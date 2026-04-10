const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const fsSync = require('fs');
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
        // 1. Potong Video
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

        // FIX: Verifikasi file clip BENAR-BENAR ada
        if (!fsSync.existsSync(clipPath)) {
          throw new Error(`File clip tidak terbuat: ${clipPath}`);
        }

        // 2. Generate Metadata via AI (dengan fallback offline)
        if (options.onProgress) {
          options.onProgress({
            current: i + 1, total: clipPlan.length, subPercent: 100,
            taskName: `Menganalisa AI Klip ${i + 1}/${clipPlan.length}...`
          });
        }
        
        let metadata;
        try {
          metadata = await this.generateMetadata(clipPath, plan);
        } catch (aiError) {
          console.warn(`⚠️ AI Metadata gagal untuk klip ${i + 1}: ${aiError.message}`);
          console.warn(`📝 Menggunakan metadata offline (tanpa AI)...`);
          metadata = this.generateOfflineMetadata(plan, i + 1);
        }
        
        // 3. Ekstrak Thumbnail
        const thumbnails = await this.thumbnailExtractor.extractThumbnails(clipPath, plan, { count: 3 });
        
        // 4. Kalkulasi Skor FYP
        const finalFYPScore = this.calculateFinalFYPScore(plan, metadata);

        generatedClips.push({
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
        });
        
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
    const outputPath = path.join(this.outputDir, `clip-${String(sequence).padStart(3, '0')}-fyp${plan.fypScore || 50}.mp4`);
    
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
  // METADATA AI (3-IN-1 JSON) — BAHASA INDONESIA
  // ==========================================
  async generateMetadata(clipPath, plan) {
    const samples = await this.extractSampleFrames(clipPath);
    
    // FIX: Jika tidak ada frame yang berhasil diekstrak, gunakan fallback
    if (samples.length === 0) {
      console.warn('⚠️ Tidak ada frame sampel, gunakan metadata offline');
      return this.generateOfflineMetadata(plan, plan.sequence || 1);
    }
    
    return this.gemini.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName }); 
      
      // FIX: Prompt dalam Bahasa Indonesia
      const prompt = `Analisa frame video ini untuk konten pendek ${plan.contentType || 'hiburan'} (Skor FYP: ${plan.fypScore || 50}).

KAMU HARUS menjawab dalam Bahasa Indonesia.
KAMU HARUS mengembalikan HANYA JSON valid tanpa code block markdown.

Format JSON yang WAJIB:
{
  "title": "Tulis judul viral maksimal 60 karakter dalam Bahasa Indonesia",
  "caption": "Tulis caption menarik dengan hook dan emoji dalam Bahasa Indonesia",
  "hashtags": ["#fyp", "#viral", "#kontenindonesia", "#trending", "#video"]
}`;

      const images = samples.map(f => ({ inlineData: { data: f.base64, mimeType: 'image/jpeg' } }));
      const result = await model.generateContent([prompt, ...images]);
      
      let textResponse = result.response.text().trim();
      textResponse = textResponse.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      
      try {
        return JSON.parse(textResponse);
      } catch (err) {
        console.warn("Gagal parsing JSON dari AI, gunakan fallback.");
        return this.generateOfflineMetadata(plan, plan.sequence || 1);
      }
    }, 'Metadata Generation');
  }

  // ==========================================
  // EKSTRAK FRAME SAMPEL — FIX: Gunakan metode yang sama dengan ThumbnailExtractor
  // ==========================================
  async extractSampleFrames(clipPath, count = 3) {
    const frames = [];
    
    // Ambil durasi clip sebenarnya
    const duration = await new Promise((resolve) => {
      ffmpeg.ffprobe(clipPath, (err, metadata) => {
        resolve(err ? 10 : parseFloat(metadata.format.duration) || 10);
      });
    });
    
    const timestamps = [
      Math.max(0.5, duration * 0.2),
      duration * 0.5,
      Math.min(duration - 0.5, duration * 0.8)
    ];
    
    for (let i = 0; i < count; i++) {
      const framePath = path.join(this.outputDir, `frame-sample-${Date.now()}-${i}.jpg`);
      try {
        // FIX: Gunakan -ss + -frames:v 1 (reliable)
        await new Promise((resolve, reject) => {
          ffmpeg(clipPath)
            .seekInput(timestamps[i])
            .frames(1)
            .outputOptions(['-q:v', '3'])
            .output(framePath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
        
        // Verifikasi file ada
        if (!fsSync.existsSync(framePath)) continue;
        
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
  // ==========================================
  calculateFinalFYPScore(plan, metadata) {
    let score = plan.fypScore || 50;
    if (metadata.title && metadata.title.length > 10) score += 2;
    if (metadata.caption && (metadata.caption.includes('?') || metadata.caption.includes('!'))) score += 2;
    if (metadata.hashtags && metadata.hashtags.length >= 5) score += 2;
    return Math.min(100, score);
  }

  // ==========================================
  // FALLBACK METADATA OFFLINE — BAHASA INDONESIA
  // ==========================================
  generateOfflineMetadata(plan, sequence) {
    const contentType = plan.contentType || 'entertainment';
    
    const templates = {
      educational: {
        titles: ['Tips Bermanfaat', 'Fakta Menarik', 'Tahukah Kamu?', 'Info Penting', 'Wajib Tahu'],
        captions: [
          'Simak info bermanfaat ini sampai habis! 💡 Save buat nanti ya!',
          'Banyak yang belum tahu ini! 🤯 Share ke teman-teman kalian!',
          'Jangan cuma di-scroll, ini penting banget! 📚 Follow untuk info lainnya!'
        ],
        tags: ['#edukasi', '#fakta', '#tipsbermanfaat', '#infomenarik', '#tahukahkamu', '#belajar', '#pengetahuan']
      },
      comedy: {
        titles: ['Ngakak Parah 😂', 'Kocak Banget', 'Auto Ketawa', 'Lucunya Kebangetan', 'Bikin Ngakak'],
        captions: [
          'Jangan ditahan ketawanya! 😂🤣 Tag temen yang harus liat ini!',
          'Auto ngakak sih ini! 🤣 Like kalau kalian juga ketawa!',
          'Siapa yang relate?! 😂 Komentar dong pengalaman kalian!'
        ],
        tags: ['#lucu', '#ngakak', '#kocak', '#comedy', '#humor', '#receh', '#memeindonesia']
      },
      entertainment: {
        titles: ['Wajib Tonton! 🔥', 'Seru Banget', 'Auto FYP', 'Keren Parah', 'Gak Nyangka'],
        captions: [
          'Tonton sampai habis! 🔥 Kalian pasti gak nyangka endingnya!',
          'Ini sih keren banget! ✨ Like kalau setuju, komentar kalau enggak!',
          'Yang sabar nonton sampai akhir, pasti worth it! 🎬 Jangan lupa share!'
        ],
        tags: ['#fyp', '#viral', '#trending', '#konten', '#seru', '#foryou', '#foryoupage']
      },
      emotional: {
        titles: ['Bikin Terharu 🥺', 'Menyentuh Hati', 'Bikin Baper', 'Mengharukan', 'Hati-hati Baper'],
        captions: [
          'Siapa yang relate? 🥺 Ceritain pengalaman kalian di komentar!',
          'Ini bikin hati adem banget 💙 Share ke orang yang kalian sayang!',
          'Tahan air mata kalian... 😢 Tag seseorang yang harus liat ini!'
        ],
        tags: ['#menyentuhhati', '#baper', '#motivasi', '#inspirasi', '#sedih', '#terharu', '#quotes']
      },
      tutorial: {
        titles: ['Tutorial Lengkap', 'Cara Mudah', 'Step by Step', 'DIY Gampang', 'Ikutin Caranya'],
        captions: [
          'Tutorial lengkap step by step! 📝 Save dan coba sendiri ya!',
          'Gampang banget ternyata! 💡 Follow untuk tutorial lainnya!',
          'Ikutin langkah-langkahnya, dijamin berhasil! ✅ Share ke yang butuh!'
        ],
        tags: ['#tutorial', '#caramudah', '#diy', '#tipsandtricks', '#belajar', '#stepbystep', '#howto']
      }
    };
    
    const template = templates[contentType] || templates.entertainment;
    const idx = ((sequence || 1) - 1);
    
    return {
      title: `${template.titles[idx % template.titles.length]} Part ${sequence}`,
      caption: template.captions[idx % template.captions.length],
      hashtags: [...template.tags, `#part${sequence}`, '#video', '#indonesia', '#kontenkreator', '#shorts'],
      _offlineGenerated: true
    };
  }

  async cleanup() {
    try { 
      await fs.rm(this.outputDir, { recursive: true, force: true }); 
    } catch (e) {}
  }
}

module.exports = ClipGenerator;
