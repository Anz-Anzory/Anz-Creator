const GeminiService = require('../ai/GeminiService');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

class ViralMomentDetector {
  constructor(apiKeys) {
    this.gemini = new GeminiService(apiKeys);
    this.tempDir = path.join(require('os').tmpdir(), 'viral-detection');
  }

  // ==========================================
  // MAIN PIPELINE
  // ==========================================
  
  async detectViralMoments(videoPath, options = {}) {
    console.log('🔍 Menganalisa video untuk momen viral...');
    
    const strategy = options.strategy || 'comprehensive';
    const minClipDuration = options.minDuration || 15;
    const maxClipDuration = options.maxDuration || 60;
    const targetClipCount = options.targetClips || 10;
    
    try {
      const totalDuration = await this.getVideoDuration(videoPath);
      console.log(`📼 Durasi video: ${Math.round(totalDuration)} detik`);
      
      let scenes;
      const useFastMode = strategy === 'fast' || totalDuration < 300;
      
      if (useFastMode) {
        console.log('⚡ Mode cepat: segmentasi berbasis durasi');
        scenes = await this.createManualSegments(videoPath, maxClipDuration);
      } else {
        console.log('🎬 Mode lengkap: scene detection...');
        scenes = await this.extractScenesFast(videoPath, totalDuration);
        if (scenes.length === 0) {
          scenes = await this.createManualSegments(videoPath, maxClipDuration);
        }
      }
      
      if (scenes.length === 0) {
        throw new Error('Gagal mengekstrak scene. Pastikan video tidak corrupt.');
      }
      
      let audioAnalysis = [];
      if (!useFastMode) {
        audioAnalysis = await this.analyzeAudioPeaks(videoPath).catch(() => []);
      }
      
      console.log(`📸 Sampling ${scenes.length} scenes...`);
      const sceneSamples = await this.sampleScenes(videoPath, scenes, strategy);
      
      console.log('🤖 Menganalisa potensi viral...');
      const viralScores = await this.analyzeViralPotential(sceneSamples);
      
      const moments = this.mergeAndRankMoments(scenes, audioAnalysis, viralScores, { minDuration: minClipDuration, maxDuration: maxClipDuration });
      
      const optimizedClips = this.optimizeClipBoundaries(moments, {
        minDuration: minClipDuration,
        maxDuration: maxClipDuration,
        targetCount: targetClipCount
      });

      return {
        totalDuration,
        detectedScenes: scenes.length,
        viralMoments: moments.length,
        optimizedClips: optimizedClips.length,
        clips: optimizedClips
      };
    } catch (error) {
      console.error('❌ Deteksi viral gagal:', error);
      throw error;
    }
  }

