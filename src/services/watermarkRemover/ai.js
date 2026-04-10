const Replicate = require("replicate");
const fs = require("fs");

const { PNG } = require("pngjs");

async function inpaint(imagePath, maskPath) {
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error(
      'REPLICATE_API_TOKEN belum dikonfigurasi. ' +
      'Dapatkan token di https://replicate.com/account/api-tokens ' +
      'lalu tambahkan ke file .env'
    );
  }

  // Generate mask putih (semua pixel = inpaint) seukuran image
  const img = PNG.sync.read(fs.readFileSync(imagePath));
  const mask = new PNG({ width: img.width, height: img.height });
  for (let i = 0; i < mask.data.length; i += 4) {
    mask.data[i] = 255;     // R
    mask.data[i + 1] = 255; // G
    mask.data[i + 2] = 255; // B
    mask.data[i + 3] = 255; // A
  }
  const generatedMaskPath = maskPath.replace(/\.png$/i, '_mask.png');
  fs.writeFileSync(generatedMaskPath, PNG.sync.write(mask));

  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  const output = await replicate.run(
    "stability-ai/stable-diffusion-inpainting",
    {
      input: {
        image: fs.createReadStream(imagePath),
        mask: fs.createReadStream(generatedMaskPath),
        prompt: "clean background, seamless texture, no watermark"
      }
    }
  );

  // Cleanup mask temp
  try { fs.unlinkSync(generatedMaskPath); } catch (e) {}

  return output[0];
}

module.exports = {
  inpaint
};
