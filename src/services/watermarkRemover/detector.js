const fs = require("fs");
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch");

function detectWatermark(framePath, templatePath) {
  try {
    const img = PNG.sync.read(fs.readFileSync(framePath));
    const template = PNG.sync.read(fs.readFileSync(templatePath));

    const { width: tw, height: th } = template;

    let best = { x: 0, y: 0, diff: Infinity };

    for (let y = 0; y < img.height - th; y += 10) {
      for (let x = 0; x < img.width - tw; x += 10) {
        const crop = new PNG({ width: tw, height: th });

        PNG.bitblt(img, crop, x, y, tw, th, 0, 0);

        const diff = pixelmatch(
          crop.data,
          template.data,
          null,
          tw,
          th,
          { threshold: 0.2 }
        );

        if (diff < best.diff) {
          best = { x, y, diff };
        }
      }
    }

    const totalPixels = tw * th;
    const diffRatio = best.diff / totalPixels;
    if (diffRatio > 0.3) {
      // Terlalu beda = bukan watermark
      return null;
    }

    return {
      x: best.x,
      y: best.y,
      width: tw,
      height: th
    };
  } catch (err) {
    console.error('Watermark detection error:', err.message);
    return null;
  }
}

module.exports = {
  detectWatermark
};
