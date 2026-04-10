// Daftar template watermark untuk deteksi
// PENTING: Path template harus relatif terhadap root project
// Pastikan file PNG template sudah tersedia sebelum menggunakan fitur ini
const watermarkList = [
  {
    name: "wm1",
    template: "templates/wm1.png"  // Buat folder templates/ dan taruh template PNG di sini
  },
  {
    name: "wm2",
    template: "templates/wm2.png"
  }
];

const settings = {
  processEveryNFrame: 5  // Proses setiap N frame (hemat API quota)
};

module.exports = {
  watermarkList,
  settings
};
