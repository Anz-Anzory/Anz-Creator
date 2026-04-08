const ffmpeg = require('fluent-ffmpeg');
const cv = require('@u4/opencv4nodejs');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class VideoInpainter {
  constructor(apiKeys) {
    this.apiKeys = apiKeys;
    this.tempDir = path.join(require('os').tmpdir(), 'video-inpaint');
  }

  async inpaintVideo(videoPath, watermarkRegions, options = {}) {
    console.log('Starting video inpainting...');
    
    const outputPath = options.outputPath || videoPath.replace('.mp4', '_cleaned.mp4');
    const method = options.method || 'hybrid';
    
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      const framesDir = path.join(this.tempDir, 'frames');
      const masksDir = path.join(this.tempDir, 'masks');
      const outputDir = path.join(this.tempDir, 'output');
      
      await fs.mkdir(framesDir, { recursive: true });
      await fs.mkdir(masksDir, { recursive: true });
      await fs.mkdir(outputDir, { recursive: true });

      console.log('Extracting frames...');
      await this.extractFrames(videoPath, framesDir);

      console.log('Creating masks...');
      const frameFiles = (await fs.readdir(framesDir))
        .filter(f => f.endsWith('.jpg'))
        .sort();
      
      for (const frameFile of frameFiles) {
        const framePath = path.join(framesDir, frameFile);
        const maskPath = path.join(masksDir, frameFile);
        await this.createMask(framePath, maskPath, watermarkRegions);
      }

      console.log(`Applying inpainting (${method} method)...`);
      
      if (method === 'opencv') {
        await this.inpaintWithOpenCV(framesDir, masksDir, outputDir, frameFiles);
      } else if (method === 'lama') {
        await this.inpaintWithLaMa(framesDir, masksDir, outputDir);
      } else {
        await this.inpaintHybrid(framesDir, masksDir, outputDir, frameFiles);
      }

      console.log('Reconstructing video...');
      await this.reconstructVideo(outputDir, videoPath, outputPath);

      await fs.rm(this.tempDir, { recursive: true, force: true });
      
      console.log('Inpainting complete!');
      return {
        success: true,
        outputPath,
        framesProcessed: frameFiles.length
      };

    } catch (error) {
      console.error('Inpainting failed:', error);
      throw error;
    }
  }

  async extractFrames(videoPath, outputDir) {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions(['-q:v 2'])
        .output(path.join(outputDir, 'frame-%06d.jpg'))
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }

  async createMask(framePath, maskPath, regions) {
    const frame = cv.imread(framePath);
    const mask = new cv.Mat(frame.rows, frame.cols, cv.CV_8UC1, 0);
    
    for (const region of regions) {
      const rect = new cv.Rect(
        Math.floor(region.x),
        Math.floor(region.y),
        Math.floor(region.width),
        Math.floor(region.height)
      );
      
      const roi = mask.getRegion(rect);
      roi.setTo(new cv.Vec3(255, 255, 255));
      
      const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
      const dilated = mask.dilate(kernel);
      mask.copyTo(dilated);
    }
    
    cv.imwrite(maskPath, mask);
  }

  async inpaintWithOpenCV(framesDir, masksDir, outputDir, frameFiles) {
    const inpaintRadius = 3;
    const algorithm = cv.INPAINT_NS;
    
    for (const frameFile of frameFiles) {
      const framePath = path.join(framesDir, frameFile);
      const maskPath = path.join(masksDir, frameFile);
      const outputPath = path.join(outputDir, frameFile);
      
      const frame = cv.imread(framePath);
      const mask = cv.imread(maskPath, cv.IMREAD_GRAYSCALE);
      
      const result = frame.inpaint(mask, inpaintRadius, algorithm);
      cv.imwrite(outputPath, result);
    }
  }

  async inpaintWithLaMa(framesDir, masksDir, outputDir) {
    const lamaCommand = `lama-cleaner \
      --device cuda \
      --input "${framesDir}" \
      --mask "${masksDir}" \
      --output "${outputDir}" \
      --lama-model lama \
      --resize-limit 2048`;
    
    try {
      await execAsync(lamaCommand);
    } catch (error) {
      console.warn('LaMa not available, falling back to OpenCV');
      const frameFiles = (await fs.readdir(framesDir))
        .filter(f => f.endsWith('.jpg'))
        .sort();
      await this.inpaintWithOpenCV(framesDir, masksDir, outputDir, frameFiles);
    }
  }

  async inpaintHybrid(framesDir, masksDir, outputDir, frameFiles) {
    for (const frameFile of frameFiles) {
      const maskPath = path.join(masksDir, frameFile);
      const mask = cv.imread(maskPath, cv.IMREAD_GRAYSCALE);
      const nonZero = mask.countNonZero();
      const totalPixels = mask.rows * mask.cols;
      const maskRatio = nonZero / totalPixels;
      
      if (maskRatio < 0.05) {
        const framePath = path.join(framesDir, frameFile);
        const outputPath = path.join(outputDir, frameFile);
        const frame = cv.imread(framePath);
        const result = frame.inpaint(mask, 3, cv.INPAINT_NS);
        cv.imwrite(outputPath, result);
      } else {
        await fs.copyFile(maskPath, path.join(masksDir, 'complex_' + frameFile));
      }
    }
    
    try {
      const complexMasks = (await fs.readdir(masksDir))
        .filter(f => f.startsWith('complex_'));
      
      if (complexMasks.length > 0) {
        await this.inpaintWithLaMa(framesDir, masksDir, outputDir);
      }
    } catch {
      // Continue dengan OpenCV results
    }
  }

  async reconstructVideo(framesDir, originalVideo, outputPath) {
    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(originalVideo, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const fps = eval(metadata.streams[0].r_frame_rate);
    
    return new Promise((resolve, reject) => {
      ffmpeg(path.join(framesDir, 'frame-%06d.jpg'))
        .inputOptions([`-framerate ${fps}`])
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-crf 18',
          '-preset slow',
          '-movflags +faststart'
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }

  async inpaintMultiple(videoPath, detections, options) {
    const allRegions = detections.flatMap(d => d.watermarks.map(w => w.coordinates));
    
    const normalizedRegions = allRegions.map(region => ({
      x: Math.floor(region.x),
      y: Math.floor(region.y),
      width: Math.ceil(region.width),
      height: Math.ceil(region.height)
    }));

    return this.inpaintVideo(videoPath, normalizedRegions, options);
  }
}

module.exports = VideoInpainter;
