#!/usr/bin/env node

const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const zlib = require('zlib');

// Configuration
const CONFIG = {
  windows: {
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    fallbackUrl: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
    extractType: 'zip',
    binaries: ['ffmpeg.exe', 'ffprobe.exe']
  },
  mac: {
    brewPackage: 'ffmpeg',
    archUrls: {
      x64: 'https://evermeet.cx/pub/ffmpeg/ffmpeg-6.1.1.zip',
      arm64: 'https://www.osxexperts.net/ffmpeg6arm.zip'
    },
    extractType: 'auto',
    binaries: ['ffmpeg', 'ffprobe']
  },
  linux: {
    aptPackage: 'ffmpeg',
    staticUrl: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
    extractType: 'tar.xz',
    binaries: ['ffmpeg', 'ffprobe']
  }
};

const RESOURCES_DIR = path.join(__dirname, '..', 'resources', 'ffmpeg');
const TEMP_DIR = path.join(require('os').tmpdir(), 'ffmpeg-setup');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function downloadFile(url, dest, label = 'Downloading') {
  console.log(`\n📥 ${label}:`);
  console.log(`   From: ${url}`);
  console.log(`   To: ${dest}`);
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fsSync.createWriteStream(dest);
    let downloaded = 0;
    let totalSize = 0;
    let lastPercent = -1;
    
    const request = protocol.get(url, { timeout: 30000 }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        console.log(`   Redirecting to: ${response.headers.location}`);
        file.close();
        fs.unlink(dest).catch(() => {});
        downloadFile(response.headers.location, dest, label).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      totalSize = parseInt(response.headers['content-length'], 10);
      
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        
        if (totalSize > 0) {
          const percent = Math.floor((downloaded / totalSize) * 100);
          
          if (percent !== lastPercent && percent % 10 === 0) {
            const mb = (downloaded / 1024 / 1024).toFixed(1);
            const totalMb = (totalSize / 1024 / 1024).toFixed(1);
            // FIX: Perbaiki string concatenation
            process.stdout.write(`\r   Progress: ${percent}% (${mb}/${totalMb} MB)`);
            lastPercent = percent;
          }
        }
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log('\n   ✅ Download complete');
        resolve(dest);
      });
    });
    
    request.on('error', (err) => {
      fs.unlink(dest).catch(() => {});
      reject(err);
    });
    
    request.on('timeout', () => {
      request.destroy();
      fs.unlink(dest).catch(() => {});
      reject(new Error('Download timeout'));
    });
  });
}

async function extractZip(zipPath, extractTo) {
  console.log('📦 Extracting ZIP...');
  
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractTo, true);
    console.log('   ✅ Extracted (adm-zip)');
    return;
  } catch (e) {
    try {
      if (process.platform === 'win32') {
        execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractTo}' -Force"`, { stdio: 'inherit' });
      } else {
        execSync(`unzip -o "${zipPath}" -d "${extractTo}"`, { stdio: 'inherit' });
      }
      console.log('   ✅ Extracted (system unzip)');
    } catch (err) {
      throw new Error('Failed to extract ZIP');
    }
  }
}

