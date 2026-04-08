import Replicate from "replicate";
import fs from "fs";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export async function inpaint(imagePath, maskPath) {
  const output = await replicate.run(
    "stability-ai/stable-diffusion-inpainting",
    {
      input: {
        image: fs.createReadStream(imagePath),
        mask: fs.createReadStream(maskPath),
        prompt: "clean background without watermark"
      }
    }
  );

  return output[0]; // URL hasil
}
