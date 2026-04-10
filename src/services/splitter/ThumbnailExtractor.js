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
      const framePath = path.join(this.tempDir, `thumb-${plan.id}-${i}-${Date.now()}.jpg`);
      
      try {
        await new Promise((resolve, reject) => {
          ffmpeg(clipPath)
            .screenshots({
              timestamps: [timestamp],
              filename: path.basename(framePath),
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
      } catch (err) {
        console.warn(`Gagal ekstrak thumbnail ${i}:`, err.message);
      }
    }
    
    // Sort berdasarkan kualitas, rank ulang
    thumbnails.sort((a, b) => b.qualityScore - a.qualityScore);
    thumbnails.forEach((t, i) => t.rank = i + 1);
    
    return thumbnails;
  }

  calculateThumbnailPositions(plan, count) {
    const duration = plan.duration || 30;
    const positions = [];
    
    // Posisi 1: Dekat awal (hook)
    positions.push(Math.min(3, duration * 0.1));
    
    // Posisi 2: Tengah
    positions.push(duration * 0.5);
    
    // Posisi 3: Key moment atau akhir
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

  // Skor kualitas berdasarkan ukuran file (heuristik kompresi)
  async scoreFrameQuality(framePath) {
    try {
      let score = 50;
      const stats = await fs.stat(framePath);
      const fileSizeKB = stats.size / 1024;

      if (fileSizeKB > 120) {
        score += 40; // Sangat detail/tajam
      } else if (fileSizeKB > 80) {
        score += 30; // Kualitas bagus
      } else if (fileSizeKB > 50) {
        score += 15; // Kualitas standar
      } else if (fileSizeKB < 20) {
        score -= 20; // Kemungkinan layar hitam/blur
      }

      return Math.min(100, Math.max(0, score));
    } catch (err) {
      console.warn("Gagal analisa kualitas thumbnail:", err.message);
      return 50;
    }
  }
}

module.exports = ThumbnailExtractor;
