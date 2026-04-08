const GeminiService = require('../ai/GeminiService');

class WatermarkDetector {
  constructor(apiKeys) {
    this.gemini = new GeminiService(apiKeys);
  }

  async detectWithAI(frameBase64, frameIndex) {
    return this.gemini.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: 'gemini-pro-vision' });
      
      const prompt = `Analyze this video frame and detect any watermarks, logos, or text overlays.
Return JSON format:
{
  "hasWatermark": true/false,
  "watermarks": [
    {
      "type": "logo|text|icon",
      "position": "top-left|top-right|bottom-left|bottom-right|center|custom",
      "coordinates": {"x": 0, "y": 0, "width": 100, "height": 50},
      "confidence": 0.95,
      "description": "TikTok logo in bottom right"
    }
  ]
}`;

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: frameBase64,
            mimeType: 'image/jpeg'
          }
        }
      ]);

      const response = result.response.text();
      
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : { hasWatermark: false };
      } catch {
        return { hasWatermark: false, error: 'Parse failed' };
      }
    }, `Watermark Detection Frame ${frameIndex}`);
  }

  async detectWithTemplate(framePath, templates = []) {
    const frame = cv.imread(framePath);
    const detections = [];

    for (const templatePath of templates) {
      const template = cv.imread(templatePath);
      const matched = frame.matchTemplate(template, cv.TM_CCOEFF_NORMED);
      const minMax = matched.minMaxLoc();
      
      if (minMax.maxVal > 0.8) {
        const { maxLoc } = minMax;
        detections.push({
          type: 'template-match',
          coordinates: {
            x: maxLoc.x,
            y: maxLoc.y,
            width: template.cols,
            height: template.rows
          },
          confidence: minMax.maxVal,
          template: templatePath
        });
      }
    }

    return {
      hasWatermark: detections.length > 0,
      watermarks: detections
    };
  }

  detectWithHeuristics(framePath) {
    const frame = cv.imread(framePath);
    const height = frame.rows;
    const width = frame.cols;
    
    const commonPositions = [
      { name: 'bottom-right', x: width * 0.7, y: height * 0.85, w: width * 0.3, h: height * 0.15 },
      { name: 'bottom-left', x: 0, y: height * 0.85, w: width * 0.3, h: height * 0.15 },
      { name: 'top-right', x: width * 0.8, y: 0, w: width * 0.2, h: height * 0.1 },
      { name: 'top-left', x: 0, y: 0, w: width * 0.2, h: height * 0.1 }
    ];

    const detections = [];
    
    for (const pos of commonPositions) {
      const roi = frame.getRegion(new cv.Rect(pos.x, pos.y, pos.w, pos.h));
      const gray = roi.bgrToGray();
      const edges = gray.canny(50, 150);
      const nonZero = edges.countNonZero();
      const edgeDensity = nonZero / (pos.w * pos.h);
      
      if (edgeDensity > 0.05 && edgeDensity < 0.4) {
        detections.push({
          type: 'heuristic',
          position: pos.name,
          coordinates: { x: pos.x, y: pos.y, width: pos.w, height: pos.h },
          confidence: edgeDensity * 2.5,
          method: 'edge-detection'
        });
      }
    }

    return {
      hasWatermark: detections.length > 0,
      watermarks: detections
    };
  }

  async detect(frameBase64, framePath, options = {}) {
    console.log('Detecting watermarks...');
    
    const results = [];
    
    if (options.useAI !== false) {
      try {
        const aiResult = await this.detectWithAI(frameBase64, options.frameIndex || 0);
        if (aiResult.hasWatermark) {
          results.push(...aiResult.watermarks.map(w => ({ ...w, source: 'ai' })));
        }
      } catch (error) {
        console.warn('AI detection failed:', error.message);
      }
    }
    
    if (options.templates && options.templates.length > 0) {
      const templateResult = await this.detectWithTemplate(framePath, options.templates);
      if (templateResult.hasWatermark) {
        results.push(...templateResult.watermarks.map(w => ({ ...w, source: 'template' })));
      }
    }
    
    if (options.useHeuristics !== false && results.length === 0) {
      const heuristicResult = this.detectWithHeuristics(framePath);
      if (heuristicResult.hasWatermark) {
        results.push(...heuristicResult.watermarks.map(w => ({ ...w, source: 'heuristic' })));
      }
    }

    const merged = this.mergeOverlappingDetections(results);
    
    return {
      hasWatermark: merged.length > 0,
      watermarks: merged,
      detectionCount: results.length,
      mergedCount: merged.length
    };
  }

  mergeOverlappingDetections(detections, iouThreshold = 0.5) {
    if (detections.length === 0) return [];
    
    const sorted = detections.sort((a, b) => b.confidence - a.confidence);
    const merged = [sorted[0]];
    
    for (let i = 1; i < sorted.length; i++) {
      let overlap = false;
      
      for (const existing of merged) {
        const iou = this.calculateIoU(sorted[i].coordinates, existing.coordinates);
        if (iou > iouThreshold) {
          overlap = true;
          if (sorted[i].confidence > existing.confidence) {
            existing.coordinates = sorted[i].coordinates;
            existing.confidence = sorted[i].confidence;
            existing.source = sorted[i].source;
          }
          break;
        }
      }
      
      if (!overlap) {
        merged.push(sorted[i]);
      }
    }
    
    return merged;
  }

  calculateIoU(box1, box2) {
    const x1 = Math.max(box1.x, box2.x);
    const y1 = Math.max(box1.y, box2.y);
    const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
    const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);
    
    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const area1 = box1.width * box1.height;
    const area2 = box2.width * box2.height;
    const union = area1 + area2 - intersection;
    
    return intersection / union;
  }
}

module.exports = WatermarkDetector;
