#!/usr/bin/env node
/**
 * FFmpeg Auto-Setup Script
 * Automatically downloads and configures FFmpeg for Windows/Mac/Linux
 * 
 * Usage: npm run setup:ffmpeg
 */

const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const zlib = require('zlib');
const tar = require('tar');

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

// Utility: Create directories
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

// Utility: Download file with progress
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
            process.stdout.write(`\r   Progress: ${percent}% (${mb}/${totalMb} MB)`;
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

// Utility: Extract ZIP
async function extractZip(zipPath, extractTo) {
  console.log(`📦 Extracting ZIP...`);
  
  try {
    // Try using adm-zip if available
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractTo, true);
    console.log('   ✅ Extracted (adm-zip)');
    return;
  } catch (e) {
    // Fallback to unzip command
    try {
      if (process.platform === 'win32') {
        execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractTo}' -Force"`, { stdio: 'inherit' });
      } else {
        execSync(`unzip -o "${zipPath}" -d "${extractTo}"`, { stdio: 'inherit' });
      }
      console.log('   ✅ Extracted (system unzip)');
    } catch (err) {
      throw new Error('Failed to extract ZIP. Please install unzip or adm-zip (npm install adm-zip)');
    }
  }
}

// Utility: Extract TAR/XZ
async function extractTarXz(tarPath, extractTo) {
  console.log(`📦 Extracting TAR.XZ...`);
  
  try {
    // Using tar npm package
    await tar.x({
      file: tarPath,
      cwd: extractTo,
      strip: 1
    });
    console.log('   ✅ Extracted (tar package)');
  } catch (e) {
    // Fallback to system tar
    try {
      execSync(`tar -xf "${tarPath}" -C "${extractTo}" --strip-components=1`, { stdio: 'inherit' });
      console.log('   ✅ Extracted (system tar)');
    } catch (err) {
      throw new Error('Failed to extract TAR. Install tar or npm install tar');
    }
  }
}

// Utility: Find files recursively
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

// Windows Setup
async function setupWindows() {
  console.log('\n🪟 Setting up FFmpeg for Windows...');
  
  const platformDir = path.join(RESOURCES_DIR, 'windows');
  await ensureDir(platformDir);
  await ensureDir(TEMP_DIR);
  
  const zipPath = path.join(TEMP_DIR, 'ffmpeg-windows.zip');
  
  try {
    // Try primary URL
    await downloadFile(CONFIG.windows.url, zipPath, 'Downloading FFmpeg (Windows)');
  } catch (error) {
    console.log('   ⚠️  Primary source failed, trying fallback...');
    try {
      await downloadFile(CONFIG.windows.fallbackUrl, zipPath, 'Downloading FFmpeg (Fallback)');
    } catch (fallbackError) {
      throw new Error('Failed to download FFmpeg. Please download manually from https://ffmpeg.org/download.html');
    }
  }
  
  // Extract
  await extractZip(zipPath, TEMP_DIR);
  
  // Find and move binaries
  console.log('🔍 Locating binaries...');
  const ffmpegExe = await findFiles(TEMP_DIR, /ffmpeg\.exe$/i);
  const ffprobeExe = await findFiles(TEMP_DIR, /ffprobe\.exe$/i);
  
  if (ffmpegExe.length === 0) {
    throw new Error('ffmpeg.exe not found in extracted archive');
  }
  
  // Copy to final location
  const sourceDir = path.dirname(ffmpegExe[0]);
  
  for (const binary of CONFIG.windows.binaries) {
    const source = path.join(sourceDir, binary);
    const dest = path.join(platformDir, binary);
    
    if (fsSync.existsSync(source)) {
      await fs.copyFile(source, dest);
      console.log(`   ✅ ${binary}`);
    } else {
      console.log(`   ⚠️  ${binary} not found`);
    }
  }
  
  // Verify
  try {
    const result = execSync(`"${path.join(platformDir, 'ffmpeg.exe')}" -version`, { encoding: 'utf8' });
    const version = result.split('\n')[0];
    console.log(`   ${version}`);
  } catch (e) {
    console.log('   ⚠️  Verification failed, but files are in place');
  }
  
  // Cleanup
  await fs.rm(TEMP_DIR, { recursive: true, force: true });
  console.log('🧹 Cleaned up temp files');
}

