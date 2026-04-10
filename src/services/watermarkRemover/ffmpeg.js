const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Ekstrak semua frame dari video ke direktori output
 * FIX: Sebelumnya pakai execSync('ffmpeg ...') yang tidak menggunakan path ffmpeg yang sudah dikonfigurasi
 */
function extractFrames(inputVideo, outputDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    ffmpeg(inputVideo)
      .outputOptions(['-vf', 'fps=1']) // 1 frame per detik untuk efisiensi
      .output(path.join(outputDir, 'frame_%04d.png'))
      .on('end', () => {
        console.log('✅ Frame extraction selesai');
        resolve();
      })
      .on('error', (err) => {
        reject(new Error(`ExtractFrames gagal: ${err.message}`));
      })
      .run();
  });
}

/**
 * Crop area watermark dari frame
 */
function cropWatermark(inputFrame, outputPath, cfg) {
  const { width, height, x, y } = cfg;
  
  return new Promise((resolve, reject) => {
    ffmpeg(inputFrame)
      .outputOptions(['-vf', `crop=${width}:${height}:${x}:${y}`])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`CropWatermark gagal: ${err.message}`)))
      .run();
  });
}

/**
 * Overlay frame yang sudah dibersihkan kembali ke frame asli
 */
function overlayBack(frameInput, cleanedInput, outputPath, cfg) {
  const { x, y } = cfg;
  
  return new Promise((resolve, reject) => {
    ffmpeg(frameInput)
      .input(cleanedInput)
      .complexFilter([`overlay=${x}:${y}`])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`OverlayBack gagal: ${err.message}`)))
      .run();
  });
}

/**
 * Build video dari frame-frame yang sudah dibersihkan
 */
function buildVideo(framesDir, outputPath, fps = 30, originalVideo = null) {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(path.join(framesDir, 'frame_%04d.png'))
      .inputOptions([`-framerate ${fps}`]);
    
    if (originalVideo) {
      cmd = cmd.input(originalVideo);
    }
    
    const outOpts = [
      '-c:v libx264',
      '-crf 23',
      '-preset fast',
      '-pix_fmt yuv420p'
    ];
    
    if (originalVideo) {
      outOpts.push('-c:a aac', '-b:a 192k', '-shortest');
    }
    
    cmd.outputOptions(outOpts)
      .output(outputPath)
      .on('end', () => {
        console.log(`✅ Video berhasil dibuild: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => reject(new Error(`BuildVideo gagal: ${err.message}`)))
      .run();
  });
}

module.exports = {
  extractFrames,
  cropWatermark,
  overlayBack,
  buildVideo
};
