function trackWatermark(prev, frameIndex) {
  // simple tracking (bisa kamu upgrade nanti)
  return {
    x: prev.x,
    y: prev.y,
    width: prev.width,
    height: prev.height
  };
}

module.exports = {
  trackWatermark
};