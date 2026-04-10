#!/usr/bin/env node
/**
 * Verify FFmpeg installation
 * FIX: Sesuaikan path dengan setup-ffmpeg.js yang menyimpan langsung di resources/ffmpeg/
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources', 'ffmpeg');

console.log('🔍 Memeriksa instalasi FFmpeg...\n');
console.log(`📁 Lokasi: ${RESOURCES_DIR}\n`);

// FIX: Binary langsung di resources/ffmpeg/, bukan di subfolder platform
const binaries = process.platform === 'win32' 
  ? ['ffmpeg.exe', 'ffprobe.exe']
  : ['ffmpeg', 'ffprobe'];

let allGood = true;

for (const binary of binaries) {
  const binaryPath = path.join(RESOURCES_DIR, binary);
  const exists = fs.existsSync(binaryPath);
  
  console.log(`${exists ? '✅' : '❌'} ${binary}`);
  
  if (exists) {
    try {
      const version = execSync(`"${binaryPath}" -version`, { encoding: 'utf8', timeout: 5000 });
      console.log(`   ${version.split('\n')[0]}`);
    } catch (e) {
      console.log(`   ⚠️  Tidak bisa dieksekusi: ${e.message}`);
      allGood = false;
    }
  } else {
    allGood = false;
  }
}

console.log('\n' + (allGood 
  ? '✅ FFmpeg siap digunakan!' 
  : '❌ FFmpeg belum ter-setup. Jalankan: npm run setup:ffmpeg'));

process.exit(allGood ? 0 : 1);
