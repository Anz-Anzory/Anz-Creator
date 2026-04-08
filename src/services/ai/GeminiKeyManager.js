const { GoogleGenerativeAI } = require('@google/generative-ai');

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
    const availableKeys = this.apiKeys.filter((key, index) => {
      if (this.failedKeys.has(index)) return false;
      if (this.rateLimitReset.has(index)) {
        const resetTime = this.rateLimitReset.get(index);
        if (Date.now() < resetTime) return false;
        this.rateLimitReset.delete(index);
      }
      return true;
    });

    if (availableKeys.length === 0) {
      throw new Error('Semua API keys sedang di rate limit. Tunggu beberapa menit...');
    }

    const availableIndex = this.apiKeys.indexOf(availableKeys[0]);
    this.currentIndex = availableIndex;
    
    return {
      key: this.apiKeys[this.currentIndex],
      index: this.currentIndex
    };
  }

  rotateKey() {
    this.failedKeys.add(this.currentIndex);
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
      currentIndex: this.currentIndex
    };
  }

  resetAll() {
    this.failedKeys.clear();
    this.rateLimitReset.clear();
    this.currentIndex = 0;
    console.log('All keys reset');
  }
}

module.exports = GeminiKeyManager;
