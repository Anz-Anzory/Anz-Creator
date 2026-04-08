const GeminiService = require('../ai/GeminiService');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');

class ViralMomentDetector {
  constructor(apiKeys) {
    this.gemini = new GeminiService(apiKeys);
    this.tempDir = path.join(require('os').tmpdir(), 'viral-detection');
  }

  async detectViralMoments(videoPath, options = {}) {
    console.log('Analyzing video for viral moments...');
    
    const strategy = options.strategy || 'comprehensive';
    const minClipDuration = options.minDuration || 15;
    const maxClipDuration = options.maxDuration || 60;
    const targetClipCount = options.targetClips || 10;
    
    try {
      const scenes = await this.extractScenes(videoPath);
      const audioAnalysis = await this.analyzeAudioPeaks(videoPath);
      
      console.log(`Sampling ${scenes.length} scenes...`);
      const sceneSamples = await this.sampleScenes(videoPath, scenes, strategy);
      
      console.log('Analyzing viral potential...');
      const viralScores = await this.analyzeViralPotential(sceneSamples);
      
      const moments = this.mergeAndRankMoments(
        scenes, 
        audioAnalysis, 
        viralScores,
        { minDuration: minClipDuration, maxDuration: maxClipDuration }
      );
      
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
      console.error('Viral detection failed:', error);
      throw error;
    }
  }

  async extractScenes(videoPath, threshold = 0.3) {
    return new Promise((resolve, reject) => {
      const scenes = [];
      let currentScene = { start: 0, end: 0 };
      
      ffmpeg(videoPath)
        .videoFilters(`select='gt(scene,${threshold})',showinfo`)
        .outputOptions('-f', 'null')
        .on('stderr', (stderrLine) => {
          const match = stderrLine.match(/pts_time:([\d.]+)/);
          if (match) {
            const timestamp = parseFloat(match[1]);
            if (currentScene.start === 0) {
              currentScene.start = timestamp;
            } else {
              currentScene.end = timestamp;
              scenes.push({ ...currentScene });
              currentScene = { start: timestamp, end: timestamp };
            }
          }
        })
        .on('end', () => {
          ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) reject(err);
            else {
              currentScene.end = metadata.format.duration;
              scenes.push(currentScene);
              resolve(scenes.map((s, i) => ({ 
                id: i, 
                start: s.start, 
                end: s.end, 
                duration: s.end - s.start 
              })));
            }
          });
        })
        .on('error', reject)
        .output('-')
        .run();
    });
  }

  async analyzeAudioPeaks(videoPath) {
    return new Promise((resolve, reject) => {
      const audioData = [];
      
      ffmpeg(videoPath)
        .audioFilters('ebur128=peak=true')
        .outputOptions('-f', 'null')
        .on('stderr', (line) => {
          const match = line.match(/t:\s*([\d.]+).*Peak:\s*([-\d.]+)/);
          if (match) {
            audioData.push({
              time: parseFloat(match[1]),
              peak: parseFloat(match[2])
            });
          }
        })
        .on('end', () => {
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
    
    for (const data of audioData) {
      if (data.peak > threshold && !inPeak) {
        inPeak = true;
        peakStart = data.time;
      } else if (data.peak <= threshold && inPeak) {
        inPeak = false;
        peaks.push({
          start: peakStart,
          end: data.time,
          intensity: data.peak
        });
      }
    }
    
    return peaks;
  }

  async sampleScenes(videoPath, scenes, strategy) {
    await fs.mkdir(this.tempDir, { recursive: true });
    
    const samples = [];
    const sampleCount = strategy === 'fast' ? 1 : strategy === 'deep' ? 5 : 3;
    
    for (const scene of scenes) {
      const sceneSamples = [];
      const interval = scene.duration / (sampleCount + 1);
      
      for (let i = 1; i <= sampleCount; i++) {
        const timestamp = scene.start + (interval * i);
        const framePath = path.join(this.tempDir, `scene-${scene.id}-frame-${i}.jpg`);
        
        await new Promise((resolve, reject) => {
          ffmpeg(videoPath)
            .screenshots({
              timestamps: [timestamp],
              filename: path.basename(framePath),
              folder: path.dirname(framePath),
              size: '720x1280'
            })
            .on('end', resolve)
            .on('error', reject);
        });
        
        const base64 = await fs.readFile(framePath, { encoding: 'base64' });
        
        sceneSamples.push({
          timestamp,
          path: framePath,
          base64
        });
      }
      
      samples.push({
        sceneId: scene.id,
        scene,
        frames: sceneSamples
      });
    }
    
    return samples;
  }

  async analyzeViralPotential(sceneSamples) {
    const scores = [];
    
    for (const sample of sceneSamples) {
      const frameBase64s = sample.frames.map(f => f.base64);
      
      try {
        const analysis = await this.gemini.executeWithRotation(async (genAI) => {
          const model = genAI.getGenerativeModel({ model: 'gemini-pro-vision' });
          
          const prompt = `Analyze these video frames and rate their VIRAL POTENTIAL for social media short videos (TikTok/Reels/Shorts).

Rate each aspect 0-100:
1. HOOK STRENGTH - Does it grab attention in first 3 seconds?
2. VISUAL APPEAL - Colors, composition, movement quality
3. CONTENT VALUE - Educational, entertaining, or emotional value
4. SHAREABILITY - Would people share this?
5. TREND POTENTIAL - Does it fit current trends?

Return ONLY JSON:
{
  "hookStrength": 85,
  "visualAppeal": 70,
  "contentValue": 90,
  "shareability": 75,
  "trendPotential": 80,
  "fypScore": 80,
  "contentType": "educational|entertainment|emotional|inspirational|comedy",
  "keyMoments": ["0-3s: Strong hook", "5-8s: Plot twist"],
  "suggestedCaptions": ["Short hook caption"],
  "bestThumbnailFrame": 2
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

        const jsonMatch = analysis.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
        
        scores.push({
          sceneId: sample.scene.id,
          scene: sample.scene,
          scores: parsed,
          overallScore: parsed.fypScore || 50,
          samples
        });
        
      } catch (error) {
        console.warn(`Analysis failed for scene ${sample.sceneId}:`, error.message);
        scores.push({
          sceneId: sample.scene.id,
          scene: sample.scene,
          scores: {},
          overallScore: 50,
          error: true
        });
      }
    }
    
    return scores;
  }

  mergeAndRankMoments(scenes, audioPeaks, viralScores, constraints) {
    const moments = [];
    
    for (const score of viralScores) {
      const scene = score.scene;
      
      const sceneAudioPeaks = audioPeaks.filter(p => 
        p.start >= scene.start && p.end <= scene.end
      );
      
      const audioBoost = sceneAudioPeaks.length > 0 ? 10 : 0;
      const finalScore = Math.min(100, score.overallScore + audioBoost);
      
      moments.push({
        sceneId: score.sceneId,
        start: scene.start,
        end: scene.end,
        duration: scene.end - scene.start,
        fypScore: finalScore,
        details: score.scores,
        audioPeaks: sceneAudioPeaks,
        metadata: {
          contentType: score.scores.contentType || 'general',
          keyMoments: score.scores.keyMoments || [],
          suggestedCaptions: score.scores.suggestedCaptions || []
        }
      });
    }
    
    return moments.sort((*