  async getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) reject(err);
        else resolve(parseFloat(metadata.format.duration) || 0);
      });
    });
  }

  async createManualSegments(videoPath, segmentDuration = 60) {
    const totalDuration = await this.getVideoDuration(videoPath);
    if (totalDuration === 0) return [];
    
    const segments = [];
    let start = 0, id = 0;
    while (start < totalDuration) {
      const end = Math.min(start + segmentDuration, totalDuration);
      if (end - start >= 5) {
        segments.push({ id: id++, start, end, duration: end - start });
      }
      start = end;
    }
    return segments;
  }

  // ==========================================
  // SCENE DETECTION (FAST VERSION)
  // ==========================================
  
  async extractScenesFast(videoPath, totalDuration, threshold = 0.35) {
    const TIMEOUT_MS = 60000;
    
    return new Promise((resolve) => {
      const scenes = [];
      let currentScene = { start: 0, end: 0 };
      let lastTimestamp = 0;
      let timedOut = false;
      
      const timer = setTimeout(() => {
        timedOut = true;
        finalize();
      }, TIMEOUT_MS);
      
      const finalize = () => {
        clearTimeout(timer);
        if (currentScene.start < totalDuration && currentScene.start > 0) {
          currentScene.end = totalDuration;
          scenes.push({ ...currentScene });
        }
        if (scenes.length === 0 && totalDuration > 0) {
          scenes.push({ start: 0, end: totalDuration });
        }
        resolve(scenes.map((s, i) => ({ id: i, start: s.start, end: s.end, duration: s.end - s.start })).filter(s => s.duration > 2));
      };
      
      ffmpeg(videoPath)
        .videoFilters(`scale=320:-1,select='gt(scene,${threshold})',showinfo`)
        .outputOptions('-f', 'null')
        .outputOptions('-an')
        .on('stderr', (line) => {
          if (timedOut) return;
          const ptsMatch = line.match(/pts_time:([\d.]+)/);
          const tMatch = line.match(/t:([\d.]+)\s/);
          const timestamp = ptsMatch ? parseFloat(ptsMatch[1]) : tMatch ? parseFloat(tMatch[1]) : null;
          
          if (timestamp && timestamp > lastTimestamp) {
            lastTimestamp = timestamp;
            if (currentScene.start === 0 && timestamp > 0) {
              currentScene.end = timestamp;
              scenes.push({ ...currentScene });
              currentScene = { start: timestamp, end: timestamp };
            } else if (timestamp > currentScene.start) {
              currentScene.end = timestamp;
              scenes.push({ ...currentScene });
              currentScene = { start: timestamp, end: timestamp };
            }
          }
        })
        .on('end', () => { if (!timedOut) finalize(); })
        .on('error', () => { clearTimeout(timer); resolve([]); })
        .output('-')
        .run();
    });
  }

  // ==========================================
  // AUDIO ANALYSIS
  // ==========================================
  
  async analyzeAudioPeaks(videoPath) {
    return new Promise((resolve) => {
      const audioData = [];
      ffmpeg(videoPath)
        .audioFilters('ebur128=peak=true')
        .outputOptions('-f', 'null')
        .on('stderr', (line) => {
          const tMatch = line.match(/t:\s*([\d.]+)/);
          const peakMatch = line.match(/Peak:\s*([-\d.]+)/);
          if (tMatch && peakMatch) {
            audioData.push({ time: parseFloat(tMatch[1]), peak: parseFloat(peakMatch[1]) });
          }
        })
        .on('end', () => resolve(this.detectAudioPeaks(audioData)))
        .on('error', () => resolve([]))
        .output('-')
        .run();
    });
  }

  detectAudioPeaks(audioData, threshold = -10) {
    const peaks = [];
    let inPeak = false, peakStart = 0, peakMax = -100;
    
    for (const data of audioData) {
      if (data.peak > threshold && !inPeak) {
        inPeak = true; peakStart = data.time; peakMax = data.peak;
      } else if (inPeak) {
        if (data.peak > peakMax) peakMax = data.peak;
        if (data.peak <= threshold) {
          inPeak = false;
          peaks.push({ start: peakStart, end: data.time, intensity: peakMax, duration: data.time - peakStart });
          peakMax = -100;
        }
      }
    }
    if (inPeak && audioData.length > 0) {
      peaks.push({ start: peakStart, end: audioData[audioData.length-1].time, intensity: peakMax, duration: audioData[audioData.length-1].time - peakStart });
    }
    return peaks.filter(p => p.duration >= 2).sort((a, b) => b.intensity - a.intensity);
  }

  // ==========================================
  // FRAME SAMPLING
  // ==========================================
  
  async sampleScenes(videoPath, scenes, strategy) {
    await fs.mkdir(this.tempDir, { recursive: true });
    const samples = [];
    const sampleCount = strategy === 'fast' ? 1 : strategy === 'deep' ? 5 : 3;
    
    for (const scene of scenes) {
      if (scene.duration < 3) continue;
      const sceneSamples = [];
      const interval = scene.duration / (sampleCount + 1);
      
      for (let i = 1; i <= sampleCount; i++) {
        const timestamp = scene.start + (interval * i);
        const framePath = path.join(this.tempDir, `scene-${scene.id}-frame-${i}.jpg`);
        
        try {
          // FIX: Gunakan -ss + -frames:v 1 (reliable)
          await new Promise((resolve, reject) => {
            ffmpeg(videoPath)
              .seekInput(timestamp)
              .frames(1)
              .outputOptions(['-q:v', '3'])
              .output(framePath)
              .on('end', resolve)
              .on('error', reject)
              .run();
          });
          
          if (!fsSync.existsSync(framePath)) continue;
          
          const base64 = await fs.readFile(framePath, { encoding: 'base64' });
          sceneSamples.push({ timestamp, path: framePath, base64, relativeTime: timestamp - scene.start });
        } catch (err) {
          console.warn(`Gagal ekstrak frame di ${timestamp}s:`, err.message);
        }
      }
      
      if (sceneSamples.length > 0) {
        samples.push({ sceneId: scene.id, scene, frames: sceneSamples });
      }
    }
    return samples;
  }

  // ==========================================
  // AI VIRAL ANALYSIS — BAHASA INDONESIA
  // ==========================================
  
  async analyzeViralPotential(sceneSamples) {
    const scores = [];
    let aiAvailable = true;
    
    for (const sample of sceneSamples) {
      if (!aiAvailable) {
        scores.push({
          sceneId: sample.scene.id, scene: sample.scene,
          scores: { contentType: 'entertainment' },
          overallScore: 60, offlineMode: true
        });
        continue;
      }

      const frameBase64s = sample.frames.map(f => f.base64);
      
      try {
        const analysis = await this.gemini.executeWithRotation(async (genAI, modelName) => {
          const model = genAI.getGenerativeModel({ model: modelName });
          
          // FIX: Prompt dalam Bahasa Indonesia
          const prompt = `Analisa frame video ini dan nilai POTENSI VIRAL untuk konten pendek Indonesia (TikTok/Reels/Shorts).

Nilai setiap aspek 0-100:
1. KEKUATAN HOOK - Apakah menarik perhatian di 3 detik pertama?
2. DAYA TARIK VISUAL - Warna, komposisi, kualitas gerakan
3. NILAI KONTEN - Edukasi, hiburan, atau emosional
4. POTENSI SHARE - Apakah orang akan share ini?
5. KESESUAIAN TREN - Apakah cocok dengan tren Indonesia saat ini?

Klasifikasi: educational, entertainment, comedy, emotional, inspirational, tutorial

JAWAB HANYA JSON VALID (tanpa code block):
{
  "hookStrength": 85,
  "visualAppeal": 70,
  "contentValue": 90,
  "shareability": 75,
  "trendPotential": 80,
  "fypScore": 80,
  "contentType": "entertainment",
  "keyMoments": ["0-3s: Hook kuat", "5-8s: Momen seru"],
  "suggestedCaptions": ["Caption viral pertama", "Alternatif"],
  "bestThumbnailFrame": 1
}`;

          const imageParts = frameBase64s.map(b64 => ({
            inlineData: { data: b64, mimeType: 'image/jpeg' }
          }));
          const result = await model.generateContent([prompt, ...imageParts]);
          return result.response.text();
        }, `Analisa Viral Scene ${sample.sceneId}`);

        let parsed;
        try {
          const clean = analysis.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
          const jsonMatch = clean.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
        } catch { parsed = {}; }
        
        const overallScore = parsed.fypScore || 
          Math.round(((parsed.hookStrength||50)+(parsed.visualAppeal||50)+(parsed.contentValue||50)+(parsed.shareability||50)+(parsed.trendPotential||50)) / 5);
        
        scores.push({
          sceneId: sample.scene.id, scene: sample.scene,
          scores: parsed, overallScore, samples: sample.frames
        });
        
      } catch (error) {
        const errMsg = error.message || '';
        if (errMsg.includes('kuota harian') || errMsg.includes('limit: 0') || errMsg.includes('kehabisan kuota')) {
          console.warn(`🚫 Kuota AI habis! Scene sisanya diproses tanpa AI.`);
          aiAvailable = false;
        }
        scores.push({
          sceneId: sample.scene.id, scene: sample.scene,
          scores: {}, overallScore: 60, error: true, errorMessage: error.message
        });
      }
    }
    return scores;
  }

  // ==========================================
  // RANKING & OPTIMIZATION
  // ==========================================
  
  mergeAndRankMoments(scenes, audioPeaks, viralScores, constraints) {
    const moments = [];
    for (const score of viralScores) {
      const scene = score.scene;
      const sceneAudioPeaks = audioPeaks.filter(p => p.start >= scene.start && p.end <= scene.end);
      const audioBoost = sceneAudioPeaks.length > 0 ? 10 : 0;
      const finalScore = Math.min(100, score.overallScore + audioBoost);
      
      moments.push({
        sceneId: score.sceneId, start: scene.start, end: scene.end,
        duration: scene.end - scene.start, fypScore: finalScore,
        details: score.scores, audioPeaks: sceneAudioPeaks,
        metadata: {
          contentType: score.scores.contentType || 'general',
          keyMoments: score.scores.keyMoments || [],
          suggestedCaptions: score.scores.suggestedCaptions || [],
          bestThumbnailFrame: score.scores.bestThumbnailFrame || 1
        }
      });
    }
    return moments.sort((a, b) => b.fypScore - a.fypScore);
  }

  optimizeClipBoundaries(moments, options) {
    const clips = [], usedRanges = [];
    
    for (const moment of moments) {
      if (this.hasOverlap(moment.start, moment.end, usedRanges, 2)) continue;
      
      let clipStart = moment.start, clipEnd = moment.end;
      const targetDur = this.calcOptimalDuration(moment);
      
      if (moment.duration < options.minDuration) {
        clipEnd = moment.end + (options.minDuration - moment.duration);
      } else if (moment.duration > options.maxDuration) {
        clipEnd = moment.start + Math.min(options.maxDuration, targetDur);
      }
      
      clipEnd = Math.max(clipEnd, clipStart + options.minDuration);
      clipEnd = Math.min(clipEnd, clipStart + options.maxDuration);
      
      clips.push({
        id: clips.length + 1, start: clipStart, end: clipEnd,
        duration: clipEnd - clipStart, fypScore: moment.fypScore,
        contentType: moment.metadata.contentType,
        keyMoments: moment.metadata.keyMoments,
        suggestedCaption: moment.metadata.suggestedCaptions[0] || '',
        bestThumbnailFrame: moment.metadata.bestThumbnailFrame
      });
      usedRanges.push({ start: clipStart, end: clipEnd });
      if (clips.length >= options.targetCount) break;
    }
    return clips;
  }

  calcOptimalDuration(moment) {
    const type = moment.details?.contentType || 'general';
    switch (type) {
      case 'educational': case 'tutorial': return 45;
      case 'comedy': return 15;
      case 'emotional': return 25;
      case 'entertainment': return moment.fypScore > 90 ? 21 : 30;
      default: return 30;
    }
  }

  hasOverlap(start, end, ranges, buf = 0) {
    return ranges.some(r => !(end <= r.start - buf || start >= r.end + buf));
  }

  async cleanup() {
    try { await fs.rm(this.tempDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = ViralMomentDetector;
