class GeminiKeyManager {
  constructor(apiKeys = []) {
    this.apiKeys = apiKeys;
    this.currentIndex = 0;
    this.failedKeys = new Set();
    this.rateLimitReset = new Map();
    
    if (this.apiKeys.length === 0) {
      throw new Error('Minimal 1 API key diperlukan');
    }
    
    console.log(`Key Manager initialized dengan ${this.apiKeys.length} keys`);
  }

  addKey(key) {
    if (!this.apiKeys.includes(key)) {
      this.apiKeys.push(key);
      console.log(`Key added. Total: ${this.apiKeys.length}`);
    }
  }

  getCurrentKey() {
    // Mulai pencarian dari currentIndex, bukan dari 0
    const totalKeys = this.apiKeys.length;
    for (let i = 0; i < totalKeys; i++) {
      const index = (this.currentIndex + i) % totalKeys;
      
      if (this.failedKeys.has(index)) continue;
      if (this.rateLimitReset.has(index)) {
        const resetTime = this.rateLimitReset.get(index);
        if (Date.now() < resetTime) continue;
        this.rateLimitReset.delete(index);
      }
      
      this.currentIndex = index;
      return { key: this.apiKeys[index], index };
    }

    // Semua key terkena limit
    console.warn('Semua key terkena limit/gagal. Mereset status...');
    this.resetAll();
    return { key: this.apiKeys[0], index: 0 };
  }

  rotateKey() {
    this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
    console.log(`Rotated to key index: ${this.currentIndex}`);
    return this.getCurrentKey();
  }

  markRateLimited(keyIndex, retryAfterMs = 60000) {
    console.log(`Key ${keyIndex} rate limited. Retry after ${retryAfterMs}ms`);
    this.rateLimitReset.set(keyIndex, Date.now() + retryAfterMs);
  }

  getStats() {
    return {
      total: this.apiKeys.length,
      active: this.apiKeys.length - this.failedKeys.size,
      failed: this.failedKeys.size,
      rateLimited: this.rateLimitReset.size,
      currentIndex: this.currentIndex
    };
  }

  resetRateLimits() {
  this.rateLimitReset.clear();
  console.log('Rate limits reset');
}

  resetAll() {
    this.failedKeys.clear();
    this.rateLimitReset.clear();
    this.currentIndex = 0;
    console.log('All keys reset');
  }
}

module.exports = GeminiKeyManager;
