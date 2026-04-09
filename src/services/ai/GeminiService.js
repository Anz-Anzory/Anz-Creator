const GeminiKeyManager = require('./GeminiKeyManager');

class GeminiService {
  constructor(apiKeys) {
    this.keyManager = new GeminiKeyManager(apiKeys);
    this.maxRetries = apiKeys.length;
    this.apiKeys = apiKeys; 
  }

  async executeWithRotation(operation, operationName = 'operation') {
    // FIX: Cegah crash sebelum loop jika array API Key kosong
    if (!this.apiKeys || this.apiKeys.length === 0) {
      throw new Error(`${operationName} gagal: Tidak ada API Key yang dikonfigurasi.`);
    }

    let attempts = 0;
    let lastError;

    while (attempts < this.maxRetries) {
      const { key, index } = this.keyManager.getCurrentKey();
      
      try {
        console.log(`${operationName} - Using key ${index + 1}/${this.keyManager.apiKeys.length}`);
        
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(key);
        const result = await operation(genAI);
        console.log(`${operationName} - Success with key ${index + 1}`);
        return result;
        
      } catch (error) {
        lastError = error;
        attempts++;
        
        // FIX: Tangani Error 503 (Server High Demand) dengan lebih sabar
        const isServerBusy = error.message?.includes('503') || error.message?.toLowerCase().includes('high demand');
        
        if (this.isRateLimitError(error) || isServerBusy) {
          // Jika 503, tunggu lebih lama (10 detik) sebelum memutar kunci
          const waitTime = isServerBusy ? 10000 : this.extractRetryAfter(error);
          this.keyManager.markRateLimited(index, waitTime);
          
          console.warn(`[!] Key ${index + 1} terkena Limit / 503 Busy. Menunggu ${waitTime/1000} detik... (Attempt ${attempts}/${this.maxRetries})`);
          
          if (attempts < this.maxRetries) {
            this.keyManager.rotateKey();
            // Jeda sejenak sebelum mencoba kunci berikutnya
            await new Promise(res => setTimeout(res, 2000)); 
          }
        } else {
          throw error;
        }
      }

    // FIX: Gunakan optional chaining (?.) untuk mencegah TypeError jika lastError masih kosong
    throw new Error(`${operationName} gagal setelah ${attempts} percobaan. Error: ${lastError?.message || 'Unknown API Error'}`);
  }

  isRateLimitError(error) {
    // FIX: Menambahkan penanganan untuk error 503 (Server Sibuk/Overloaded)
    const rateLimitIndicators = [
      'rate limit', 'quota exceeded', '429', 'RESOURCE_EXHAUSTED', 'Too many requests',
      '503', 'service unavailable', 'high demand', 'overloaded'
    ];
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = String(error.code || '');
    
    return rateLimitIndicators.some(indicator => 
      errorMessage.includes(indicator.toLowerCase()) || errorCode.includes(indicator)
    );
  }

  extractRetryAfter(error) {
    const match = error.message?.match(/retry after (\d+) seconds?/i);
    if (match) return parseInt(match[1]) * 1000;
    return 60000;
  }

  async analyzeVideo(frames, prompt) {
    return this.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
      const imageParts = frames.map(frame => ({
        inlineData: { data: frame.base64, mimeType: frame.mimeType || 'image/jpeg' }
      }));
      const result = await model.generateContent([prompt, ...imageParts]);
      return result.response.text();
    }, 'Video Analysis');
  }

  async generateCaption(videoAnalysis, context = {}) {
    return this.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
      const strategies = {
        storytelling: 'Use storytelling hook - start with a relatable moment',
        education: 'Lead with value proposition - "Here\'s how..." or "Did you know..."',
        entertainment: 'Start with curiosity gap or unexpected statement',
        inspiration: 'Lead with motivation or transformation',
        trending: 'Reference current trends or use popular formats'
      };
      const strategy = strategies[context.contentType] || strategies.entertainment;
      const prompt = `Create an engaging social media caption for this video.
STRATEGY: ${strategy}
VIDEO ANALYSIS: ${videoAnalysis}
REQUIREMENTS:
- Hook in first line (stop the scroll)
- Main content (2-3 sentences max)
- Strong CTA (follow, comment, share, save)
- Use emojis naturally
- Add line breaks for readability
- Target audience: ${context.audience || 'general'}

OUTPUT FORMAT:
[Hook]
[Content]
[CTA + Hashtags]`;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 500 }
      });
      return result.response.text();
    }, 'Caption Generation');
  }

  async generateTitle(videoAnalysis) {
    return this.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
      const prompt = `Generate 5 catchy video titles for this content. 
Format: Numbered list.
Video context: ${videoAnalysis}
Make them viral-worthy, use power words, add emoji if appropriate.`;
      const result = await model.generateContent(prompt);
      return result.response.text();
    }, 'Title Generation');
  }

  async generateHashtags(videoAnalysis, count = 15) {
    return this.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
      const prompt = `Generate ${count} relevant hashtags for this video content.
Mix of: trending, niche-specific, broad reach.
Return only hashtags separated by spaces.
Video context: ${videoAnalysis}`;
      const result = await model.generateContent(prompt);
      return result.response.text();
    }, 'Hashtag Generation');
  }

  async predictFYPScore(videoAnalysis, metadata) {
    return this.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
      const prompt = `Rate this video's viral potential (FYP score) from 0-100.
Consider: hook strength, trending potential, engagement factors.
Video Analysis: ${videoAnalysis}
Metadata: ${JSON.stringify(metadata)}
Format: JSON with score, reasoning, and suggestions.`;
      const result = await model.generateContent(prompt);
      return result.response.text();
    }, 'FYP Score Prediction');
  }

  getStats() { return this.keyManager.getStats(); }
  resetKeys() { this.keyManager.resetAll(); }
}

module.exports = GeminiService;