async function findFiles(dir, pattern) {
  const files = [];
  
  async function scan(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (pattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  
  await scan(dir);
  return files;
}

async function setupWindows() {
  console.log('\n🪟 Setting up FFmpeg for Windows...');
  
  const platformDir = path.join(RESOURCES_DIR, 'windows');
  await ensureDir(platformDir);
  await ensureDir(TEMP_DIR);
  
  const zipPath = path.join(TEMP_DIR, 'ffmpeg-windows.zip');
  
  try {
    await downloadFile(CONFIG.windows.url, zipPath, 'Downloading FFmpeg (Windows)');
  } catch (error) {
    console.log('   ⚠️ Primary source failed, trying fallback...');
    try {
      await downloadFile(CONFIG.windows.fallbackUrl, zipPath, 'Downloading FFmpeg (Fallback)');
    } catch (fallbackError) {
      throw new Error('Failed to download FFmpeg');
    }
  }
  
  await extractZip(zipPath, TEMP_DIR);
  
  console.log('🔍 Locating binaries...');
  const ffmpegExe = await findFiles(TEMP_DIR, /ffmpeg\.exe$/i);
  
  if (ffmpegExe.length === 0) {
    throw new Error('ffmpeg.exe not found');
  }
  
  const sourceDir = path.dirname(ffmpegExe[0]);
  
  for (const binary of CONFIG.windows.binaries) {
    const source = path.join(sourceDir, binary);
    const dest = path.join(platformDir, binary);
    
    if (fsSync.existsSync(source)) {
      await fs.copyFile(source, dest);
      console.log(`   ✅ ${binary}`);
    }
  }
  
  try {
    const result = execSync(`"${path.join(platformDir, 'ffmpeg.exe')}" -version`, { encoding: 'utf8' });
    console.log(`   ${result.split('\n')[0]}`);
  } catch (e) {
    console.log('   ⚠️ Verification failed');
  }
  
  await fs.rm(TEMP_DIR, { recursive: true, force: true });
  console.log('🧹 Cleaned up temp files');
}

async function setupMac() {
  console.log('\n🍎 Setting up FFmpeg for Mac...');
  
  const platformDir = path.join(RESOURCES_DIR, 'mac');
  await ensureDir(platformDir);
  
  try {
    execSync('which brew', { stdio: 'pipe' });
    console.log('✅ Homebrew detected, installing via brew...');
    
    execSync('brew install ffmpeg', { stdio: 'inherit' });
    
    const brewPrefix = execSync('brew --prefix', { encoding: 'utf8' }).trim();
    const brewBin = path.join(brewPrefix, 'bin');
    
    for (const binary of CONFIG.mac.binaries) {
      const source = path.join(brewBin, binary);
      const dest = path.join(platformDir, binary);
      
      if (fsSync.existsSync(source)) {
        await fs.copyFile(source, dest);
        execSync(`chmod +x "${dest}"`);
        console.log(`   ✅ ${binary}`);
      }
    }
  } catch (e) {
    console.log('⚠️ Homebrew not found, downloading static build...');
    
    const arch = process.arch;
    const url = CONFIG.mac.archUrls[arch] || CONFIG.mac.archUrls.x64;
    
    await ensureDir(TEMP_DIR);
    const zipPath = path.join(TEMP_DIR, 'ffmpeg-mac.zip');
    
    await downloadFile(url, zipPath, 'Downloading FFmpeg (Mac)');
    await extractZip(zipPath, TEMP_DIR);
    
    const ffmpegBin = await findFiles(TEMP_DIR, /^ffmpeg$/);
    
    if (ffmpegBin.length > 0) {
      const sourceDir = path.dirname(ffmpegBin[0]);
      
      for (const binary of CONFIG.mac.binaries) {
        const source = path.join(sourceDir, binary);
        const dest = path.join(platformDir, binary);
        
        if (fsSync.existsSync(source)) {
          await fs.copyFile(source, dest);
          execSync(`chmod +x "${dest}"`);
          console.log(`   ✅ ${binary}`);
        }
      }
    }
    
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  }
}

async function setupLinux() {
  console.log('\n🐧 Setting up FFmpeg for Linux...');
  
  const platformDir = path.join(RESOURCES_DIR, 'linux');
  await ensureDir(platformDir);
  
  try {
    console.log('📦 Trying package manager...');
    
    if (fsSync.existsSync('/usr/bin/apt')) {
      execSync('sudo apt update && sudo apt install -y ffmpeg', { stdio: 'inherit' });
    } else if (fsSync.existsSync('/usr/bin/yum')) {
      execSync('sudo yum install -y ffmpeg', { stdio: 'inherit' });
    } else {
      throw new Error('No supported package manager');
    }
    
    const systemPaths = ['/usr/bin', '/usr/local/bin'];
    
    for (const binary of CONFIG.linux.binaries) {
      for (const sysPath of systemPaths) {
        const source = path.join(sysPath, binary);
        const dest = path.join(platformDir, binary);
        
        if (fsSync.existsSync(source)) {
          await fs.copyFile(source, dest);
          execSync(`chmod +x "${dest}"`);
          console.log(`   ✅ ${binary}`);
          break;
        }
      }
    }
  } catch (e) {
    console.log('⚠️ Package manager failed, downloading static build...');
    // Simplified for CI
    throw new Error('Please install ffmpeg manually on Linux');
  }
}

async function main() {
  console.log('🎬 FFmpeg Auto-Setup');
  console.log('====================');
  console.log(`Platform: ${process.platform} (${process.arch})`);
  
  try {
    switch (process.platform) {
      case 'win32':
        await setupWindows();
        break;
      case 'darwin':
        await setupMac();
        break;
      case 'linux':
        await setupLinux();
        break;
      default:
        console.error(`❌ Unsupported platform: ${process.platform}`);
        process.exit(1);
    }
    
    console.log('\n✨ FFmpeg setup complete!');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
}

main();
