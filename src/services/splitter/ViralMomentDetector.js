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
    console.log('🔍 Analyzing video for viral moments...');
    
    const strategy = options.strategy || 'comprehensive'; // 'fast' | 'comprehensive' | 'deep'
    const minClipDuration = options.minDuration || 15;   // Minimum 15s
    const maxClipDuration = options.maxDuration || 60;   // Maximum 60s
    const targetClipCount = options.targetClips || 10;   // Target jumlah clips
    
    try {
      // Step 1: Extract scenes & audio analysis
      const scenes = await this.extractScenes(videoPath);
      const audioAnalysis = await this.analyzeAudioPeaks(videoPath);
      
      // Step 2: Sample frames untuk AI analysis
      console.log(`📸 Sampling ${scenes.length} scenes...`);
      const sceneSamples = await this.sampleScenes(videoPath, scenes, strategy);
      
      // Step 3: AI Viral Score Analysis
      console.log('🤖 Analyzing viral potential...');
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
        totalDuration: scenes[scenes.length - 1].end,
        detectedScenes: scenes.length,
        viralMoments: moments.length,
        optimizedClips: optimizedClips.length,
        clips: optimizedClips
      };

    } catch (error) {
      console.error('❌ Viral detection failed:', error);
      throw error;
    }
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
          // Parse scene change timestamps dari ffmpeg output
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
          // Get final duration dan complete last scene
          ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
              reject(err);
              return;
            }
            
            const totalDuration = metadata.format.duration;
            
            // Complete last scene jika belum selesai
            if (currentScene.start < totalDuration) {
              currentScene.end = totalDuration;
              scenes.push(currentScene);
            }
            
            // Format scenes dengan ID dan duration
            const formattedScenes = scenes.map((s, i) => ({
              id: i,
              start: s.start,
              end: s.end,
              duration: s.end - s.start
            })).filter(s => s.duration > 1); // Filter scenes < 1s
            
            resolve(formattedScenes);
          });
        })
        .on('error', reject)
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
          // Parse EBU R128 loudness data
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
          // Detect audio peaks (exciting moments)
          const peaks = this.detectAudioPeaks(audioData);
          resolve(peaks);
        })
        .on('error', reject)
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
        // Start of peak
        inPeak = true;
        peakStart = data.time;
        peakMax = data.peak;
      } else if (inPeak) {
        // Inside peak
        if (data.peak > peakMax) peakMax = data.peak;
        
        if (data.peak <= threshold) {
          // End of peak
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
    
    // Close peak if still open at end
    if (inPeak && audioData.length > 0) {
      peaks.push({
        start: peakStart,
        end: audioData[audioData.length - 1].time,
        intensity: peakMax,
        duration: audioData[audioData.length - 1].time - peakStart
      });
    }
    
    // Filter peaks < 2s (too short) dan sort by intensity
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
      // Skip jika scene terlalu pendek
      if (scene.duration < 3) continue;
      
      const sceneSamples = [];
      
      // Calculate sample timestamps (evenly distributed)
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
          console.warn(`Failed to extract frame at ${timestamp}s:`, err.message);
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
          size: '720x1280' // Portrait untuk shorts/reels
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
        const analysis = await this.gemini.executeWithRotation(async (genAI) => {
          const model = genAI.getGenerativeModel({ model: 'gemini-3-flash' });
          
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
- Identify timestamps of key moments/hooks dalam scene ini

Suggested Captions:
- Suggest 2-3 short hook captions for this content

Return ONLY JSON:
{
  "hookStrength": 85,
  "visualAppeal": 70,
  "contentValue": 90,
  "shareability": 75,
  "trendPotential": 80,
  "fypScore": 80,
  "contentType": "educational|entertainment|emotional|inspirational|comedy|tutorial",
  "keyMoments": ["0-3s: Strong hook", "5-8s: Plot twist"],
  "suggestedCaptions": ["Short hook caption", "Alternative"],
  "bestThumbnailFrame": 1
}`;

          const imageParts = frameBase64s.map(b64 => ({
            inlineData: {
              data: b64,
              mimeType: 'image/jpeg'
            }
          }));

          const result = await model.generateContent([prompt, ...imageParts]);
          return result.response.text();
        }, `Viral Analysis Scene ${sample.sceneId}`);

        // Parse JSON response
        let parsed;
        try {
          const jsonMatch = analysis.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
        } catch (parseError) {
          console.warn('Failed to parse AI response, using defaults');
          parsed = {};
        }
        
        // Calculate overall score
        const overallScore = parsed.fypScore || 
          Math.round((parsed.hookStrength + parsed.visualAppeal + 
                     parsed.contentValue + parsed.shareability + 
                     parsed.trendPotential) / 5) || 50;
        
        scores.push({
          sceneId: sample.scene.id,
          scene: sample.scene,
          scores: parsed,
          overallScore: overallScore,
          samples: sample.frames,
          rawResponse: analysis
        });
        
      } catch (error) {
        console.warn(`Analysis failed for scene ${sample.sceneId}:`, error.message);
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
      
      // Check audio peaks dalam scene ini
      const sceneAudioPeaks = audioPeaks.filter(p => 
        p.start >= scene.start && p.end <= scene.end
      );
      
      // Boost score jika ada audio peaks (exciting audio)
      const audioBoost = sceneAudioPeaks.length > 0 ? 10 : 0;
      const intensityBoost = sceneAudioPeaks.length > 0 ? 
        Math.min(5, sceneAudioPeaks[0].intensity / 10) : 0;
      
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
    
    // Sort by FYP score descending
    return moments.sort((a, b) => b.fypScore - a.fypScore);
  }

  // ==========================================
  // CLIP OPTIMIZATION
  // ==========================================
  
  optimizeClipBoundaries(moments, options) {
    const clips = [];
    const usedTimeRanges = [];
    
    for (const moment of moments) {
      // Skip jika overlap dengan clip yang sudah ada
      if (this.hasOverlap(moment.start, moment.end, usedTimeRanges, 2)) { // 2s buffer
        continue;
      }
      
      // Adjust boundaries untuk optimal duration
      let clipStart = moment.start;
      let clipEnd = moment.end;
      
      // Target duration berdasarkan content type
      const targetDuration = this.calculateOptimalDuration(moment);
      const currentDuration = moment.duration;
      
      if (currentDuration < options.minDuration) {
        // Scene terlalu pendek, extend ke depan jika bisa
        const extendNeeded = options.minDuration - currentDuration;
        clipEnd = Math.min(moment.end + extendNeeded, moment.end + 5);
      } else if (currentDuration > options.maxDuration) {
        // Scene terlalu panjang, trim ke durasi optimal
        // Prioritaskan hook di awal
        clipEnd = moment.start + Math.min(options.maxDuration, targetDuration);
      } else if (Math.abs(currentDuration - targetDuration) > 5) {
        // Adjus untuk更接近 target
        if (currentDuration < targetDuration) {
          // Extend sedikit
          const extendBy = Math.min(targetDuration - currentDuration, 5);
          clipEnd = moment.end + extendBy;
        } else {
          // Trim sedikit
          clipEnd = moment.start + targetDuration;
        }
      }
      
      // Ensure tidak melebihi batas
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
      
      // Stop jika sudah mencapai target count
      if (clips.length >= options.targetCount) break;
    }
    
    return clips;
  }

  calculateOptimalDuration(moment) {
    // Strategy: Hook kuat = bisa pendek, Content educational = perlu lebih panjang
    const baseDuration = 30; // 30 seconds default
    
    const contentType = moment.details.contentType || 'general';
    
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
        return moment.fypScore > 85 ? 21 : baseDuration;
    }
  }

  hasOverlap(start, end, ranges, bufferSeconds = 0) {
    return ranges.some(r => {
      // Check dengan buffer untuk menghindari clips yang terlalu dekat
      const rStart = r.start - bufferSeconds;
      const rEnd = r.end + bufferSeconds;
      return !(end <= rStart || start >= rEnd);
    });
  }

  // ==========================================
  // UTILITIES
  // ==========================================
  
  async cleanup() {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
      console.log('🧹 Cleaned up temp directory');
    } catch (err) {
      console.warn('Failed to cleanup:', err.message);
    }
  }

  // Get detailed analysis report
  getAnalysisReport(results) {
    return {
      summary: {
        totalDuration: results.totalDuration,
        totalScenes: results.detectedScenes,
        viralMomentsFound: results.viralMoments,
        clipsGenerated: results.optimizedClips,
        averageFYPScore: results.clips.reduce((sum, c) => sum + c.fypScore, 0) / results.clips.length
      },
      topClips: results.clips.slice(0, 5),
      contentTypes: this.analyzeContentTypes(results.clips),
      bestPostingTimes: this.calculateOptimalPostingTimes(results.clips.length)
    };
  }

  analyzeContentTypes(clips) {
    const types = {};
    clips.forEach(c => {
      types[c.contentType] = (types[c.contentType] || 0) + 1;
    });
    return types;
  }

  calculateOptimalPostingTimes(clipCount) {
    const times = [];
    const optimalHours = [11, 15, 19, 21]; // 11am, 3pm, 7pm, 9pm
    
    for (let i = 0; i < clipCount; i++) {
      const hour = optimalHours[i % optimalHours.length];
      times.push(`${hour}:00`);
    }
    
    return times;
  }
}

module.exports = ViralMomentDetector;
