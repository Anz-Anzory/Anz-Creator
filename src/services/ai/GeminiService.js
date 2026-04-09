const { GoogleGenerativeAI } = require('@google/generative-ai');
const GeminiKeyManager = require('./GeminiKeyManager');

class GeminiService {
  constructor(apiKeys) {
    if (!apiKeys || apiKeys.length === 0) {
      throw new Error('GeminiService gagal: Tidak ada API Key yang dikonfigurasi.');
    }
    this.apiKeys = apiKeys;
    this.keyManager = new GeminiKeyManager(apiKeys);
    
    // Batas percobaan dihitung dari jumlah API Key dikali jumlah model fallback
    this.maxRetries = apiKeys.length * 4; 
  }

  // Daftar model cadangan dengan prioritas eksekusi (Atas ke Bawah)
  fallbackModels = [
    'gemini-3.1-flash-lite-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-flash'
  ];

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

    while (attempts < this.maxRetries) {
      const { key, index: keyIndex } = this.keyManager.getCurrentKey();
      const currentModelName = this.fallbackModels[currentModelIndex];
      
      try {
        console.log(`[AI] ${operationName} | Key: ${keyIndex + 1}/${this.apiKeys.length} | Model: ${currentModelName}`);
        
        const genAI = new GoogleGenerativeAI(key);
        
        // Eksekusi fungsi internal dengan menyuntikkan instance genAI dan nama model aktif
        const result = await operation(genAI, currentModelName);
        
        console.log(`✅ ${operationName} - Sukses menggunakan ${currentModelName}`);
        return result;
        
      } catch (error) {
        lastError = error;
        attempts++;
        
        const errorMessage = error.message?.toLowerCase() || '';
        const isServerBusy = errorMessage.includes('503') || errorMessage.includes('high demand');
        const isModelNotFound = errorMessage.includes('404') || errorMessage.includes('not found');
        
        // [HANDLE] Error 503 (Server Overload) atau 404 (Model Tidak Tersedia)
        if (isServerBusy || isModelNotFound) {
          console.warn(`[!] Model ${currentModelName} gagal (${isServerBusy ? '503 Server Sibuk' : '404 Tidak Ditemukan'}).`);
          
          if (currentModelIndex < this.fallbackModels.length - 1) {
            currentModelIndex++;
            console.log(`🔄 Pindah ke model cadangan: ${this.fallbackModels[currentModelIndex]}...`);
          } else {
            console.warn(`[!] Semua prioritas model gagal. Mengganti API Key dan memberikan jeda...`);
            this.keyManager.rotateKey();
            currentModelIndex = 0; // Reset kembali ke prioritas model tertinggi
            await new Promise(res => setTimeout(res, 5000));
          }
          continue;
        }
        
        // [HANDLE] Error 429 (Rate Limit / Quota Exceeded)
        if (this.isRateLimitError(error)) {
          const waitTime = this.extractRetryAfter(error);
          this.keyManager.markRateLimited(keyIndex, waitTime);
          
          console.warn(`[!] Key ${keyIndex + 1} terkena Limit. Putar kunci dan tunggu ${waitTime/1000} detik...`);
          this.keyManager.rotateKey();
          await new Promise(res => setTimeout(res, 2000)); 
          continue;
        } 
        
        // Lempar error jika merupakan kegagalan logika sistem/kode (bukan kendala jaringan)
        throw error;
      }
    }

    throw new Error(`${operationName} gagal total setelah ${attempts} percobaan. Pesan Error: ${lastError?.message || 'Unknown API Error'}`);
  }

  /**
   * Memvalidasi apakah error merupakan kendala limitasi kuota.
   */
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

  /**
   * Mengekstrak waktu jeda (dalam milidetik) dari pesan error Google API.
   */
  extractRetryAfter(error) {
    let waitTime = 15000; // Standar jeda: 15 detik
    const errorMessage = error.message?.toLowerCase() || '';
    
    // Analisis regex untuk menangkap format "Please retry in XXs"
    const match = errorMessage.match(/retry in ([\d.]+)s/);
    if (match && match[1]) {
      waitTime = Math.ceil(parseFloat(match[1])) * 1000;
    }
    
    return Math.min(waitTime, 60000); // Batas maksimal penundaan adalah 60 detik
  }
}

module.exports = GeminiService;
