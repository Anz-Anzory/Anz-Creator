# 🎬 Anz Video Publisher

AI-powered desktop application for viral video content generation and optimization.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Electron](https://img.shields.io/badge/Electron-28.x-9fe2bf.svg)
![React](https://img.shields.io/badge/React-18.x-61dafb.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ Features

- 🤖 **AI Video Analysis** - Gemini-powered content analysis
- ✂️ **Smart Video Splitter** - Convert long videos to viral short clips
- 🎨 **Watermark Remover** - AI inpainting untuk menghapus watermark
- 📝 **Auto Caption** - Generate caption & hashtag otomatis
- 🎯 **FYP Score** - Prediksi viral potential dengan AI
- 🖼️ **Thumbnail Extractor** - Auto-select thumbnail terbaik
- 🔄 **Multi-API Key Rotation** - Support banyak Gemini API keys

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0
- FFmpeg (auto-setup included)

### Installation

```bash
# Clone repository
git clone https://github.com/Anz-Anzory/Anz-Creator.git
cd anz-video-publisher

# Install dependencies
npm install

# Setup FFmpeg (otomatis download)
npm run setup:ffmpeg

# Verify FFmpeg
npm run verify:ffmpeg

# (Opsional) Setup environment variables untuk Watermark Remover
cp .env.example .env
# Edit .env dan isi REPLICATE_API_TOKEN

# Run development
npm run dev
```

### Build

```bash
# Build untuk Windows
npm run build:win

# Build untuk macOS
npm run build:mac

# Build untuk Linux
npm run build:linux
```

## ⚙️ Configuration

### Gemini API Key (Wajib)
1. Dapatkan API key di [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Buka aplikasi → Settings → masukkan API key
3. Bisa menambahkan beberapa key untuk rotasi otomatis

### Replicate API Token (Opsional - untuk Watermark Remover)
1. Dapatkan token di [Replicate](https://replicate.com/account/api-tokens)
2. Salin `.env.example` menjadi `.env`
3. Isi `REPLICATE_API_TOKEN=r8_...`

## 🛠️ Troubleshooting

### FFmpeg tidak ditemukan
```bash
npm run setup:ffmpeg
npm run verify:ffmpeg
```

### Build gagal — icon tidak ditemukan
Pastikan file icon tersedia di folder `resources/`:
- `icon.png` (256x256, untuk Linux)
- `icon.ico` (untuk Windows)
- `icon.icns` (untuk macOS)

### Error "API key belum dikonfigurasi"
Buka Settings di aplikasi dan tambahkan minimal 1 Gemini API key.

## 📄 License

MIT License - lihat file [LICENSE](LICENSE)
