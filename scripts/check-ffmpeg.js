#!/usr/bin/env node
/**
 * Verify FFmpeg installation
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources', 'ffmpeg');

const platform = process.platform === 'win32' ? 'windows' : 
                 process.platform === 'darwin' ? 'mac' : 'linux';

const platformDir = path.join(RESOURCES_DIR, platform);

console.log('🔍 Checking FFmpeg installation...\n');

const binaries = process.platform === 'win32' 
  ? ['ffmpeg.exe', 'ffprobe.exe']
  : ['ffmpeg', 'ffprobe'];

let allGood = true;

for (const binary of binaries) {
  const binaryPath = path.join(platformDir, binary);
  const exists = fs.existsSync(binaryPath);
  
  console.log(`${exists ? '✅' : '❌'} ${binary}`);
  
  if (exists) {
    try {
      const version = execSync(`"${binaryPath}" -version`, { encoding: 'utf8', timeout: 5000 });
      console.log(`   ${version.split('\n')[0]}`);
    } catch (e) {
      console.log(`   ⚠️  Cannot execute: ${e.message}`);
      allGood = false;
    }
  } else {
    allGood = false;
  }
}

console.log('\n' + (allGood ? '✅ FFmpeg is ready!' : '❌ FFmpeg setup incomplete'));
console.log(`📁 Location: ${platformDir}`);

process.exit(allGood ? 0 : 1);
