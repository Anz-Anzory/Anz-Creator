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
git clone https://github.com/username/anz-video-publisher.git
cd anz-video-publisher

# Install dependencies
npm install

# Setup FFmpeg (otomatis)
npm run setup:ffmpeg

# Verify setup
npm run verify:ffmpeg

# Run development
npm run dev
