const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs').promises
const isDev = !app.isPackaged
const ffmpeg = require('fluent-ffmpeg');

const KeyStorage = require('./src/services/config/KeyStorage')
const GeminiService = require('./src/services/ai/GeminiService')
const VideoProcessor = require('./src/services/watermarkRemover')
const LongVideoProcessor = require('./src/services/pipelines/LongVideoProcessor')

// ============================================
// FIX: Set path untuk KEDUA binary (ffmpeg + ffprobe)
// ============================================
const ffmpegBinaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffprobeBinaryName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';

const ffmpegPath = isDev 
  ? path.join(__dirname, 'resources', 'ffmpeg', ffmpegBinaryName)
  : path.join(process.resourcesPath, 'ffmpeg', ffmpegBinaryName);

const ffprobePath = isDev 
  ? path.join(__dirname, 'resources', 'ffmpeg', ffprobeBinaryName)
  : path.join(process.resourcesPath, 'ffmpeg', ffprobeBinaryName);

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath); // FIX: Sebelumnya tidak ada, menyebabkan ffprobe gagal di production

let mainWindow
let geminiService
let videoProcessor
let longVideoProcessor

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT ERROR:', err)
})

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err)
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hiddenInset',
    show: false
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })
}

app.whenReady().then(() => {
  // ============================================
  // Protocol 'media://' untuk akses file lokal dari renderer
  // 
  // FIX TOTAL — Masalah sebelumnya:
  // 1. CSP di index.html tidak mengizinkan media:// → ditambahkan
  // 2. Backslash Windows (\) tidak valid di URL → di-convert ke /
  // 3. Short path (~1) tidak bisa dibaca Chromium → resolve dengan realpathSync
  // 4. Path dengan spasi/unicode gagal → encode URI component
  // ============================================
  protocol.handle('media', (request) => {
    try {
      // Ambil path dari URL — hapus 'media://' prefix
      let rawUrl = request.url;
      
      // media://C:/path atau media:///C:/path → ambil path saja
      let filePath = rawUrl.slice('media://'.length);
      
      // Decode URL encoding (%20 → spasi, dll)
      filePath = decodeURIComponent(filePath);
      
      // Hapus leading slash di Windows (media:///C:/... → C:/...)
      if (process.platform === 'win32') {
        // Bisa ada 1-3 leading slash tergantung browser
        filePath = filePath.replace(/^\/+/, '');
        
        // Pastikan path menggunakan backslash Windows
        filePath = filePath.replace(/\//g, '\\');
      }
      
      const fsSync = require('fs');
      
      // Resolve short path Windows (SALSA_~1 → Salsa Nazwa)
      if (fsSync.existsSync(filePath)) {
        try {
          filePath = fsSync.realpathSync(filePath);
        } catch (e) {
          // realpathSync gagal — pakai path apa adanya
        }
      } else {
        console.warn(`[media://] File tidak ditemukan: ${filePath}`);
        return new Response('File Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
      }
      
      // Convert ke file:// URL yang valid untuk Chromium
      const fileUrl = require('url').pathToFileURL(filePath).toString();
      return net.fetch(fileUrl);
      
    } catch (e) {
      console.error("[media://] Error:", e.message);
      return new Response('Internal Error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
  });

  createWindow();
});

// ============================================
// FIX: Tambahkan handler window-all-closed
// Tanpa ini, aplikasi tidak akan tertutup di Windows/Linux
// ============================================
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ============================================
// SERVICES INITIALIZATION
// ============================================
async function initializeServices() {
  const keyStorage = new KeyStorage()
  const apiKeys = await keyStorage.loadKeys()

  if (apiKeys.length > 0) {
    geminiService = new GeminiService(apiKeys)
    videoProcessor = VideoProcessor
    longVideoProcessor = new LongVideoProcessor(apiKeys)
    return true
  }
  return false
}

// ============================================
// IPC HANDLERS
// ============================================

ipcMain.handle('save-api-keys', async (event, keysArray) => {
  try {
    const keyStorage = new KeyStorage()
    await keyStorage.saveKeys(keysArray)
    const initialized = await initializeServices()
    return { success: true, initialized, keyCount: keysArray.length }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-key-status', async () => {
  try {
    const keyStorage = new KeyStorage()
    const keys = await keyStorage.loadKeys()
    return { success: true, count: keys.length, hasKeys: keys.length > 0 }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-gemini-stats', () => {
  if (!geminiService) return { error: 'Service not initialized' }
  return geminiService.getStats()
})

ipcMain.handle('analyze-video', async (event, { videoPath, settings }) => {
  try {
    // FIX: Null safety — pastikan service sudah diinisialisasi
    if (!geminiService) {
      const initialized = await initializeServices()
      if (!initialized) {
        return { success: false, error: 'API key belum dikonfigurasi. Silakan tambahkan di Settings.' }
      }
    }
    
    const VideoAnalyzerClass = require('./src/services/ai/VideoAnalyzer')
    const analyzer = new VideoAnalyzerClass(geminiService.apiKeys || [])

    const results = await analyzer.analyzeVideo(videoPath, {
      contentType: settings.contentType || 'entertainment',
      audience: settings.audience || 'general',
      transcribeAudio: settings.transcribeAudio !== false
    })
    return { success: true, data: results }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('detect-watermark', async (event, { videoPath, options = {} }) => {
  try {
    const fsSync = require('fs');
    const pathModule = require('path');
    const { detectWatermark } = require('./src/services/watermarkRemover/detector');
    const { watermarkList } = require('./src/services/watermarkRemover/config');

    const tempDir = require('os').tmpdir();
    const framePath = pathModule.join(tempDir, `frame-detect-${Date.now()}.png`);

    // 1. Ambil 1 frame screenshot dari tengah video
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: ['50%'],
          filename: pathModule.basename(framePath),
          folder: pathModule.dirname(framePath),
          size: '1280x720'
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // 2. Lakukan deteksi watermark
    let detectedWatermarks = [];
    
    if (watermarkList && watermarkList.length > 0) {
      for (const wm of watermarkList) {
        // FIX: Resolve path template relatif terhadap root project
        const templatePath = pathModule.isAbsolute(wm.template) 
          ? wm.template 
          : pathModule.join(__dirname, wm.template);
          
        if (fsSync.existsSync(templatePath)) {
          const area = detectWatermark(framePath, templatePath);
          
          if (area) {
            detectedWatermarks.push({
              type: wm.name || 'Watermark',
              position: `X:${area.x} Y:${area.y}`,
              confidence: 0.95,
              area: area
            });
          }
        } else {
          console.warn(`Template watermark tidak ditemukan: ${templatePath}`);
        }
      }
    }

    // 3. Bersihkan file temp
    await fs.unlink(framePath).catch(() => {});

    return { 
      success: true, 
      hasWatermark: detectedWatermarks.length > 0, 
      watermarks: detectedWatermarks 
    };
  } catch (error) {
    console.error("Detect Watermark Error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('remove-watermark', async (event, { videoPath, options }) => {
  try {
    if (!videoProcessor) await initializeServices()
    const result = await videoProcessor.processVideo(videoPath, {
      removeWatermark: true,
      inpaintMethod: options.method || 'hybrid',
      outputPath: options.outputPath
    })
    return { success: true, result }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Handler untuk tombol Download/Simpan Video
ipcMain.handle('save-file', async (event, { sourcePath, defaultName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'Video MP4', extensions: ['mp4'] }]
  });
  
  if (!canceled && filePath) {
    await fs.copyFile(sourcePath, filePath);
    return { success: true, savedPath: filePath };
  }
  return { success: false };
});

// ==========================
// SPLIT VIDEO
// ==========================
ipcMain.handle('split-long-video', async (event, { videoPath, options }) => {
  try {
    if (!longVideoProcessor) {
      const initialized = await initializeServices()
      if (!initialized || !longVideoProcessor) {
        return { success: false, error: 'API key belum dikonfigurasi. Silakan tambahkan di Settings.' }
      }
    }

    const results = await longVideoProcessor.process(videoPath, {
      minDuration: options.minDuration || 15,
      maxDuration: options.maxDuration || 60,
      targetClips: options.targetClips || 10,
      platform: options.platform || 'tiktok',
      seriesName: options.seriesName,
      detectionStrategy: options.strategy || 'comprehensive',
      onProgress: (status) => {
        event.sender.send('split-progress', status);
      }
    })

    return { success: true, data: results }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-video-info', async (event, videoPath) => {
  try {
    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, data) => {
        if (err) reject(err)
        else resolve(data)
      })
    })

    const videoStream = metadata.streams.find(s => s.codec_type === 'video')
    
    if (!videoStream) {
      return { success: false, error: 'Tidak ditemukan stream video dalam file ini.' }
    }
    
    const frameRateStr = videoStream.r_frame_rate || '30/1'
    const [num, den] = frameRateStr.split('/')

    return {
      success: true,
      info: {
        duration: metadata.format.duration,
        size: metadata.format.size,
        width: videoStream.width,
        height: videoStream.height,
        fps: (Number(num) / Number(den)) || 30,
        bitrate: metadata.format.bit_rate
      }
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  if (!result.canceled) return { success: true, path: result.filePaths[0] }
  return { success: false }
})
