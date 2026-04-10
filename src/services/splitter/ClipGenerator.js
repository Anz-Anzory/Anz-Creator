const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');
const GeminiService = require('../ai/GeminiService');
const ThumbnailExtractor = require('./ThumbnailExtractor');

class ClipGenerator {
  constructor(apiKeys) {
    this.gemini = new GeminiService(apiKeys);
    this.thumbnailExtractor = new ThumbnailExtractor();
    this.outputDir = path.join(require('os').tmpdir(), 'generated-clips');
  }

  async generateClips(videoPath, clipPlan, options = {}) {
    console.log(`Mulai merender ${clipPlan.length} klip video...`);
    await fs.mkdir(this.outputDir, { recursive: true });
    const generatedClips = [];
    
    for (let i = 0; i < clipPlan.length; i++) {
      const plan = clipPlan[i];
      try {
        // 1. Potong Video MP4 dengan progress real-time
        const clipPath = await this.extractClip(videoPath, plan, i + 1, (percent) => {
          if (options.onProgress) {
            options.onProgress({
              current: i + 1,
              total: clipPlan.length,
              subPercent: percent,
              taskName: `Memotong Video ${i + 1}/${clipPlan.length} (${Math.round(percent)}%)`
            });
          }
        });

        // 2. Generate Metadata via AI (3-in-1 JSON)
        if (options.onProgress) {
          options.onProgress({
            current: i + 1, total: clipPlan.length, subPercent: 100,
            taskName: `Menganalisa AI Klip ${i + 1}/${clipPlan.length}...`
          });
        }
        const metadata = await this.generateMetadata(clipPath, plan);
        
        // 3. Ekstrak 3 Thumbnail Terbaik
        const thumbnails = await this.thumbnailExtractor.extractThumbnails(clipPath, plan, { count: 3 });
        
        // 4. Kalkulasi Skor FYP Akhir
        const finalFYPScore = this.calculateFinalFYPScore(plan, metadata);

        const generatedClip = {
          id: plan.id,
          sequence: plan.sequence || (i + 1),
          videoPath: clipPath,
          filename: path.basename(clipPath),
          duration: plan.duration,
          startTime: plan.start,
          endTime: plan.end,
          metadata: {
            title: metadata.title,
            caption: metadata.caption,
            hashtags: metadata.hashtags,
            fypScore: finalFYPScore,
            contentType: plan.contentType,
            keyMoments: plan.keyMoments
          },
          thumbnails: thumbnails,
          seriesInfo: plan.seriesInfo,
          timing: plan.timing
        };
        
        generatedClips.push(generatedClip);
        
      } catch (error) {
        console.error(`Gagal membuat klip ${plan.id}:`, error.message);
        generatedClips.push({
          id: plan.id,
          sequence: plan.sequence || (i + 1),
          error: true,
          errorMessage: error.message
        });
      }
    }
    
    return generatedClips;
  }

  // ==========================================
  // POTONG VIDEO (FFMPEG)
  // ==========================================
  async extractClip(videoPath, plan, sequence, onProgressCallback) {
    const outputPath = path.join(this.outputDir, `clip-${String(sequence).padStart(3, '0')}-fyp${plan.fypScore}.mp4`);
    
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .setStartTime(plan.start)
        .setDuration(plan.duration)
        .outputOptions([
          '-c:v libx264',
          '-c:a aac',
          '-b:a 192k',
          '-crf 23',
          '-preset fast',
          '-movflags +faststart',
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p'
        ])
        .on('progress', (progress) => {
          if (progress.percent && onProgressCallback) {
            onProgressCallback(progress.percent);
          }
        })
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(new Error(`FFmpeg Error: ${err.message}`)))
        .run();
    });
  }

  // ==========================================
  // METADATA AI (3-IN-1 JSON)
  // ==========================================
  async generateMetadata(clipPath, plan) {
    const samples = await this.extractSampleFrames(clipPath);
    
    return this.gemini.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName }); 
      
      const prompt = `Analyze these video frames for a ${plan.contentType || 'entertainment'} short video (FYP Score: ${plan.fypScore || 50}).
      You MUST return the response EXACTLY as a valid JSON object. Do not include markdown code blocks like \`\`\`json.
      Structure required:
      {
        "title": "Write a viral title max 60 chars",
        "caption": "Write an engaging caption with a hook and emojis",
        "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]
      }`;

      const images = samples.map(f => ({ inlineData: { data: f.base64, mimeType: 'image/jpeg' } }));
      const result = await model.generateContent([prompt, ...images]);
      
      let textResponse = result.response.text().trim();
      textResponse = textResponse.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      
      try {
        return JSON.parse(textResponse);
      } catch (err) {
        console.warn("Gagal parsing JSON dari AI, menggunakan data cadangan.");
        return {
          title: "Viral Video " + (plan.fypScore || 50),
          caption: "Tonton keseruan video ini sampai habis! 🔥 Jangan lupa like dan share ya!",
          hashtags: ["#fyp", "#viral", "#trending", "#video"]
        };
      }
    }, 'Metadata Generation (3-in-1 JSON)');
  }

  // ==========================================
  // EKSTRAK FRAME SAMPEL UNTUK AI
  // ==========================================
  async extractSampleFrames(clipPath, count = 3) {
    const frames = [];
    const timestamps = [0.2, 0.5, 0.8]; 
    
    for (let i = 0; i < count; i++) {
      const framePath = path.join(this.outputDir, `frame-temp-${Date.now()}-${i}.jpg`);
      try {
        await new Promise((resolve, reject) => {
          ffmpeg(clipPath)
            .screenshots({
              timestamps: [timestamps[i]],
              filename: path.basename(framePath),
              folder: path.dirname(framePath),
              size: '720x1280'
            })
            .on('end', resolve)
            .on('error', reject);
        });
        
        const base64 = await fs.readFile(framePath, { encoding: 'base64' });
        frames.push({ path: framePath, base64, index: i });
        await fs.unlink(framePath).catch(() => {});
      } catch (err) {
        console.warn(`Gagal ekstrak frame sampel ${i}:`, err.message);
      }
    }
    return frames;
  }

  // ==========================================
  // KALKULASI SKOR FYP
  // FIX: Tidak perlu async karena tidak ada operasi async
  // ==========================================
  calculateFinalFYPScore(plan, metadata) {
    let score = plan.fypScore || 50;
    if (metadata.title && metadata.title.length > 10) score += 2;
    if (metadata.caption && (metadata.caption.includes('?') || metadata.caption.includes('!'))) score += 2;
    if (metadata.hashtags && metadata.hashtags.length >= 5) score += 2;
    return Math.min(100, score);
  }

  async cleanup() {
    try { 
      await fs.rm(this.outputDir, { recursive: true, force: true }); 
    } catch (e) {
      // Abaikan
    }
  }
}

module.exports = ClipGenerator;
