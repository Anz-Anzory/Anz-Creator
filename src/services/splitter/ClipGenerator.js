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
      console.log(`\nProcessing clip ${i + 1}/${clipPlan.length} (FYP: ${plan.fypScore})`);
      
      try {
        const clipPath = await this.extractClip(videoPath, plan, i + 1);
        const metadata = await this.generateMetadata(clipPath, plan);
        const thumbnails = await this.thumbnailExtractor.extractThumbnails(clipPath, plan, { count: 3 });
        const finalFYPScore = await this.calculateFinalFYPScore(plan, metadata);

        const generatedClip = {
          id: plan.id,
          sequence: plan.sequence,
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
          error: true,
          errorMessage: error.message
        });
      }
    }
    
    return generatedClips;
  }

  async extractClip(videoPath, plan, sequence) {
    const outputPath = path.join(
      this.outputDir, 
      `clip-${String(sequence).padStart(3, '0')}-fyp${plan.fypScore}.mp4`
    );
    
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .setStartTime(plan.start)
        .setDuration(plan.duration)
        .outputOptions([
          '-c:v libx264',
          '-c:a aac',
          '-strict experimental',
          '-b:a 192k',
          '-pix_fmt yuv420p',
          '-crf 23',
          '-preset fast',
          '-movflags +faststart',
          '-vf format=yuv420p'
        ])
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', reject)
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
    const timestamps = [0.5, 0.5, 0.9];
    
    for (let i = 0; i < count; i++) {
      const framePath = path.join(this.outputDir, `frame-temp-${i}.jpg`);
      await new Promise((resolve, reject) => {
        ffmpeg(clipPath)
          .screenshots({
            timestamps: [timestamps[i]],
            filename: `frame-temp-${i}.jpg`,
            folder: this.outputDir,
            size: '720x1280'
          })
          .on('end', resolve)
          .on('error', reject);
      });
      
      const base64 = await fs.readFile(framePath, { encoding: 'base64' });
      frames.push({ path: framePath, base64, index: i });
      await fs.unlink(framePath);
    }
    
    return frames;
  }

  async generateTitle(frames, plan) {
    return this.gemini.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
      
      const prompt = `Create a VIRAL, ATTENTION-GRABBING title for this short video.
Context: ${plan.contentType}, FYP Score: ${plan.fypScore}/100
Key moment: ${plan.keyMoments?.[0] || 'Interesting content'}

Rules:
- Max 60 characters
- Use power words (Amazing, Shocking, Secret, Ultimate, etc.)
- Create curiosity gap
- No clickbait that doesn't deliver

Return ONLY the title, no quotes.`;

      const images = frames.map(f => ({
        inlineData: { data: f.base64, mimeType: 'image/jpeg' }
      }));

      const result = await model.generateContent([prompt, ...images]);
      return result.response.text().trim().replace(/^["']|["']$/g, '');
    }, 'Title Generation');
  }

  async generateCaption(frames, plan) {
    return this.gemini.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
      
      const prompt = `Create an engaging social media caption for this video.

Content Type: ${plan.contentType}
Video Duration: ${plan.duration}s

Structure:
Line 1: HOOK (stop the scroll - max 8 words)
Line 2-3: CONTEXT/VALUE (what's in the video)
Line 4: CTA (comment, follow, save, share)
Line 5: (optional) Series info if part ${plan.seriesInfo?.part} of ${plan.seriesInfo?.total}

Use emojis naturally. Add line breaks.
Max 150 characters for hook + context.`;

      const images = frames.map(f => ({
        inlineData: { data: f.base64, mimeType: 'image/jpeg' }
      }));

      const result = await model.generateContent([prompt, ...images]);
      return result.response.text().trim();
    }, 'Caption Generation');
  }

  async generateHashtags(frames, plan) {
    return this.gemini.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
      
      const prompt = `Generate 15 strategic hashtags for this ${plan.contentType} video.
FYP Score: ${plan.fypScore}/100

Mix:
- 5 broad trending (#fyp #viral #trending)
- 5 niche-specific (relevant to content)
- 5 community tags (target audience)

Return ONLY hashtags separated by spaces.`;

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const hashtags = text.match(/#\w+/g) || [];
      return hashtags.slice(0, 15);
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
    try {
      await fs.rm(this.outputDir, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = ClipGenerator;
