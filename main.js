const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron') // Pastikan ada protocol dan net
const path = require('path')
const fs = require('fs').promises
const isDev = !app.isPackaged
const ffmpeg = require('fluent-ffmpeg');

const KeyStorage = require('./src/services/config/KeyStorage')
const GeminiService = require('./src/services/ai/GeminiService')
const VideoProcessor = require('./src/services/watermarkRemover')
const LongVideoProcessor = require('./src/services/pipelines/LongVideoProcessor')
const ffmpegPath = isDev 
  ? path.join(__dirname, 'resources', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  : path.join(process.resourcesPath, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

ffmpeg.setFfmpegPath(ffmpegPath);

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
  // FIX 1: Protocol 'media://' yang 100% Anti-Error di Windows
  protocol.handle('media', (request) => {
    let filePath = request.url.replace('media://', '');
    try {
      filePath = decodeURIComponent(filePath);
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }
      // pathToFileURL otomatis membuat URL 'file:///' yang valid dan disukai Chromium
      const fileUrl = require('url').pathToFileURL(filePath).toString();
      return net.fetch(fileUrl);
    } catch (e) {
      console.error("Media protocol error:", e);
      return new Response('Not Found', { status: 404 });
    }
  });

  createWindow();
});

async function initializeServices() {
  const keyStorage = new KeyStorage()
  const apiKeys = await keyStorage.loadKeys()

  if (apiKeys.length > 0) {
    geminiService = new GeminiService(apiKeys)
    videoProcessor = VideoProcessor // <--- HAPUS kata "new" dan "(apiKeys)"
    longVideoProcessor = new LongVideoProcessor(apiKeys)
    return true
  }
  return false
}

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
    if (!geminiService) await initializeServices()
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
    const fs = require('fs').promises;
    const path = require('path');
    const { detectWatermark } = require('./src/services/watermarkRemover/detector');
    const { watermarkList } = require('./src/services/watermarkRemover/config');

    const tempDir = require('os').tmpdir();
    const framePath = path.join(tempDir, `frame-detect-${Date.now()}.png`); // Harus PNG karena pngjs

    // 1. Ambil 1 frame screenshot dari tengah video
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: ['50%'],
          filename: path.basename(framePath),
          folder: path.dirname(framePath),
          size: '1280x720'
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // 2. Lakukan deteksi menggunakan metode Pixelmatch (Sesuai dengan detector.js Anda)
    let detectedWatermarks = [];
    
    // Pastikan config watermarkList tersedia dan template-nya ada
    if (watermarkList && watermarkList.length > 0) {
      for (const wm of watermarkList) {
        // Asumsi wm.template adalah path file template PNG
        if (require('fs').existsSync(wm.template)) {
          const area = detectWatermark(framePath, wm.template);
          
          // Jika x dan y tidak 0 atau diff memenuhi syarat, berarti terdeteksi
          if (area) {
            detectedWatermarks.push({
              type: wm.name || 'Watermark',
              position: `X:${area.x} Y:${area.y}`,
              confidence: 0.95, // Dummy confidence
              area: area
            });
          }
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

// FIX 2: Tambahkan Handler untuk Fitur Tombol Download Video (Taruh di deretan IPC Handlers bawah)
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
        return { success: false, error: 'No API keys configured or service failed to start' }
      }
    }

    const results = await longVideoProcessor.process(videoPath, {
      minDuration: options.minDuration || 15,
      maxDuration: options.maxDuration || 60,
      targetClips: options.targetClips || 10,
      platform: options.platform || 'tiktok',
      seriesName: options.seriesName,
      detectionStrategy: options.strategy || 'comprehensive',
      // FIX: Callback untuk mengirim sinyal progress ke Frontend
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
    const frameRateStr = videoStream.r_frame_rate || '30/1'
    const [num, den] = frameRateStr.split('/')

    return {
      success: true,
      info: {
        duration: metadata.format.duration,
        size: metadata.format.size,
        width: videoStream.width,
        height: videoStream.height,
        fps: (Number(num) / Number(den)) || 30, // FIX: Perhitungan manual tanpa menggunakan eval()
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
