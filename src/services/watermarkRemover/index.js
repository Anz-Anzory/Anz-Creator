import fs from "fs";
import path from "path";
import fetch from "node-fetch";

import { extractFrames, cropWatermark, overlayBack, buildVideo } from "./ffmpeg.js";
import { inpaint } from "./ai.js";
import { detectWatermark } from "./detector.js";
import { trackWatermark } from "./tracker.js";
import { watermarkList, settings } from "./config.js";

const framesDir = "frames";
const croppedDir = "cropped";
const cleanDir = "clean";
const finalDir = "frames_clean";

export async function processVideo(inputVideo) {
  console.log("🚀 Start processing...");

  // ensure folder
  [framesDir, croppedDir, cleanDir, finalDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  });

  // 1. extract frames
  extractFrames(inputVideo);

  const files = fs.readdirSync(framesDir).sort();

  let detectedAreas = [];

  for (let i = 0; i < files.length; i++) {
    const frame = files[i];
    const framePath = path.join(framesDir, frame);

    console.log(`🎬 Frame ${i + 1}/${files.length}`);

    // 🔥 DETECT (FIRST FRAME ONLY)
    if (i === 0) {
      detectedAreas = watermarkList.map(wm => {
        console.log(`🔍 Detecting: ${wm.name}`);
        return detectWatermark(framePath, wm.template);
      });
    } else {
      // tracking
      detectedAreas = detectedAreas.map(area =>
        trackWatermark(area, i)
      );
    }

    let currentFramePath = framePath;

    // 🔥 LOOP MULTI WATERMARK
    for (let w = 0; w < detectedAreas.length; w++) {
      const area = detectedAreas[w];

      const cropPath = path.join(croppedDir, `${w}_${frame}`);
      const cleanedPath = path.join(cleanDir, `${w}_${frame}`);
      const outputPath = path.join(finalDir, `${w}_${frame}`);

      // skip frame (hemat API)
      if (i % settings.processEveryNFrame !== 0) {
        continue;
      }

      // 2. crop watermark area
      cropWatermark(currentFramePath, cropPath, area);

      // 3. AI inpainting
      const resultUrl = await inpaint(cropPath, cropPath);

      // download hasil AI
      const res = await fetch(resultUrl);
      const buffer = await res.arrayBuffer();
      fs.writeFileSync(cleanedPath, Buffer.from(buffer));

      // 4. overlay balik
      overlayBack(currentFramePath, cleanedPath, outputPath, area);

      // update frame untuk watermark berikutnya
      currentFramePath = outputPath;
    }

    // kalau tidak diproses (skip frame)
    const finalFrame = path.join(finalDir, frame);

    if (!fs.existsSync(finalFrame)) {
      fs.copyFileSync(currentFramePath, finalFrame);
    }
  }

  // 5. build video
  buildVideo();

  console.log("✅ DONE: output.mp4");
}
