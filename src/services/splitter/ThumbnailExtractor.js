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

  // FIX: Mengganti OpenCV dengan Heuristik Kompresi File 
  async scoreFrameQuality(framePath) {
    try {
      let score = 50; // Skor dasar

      // Mengambil statistik file
      const stats = await fs.stat(framePath);
      const fileSizeKB = stats.size / 1024;

      // Gambar JPEG portrait 720x1280 yang tajam dan berwarna biasanya berukuran besar (>80KB).
      // Gambar blur atau gelap/hitam sangat mudah dikompresi sehingga ukurannya kecil (<30KB).
      if (fileSizeKB > 120) {
        score += 40; // Sangat detail / tajam
      } else if (fileSizeKB > 80) {
        score += 30; // Kualitas bagus
      } else if (fileSizeKB > 50) {
        score += 15; // Kualitas standar
      } else if (fileSizeKB < 20) {
        score -= 20; // Kemungkinan besar layar hitam atau sangat blur
      }

      return Math.min(100, Math.max(0, score)); // Pastikan skor tetap di rentang 0-100
    } catch (err) {
      console.warn("Gagal menganalisa kualitas thumbnail:", err.message);
      return 50; // Fallback jika gagal
    }
  }
}

module.exports = ThumbnailExtractor;
