const { GoogleGenerativeAI } = require('@google/generative-ai');
const GeminiKeyManager = require('./GeminiKeyManager');

class GeminiService {
  constructor(apiKeys) {
    if (!apiKeys || apiKeys.length === 0) {
      throw new Error('GeminiService gagal: Tidak ada API Key yang dikonfigurasi.');
    }
    this.apiKeys = apiKeys;
    this.keyManager = new GeminiKeyManager(apiKeys);
    
    this._stats = {
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      lastUsedModel: null,
      lastUsedKeyIndex: null
    };

    // ============================================
    // FIX: Tracking kuota harian per key
    // "quota exceeded" + "limit: 0" = kuota HARIAN habis (bukan rate limit per menit)
    // ============================================
    this._dailyQuotaExhausted = new Set();
  }

  // Model diurutkan: paling ringan dulu (hemat kuota free tier)
  fallbackModels = [
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ];

  getStats() {
    return {
      ...this._stats,
      keyManager: this.keyManager.getStats(),
      dailyQuotaExhaustedKeys: this._dailyQuotaExhausted.size
    };
  }

  /**
   * ============================================
   * INTI SISTEM ROTASI — DIPERBAIKI TOTAL
   * ============================================
   * 
   * Perubahan:
   * 1. Deteksi "kuota harian habis" vs "rate limit per menit"  
   * 2. Jika SEMUA key kuota harian habis → langsung gagal (jangan buang waktu retry)
   * 3. Jeda tunggu mengikuti waktu dari pesan error Google
   * 4. maxRetries lebih kecil agar tidak spam API
   */
  async executeWithRotation(operation, operationName = 'operation') {
    if (!this.apiKeys || this.apiKeys.length === 0) {
      throw new Error(`${operationName} gagal: Tidak ada API Key yang valid.`);
    }

    // Cek apakah masih ada key yang kuota hariannya tersisa
    const availableKeyCount = this.apiKeys.length - this._dailyQuotaExhausted.size;
    if (availableKeyCount <= 0) {
      throw new Error(
        `${operationName} gagal: Semua ${this.apiKeys.length} API Key kehabisan kuota harian. ` +
        `Kuota direset besok oleh Google. Solusi:\n` +
        `1. Tambahkan API Key baru di Settings\n` +
        `2. Tunggu hingga besok (reset setiap 24 jam)\n` +
        `3. Upgrade ke paket berbayar di Google AI Studio`
      );
    }

    // maxRetries lebih kecil = tidak buang kuota sia-sia
    const maxRetries = Math.min(availableKeyCount * this.fallbackModels.length, 12);
    let attempts = 0;
    let lastError;
    let currentModelIndex = 0;
    
    this._stats.totalCalls++;

    while (attempts < maxRetries) {
      // Skip key yang kuota hariannya habis
      let keyData;
      let keySearchAttempts = 0;
      do {
        keyData = this.keyManager.getCurrentKey();
        if (this._dailyQuotaExhausted.has(keyData.index)) {
          this.keyManager.rotateKey();
          keySearchAttempts++;
        } else {
          break;
        }
      } while (keySearchAttempts < this.apiKeys.length);

      // Double-check: semua key habis
      if (keySearchAttempts >= this.apiKeys.length) {
        throw new Error(
          `${operationName} gagal: Semua API Key kehabisan kuota harian. ` +
          `Tambahkan key baru atau tunggu besok.`
        );
      }

      const { key, index: keyIndex } = keyData;
      const currentModelName = this.fallbackModels[currentModelIndex];
      
      try {
        console.log(`[AI] ${operationName} | Key: ${keyIndex + 1}/${this.apiKeys.length} | Model: ${currentModelName} | Percobaan: ${attempts + 1}/${maxRetries}`);
        
        const genAI = new GoogleGenerativeAI(key);
        const result = await operation(genAI, currentModelName);
        
        console.log(`✅ ${operationName} - Sukses (${currentModelName})`);
        this._stats.successCalls++;
        this._stats.lastUsedModel = currentModelName;
        this._stats.lastUsedKeyIndex = keyIndex;
        return result;
        
      } catch (error) {
        lastError = error;
        attempts++;
        
        const errorMessage = error.message || '';
        const errorLower = errorMessage.toLowerCase();
        
        // ========== CASE 1: KUOTA HARIAN HABIS (limit: 0) ==========
        // Tandai key ini, langsung pindah ke key lain
        if (this.isDailyQuotaExhausted(errorMessage)) {
          console.warn(`🚫 Key ${keyIndex + 1} KUOTA HARIAN HABIS. Ditandai dan dilewati.`);
          this._dailyQuotaExhausted.add(keyIndex);
          this.keyManager.markRateLimited(keyIndex, 24 * 60 * 60 * 1000); // 24 jam
          
          if (this._dailyQuotaExhausted.size >= this.apiKeys.length) {
            throw new Error(
              `Semua ${this.apiKeys.length} API Key kehabisan kuota harian. ` +
              `Tambahkan key baru di Settings atau tunggu besok.`
            );
          }
          
          this.keyManager.rotateKey();
          currentModelIndex = 0;
          continue;
        }
        
        // ========== CASE 2: RATE LIMIT PER MENIT (bisa ditunggu) ==========
        if (this.isRateLimitError(error)) {
          const waitTime = this.extractRetryAfter(error);
          console.warn(`⏳ Key ${keyIndex + 1} rate limit. Menunggu ${Math.ceil(waitTime / 1000)} detik...`);
          
          this.keyManager.markRateLimited(keyIndex, waitTime);
          
          // Coba key lain yang belum kena limit
          const otherAvailable = this.apiKeys.some((_, idx) => 
            idx !== keyIndex && 
            !this._dailyQuotaExhausted.has(idx) && 
            !this.keyManager.rateLimitReset.has(idx)
          );
          
          if (otherAvailable) {
            console.log(`🔄 Pindah ke key lain...`);
            this.keyManager.rotateKey();
          } else {
            // Semua key kena limit — tunggu sesuai waktu Google
            console.log(`⏳ Semua key terkena limit. Menunggu ${Math.ceil(waitTime / 1000)} detik...`);
            await this.sleep(waitTime);
            this.keyManager.resetRateLimits();
          }
          continue;
        }
        
        // ========== CASE 3: SERVER SIBUK (503) / MODEL TIDAK ADA (404) ==========
        const isServerBusy = errorLower.includes('503') || errorLower.includes('overloaded') || errorLower.includes('high demand');
        const isModelNotFound = errorLower.includes('404') || errorLower.includes('not found') || errorLower.includes('not supported');
        
        if (isServerBusy || isModelNotFound) {
          console.warn(`[!] Model ${currentModelName}: ${isServerBusy ? '503 Server Sibuk' : '404 Tidak Ada'}`);
          
          if (currentModelIndex < this.fallbackModels.length - 1) {
            currentModelIndex++;
            console.log(`🔄 Coba model: ${this.fallbackModels[currentModelIndex]}`);
          } else {
            this.keyManager.rotateKey();
            currentModelIndex = 0;
            await this.sleep(3000);
          }
          continue;
        }
        
        // ========== CASE 4: ERROR LAIN → langsung throw ==========
        console.error(`❌ Error tak terduga: ${errorMessage.substring(0, 200)}`);
        this._stats.failedCalls++;
        throw error;
      }
    }

    this._stats.failedCalls++;
    
    const exhaustedCount = this._dailyQuotaExhausted.size;
    let hint = '';
    if (exhaustedCount > 0) {
      hint = ` (${exhaustedCount}/${this.apiKeys.length} key kuota harian habis)`;
    }
    
    throw new Error(
      `${operationName} gagal setelah ${attempts} percobaan${hint}. ` +
      `Error terakhir: ${lastError?.message?.substring(0, 150) || 'Unknown'}`
    );
  }

