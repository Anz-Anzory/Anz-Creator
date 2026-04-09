const GeminiService = require('./GeminiService');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');

class VideoAnalyzer {
  constructor(apiKeys) {
    this.gemini = new GeminiService(apiKeys);
  }

  async analyzeVideo(videoPath, options = {}) {
    console.log('Starting video analysis...');
    
    try {
      const frames = await this.extractFrames(videoPath, 5);
      
      const visualAnalysis = await this.gemini.analyzeVideo(
        frames,
        'Analyze this video visually. Describe: main subject, mood/atmosphere, colors, any text visible, people/objects, actions happening. Be specific about content type and style.'
      );
      
      const audioTranscription = options.transcribeAudio 
        ? await this.transcribeAudio(videoPath)
        : null;

      const metadata = await this.getVideoMetadata(videoPath);

      const [title, caption, hashtags, fypScore] = await Promise.all([
        this.gemini.generateTitle(visualAnalysis),
        this.gemini.generateCaption(visualAnalysis, {
          contentType: options.contentType || 'entertainment',
          audience: options.audience || 'general'
        }),
        this.gemini.generateHashtags(visualAnalysis, 15),
        this.gemini.predictFYPScore(visualAnalysis, metadata)
      ]);

      return {
        visualAnalysis,
        audioTranscription,
        title: this.parseTitles(title),
        caption,
        hashtags: this.parseHashtags(hashtags),
        fypScore: this.parseFYPScore(fypScore),
        metadata,
        aiStats: this.gemini.getStats()
      };

    } catch (error) {
      console.error('Analysis failed:', error);
      throw error;
    }
  }

  async extractFrames(videoPath, frameCount = 5) {
    const tempDir = path.join(require('os').tmpdir(), 'video-frames');
    await fs.mkdir(tempDir, { recursive: true });

    const duration = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata.format.duration);
      });
    });

    const interval = duration / (frameCount + 1);
    const frames = [];
    
    for (let i = 1; i <= frameCount; i++) {
      const timestamp = interval * i;
      const framePath = path.join(tempDir, `frame-${i}.jpg`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .screenshots({
            timestamps: [timestamp],
            filename: `frame-${i}.jpg`,
            folder: tempDir,
            size: '1280x720'
          })
          .on('end', resolve)
          .on('error', reject);
      });

      const frameData = await fs.readFile(framePath, { encoding: 'base64' });
      frames.push({
        base64: frameData,
        mimeType: 'image/jpeg',
        timestamp,
        path: framePath
      });
    }

    await fs.rm(tempDir, { recursive: true, force: true });
    
    return frames;
  }

  async transcribeAudio(videoPath) {
    const audioPath = videoPath.replace('.mp4', '.mp3');
    
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .save(audioPath)
        .on('end', resolve)
        .on('error', reject);
    });

    const audioData = await fs.readFile(audioPath, { encoding: 'base64' });
    
    const transcription = await this.gemini.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
      
      const result = await model.generateContent([
        'Transcribe this audio and summarize the main points:',
        {
          inlineData: {
            data: audioData,
            mimeType: 'audio/mp3'
          }
        }
      ]);
      
      return result.response.text();
    }, 'Audio Transcription');

    await fs.unlink(audioPath);
    
    return transcription;
  }

  async getVideoMetadata(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) reject(err);
        else resolve({
          duration: metadata.format.duration,
          size: metadata.format.size,
          bitrate: metadata.format.bit_rate,
          width: metadata.streams[0].width,
          height: metadata.streams[0].height,
          fps: eval(metadata.streams[0].r_frame_rate),
          codec: metadata.streams[0].codec_name
        });
      });
    });
  }

  parseTitles(titleText) {
    const titles = titleText
      .split('\n')
      .filter(line => /^\d+\./.test(line.trim()))
      .map(line => line.replace(/^\d+\.\s*/, '').trim());
    
    return titles.length > 0 ? titles : [titleText.trim()];
  }

  parseHashtags(hashtagText) {
    return hashtagText
      .split(/[\s,]+/)
      .filter(tag => tag.startsWith('#'))
      .map(tag => tag.trim());
  }

  parseFYPScore(scoreText) {
    try {
      const jsonMatch = scoreText.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      
      const scoreMatch = scoreText.match(/(\d+)\s*\/\s*100/);
      return {
        score: scoreMatch ? parseInt(scoreMatch[1]) : 70,
        reasoning: scoreText,
        suggestions: []
      };
    } catch {
      return { score: 70, reasoning: scoreText, suggestions: [] };
    }
  }
}

module.exports = VideoAnalyzer;
