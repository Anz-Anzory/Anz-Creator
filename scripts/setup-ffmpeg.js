#!/usr/bin/env node

const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  windows: {
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    fallbackUrl: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
    binaries: ['ffmpeg.exe', 'ffprobe.exe']
  },
  mac: {
    brewPackage: 'ffmpeg',
    binaries: ['ffmpeg', 'ffprobe']
  },
  linux: {
    aptPackage: 'ffmpeg',
    binaries: ['ffmpeg', 'ffprobe']
  }
};

const RESOURCES_DIR = path.join(__dirname, '..', 'resources', 'ffmpeg');
const TEMP_DIR = path.join(require('os').tmpdir(), 'ffmpeg-setup-' + Date.now());

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function cleanupFile(filePath) {
  try {
    if (fsSync.existsSync(filePath)) {
      fsSync.unlinkSync(filePath);
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}

async function downloadFile(url, dest, label = 'Downloading') {
  console.log(`\n📥 ${label}:`);
  console.log(`   From: ${url.substring(0, 80)}...`);
  console.log(`   To: ${dest}`);
  
  // Clean up existing file first
  await cleanupFile(dest);
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const file = fsSync.createWriteStream(dest);
    let downloaded = 0;
    let totalSize = 0;
    let lastPercent = -1;
    
    const cleanupAndReject = (err) => {
      file.destroy();
      cleanupFile(dest);
      reject(err);
    };
    
    const request = protocol.get(url, { 
      timeout: 120000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        console.log(`   🔀 Following redirect...`);
        const redirectUrl = response.headers.location;
        file.destroy();
        cleanupFile(dest);
        
        // Handle relative redirects
        const finalUrl = redirectUrl.startsWith('http') 
          ? redirectUrl 
          : new URL(redirectUrl, url).toString();
          
        downloadFile(finalUrl, dest, label).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        cleanupAndReject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      totalSize = parseInt(response.headers['content-length'], 10) || 0;
      
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        
        if (totalSize > 0) {
          const percent = Math.floor((downloaded / totalSize) * 100);
          
          if (percent !== lastPercent && percent % 10 === 0) {
            const mb = (downloaded / 1024 / 1024).toFixed(1);
            const totalMb = (totalSize / 1024 / 1024).toFixed(1);
            process.stdout.write(`\r   Progress: ${percent}% (${mb}/${totalMb} MB)`);
            lastPercent = percent;
          }
        }
      });
      
      response.pipe(file);
      
      response.on('error', cleanupAndReject);
      
      file.on('finish', () => {
        file.close();
        console.log('\n   ✅ Download complete');
        resolve(dest);
      });
      
      file.on('error', cleanupAndReject);
    });
    
    request.on('error', cleanupAndReject);
    request.on('timeout', () => cleanupAndReject(new Error('Download timeout')));
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
    console.log('   ⚠️ adm-zip failed, trying PowerShell...');
    try {
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractTo}' -Force"`, { 
        stdio: 'inherit',
        timeout: 120000
      });
      console.log('   ✅ Extracted (PowerShell)');
    } catch (err) {
      throw new Error('Failed to extract ZIP');
    }
  }
}

