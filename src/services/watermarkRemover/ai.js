const Replicate = require("replicate");
const fs = require("fs");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

async function inpaint(imagePath, maskPath) {
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