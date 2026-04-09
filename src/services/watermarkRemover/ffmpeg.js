const { execSync } = require("child_process");

function extractFrames(input) {
  execSync(`ffmpeg -i ${input} frames/frame_%04d.png`);
}

function cropWatermark(input, output, cfg) {
  const { width, height, x, y } = cfg;
  execSync(`ffmpeg -i ${input} -filter:v "crop=${width}:${height}:${x}:${y}" ${output}`);
}

function overlayBack(frame, cleaned, output, cfg) {
  const { x, y } = cfg;
  execSync(`ffmpeg -i ${frame} -i ${cleaned} -filter_complex "overlay=${x}:${y}" ${output}`);
}

function buildVideo() {
  execSync(`ffmpeg -framerate 30 -i frames_clean/frame_%04d.png -c:v libx264 output.mp4`);
}

module.exports = {
  extractFrames,
  cropWatermark,
  overlayBack,
  buildVideo
};