async function findFiles(dir, pattern) {
  const files = [];
  
  async function scan(currentDir) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (pattern.test(entry.name)) {
          files.push(fullPath);
        }
      }
    } catch (e) {
      // Ignore errors reading directories
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
  
  const zipPath = path.join(TEMP_DIR, 'ffmpeg.zip');
  let downloadSuccess = false;
  
  // Try primary source
  try {
    await downloadFile(CONFIG.windows.url, zipPath, 'Downloading FFmpeg (Primary)');
    downloadSuccess = true;
  } catch (error) {
    console.log('   ⚠️ Primary source failed:', error.message);
  }
  
  // Try fallback if primary failed
  if (!downloadSuccess) {
    console.log('   🔄 Trying fallback source...');
    try {
      await downloadFile(CONFIG.windows.fallbackUrl, zipPath, 'Downloading FFmpeg (Fallback)');
      downloadSuccess = true;
    } catch (error) {
      throw new Error(`Both download sources failed: ${error.message}`);
    }
  }
  
  // Extract
  await extractZip(zipPath, TEMP_DIR);
  
  // Find binaries
  console.log('🔍 Locating binaries...');
  const ffmpegExe = await findFiles(TEMP_DIR, /ffmpeg\.exe$/i);
  
  if (ffmpegExe.length === 0) {
    throw new Error('ffmpeg.exe not found in extracted archive');
  }
  
  const sourceDir = path.dirname(ffmpegExe[0]);
  
  // Copy binaries
  for (const binary of CONFIG.windows.binaries) {
    const source = path.join(sourceDir, binary);
    const dest = path.join(platformDir, binary);
    
    if (fsSync.existsSync(source)) {
      fsSync.copyFileSync(source, dest);
      console.log(`   ✅ ${binary}`);
    } else {
      console.log(`   ⚠️ ${binary} not found`);
    }
  }
  
  // Verify
  try {
    const result = execSync(`"${path.join(platformDir, 'ffmpeg.exe')}" -version`, { 
      encoding: 'utf8',
      timeout: 10000
    });
    console.log(`   Version: ${result.split('\n')[0]}`);
  } catch (e) {
    console.log('   ⚠️ Verification skipped');
  }
}

async function setupWithChocolatey() {
  console.log('📦 Trying Chocolatey...');
  try {
    execSync('choco install ffmpeg -y', { stdio: 'inherit', timeout: 300000 });
    
    const platformDir = path.join(RESOURCES_DIR, 'windows');
    await ensureDir(platformDir);
    
    // Copy from choco install location
    const chocoPath = 'C:\\ProgramData\\chocolatey\\bin';
    for (const binary of CONFIG.windows.binaries) {
      const source = path.join(chocoPath, binary);
      const dest = path.join(platformDir, binary);
      if (fsSync.existsSync(source)) {
        fsSync.copyFileSync(source, dest);
        console.log(`   ✅ ${binary} (from Chocolatey)`);
      }
    }
    return true;
  } catch (e) {
    console.log('   ⚠️ Chocolatey failed:', e.message);
    return false;
  }
}

async function setupMac() {
  console.log('\n🍎 Setting up FFmpeg for Mac...');
  
  const platformDir = path.join(RESOURCES_DIR, 'mac');
  await ensureDir(platformDir);
  
  try {
    execSync('which brew', { stdio: 'pipe' });
    console.log('✅ Installing via Homebrew...');
    execSync('brew install ffmpeg', { stdio: 'inherit', timeout: 300000 });
    
    const brewPrefix = execSync('brew --prefix', { encoding: 'utf8' }).trim();
    const brewBin = path.join(brewPrefix, 'bin');
    
    for (const binary of CONFIG.mac.binaries) {
      const source = path.join(brewBin, binary);
      const dest = path.join(platformDir, binary);
      
      if (fsSync.existsSync(source)) {
        fsSync.copyFileSync(source, dest);
        execSync(`chmod +x "${dest}"`);
        console.log(`   ✅ ${binary}`);
      }
    }
  } catch (e) {
    console.log('⚠️ Setup failed:', e.message);
    throw e;
  }
}

async function setupLinux() {
  console.log('\n🐧 Please install FFmpeg manually:');
  console.log('   sudo apt update && sudo apt install -y ffmpeg');
  console.log('   Then copy ffmpeg and ffprobe to resources/ffmpeg/linux/');
  throw new Error('Auto-setup not supported on Linux CI. Please use apt.');
}

async function main() {
  console.log('🎬 FFmpeg Auto-Setup');
  console.log('====================');
  console.log(`Platform: ${process.platform} (${process.arch})`);
  
  try {
    // Ensure temp dir is clean
    try {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
    } catch (e) {}
    
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
        throw new Error(`Unsupported platform: ${process.platform}`);
    }
    
    console.log('\n✨ FFmpeg setup complete!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    
    // Cleanup on error
    try {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
    } catch (e) {}
    
    process.exit(1);
  }
}

main();
