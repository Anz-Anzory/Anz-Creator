const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');

class ThumbnailExtractor {
  constructor() {
    this.tempDir = path.join(require('os').tmpdir(), 'thumbnails');
  }

  async extractThumbnails(clipPath, plan, options = {}) {
    const count = options.count || 3;
    const thumbnails = [];
    
    await fs.mkdir(this.tempDir, { recursive: true });
    
    const positions = this.calculateThumbnailPositions(plan, count);
    
    for (let i = 0; i < positions.length; i++) {
      const timestamp = positions[i];
      const framePath = path.join(this.tempDir, `thumb-${plan.id}-${i}.jpg`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(clipPath)
          .screenshots({
            timestamps: [timestamp],
            filename: `thumb-${plan.id}-${i}.jpg`,
            folder: this.tempDir,
            size: '720x1280'
          })
          .on('end', resolve)
          .on('error', reject);
      });
      
      const qualityScore = await this.scoreFrameQuality(framePath);
      
      thumbnails.push({
        path: framePath,
        timestamp,
        qualityScore,
        rank: i + 1
      });
    }
    
    thumbnails.sort((a, b) => b.qualityScore - a.qualityScore);
    thumbnails.forEach((t, i) => t.rank = i + 1);
    
    return thumbnails;
  }

  calculateThumbnailPositions(plan, count) {
    const duration = plan.duration;
    const positions = [];
    
    positions.push(Math.min(3, duration * 0.1));
    positions.push(duration * 0.5);
    
    if (plan.keyMoments && plan.keyMoments.length > 0) {
      const match = plan.keyMoments[0].match(/(\d+)s/);
      if (match) {
        positions.push(parseInt(match[1]));
      } else {
        positions.push(duration * 0.8);
      }
    } else {
      positions.push(duration * 0.8);
    }
    
    return positions.slice(0, count);
  }

  async scoreFrameQuality(framePath) {
    const img = cv.imread(framePath);
    let score = 50;
    
    const faceDetector = new cv.CascadeClassifier(cv.HAAR_FRONTALFACE_DEFAULT);
    const gray = img.bgrToGray();
    const faces = faceDetector.detectMultiScale(gray);
    if (faces.objects.length > 0) score += 20;
    
    const laplacian = gray.laplacian(cv.CV_64F);
    const mean = laplacian.mean();
    const variance = Math.sqrt(laplacian.hMul(laplacian).mean().z - mean.z * mean.z);
    if (variance > 100) score += 15;
    
    const brightness = gray.mean();
    if (brightness > 80 && brightness < 200) score += 10;
    
    const hsv = img.cvtColor(cv.COLOR_BGR2HSV);
    const saturation = hsv.extractChannel(1).mean();
    if (saturation > 50) score += 5;
    
    return Math.min(100, score);
  }
}

module.exports = ThumbnailExtractor;
