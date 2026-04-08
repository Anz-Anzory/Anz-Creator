const ffmpeg = require('fluent-ffmpeg');
const cv = require('@u4/opencv4nodejs');
const fs = require('fs').promises;
const path = require('path');

class FrameProcessor {
  constructor() {
    this.tempDir = path.join(require('os').tmpdir(), 'frame-processor');
  }

  async extractFramesBatch(videoPath, timestamps, options = {}) {
    await fs.mkdir(this.tempDir, { recursive: true });
    
    const frames = [];
    
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const framePath = path.join(this.tempDir, `frame-${i}-${Date.now()}.jpg`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .screenshots({
            timestamps: [timestamp],
            filename: path.basename(framePath),
            folder: path.dirname(framePath),
            size: options.size || '720x1280'
          })
          .on('end', resolve)
          .on('error', reject);
      });
      
      const base64 = await fs.readFile(framePath, { encoding: 'base64' });
      frames.push({
        path: framePath,
        base64,
        timestamp,
        index: i
      });
    }
    
    return frames;
  }

  async analyzeFrameQuality(framePath) {
    const img = cv.imread(framePath);
    const results = {
      blur: this.detectBlur(img),
      brightness: this.analyzeBrightness(img),
      contrast: this.analyzeContrast(img),
      faces: this.detectFaces(img)
    };
    
    return results;
  }

  detectBlur(img) {
    const gray = img.bgrToGray();
    const laplacian = gray.laplacian(cv.CV_64F);
    const variance = laplacian.mean().z;
    return {
      score: Math.min(100, variance),
      isBlurry: variance < 100
    };
  }

  analyzeBrightness(img) {
    const gray = img.bgrToGray();
    const mean = gray.mean();
    return {
      value: mean,
      isGood: mean > 80 && mean < 200
    };
  }

  analyzeContrast(img) {
    const gray = img.bgrToGray();
    const stdDev = gray.meanStdDev().stddev;
    return {
      value: stdDev,
      isGood: stdDev > 40
    };
  }

  detectFaces(img) {
    const classifier = new cv.CascadeClassifier(cv.HAAR_FRONTALFACE_DEFAULT);
    const gray = img.bgrToGray();
    const faces = classifier.detectMultiScale(gray);
    return {
      count: faces.objects.length,
      regions: faces.objects
    };
  }

  async cleanup() {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = FrameProcessor;
