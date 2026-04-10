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
        ? await this.transcribeAudio(videoPath).catch(err => {
            console.warn('Audio transcription gagal, lanjutkan tanpa transkripsi:', err.message);
            return null;
          })
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
    const tempDir = path.join(require('os').tmpdir(), 'video-frames-' + Date.now());
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

    // Bersihkan temp dir setelah semua frame diekstrak
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    
    return frames;
  }

  async transcribeAudio(videoPath) {
    const tempDir = path.join(require('os').tmpdir(), 'audio-temp-' + Date.now());
    await fs.mkdir(tempDir, { recursive: true });
    const audioPath = path.join(tempDir, 'audio.mp3');
    
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .save(audioPath)
        .on('end', resolve)
        .on('error', reject);
    });

    const audioData = await fs.readFile(audioPath, { encoding: 'base64' });
    
    const transcription = await this.gemini.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      
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

    // Bersihkan temp
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    
    return transcription;
  }

  async getVideoMetadata(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) reject(err);
        else {
          const videoStream = metadata.streams.find(s => s.codec_type === 'video');
          
          if (!videoStream) {
            reject(new Error('Tidak ditemukan stream video'));
            return;
          }
          
          // FIX: Hapus eval() — gunakan kalkulasi manual yang aman
          const frameRateStr = videoStream.r_frame_rate || '30/1';
          const [num, den] = frameRateStr.split('/');
          const fps = den ? (Number(num) / Number(den)) : Number(num);
          
          resolve({
            duration: metadata.format.duration,
            size: metadata.format.size,
            bitrate: metadata.format.bit_rate,
            width: videoStream.width,
            height: videoStream.height,
            fps: fps || 30,
            codec: videoStream.codec_name
          });
        }
      });
    });
  }

  parseTitles(titleText) {
    if (!titleText) return ['Untitled Video'];
    
    const titles = titleText
      .split('\n')
      .filter(line => /^\d+\./.test(line.trim()))
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .filter(line => line.length > 0);
    
    return titles.length > 0 ? titles : [titleText.trim()];
  }

  parseHashtags(hashtagText) {
    if (!hashtagText) return ['#fyp', '#viral'];
    
    return hashtagText
      .split(/[\s,]+/)
      .filter(tag => tag.startsWith('#'))
      .map(tag => tag.trim())
      .filter(tag => tag.length > 1);
  }

  parseFYPScore(scoreText) {
    if (!scoreText) return { score: 70, reasoning: 'Tidak dapat dianalisa', suggestions: [] };
    
    try {
      // Coba parse JSON langsung
      let cleanText = scoreText.trim();
      cleanText = cleanText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          score: parsed.score || 70,
          reasoning: parsed.reasoning || scoreText,
          breakdown: parsed.breakdown || {},
          suggestions: parsed.suggestions || []
        };
      }
      
      // Fallback: cari pola "XX/100"
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
