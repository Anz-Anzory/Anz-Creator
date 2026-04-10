const GeminiService = require('../ai/GeminiService');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');

class ViralMomentDetector {
  constructor(apiKeys) {
    this.gemini = new GeminiService(apiKeys);
    this.tempDir = path.join(require('os').tmpdir(), 'viral-detection');
  }

  // ==========================================
  // MAIN DETECTION PIPELINE
  // ==========================================
  
  async detectViralMoments(videoPath, options = {}) {
    console.log('🔍 Menganalisa video untuk momen viral...');
    
    const strategy = options.strategy || 'comprehensive';
    const minClipDuration = options.minDuration || 15;
    const maxClipDuration = options.maxDuration || 60;
    const targetClipCount = options.targetClips || 10;
    
    try {
      // Step 1: Deteksi scene & analisa audio
      let scenes = await this.extractScenes(videoPath);
      
      // FIX: Handle video tanpa scene change — buat segmentasi manual
      if (scenes.length === 0) {
        console.warn('⚠️ Tidak ada scene change terdeteksi, membuat segmentasi manual...');
        scenes = await this.createManualSegments(videoPath, maxClipDuration);
      }
      
      if (scenes.length === 0) {
        throw new Error('Gagal mengekstrak scene dari video. Pastikan video tidak corrupt.');
      }
      
      const audioAnalysis = await this.analyzeAudioPeaks(videoPath).catch(err => {
        console.warn('⚠️ Analisa audio gagal, lanjut tanpa data audio:', err.message);
        return [];
      });
      
      // Step 2: Sample frames untuk AI analysis
      console.log(`📸 Sampling ${scenes.length} scenes...`);
      const sceneSamples = await this.sampleScenes(videoPath, scenes, strategy);
      
      // Step 3: AI Viral Score Analysis
      console.log('🤖 Menganalisa potensi viral...');
      const viralScores = await this.analyzeViralPotential(sceneSamples);
      
      // Step 4: Merge & rank moments
      const moments = this.mergeAndRankMoments(
        scenes, 
        audioAnalysis, 
        viralScores,
        { minDuration: minClipDuration, maxDuration: maxClipDuration }
      );
      
      // Step 5: Optimize clip boundaries
      const optimizedClips = this.optimizeClipBoundaries(moments, {
        minDuration: minClipDuration,
        maxDuration: maxClipDuration,
        targetCount: targetClipCount
      });

      return {
        totalDuration: scenes[scenes.length - 1]?.end || 0,
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

  // ==========================================
  // FIX: Segmentasi manual jika tidak ada scene change
  // ==========================================
  
  async createManualSegments(videoPath, segmentDuration = 60) {
    const totalDuration = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) reject(err);
        else resolve(parseFloat(metadata.format.duration) || 0);
      });
    });
    
    if (totalDuration === 0) return [];
    
    const segments = [];
    let start = 0;
    let id = 0;
    
    while (start < totalDuration) {
      const end = Math.min(start + segmentDuration, totalDuration);
      if (end - start >= 5) { // Minimal 5 detik
        segments.push({
          id: id++,
          start,
          end,
          duration: end - start
        });
      }
      start = end;
    }
    
    console.log(`📎 Dibuat ${segments.length} segmen manual (masing-masing ~${segmentDuration}s)`);
    return segments;
  }

  // ==========================================
  // SCENE DETECTION
  // ==========================================
  
  async extractScenes(videoPath, threshold = 0.3) {
    return new Promise((resolve, reject) => {
      const scenes = [];
      let currentScene = { start: 0, end: 0 };
      let lastTimestamp = 0;
      
      ffmpeg(videoPath)
        .videoFilters(`select='gt(scene,${threshold})',showinfo`)
        .outputOptions('-f', 'null')
        .on('stderr', (stderrLine) => {
          const ptsMatch = stderrLine.match(/pts_time:([\d.]+)/);
          const tMatch = stderrLine.match(/t:([\d.]+)\s/);
          
          const timestamp = ptsMatch ? parseFloat(ptsMatch[1]) : 
                           tMatch ? parseFloat(tMatch[1]) : null;
          
          if (timestamp && timestamp !== lastTimestamp) {
            lastTimestamp = timestamp;
            
            if (currentScene.start === 0 && timestamp > 0) {
              currentScene.start = 0;
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
        .on('end', () => {
          ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
              // FIX: Jangan reject, return scenes yang sudah ada
              console.warn('ffprobe gagal saat finalisasi scene:', err.message);
              resolve(scenes.map((s, i) => ({ id: i, ...s, duration: s.end - s.start })).filter(s => s.duration > 1));
              return;
            }
            
            const totalDuration = metadata.format.duration;
            
            if (currentScene.start < totalDuration) {
              currentScene.end = totalDuration;
              scenes.push(currentScene);
            }
            
            const formattedScenes = scenes.map((s, i) => ({
              id: i,
              start: s.start,
              end: s.end,
              duration: s.end - s.start
            })).filter(s => s.duration > 1);
            
            resolve(formattedScenes);
          });
        })
        .on('error', (err) => {
          // FIX: Jangan crash, return empty array agar fallback ke segmentasi manual
          console.warn('Scene detection error (akan fallback ke manual):', err.message);
          resolve([]);
        })
        .output('-')
        .run();
    });
  }

  // ==========================================
  // AUDIO ANALYSIS
  // ==========================================
  
  async analyzeAudioPeaks(videoPath) {
    return new Promise((resolve, reject) => {
      const audioData = [];
      
      ffmpeg(videoPath)
        .audioFilters('ebur128=peak=true')
        .outputOptions('-f', 'null')
        .on('stderr', (line) => {
          const tMatch = line.match(/t:\s*([\d.]+)/);
          const peakMatch = line.match(/Peak:\s*([-\d.]+)/);
          
          if (tMatch && peakMatch) {
            audioData.push({
              time: parseFloat(tMatch[1]),
              peak: parseFloat(peakMatch[1])
            });
          }
        })
        .on('end', () => {
          const peaks = this.detectAudioPeaks(audioData);
          resolve(peaks);
        })
        .on('error', (err) => {
          console.warn('Audio analysis error:', err.message);
          resolve([]); // FIX: Jangan reject, return empty agar pipeline tetap jalan
        })
        .output('-')
        .run();
    });
  }

  detectAudioPeaks(audioData, threshold = -10) {
    const peaks = [];
    let inPeak = false;
    let peakStart = 0;
    let peakMax = -100;
    
    for (const data of audioData) {
      if (data.peak > threshold && !inPeak) {
        inPeak = true;
        peakStart = data.time;
        peakMax = data.peak;
      } else if (inPeak) {
        if (data.peak > peakMax) peakMax = data.peak;
        
        if (data.peak <= threshold) {
          inPeak = false;
          peaks.push({
            start: peakStart,
            end: data.time,
            intensity: peakMax,
            duration: data.time - peakStart
          });
          peakMax = -100;
        }
      }
    }
    
    if (inPeak && audioData.length > 0) {
      peaks.push({
        start: peakStart,
        end: audioData[audioData.length - 1].time,
        intensity: peakMax,
        duration: audioData[audioData.length - 1].time - peakStart
      });
    }
    
    return peaks
      .filter(p => p.duration >= 2)
      .sort((a, b) => b.intensity - a.intensity);
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
          await this.extractFrame(videoPath, timestamp, framePath);
          const base64 = await fs.readFile(framePath, { encoding: 'base64' });
          
          sceneSamples.push({
            timestamp,
            path: framePath,
            base64,
            relativeTime: timestamp - scene.start
          });
        } catch (err) {
          console.warn(`Gagal ekstrak frame di ${timestamp}s:`, err.message);
        }
      }
      
      if (sceneSamples.length > 0) {
        samples.push({
          sceneId: scene.id,
          scene,
          frames: sceneSamples
        });
      }
    }
    
    return samples;
  }

  extractFrame(videoPath, timestamp, outputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: [timestamp],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: '720x1280'
        })
        .on('end', resolve)
        .on('error', reject);
    });
  }

  // ==========================================
  // AI VIRAL ANALYSIS
  // ==========================================
  
  async analyzeViralPotential(sceneSamples) {
    const scores = [];
    
    for (const sample of sceneSamples) {
      const frameBase64s = sample.frames.map(f => f.base64);
      
      try {
        const analysis = await this.gemini.executeWithRotation(async (genAI, modelName) => {
          const model = genAI.getGenerativeModel({ model: modelName });
          
          const prompt = `Analyze these video frames and rate their VIRAL POTENTIAL for social media short videos (TikTok/Reels/Shorts).

Rate each aspect 0-100:
1. HOOK STRENGTH - Does it grab attention in first 3 seconds?
2. VISUAL APPEAL - Colors, composition, movement quality
3. CONTENT VALUE - Educational, entertaining, or emotional value
4. SHAREABILITY - Would people share this?
5. TREND POTENTIAL - Does it fit current trends?

Content Classification:
- Identify content type (educational, entertainment, comedy, emotional, inspirational, tutorial)

Key Moments:
- Identify timestamps of key moments/hooks

Suggested Captions:
- Suggest 2-3 short hook captions

Return ONLY valid JSON (no markdown code blocks):
{
  "hookStrength": 85,
  "visualAppeal": 70,
  "contentValue": 90,
  "shareability": 75,
  "trendPotential": 80,
  "fypScore": 80,
  "contentType": "educational",
  "keyMoments": ["0-3s: Strong hook", "5-8s: Plot twist"],
  "suggestedCaptions": ["Short hook caption", "Alternative"],
  "bestThumbnailFrame": 1
}`;

          const imageParts = frameBase64s.map(b64 => ({
            inlineData: { data: b64, mimeType: 'image/jpeg' }
          }));

          const result = await model.generateContent([prompt, ...imageParts]);
          return result.response.text();
        }, `Viral Analysis Scene ${sample.sceneId}`);

        let parsed;
        try {
          let cleanText = analysis.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
          const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
        } catch (parseError) {
          console.warn('Gagal parse response AI, gunakan default');
          parsed = {};
        }
        
        const overallScore = parsed.fypScore || 
          Math.round(((parsed.hookStrength || 50) + (parsed.visualAppeal || 50) + 
                     (parsed.contentValue || 50) + (parsed.shareability || 50) + 
                     (parsed.trendPotential || 50)) / 5);
        
        scores.push({
          sceneId: sample.scene.id,
          scene: sample.scene,
          scores: parsed,
          overallScore: overallScore,
          samples: sample.frames,
          rawResponse: analysis
        });
        
      } catch (error) {
        console.warn(`Analisa gagal untuk scene ${sample.sceneId}:`, error.message);
        scores.push({
          sceneId: sample.scene.id,
          scene: sample.scene,
          scores: {},
          overallScore: 50,
          error: true,
          errorMessage: error.message
        });
      }
    }
    
    return scores;
  }

  // ==========================================
  // MOMENT RANKING & MERGING
  // ==========================================
  
  mergeAndRankMoments(scenes, audioPeaks, viralScores, constraints) {
    const moments = [];
    
    for (const score of viralScores) {
      const scene = score.scene;
      
      const sceneAudioPeaks = audioPeaks.filter(p => 
        p.start >= scene.start && p.end <= scene.end
      );
      
      const audioBoost = sceneAudioPeaks.length > 0 ? 10 : 0;
      const intensityBoost = sceneAudioPeaks.length > 0 ? 
        Math.min(5, Math.abs(sceneAudioPeaks[0].intensity) / 10) : 0;
      
      const finalScore = Math.min(100, score.overallScore + audioBoost + intensityBoost);
      
      moments.push({
        sceneId: score.sceneId,
        start: scene.start,
        end: scene.end,
        duration: scene.end - scene.start,
        fypScore: finalScore,
        rawScore: score.overallScore,
        details: score.scores,
        audioPeaks: sceneAudioPeaks,
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

  // ==========================================
  // CLIP OPTIMIZATION
  // ==========================================
  
  optimizeClipBoundaries(moments, options) {
    const clips = [];
    const usedTimeRanges = [];
    
    for (const moment of moments) {
      if (this.hasOverlap(moment.start, moment.end, usedTimeRanges, 2)) {
        continue;
      }
      
      let clipStart = moment.start;
      let clipEnd = moment.end;
      
      const targetDuration = this.calculateOptimalDuration(moment);
      const currentDuration = moment.duration;
      
      if (currentDuration < options.minDuration) {
        const extendNeeded = options.minDuration - currentDuration;
        clipEnd = Math.min(moment.end + extendNeeded, moment.end + 5);
      } else if (currentDuration > options.maxDuration) {
        clipEnd = moment.start + Math.min(options.maxDuration, targetDuration);
      } else if (Math.abs(currentDuration - targetDuration) > 5) {
        if (currentDuration < targetDuration) {
          const extendBy = Math.min(targetDuration - currentDuration, 5);
          clipEnd = moment.end + extendBy;
        } else {
          clipEnd = moment.start + targetDuration;
        }
      }
      
      clipEnd = Math.max(clipEnd, clipStart + options.minDuration);
      clipEnd = Math.min(clipEnd, clipStart + options.maxDuration);
      
      const clip = {
        id: clips.length + 1,
        start: clipStart,
        end: clipEnd,
        duration: clipEnd - clipStart,
        fypScore: moment.fypScore,
        contentType: moment.metadata.contentType,
        keyMoments: moment.metadata.keyMoments,
        suggestedCaption: moment.metadata.suggestedCaptions[0] || '',
        bestThumbnailFrame: moment.metadata.bestThumbnailFrame,
        sourceMoment: moment
      };
      
      clips.push(clip);
      usedTimeRanges.push({ start: clipStart, end: clipEnd });
      
      if (clips.length >= options.targetCount) break;
    }
    
    return clips;
  }

  calculateOptimalDuration(moment) {
    const contentType = moment.details?.contentType || moment.metadata?.contentType || 'general';
    
    switch (contentType) {
      case 'educational':
      case 'tutorial':
        return 45;
      case 'comedy':
        return 15;
      case 'emotional':
        return 25;
      case 'entertainment':
        return moment.fypScore > 90 ? 21 : 30;
      default:
        return moment.fypScore > 85 ? 21 : 30;
    }
  }

  hasOverlap(start, end, ranges, bufferSeconds = 0) {
    return ranges.some(r => {
      const rStart = r.start - bufferSeconds;
      const rEnd = r.end + bufferSeconds;
      return !(end <= rStart || start >= rEnd);
    });
  }

  // ==========================================
  // CLEANUP
  // ==========================================
  
  async cleanup() {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
      console.log('🧹 Temp directory dibersihkan');
    } catch (err) {
      console.warn('Gagal membersihkan temp:', err.message);
    }
  }
}

module.exports = ViralMomentDetector;
