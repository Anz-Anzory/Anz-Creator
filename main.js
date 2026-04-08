const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const KeyStorage = require('./src/services/config/KeyStorage');
const GeminiService = require('./src/services/ai/GeminiService');
const VideoProcessor = require('./src/services/watermarkRemover');
const LongVideoProcessor = require('./src/services/pipelines/LongVideoProcessor');

let mainWindow;
let geminiService;
let videoProcessor;
let longVideoProcessor;

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
  });

  // Load React dev server in dev mode, or built files in production
  if (process.argv.includes('--dev')) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ==========================================
// IPC HANDLERS
// ==========================================

// Initialize services dengan API keys
async function initializeServices() {
  const keyStorage = new KeyStorage();
  const apiKeys = await keyStorage.loadKeys();
  
  if (apiKeys.length > 0) {
    geminiService = new GeminiService(apiKeys);
    videoProcessor = new VideoProcessor(apiKeys);
    longVideoProcessor = new LongVideoProcessor(apiKeys);
    return true;
  }
  return false;
}

// Save API Keys
ipcMain.handle('save-api-keys', async (event, keysArray) => {
  try {
    const keyStorage = new KeyStorage();
    await keyStorage.saveKeys(keysArray);
    
    // Reinitialize services
    const initialized = await initializeServices();
    
    return { 
      success: true, 
      initialized,
      keyCount: keysArray.length 
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get stored keys count (tanpa expose actual keys)
ipcMain.handle('get-key-status', async () => {
  try {
    const keyStorage = new KeyStorage();
    const keys = await keyStorage.loadKeys();
    return { 
      success: true, 
      count: keys.length,
      hasKeys: keys.length > 0 
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get Gemini stats
ipcMain.handle('get-gemini-stats', () => {
  if (!geminiService) return { error: 'Service not initialized' };
  return geminiService.getStats();
});

// Analyze video (single - untuk content generation)
ipcMain.handle('analyze-video', async (event, { videoPath, settings }) => {
  try {
    if (!geminiService) await initializeServices();
    
    const VideoAnalyzerClass = require('./src/services/ai/VideoAnalyzer');
    const analyzer = new VideoAnalyzerClass(geminiService.apiKeys || []);
    
    const results = await analyzer.analyzeVideo(videoPath, {
      contentType: settings.contentType || 'entertainment',
      audience: settings.audience || 'general',
      transcribeAudio: settings.transcribeAudio !== false
    });

    return { success: true, data: results };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Detect watermark only
ipcMain.handle('detect-watermark', async (event, { videoPath, options = {} }) => {
  try {
    if (!videoProcessor) await initializeServices();
    
    const WatermarkDetector = require('./src/services/video/WatermarkDetector');
    const detector = new WatermarkDetector(geminiService.apiKeys);
    
    // Extract sample frame
    const tempDir = require('os').tmpdir();
    const framePath = path.join(tempDir, `sample-frame-${Date.now()}.jpg`);
    
    await new Promise((resolve, reject) => {
      const ffmpeg = require('fluent-ffmpeg');
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

    const base64 = await fs.readFile(framePath, { encoding: 'base64' });
    
    const detection = await detector.detect(
      base64,
      framePath,
      { 
        useAI: options.useAI !== false, 
        useHeuristics: options.useHeuristics !== false,
        templates: options.templates || []
      }
    );

    // Generate preview image dengan bounding boxes
    let previewPath = null;
    if (detection.hasWatermark) {
      previewPath = await generateWatermarkPreview(framePath, detection.watermarks);
    }

    // Cleanup
    await fs.unlink(framePath);

    return {
      success: true,
      hasWatermark: detection.hasWatermark,
      watermarks: detection.watermarks,
      preview: previewPath
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Remove watermark (detect + inpaint)
ipcMain.handle('remove-watermark', async (event, { videoPath, options }) => {
  try {
    if (!videoProcessor) await initializeServices();
    
    const result = await videoProcessor.processVideo(videoPath, {
      removeWatermark: true,
      inpaintMethod: options.method || 'hybrid',
      outputPath: options.outputPath
    });
    
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Split long video into viral clips
ipcMain.handle('split-long-video', async (event, { videoPath, options }) => {
  try {
    if (!longVideoProcessor) {
      const initialized = await initializeServices();
      if (!initialized) {
        return { success: false, error: 'No API keys configured' };
      }
    }
    
    const results = await longVideoProcessor.process(videoPath, {
      minDuration: options.minDuration || 15,
      maxDuration: options.maxDuration || 60,
      targetClips: options.targetClips || 10,
      platform: options.platform || 'tiktok',
      seriesName: options.seriesName,
      detectionStrategy: options.strategy || 'comprehensive'
    });
    
    return { success: true, data: results };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get video info
ipcMain.handle('get-video-info', async (event, videoPath) => {
  try {
    const ffmpeg = require('fluent-ffmpeg');
    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    
    const videoStream = metadata.streams.find(s => s.codec_type === 'video');
    
    return {
      success: true,
      info: {
        duration: metadata.format.duration,
        size: metadata.format.size,
        width: videoStream.width,
        height: videoStream.height,
        fps: eval(videoStream.r_frame_rate),
        bitrate: metadata.format.bit_rate
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Select output directory
ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (!result.canceled) {
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false };
});

// Helper: Generate watermark preview dengan bounding boxes
async function generateWatermarkPreview(framePath, watermarks) {
  const img = cv.imread(framePath);
  
  for (const wm of watermarks) {
    const rect = new cv.Rect(
      Math.floor(wm.coordinates.x),
      Math.floor(wm.coordinates.y),
      Math.ceil(wm.coordinates.width),
      Math.ceil(wm.coordinates.height)
    );
    const color = new cv.Vec3(0, 255, 0);
    img.drawRectangle(rect, color, 3);
    
    const text = `${wm.type} ${Math.round(wm.confidence * 100)}%`;
    img.putText(
      text,
      new cv.Point(wm.coordinates.x, wm.coordinates.y - 10),
      cv.FONT_HERSHEY_SIMPLEX,
      0.7,
      color,
      2
    );
  }
  
  const previewPath = framePath.replace('.jpg', '_preview.jpg');
  cv.imwrite(previewPath, img);
  
  return previewPath;
}
