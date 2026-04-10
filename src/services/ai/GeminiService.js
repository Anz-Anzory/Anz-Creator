const { GoogleGenerativeAI } = require('@google/generative-ai');
const GeminiKeyManager = require('./GeminiKeyManager');

class GeminiService {
  constructor(apiKeys) {
    if (!apiKeys || apiKeys.length === 0) {
      throw new Error('GeminiService gagal: Tidak ada API Key yang dikonfigurasi.');
    }
    this.apiKeys = apiKeys;
    this.keyManager = new GeminiKeyManager(apiKeys);
    
    // Batas percobaan = jumlah API Key x jumlah model fallback
    this.maxRetries = apiKeys.length * this.fallbackModels.length; 
    
    // FIX: Statistik penggunaan
    this._stats = {
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      lastUsedModel: null,
      lastUsedKeyIndex: null
    };
  }

  // FIX: Perbaiki nama model — gunakan model yang pasti valid
  // Verifikasi di: https://ai.google.dev/gemini-api/docs/models
  fallbackModels = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ];

  /**
   * FIX: Method getStats() — sebelumnya tidak ada, dipanggil oleh VideoAnalyzer
   */
  getStats() {
    return {
      ...this._stats,
      keyManager: this.keyManager.getStats()
    };
  }

  /**
   * Mengeksekusi operasi API dengan sistem rotasi ganda (Model & API Key).
   */
  async executeWithRotation(operation, operationName = 'operation') {
    if (!this.apiKeys || this.apiKeys.length === 0) {
      throw new Error(`${operationName} gagal: Tidak ada API Key yang valid.`);
    }

    let attempts = 0;
    let lastError;
    let currentModelIndex = 0;
    
    this._stats.totalCalls++;

    while (attempts < this.maxRetries) {
      const { key, index: keyIndex } = this.keyManager.getCurrentKey();
      const currentModelName = this.fallbackModels[currentModelIndex];
      
      try {
        console.log(`[AI] ${operationName} | Key: ${keyIndex + 1}/${this.apiKeys.length} | Model: ${currentModelName}`);
        
        const genAI = new GoogleGenerativeAI(key);
        const result = await operation(genAI, currentModelName);
        
        console.log(`✅ ${operationName} - Sukses menggunakan ${currentModelName}`);
        this._stats.successCalls++;
        this._stats.lastUsedModel = currentModelName;
        this._stats.lastUsedKeyIndex = keyIndex;
        return result;
        
      } catch (error) {
        lastError = error;
        attempts++;
        
        const errorMessage = error.message?.toLowerCase() || '';
        const isServerBusy = errorMessage.includes('503') || errorMessage.includes('high demand') || errorMessage.includes('overloaded');
        const isModelNotFound = errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('not supported');
        
        // Error 503 atau 404 — coba model berikutnya
        if (isServerBusy || isModelNotFound) {
          console.warn(`[!] Model ${currentModelName} gagal (${isServerBusy ? '503 Server Sibuk' : '404 Tidak Ditemukan'}).`);
          
          if (currentModelIndex < this.fallbackModels.length - 1) {
            currentModelIndex++;
            console.log(`🔄 Pindah ke model cadangan: ${this.fallbackModels[currentModelIndex]}...`);
          } else {
            console.warn(`[!] Semua model gagal. Mengganti API Key...`);
            this.keyManager.rotateKey();
            currentModelIndex = 0;
            await new Promise(res => setTimeout(res, 5000));
          }
          continue;
        }
        
        // Error 429 (Rate Limit)
        if (this.isRateLimitError(error)) {
          const waitTime = this.extractRetryAfter(error);
          this.keyManager.markRateLimited(keyIndex, waitTime);
          
          console.warn(`[!] Key ${keyIndex + 1} terkena Rate Limit. Tunggu ${waitTime/1000} detik...`);
          this.keyManager.rotateKey();
          await new Promise(res => setTimeout(res, 2000)); 
          continue;
        } 
        
        // Error lain — langsung throw
        this._stats.failedCalls++;
        throw error;
      }
    }

    this._stats.failedCalls++;
    throw new Error(`${operationName} gagal total setelah ${attempts} percobaan. Error: ${lastError?.message || 'Unknown'}`);
  }

  // ============================================
  // FIX: Method-method berikut SEBELUMNYA TIDAK ADA
  // Dipanggil oleh VideoAnalyzer.js — tanpa ini, halaman Editor pasti crash
  // ============================================

  /**
   * Analisa video dari frame-frame yang diekstrak
   */
  async analyzeVideo(frames, prompt) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      
      const imageParts = frames.map(frame => ({
        inlineData: {
          data: frame.base64,
          mimeType: frame.mimeType || 'image/jpeg'
        }
      }));

      const result = await model.generateContent([prompt, ...imageParts]);
      return result.response.text();
    }, 'Video Analysis');
  }

  /**
   * Generate judul viral dari hasil analisa visual
   */
  async generateTitle(visualAnalysis) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      
      const prompt = `Berdasarkan analisa visual berikut, buatkan 5 opsi judul yang viral dan menarik untuk video pendek (TikTok/Reels/Shorts). Setiap judul maksimal 60 karakter.

Analisa Visual:
${visualAnalysis}

Format jawaban (1 judul per baris, diberi nomor):
1. Judul pertama
2. Judul kedua
...dst`;

      const result = await model.generateContent(prompt);
      return result.response.text();
    }, 'Generate Title');
  }

  /**
   * Generate caption yang engaging
   */
  async generateCaption(visualAnalysis, options = {}) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      
      const prompt = `Buatkan caption viral untuk video pendek berdasarkan analisa berikut.

Jenis Konten: ${options.contentType || 'entertainment'}
Target Audiens: ${options.audience || 'general'}

Analisa Visual:
${visualAnalysis}

Buat caption yang:
- Dimulai dengan hook yang kuat (pertanyaan/pernyataan mengejutkan)
- Menggunakan emoji secukupnya
- Mendorong engagement (like, comment, share)
- Maksimal 300 karakter`;

      const result = await model.generateContent(prompt);
      return result.response.text();
    }, 'Generate Caption');
  }

  /**
   * Generate hashtag yang relevan dan trending
   */
  async generateHashtags(visualAnalysis, count = 15) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      
      const prompt = `Berdasarkan analisa visual berikut, buatkan ${count} hashtag yang relevan dan berpotensi viral.

Analisa Visual:
${visualAnalysis}

Aturan:
- Campurkan hashtag populer tinggi (jutaan views) dan niche spesifik
- Semua diawali dengan #
- Pisahkan dengan spasi
- Jangan gunakan hashtag yang terlalu generik seperti #fyp saja

Format: #hashtag1 #hashtag2 #hashtag3 ...`;

      const result = await model.generateContent(prompt);
      return result.response.text();
    }, 'Generate Hashtags');
  }

  /**
   * Prediksi skor FYP (potensi viral)
   */
  async predictFYPScore(visualAnalysis, metadata) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      
      const prompt = `Analisa potensi viral video ini dan berikan skor FYP (For You Page) dari 0-100.

Analisa Visual:
${visualAnalysis}

Metadata Video:
- Durasi: ${metadata?.duration || 'unknown'}s
- Resolusi: ${metadata?.width || '?'}x${metadata?.height || '?'}
- FPS: ${metadata?.fps || '?'}

Evaluasi aspek berikut:
1. Hook Strength (0-100): Seberapa kuat 3 detik pertama menarik perhatian
2. Visual Appeal (0-100): Kualitas visual, warna, komposisi
3. Content Value (0-100): Nilai edukasi/hiburan/emosi
4. Shareability (0-100): Seberapa besar kemungkinan di-share
5. Trend Alignment (0-100): Kesesuaian dengan tren terkini

JAWAB HANYA DALAM FORMAT JSON VALID (tanpa markdown code block):
{
  "score": 85,
  "reasoning": "Penjelasan singkat kenapa skornya segitu",
  "breakdown": {
    "hookStrength": 80,
    "visualAppeal": 90,
    "contentValue": 85,
    "shareability": 80,
    "trendAlignment": 75
  },
  "suggestions": ["Saran 1", "Saran 2", "Saran 3"]
}`;

      const result = await model.generateContent(prompt);
      return result.response.text();
    }, 'FYP Score Prediction');
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  isRateLimitError(error) {
    const rateLimitIndicators = [
      'rate limit', 'quota exceeded', '429', 'resource_exhausted', 'too many requests'
    ];
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = String(error.code || '');
    
    return rateLimitIndicators.some(indicator => 
      errorMessage.includes(indicator) || errorCode.includes(indicator)
    );
  }

  extractRetryAfter(error) {
    let waitTime = 15000;
    const errorMessage = error.message?.toLowerCase() || '';
    
    const match = errorMessage.match(/retry in ([\d.]+)s/);
    if (match && match[1]) {
      waitTime = Math.ceil(parseFloat(match[1])) * 1000;
    }
    
    return Math.min(waitTime, 60000);
  }
}

module.exports = GeminiService;