  // ============================================
  // Deteksi kuota HARIAN habis (bukan rate limit per menit)
  // Ciri: "limit: 0" atau "PerDayPerProject" dalam pesan error
  // ============================================
  isDailyQuotaExhausted(errorMessage) {
    const msg = errorMessage.toLowerCase();
    
    if (msg.includes('limit: 0') || msg.includes('limit:0')) return true;
    if (msg.includes('requestsperdayperproject')) return true;
    if (msg.includes('quota exceeded') && msg.includes('free_tier') && msg.includes('perday')) return true;
    
    return false;
  }

  isRateLimitError(error) {
    const msg = (error.message || '').toLowerCase();
    const code = String(error.code || '');
    const indicators = ['rate limit', 'quota exceeded', '429', 'resource_exhausted', 'too many requests'];
    return indicators.some(i => msg.includes(i) || code.includes(i));
  }

  extractRetryAfter(error) {
    const msg = (error.message || '').toLowerCase();
    
    // Ambil waktu dari Google: "Please retry in 20.218s"
    const match = msg.match(/retry in ([\d.]+)s/);
    if (match && match[1]) {
      const seconds = Math.ceil(parseFloat(match[1]));
      return Math.min((seconds + 3) * 1000, 120000); // +3 detik buffer, max 2 menit
    }
    
    return 30000; // Default 30 detik
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // METHOD-METHOD AI
  // ============================================

  async analyzeVideo(frames, prompt) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      const imageParts = frames.map(frame => ({
        inlineData: { data: frame.base64, mimeType: frame.mimeType || 'image/jpeg' }
      }));
      const result = await model.generateContent([prompt, ...imageParts]);
      return result.response.text();
    }, 'Video Analysis');
  }

  async generateTitle(visualAnalysis) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      const prompt = `Buatkan 5 judul viral untuk video pendek (max 60 karakter per judul).
Analisa: ${visualAnalysis}
Format: 1 judul per baris, diberi nomor.`;
      const result = await model.generateContent(prompt);
      return result.response.text();
    }, 'Generate Title');
  }

  async generateCaption(visualAnalysis, options = {}) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      const prompt = `Buatkan caption viral (max 300 karakter, ada hook + emoji).
Jenis: ${options.contentType || 'entertainment'} | Audiens: ${options.audience || 'general'}
Analisa: ${visualAnalysis}`;
      const result = await model.generateContent(prompt);
      return result.response.text();
    }, 'Generate Caption');
  }

  async generateHashtags(visualAnalysis, count = 15) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      const prompt = `Buatkan ${count} hashtag viral. Format: #tag1 #tag2 #tag3
Analisa: ${visualAnalysis}`;
      const result = await model.generateContent(prompt);
      return result.response.text();
    }, 'Generate Hashtags');
  }

  async predictFYPScore(visualAnalysis, metadata) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      const prompt = `Skor viral 0-100. Durasi:${metadata?.duration||'?'}s Resolusi:${metadata?.width||'?'}x${metadata?.height||'?'}
Analisa: ${visualAnalysis}
JAWAB JSON SAJA: {"score":85,"reasoning":"alasan","suggestions":["saran"]}`;
      const result = await model.generateContent(prompt);
      return result.response.text();
    }, 'FYP Score Prediction');
  }
}

module.exports = GeminiService;
