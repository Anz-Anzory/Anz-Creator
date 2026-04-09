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
    console.log(`Generating ${clipPlan.length} clips...`);
    await fs.mkdir(this.outputDir, { recursive: true });
    const generatedClips = [];
    
    for (let i = 0; i < clipPlan.length; i++) {
      const plan = clipPlan[i];
      try {
        // Proses render potongan MP4 dengan pantauan Real-Time
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

        // Generate Metadata & Thumbnail
        const metadata = await this.generateMetadata(clipPath, plan);
        const thumbnails = await this.thumbnailExtractor.extractThumbnails(clipPath, plan, { count: 3 });
        const finalFYPScore = await this.calculateFinalFYPScore(plan, metadata);

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
        
        if (options.onProgress) {
          options.onProgress({
            current: i + 1,
            total: clipPlan.length,
            clip: generatedClip
          });
        }
      } catch (error) {
        console.error(`Failed to generate clip ${plan.id}:`, error.message);
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
          // FIX: Memisahkan argumen '-vf' agar Windows/FFmpeg tidak error (Kode 4294967274)
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

  async generateMetadata(clipPath, plan) {
    const samples = await this.extractSampleFrames(clipPath);
    const [title, caption, hashtags] = await Promise.all([
      this.generateTitle(samples, plan),
      this.generateCaption(samples, plan),
      this.generateHashtags(samples, plan)
    ]);
    return { title, caption, hashtags };
  }

  async extractSampleFrames(clipPath, count = 3) {
    const frames = [];
    const timestamps = [0.2, 0.5, 0.8]; // Diubah agar sebarannya lebih merata
    
    for (let i = 0; i < count; i++) {
      const framePath = path.join(this.outputDir, `frame-temp-${Date.now()}-${i}.jpg`);
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
    }
    return frames;
  }

  // Menggunakan Gemini 3 Flash Preview (Super Cepat & Bebas Limit)
  async generateTitle(frames, plan) {
    return this.gemini.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
      const prompt = `Create a VIRAL, ATTENTION-GRABBING title for this short video.
      Context: ${plan.contentType}, FYP Score: ${plan.fypScore}/100
      Key moment: ${plan.keyMoments?.[0] || 'Interesting content'}
      Rules: Max 60 chars, power words. Return ONLY the title without quotes.`;
      const images = frames.map(f => ({ inlineData: { data: f.base64, mimeType: 'image/jpeg' } }));
      const result = await model.generateContent([prompt, ...images]);
      return result.response.text().trim().replace(/^["']|["']$/g, '');
    }, 'Title Generation');
  }

  async generateCaption(frames, plan) {
    return this.gemini.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
      const prompt = `Create an engaging social media caption for this video.
      Content Type: ${plan.contentType} | Duration: ${plan.duration}s
      Structure: Hook, Context, CTA. Emojis. Max 150 chars for hook.`;
      const images = frames.map(f => ({ inlineData: { data: f.base64, mimeType: 'image/jpeg' } }));
      const result = await model.generateContent([prompt, ...images]);
      return result.response.text().trim();
    }, 'Caption Generation');
  }

  async generateHashtags(frames, plan) {
    return this.gemini.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
      const prompt = `Generate 15 strategic hashtags for this ${plan.contentType} video. Mix broad, niche, community. Return ONLY hashtags separated by spaces.`;
      const result = await model.generateContent(prompt);
      return result.response.text().match(/#\w+/g) || [];
    }, 'Hashtag Generation');
  }

  async calculateFinalFYPScore(plan, metadata) {
    let score = plan.fypScore;
    if (metadata.title.length > 10) score += 2;
    if (metadata.caption.includes('?') || metadata.caption.includes('!')) score += 2;
    if (metadata.hashtags.length >= 10) score += 2;
    return Math.min(100, score);
  }

  async cleanup() {
    try { await fs.rm(this.outputDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = ClipGenerator;
