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

    this._dailyQuotaExhausted = new Set();
  }

  this.fallbackModels = [
      'gemini-3.1-flash-lite-preview',
      'gemini-3-flash-preview',
      'gemini-2.5-flash'
    ];

  getStats() {
    return {
      ...this._stats,
      keyManager: this.keyManager.getStats(),
      dailyQuotaExhaustedKeys: this._dailyQuotaExhausted.size
    };
  }

  async executeWithRotation(operation, operationName = 'operation') {
    if (!this.apiKeys || this.apiKeys.length === 0) {
      throw new Error(`${operationName} gagal: Tidak ada API Key yang valid.`);
    }

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

    const maxRetries = Math.min(availableKeyCount * this.fallbackModels.length, 12);
    let attempts = 0;
    let lastError;
    let currentModelIndex = 0;
    
    this._stats.totalCalls++;

    while (attempts < maxRetries) {
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

      if (keySearchAttempts >= this.apiKeys.length) {
        throw new Error(
          `${operationName} gagal: Semua API Key kehabisan kuota harian. Tambahkan key baru atau tunggu besok.`
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
        
        if (this.isDailyQuotaExhausted(errorMessage)) {
          console.warn(`🚫 Key ${keyIndex + 1} KUOTA HARIAN HABIS.`);
          this._dailyQuotaExhausted.add(keyIndex);
          this.keyManager.markRateLimited(keyIndex, 24 * 60 * 60 * 1000);
          
          if (this._dailyQuotaExhausted.size >= this.apiKeys.length) {
            throw new Error(`Semua ${this.apiKeys.length} API Key kehabisan kuota harian. Tambahkan key baru di Settings atau tunggu besok.`);
          }
          this.keyManager.rotateKey();
          currentModelIndex = 0;
          continue;
        }
        
        if (this.isRateLimitError(error)) {
          const waitTime = this.extractRetryAfter(error);
          console.warn(`⏳ Key ${keyIndex + 1} rate limit. Tunggu ${Math.ceil(waitTime / 1000)}s...`);
          this.keyManager.markRateLimited(keyIndex, waitTime);
          
          const otherAvailable = this.apiKeys.some((_, idx) => 
            idx !== keyIndex && !this._dailyQuotaExhausted.has(idx) && !this.keyManager.rateLimitReset.has(idx)
          );
          
          if (otherAvailable) {
            this.keyManager.rotateKey();
          } else {
            console.log(`⏳ Semua key terkena limit. Tunggu ${Math.ceil(waitTime / 1000)}s...`);
            await this.sleep(waitTime);
            this.keyManager.resetRateLimits();
          }
          continue;
        }
        
        const isServerBusy = errorLower.includes('503') || errorLower.includes('overloaded');
        const isModelNotFound = errorLower.includes('404') || errorLower.includes('not found') || errorLower.includes('not supported');
        
        if (isServerBusy || isModelNotFound) {
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
        
        this._stats.failedCalls++;
        throw error;
      }
    }

    this._stats.failedCalls++;
    const exhaustedCount = this._dailyQuotaExhausted.size;
    const hint = exhaustedCount > 0 ? ` (${exhaustedCount}/${this.apiKeys.length} key kuota habis)` : '';
    throw new Error(`${operationName} gagal setelah ${attempts} percobaan${hint}.`);
  }

  isDailyQuotaExhausted(errorMessage) {
    const msg = errorMessage.toLowerCase();
    if (msg.includes('limit: 0') || msg.includes('limit:0')) return true;
    if (msg.includes('requestsperdayperproject')) return true;
    return false;
  }

  isRateLimitError(error) {
    const msg = (error.message || '').toLowerCase();
    return ['rate limit', 'quota exceeded', '429', 'resource_exhausted', 'too many requests'].some(i => msg.includes(i));
  }

  extractRetryAfter(error) {
    const match = (error.message || '').match(/retry in ([\d.]+)s/i);
    if (match) return Math.min((Math.ceil(parseFloat(match[1])) + 3) * 1000, 120000);
    return 30000;
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ============================================
  // AI METHODS — SEMUA PROMPT BAHASA INDONESIA
  // ============================================

  async analyzeVideo(frames, prompt) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      const imageParts = frames.map(f => ({
        inlineData: { data: f.base64, mimeType: f.mimeType || 'image/jpeg' }
      }));
      const result = await model.generateContent([prompt, ...imageParts]);
      return result.response.text();
    }, 'Analisa Video');
  }

  async generateTitle(visualAnalysis) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(
        `Berdasarkan analisa visual berikut, buatkan 5 opsi judul VIRAL dalam Bahasa Indonesia untuk video pendek (TikTok/Reels/Shorts). Setiap judul maksimal 60 karakter, menarik perhatian, dan bikin penasaran.

Analisa Visual:
${visualAnalysis}

Format (1 judul per baris, diberi nomor):
1. Judul pertama
2. Judul kedua
3. dst`
      );
      return result.response.text();
    }, 'Generate Judul');
  }

  async generateCaption(visualAnalysis, options = {}) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(
        `Buatkan caption viral DALAM BAHASA INDONESIA untuk video pendek.
Jenis Konten: ${options.contentType || 'hiburan'}
Target Audiens: ${options.audience || 'umum/anak muda Indonesia'}

Analisa Visual: ${visualAnalysis}

Syarat caption:
- Bahasa Indonesia gaul/kekinian
- Dimulai dengan hook kuat (pertanyaan/pernyataan mengejutkan)
- Pakai emoji secukupnya
- Dorong engagement (like, komentar, share)
- Maksimal 300 karakter`
      );
      return result.response.text();
    }, 'Generate Caption');
  }

  async generateHashtags(visualAnalysis, count = 15) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(
        `Buatkan ${count} hashtag untuk video pendek viral di Indonesia.
Analisa: ${visualAnalysis}

Aturan:
- Campurkan hashtag Indonesia populer dan niche spesifik
- Wajib ada: #fyp #viral #trending
- Tambahkan hashtag bahasa Indonesia yang relevan
- Format: #tag1 #tag2 #tag3 (pisahkan dengan spasi)`
      );
      return result.response.text();
    }, 'Generate Hashtag');
  }

  async predictFYPScore(visualAnalysis, metadata) {
    return this.executeWithRotation(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(
        `Analisa potensi viral video ini (skor 0-100) untuk audiens Indonesia.
Durasi: ${metadata?.duration || '?'}s | Resolusi: ${metadata?.width || '?'}x${metadata?.height || '?'}

Analisa: ${visualAnalysis}

JAWAB HANYA JSON VALID (tanpa code block):
{"score":85,"reasoning":"Penjelasan dalam Bahasa Indonesia kenapa skornya segini","suggestions":["Saran perbaikan 1 dalam Bahasa Indonesia","Saran 2"]}`
      );
      return result.response.text();
    }, 'Prediksi Skor FYP');
  }
}

module.exports = GeminiService;