// Mac Setup
async function setupMac() {
  console.log('\n🍎 Setting up FFmpeg for Mac...');
  
  const platformDir = path.join(RESOURCES_DIR, 'mac');
  await ensureDir(platformDir);
  
  // Check if Homebrew available
  try {
    execSync('which brew', { stdio: 'pipe' });
    console.log('✅ Homebrew detected, installing via brew...');
    
    execSync('brew install ffmpeg', { stdio: 'inherit' });
    
    // Copy binaries from brew
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
    // Homebrew not available, download static build
    console.log('⚠️  Homebrew not found, downloading static build...');
    
    const arch = process.arch;
    const url = CONFIG.mac.archUrls[arch] || CONFIG.mac.archUrls.x64;
    
    await ensureDir(TEMP_DIR);
    const zipPath = path.join(TEMP_DIR, 'ffmpeg-mac.zip');
    
    await downloadFile(url, zipPath, 'Downloading FFmpeg (Mac)');
    await extractZip(zipPath, TEMP_DIR);
    
    // Find binaries
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
  
  // Verify
  try {
    const result = execSync(`"${path.join(platformDir, 'ffmpeg')}" -version`, { encoding: 'utf8' });
    console.log(`   ${result.split('\n')[0]}`);
  } catch (e) {
    console.log('   ⚠️  Verification failed');
  }
}

// Linux Setup
async function setupLinux() {
  console.log('\n🐧 Setting up FFmpeg for Linux...');
  
  const platformDir = path.join(RESOURCES_DIR, 'linux');
  await ensureDir(platformDir);
  
  // Try package manager first
  try {
    console.log('📦 Trying package manager...');
    
    if (fsSync.existsSync('/usr/bin/apt')) {
      console.log('   Using apt...');
      execSync('sudo apt update && sudo apt install -y ffmpeg', { stdio: 'inherit' });
    } else if (fsSync.existsSync('/usr/bin/yum')) {
      console.log('   Using yum...');
      execSync('sudo yum install -y ffmpeg', { stdio: 'inherit' });
    } else if (fsSync.existsSync('/usr/bin/pacman')) {
      console.log('   Using pacman...');
      execSync('sudo pacman -S ffmpeg --noconfirm', { stdio: 'inherit' });
    } else {
      throw new Error('No supported package manager found');
    }
    
    // Copy to resources
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
    // Package manager failed, download static build
    console.log('⚠️  Package manager failed, downloading static build...');
    
    await ensureDir(TEMP_DIR);
    const tarPath = path.join(TEMP_DIR, 'ffmpeg-linux.tar.xz');
    
    await downloadFile(CONFIG.linux.staticUrl, tarPath, 'Downloading FFmpeg (Linux)');
    await extractTarXz(tarPath, platformDir);
    
    // Make executable
    for (const binary of CONFIG.linux.binaries) {
      const binaryPath = path.join(platformDir, binary);
      if (fsSync.existsSync(binaryPath)) {
        execSync(`chmod +x "${binaryPath}"`);
        console.log(`   ✅ ${binary}`);
      }
    }
    
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  }
  
  // Verify
  try {
    const result = execSync(`"${path.join(platformDir, 'ffmpeg')}" -version`, { encoding: 'utf8' });
    console.log(`   ${result.split('\n')[0]}`);
  } catch (e) {
    console.log('   ⚠️  Verification failed');
  }
}

// Verify Installation
async function verifyInstallation() {
  console.log('\n🔍 Verifying installation...');
  
  const platform = process.platform === 'win32' ? 'windows' : 
                   process.platform === 'darwin' ? 'mac' : 'linux';
  
  const platformDir = path.join(RESOURCES_DIR, platform);
  
  const config = CONFIG[platform];
  let allExist = true;
  
  for (const binary of config.binaries) {
    const binaryPath = path.join(platformDir, binary);
    const exists = fsSync.existsSync(binaryPath);
    
    console.log(`   ${exists ? '✅' : '❌'} ${binary}`);
    if (!exists) allExist = false;
  }
  
  if (allExist) {
    console.log('\n✨ FFmpeg setup complete!');
    console.log(`📁 Location: ${platformDir}`);
    return true;
  } else {
    console.log('\n❌ Some binaries are missing');
    return false;
  }
}

// Main
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
    
    const verified = await verifyInstallation();
    process.exit(verified ? 0 : 1);
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.log('\n💡 Manual installation:');
    console.log('   1. Download from https://ffmpeg.org/download.html');
    console.log('   2. Place binaries in:');
    console.log(`      ${RESOURCES_DIR}/${process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'}/`);
    process.exit(1);
  }
}

main();
