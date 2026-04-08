const WatermarkDetector = require('./WatermarkDetector');
const VideoInpainter = require('./VideoInpainter');

class VideoProcessor {
  constructor(apiKeys) {
    this.detector = new WatermarkDetector(apiKeys);
    this.inpainter = new VideoInpainter(apiKeys);
  }

  async processVideo(videoPath, options = {}) {
    const results = {
      originalPath: videoPath,
      stages: []
    };

    const detectOptions = {
      useAI: true,
      useHeuristics: true,
      templates: options.watermarkTemplates || []
    };

    const tempDir = require('os').tmpdir();
    const framePath = `${tempDir}/sample-frame-${Date.now()}.jpg`;
    
    await new Promise((resolve, reject) => {
      const ffmpeg = require('fluent-ffmpeg');
      ffmpeg(videoPath)
        .screenshots({
          timestamps: ['50%'],
          filename: require('path').basename(framePath),
          folder: require('path').dirname(framePath),
          size: '1280x720'
        })
        .on('end', resolve)
        .on('error', reject);
    });

    const fs = require('fs').promises;
    const base64 = await fs.readFile(framePath, { encoding: 'base64' });
    
    const detection = await this.detector.detect(
      base64,
      framePath,
      detectOptions
    );

    results.detection = detection;
    results.stages.push({
      stage: 'detection',
      status: detection.hasWatermark ? 'watermark_found' : 'clean',
      watermarks: detection.watermarks
    });

    if (detection.hasWatermark && options.removeWatermark !== false) {
      const inpaintResult = await this.inpainter.inpaintMultiple(
        videoPath,
        [detection],
        {
          method: options.inpaintMethod || 'hybrid',
          outputPath: options.outputPath
        }
      );

      results.inpainting = inpaintResult;
      results.stages.push({
        stage: 'inpainting',
        status: 'complete',
        outputPath: inpaintResult.outputPath
      });
      
      results.finalPath = inpaintResult.outputPath;
    } else {
      results.finalPath = videoPath;
    }

    return results;
  }
}

module.exports = VideoProcessor;
