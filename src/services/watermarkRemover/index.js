const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const os = require("os");

const { extractFrames, cropWatermark, overlayBack, buildVideo } = require("./ffmpeg");
const { inpaint } = require("./ai");
const { detectWatermark } = require("./detector");
const { trackWatermark } = require("./tracker");
const { watermarkList, settings } = require("./config");
const tempBasePath = path.join(os.tmpdir(), 'anz-video-temp');
if (!fs.existsSync(tempBasePath)) {
  fs.mkdirSync(tempBasePath, { recursive: true });
}

const framesDir = path.join(tempBasePath, "frames");
const croppedDir = path.join(tempBasePath, "cropped");
const cleanDir = path.join(tempBasePath, "clean");
const finalDir = path.join(tempBasePath, "frames_clean");

async function processVideo(inputVideo) {
  console.log("🚀 Start processing...");

  // buat folder
  [framesDir, croppedDir, cleanDir, finalDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  });

  // extract frame
  extractFrames(inputVideo);

  const files = fs.readdirSync(framesDir).sort();

  let detectedAreas = [];

  for (let i = 0; i < files.length; i++) {
    const frame = files[i];
    const framePath = path.join(framesDir, frame);

    console.log(`🎬 Frame ${i + 1}/${files.length}`);

    // detect hanya di frame pertama
    if (i === 0) {
      detectedAreas = watermarkList.map(wm => {
        console.log(`🔍 Detecting: ${wm.name}`);
        return detectWatermark(framePath, wm.template);
      });
    } else {
      detectedAreas = detectedAreas.map(area =>
        trackWatermark(area, i)
      );
    }

    let currentFramePath = framePath;

    // multi watermark loop
    for (let w = 0; w < detectedAreas.length; w++) {
      const area = detectedAreas[w];

      const cropPath = path.join(croppedDir, `${w}_${frame}`);
      const cleanedPath = path.join(cleanDir, `${w}_${frame}`);
      const outputPath = path.join(finalDir, `${w}_${frame}`);

      // skip frame biar hemat API
      if (i % settings.processEveryNFrame !== 0) {
        continue;
      }

      // crop
      cropWatermark(currentFramePath, cropPath, area);

      // AI inpaint
      const resultUrl = await inpaint(cropPath, cropPath);

      // download hasil
      const res = await fetch(resultUrl);
      const buffer = await res.arrayBuffer();
      fs.writeFileSync(cleanedPath, Buffer.from(buffer));

      // overlay balik
      overlayBack(currentFramePath, cleanedPath, outputPath, area);

      currentFramePath = outputPath;
    }

    // kalau frame tidak diproses
    const finalFrame = path.join(finalDir, frame);

    if (!fs.existsSync(finalFrame)) {
      fs.copyFileSync(currentFramePath, finalFrame);
    }
  }

  // build video
  buildVideo();

  console.log("✅ DONE: output.mp4");
}

module.exports = {
  processVideo
};
