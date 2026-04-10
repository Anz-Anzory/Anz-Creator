const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const fetch = require("node-fetch");
const os = require("os");

const { extractFrames, cropWatermark, overlayBack, buildVideo } = require("./ffmpeg");
const { inpaint } = require("./ai");
const { detectWatermark } = require("./detector");
const { trackWatermark } = require("./tracker");
const { watermarkList, settings } = require("./config");

const tempBasePath = path.join(os.tmpdir(), 'anz-video-temp');

async function processVideo(inputVideo, options = {}) {
  console.log("🚀 Mulai proses penghapusan watermark...");

  // Bersihkan direktori temp dari eksekusi sebelumnya
  if (fs.existsSync(tempBasePath)) {
    fs.rmSync(tempBasePath, { recursive: true, force: true });
  }
  fs.mkdirSync(tempBasePath, { recursive: true });

  const framesDir = path.join(tempBasePath, "frames");
  const croppedDir = path.join(tempBasePath, "cropped");
  const cleanDir = path.join(tempBasePath, "clean");
  const finalDir = path.join(tempBasePath, "frames_clean");

  // Buat semua folder kerja
  [framesDir, croppedDir, cleanDir, finalDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  // FIX: Gunakan fungsi async yang benar dan path output yang tepat
  await extractFrames(inputVideo, framesDir);

  // Pengurutan frame secara numerik
  const files = fs.readdirSync(framesDir).sort((a, b) => {
    const numA = parseInt((a.match(/\d+/) || ['0'])[0], 10);
    const numB = parseInt((b.match(/\d+/) || ['0'])[0], 10);
    return numA - numB;
  });

  if (files.length === 0) {
    throw new Error('Tidak ada frame yang berhasil diekstrak dari video.');
  }

  console.log(`📸 Total frame: ${files.length}`);

  let detectedAreas = [];

  for (let i = 0; i < files.length; i++) {
    const frame = files[i];
    const framePath = path.join(framesDir, frame);

    console.log(`🎬 Frame ${i + 1}/${files.length}`);

    // Deteksi watermark hanya di frame pertama
    if (i === 0) {
      detectedAreas = [];
      for (const wm of watermarkList) {
        // FIX: Resolve path template dengan benar
        const templatePath = path.isAbsolute(wm.template)
          ? wm.template
          : path.join(__dirname, '..', '..', '..', wm.template);
          
        if (fs.existsSync(templatePath)) {
          console.log(`🔍 Mendeteksi: ${wm.name}`);
          const area = detectWatermark(framePath, templatePath);
          if (area) {
            detectedAreas.push(area);
          }
        } else {
          console.warn(`⚠️ Template tidak ditemukan: ${templatePath}`);
        }
      }
      
      if (detectedAreas.length === 0) {
        console.log('✅ Tidak ada watermark terdeteksi, skip proses.');
        // Salin video asli sebagai output
        const outputPath = options.outputPath || inputVideo.replace(/(\.\w+)$/, '_no-watermark$1');
        await fsPromises.copyFile(inputVideo, outputPath);
        return { finalPath: outputPath, watermarksRemoved: 0 };
      }
    } else {
      detectedAreas = detectedAreas.map(area => trackWatermark(area, i));
    }

    // Skip frame berdasarkan setting untuk efisiensi API
    if (i % settings.processEveryNFrame !== 0) {
      // Salin frame asli ke folder final
      const finalFrame = path.join(finalDir, frame);
      if (!fs.existsSync(finalFrame)) {
        fs.copyFileSync(framePath, finalFrame);
      }
      continue;
    }

    let currentFramePath = framePath;

    // Proses setiap watermark yang terdeteksi
    for (let w = 0; w < detectedAreas.length; w++) {
      const area = detectedAreas[w];
      const cropPath = path.join(croppedDir, `${w}_${frame}`);
      const cleanedPath = path.join(cleanDir, `${w}_${frame}`);
      const outputPath = path.join(finalDir, `${w}_${frame}`);

      try {
        // Crop area watermark
        await cropWatermark(currentFramePath, cropPath, area);

        // AI inpainting
        const resultUrl = await inpaint(cropPath, cropPath);

        // Download hasil inpainting
        const res = await fetch(resultUrl);
        const buffer = await res.arrayBuffer();
        fs.writeFileSync(cleanedPath, Buffer.from(buffer));

        // Overlay kembali ke frame asli
        await overlayBack(currentFramePath, cleanedPath, outputPath, area);

        currentFramePath = outputPath;
      } catch (err) {
        console.warn(`⚠️ Gagal proses watermark ${w} di frame ${i}:`, err.message);
      }
    }

    // Pastikan frame final tersedia — SELALU overwrite dengan hasil terbaru
    const finalFrame = path.join(finalDir, frame);
    fs.copyFileSync(currentFramePath, finalFrame);
    }
  }

  // Build video dari frame-frame yang sudah dibersihkan
  const outputVideoPath = options.outputPath || inputVideo.replace(/(\.\w+)$/, '_no-watermark$1');
  await buildVideo(finalDir, outputVideoPath);

  console.log("✅ SELESAI: " + outputVideoPath);
  
  return { 
    finalPath: outputVideoPath, 
    watermarksRemoved: detectedAreas.length 
  };
}

module.exports = {
  processVideo
};
