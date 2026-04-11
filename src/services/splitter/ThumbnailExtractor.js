const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

class ThumbnailExtractor {
  constructor() {
    // FIX: Simpan thumbnail di folder yang SAMA dengan generated-clips
    // Sebelumnya di os.tmpdir()/thumbnails/ — bisa dihapus OS kapan saja
    // dan path berbeda dari clip sehingga sulit di-track
    this.tempDir = path.join(require('os').tmpdir(), 'generated-clips', 'thumbnails');
  }

  async extractThumbnails(clipPath, plan, options = {}) {
    const count = options.count || 3;
    const thumbnails = [];
    
    await fs.mkdir(this.tempDir, { recursive: true });
    
    const clipDuration = await this.getClipDuration(clipPath);
    const positions = this.calculateThumbnailPositions(clipDuration, plan, count);
    
    // Detect orientasi video
    const isPortrait = await new Promise((resolve) => {
      ffmpeg.ffprobe(clipPath, (err, metadata) => {
        if (err) return resolve(true); // Default portrait
        const video = metadata.streams.find(s => s.codec_type === 'video');
        resolve(video ? video.height > video.width : true);
      });
    });
    
    for (let i = 0; i < positions.length; i++) {
      try { // <--- TAMBAHKAN PEMBUKA TRY DI SINI
        const timestamp = positions[i];
        
        // Buat nama file unik berdasarkan nama clip dan index
        const baseName = path.basename(clipPath, path.extname(clipPath));
        const thumbName = `${baseName}_thumb_${i + 1}.jpg`;
        const outputPath = path.join(this.tempDir, thumbName);

        // Ekstrak frame
        await this.captureFrame(clipPath, timestamp, outputPath, isPortrait);
        
        // Verifikasi file BENAR-BENAR ada setelah capture
        if (!fsSync.existsSync(outputPath)) {
          console.warn(`⚠️ Thumbnail ${thumbName} tidak terbuat, skip`);
          continue;
        }
        
        const stats = await fs.stat(outputPath);
        if (stats.size < 100) {
          // File terlalu kecil = kemungkinan corrupt/kosong
          console.warn(`⚠️ Thumbnail ${thumbName} terlalu kecil (${stats.size} bytes), skip`);
          await fs.unlink(outputPath).catch(() => {});
          continue;
        }
        
        const qualityScore = await this.scoreFrameQuality(outputPath);
        
        thumbnails.push({
          path: outputPath,
          timestamp,
          qualityScore,
          rank: i + 1
        });
      } catch (err) { // <--- SEKARANG CATCH INI PUNYA PASANGAN
        // Gunakan positions[i] di pesan error karena jika gagal di awal, 
        // variabel timestamp mungkin belum terbaca dengan baik
        console.warn(`Gagal ekstrak thumbnail ${i} di ${positions[i]}s:`, err.message);
      }
    }
    
    // Sort berdasarkan kualitas
    thumbnails.sort((a, b) => b.qualityScore - a.qualityScore);
    thumbnails.forEach((t, i) => t.rank = i + 1);
    
    return thumbnails;
  }

  // FIX: Gunakan -ss + -frames:v 1 (paling reliable untuk capture frame tunggal)
  // .screenshots() dari fluent-ffmpeg sering bermasalah dengan naming
  captureFrame(videoPath, timestamp, outputPath, isPortrait = true) {
    const size = isPortrait 
      ? 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2'
      : 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2';
    
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .seekInput(timestamp)
        .frames(1)
        .outputOptions(['-vf', size, '-q:v', '2'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', (err) => reject(new Error(`Capture frame gagal: ${err.message}`)))
        .run();
    });
  }

  // FIX: Ambil durasi clip sebenarnya dari file
  getClipDuration(clipPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(clipPath, (err, metadata) => {
        if (err) {
          resolve(30); // Default 30 detik jika gagal
        } else {
          resolve(parseFloat(metadata.format.duration) || 30);
        }
      });
    });
  }

  calculateThumbnailPositions(clipDuration, plan, count) {
    const duration = clipDuration || plan.duration || 30;
    const positions = [];
    
    // FIX: Pastikan semua posisi DALAM durasi clip (bukan di luar)
    // Sebelumnya bisa request timestamp > durasi clip → FFmpeg gagal
    const safeDuration = Math.max(duration - 0.5, 1); // Kurangi 0.5 detik dari akhir
    
    // Posisi 1: Dekat awal (hook) — 10% atau max 3 detik
    positions.push(Math.min(3, safeDuration * 0.1));
    
    // Posisi 2: Tengah
    if (count >= 2) {
      positions.push(safeDuration * 0.5);
    }
    
    // Posisi 3: Menjelang akhir
    if (count >= 3) {
      if (plan.keyMoments && plan.keyMoments.length > 0) {
        const match = plan.keyMoments[0].match(/(\d+)s/);
        if (match) {
          const keyTime = parseInt(match[1]);
          // Pastikan key moment dalam durasi clip
          positions.push(Math.min(keyTime, safeDuration * 0.9));
        } else {
          positions.push(safeDuration * 0.8);
        }
      } else {
        positions.push(safeDuration * 0.8);
      }
    }
    
    return positions.slice(0, count);
  }

  async scoreFrameQuality(framePath) {
    try {
      let score = 50;
      const stats = await fs.stat(framePath);
      const fileSizeKB = stats.size / 1024;

      if (fileSizeKB > 120) score += 40;
      else if (fileSizeKB > 80) score += 30;
      else if (fileSizeKB > 50) score += 15;
      else if (fileSizeKB < 20) score -= 20;

      return Math.min(100, Math.max(0, score));
    } catch (err) {
      return 50;
    }
  }
}

module.exports = ThumbnailExtractor;
