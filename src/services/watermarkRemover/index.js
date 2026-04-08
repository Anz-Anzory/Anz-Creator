import fs from "fs";
import path from "path";
import { extractFrames, cropWatermark, overlayBack, buildVideo } from "./ffmpeg.js";
import { inpaint } from "./ai.js";
import { watermarkConfig } from "./config.js";

const framesDir = "frames";
const croppedDir = "cropped";
const cleanDir = "clean";
const finalDir = "frames_clean";

export async function processVideo(inputVideo) {
  // 1. extract frame
  extractFrames(inputVideo);

  const files = fs.readdirSync(framesDir);

  for (let i = 0; i < files.length; i++) {
    const frame = files[i];

    // skip frame (optimasi)
    if (i % watermarkConfig.processEveryNFrame !== 0) {
      fs.copyFileSync(
        path.join(framesDir, frame),
        path.join(finalDir, frame)
      );
      continue;
    }

    const framePath = path.join(framesDir, frame);
    const cropPath = path.join(croppedDir, frame);

    // 2. crop watermark
    cropWatermark(framePath, cropPath, watermarkConfig);

    // 3. kirim ke AI
    const resultUrl = await inpaint(cropPath, cropPath);

    // download hasil AI
    const res = await fetch(resultUrl);
    const buffer = await res.arrayBuffer();
    const cleanedPath = path.join(cleanDir, frame);
    fs.writeFileSync(cleanedPath, Buffer.from(buffer));

    // 4. overlay balik
    const finalPath = path.join(finalDir, frame);
    overlayBack(framePath, cleanedPath, finalPath, watermarkConfig);
  }

  // 5. build video
  buildVideo();

  console.log("✅ DONE: output.mp4");
}
