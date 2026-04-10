const Replicate = require("replicate");
const fs = require("fs");

async function inpaint(imagePath, maskPath) {
  // FIX: Periksa apakah API token tersedia
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error(
      'REPLICATE_API_TOKEN belum dikonfigurasi. ' +
      'Dapatkan token di https://replicate.com/account/api-tokens ' +
      'lalu tambahkan ke file .env'
    );
  }

  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  const output = await replicate.run(
    "stability-ai/stable-diffusion-inpainting",
    {
      input: {
        image: fs.createReadStream(imagePath),
        mask: fs.createReadStream(maskPath),
        prompt: "remove watermark clean background"
      }
    }
  );

  return output[0];
}

module.exports = {
  inpaint
};
