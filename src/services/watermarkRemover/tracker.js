function trackWatermark(prev, frameIndex) {
  // Simple tracking — posisi watermark diasumsikan tetap
  // Bisa di-upgrade nanti dengan optical flow
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
