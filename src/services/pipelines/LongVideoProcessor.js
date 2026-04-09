const ViralMomentDetector = require('../splitter/ViralMomentDetector');
const SplitPlanner = require('../splitter/SplitPlanner');
const ClipGenerator = require('../splitter/ClipGenerator');

class LongVideoProcessor {
  constructor(apiKeys) {
    this.detector = new ViralMomentDetector(apiKeys);
    this.planner = new SplitPlanner();
    this.generator = new ClipGenerator(apiKeys);
  }

  async process(videoPath, options = {}) {
    // FIX: Mengirim 4 data sekaligus (Progress Total, Progress Bagian, Pesan, Nama Tahapan)
    const reportProgress = (overallPercent, taskPercent, message, taskName) => {
      if (options.onProgress) {
        options.onProgress({ overallPercent, taskPercent, message, taskName });
      }
      console.log(`[Total: ${overallPercent}% | Bagian: ${taskPercent}%] ${message}`);
    };

    const startTime = Date.now();
    const results = { input: { path: videoPath }, stages: [] };
    
    try {
      reportProgress(5, 10, 'Mengekstrak frame & menganalisa audio video asli...', 'Tahap 1: Analisa Video');
      
      const viralMoments = await this.detector.detectViralMoments(videoPath, {
        minDuration: options.minDuration || 15,
        maxDuration: options.maxDuration || 60,
        targetClips: options.targetClips || 10,
        strategy: options.detectionStrategy || 'comprehensive'
      });
      
      results.stages.push({ name: 'viral-detection', status: 'complete' });
      reportProgress(40, 100, `Menemukan ${viralMoments.optimizedClips} momen potensial. Merencanakan pemotongan...`, 'Tahap 1: Selesai');
      
      const plan = this.planner.createPlan(viralMoments.clips, {
        platform: options.platform || 'tiktok'
      });
      
      const seriesPlan = this.planner.generateSeriesPlan(plan, {
        seriesName: options.seriesName || 'Auto-Generated Series'
      });
      
      results.stages.push({ name: 'planning', status: 'complete', data: seriesPlan });
      reportProgress(50, 100, `Memulai AI Rendering untuk ${seriesPlan.totalClips} Klip Video...`, 'Tahap 2: Perencanaan Konten');
      
      const clips = await this.generator.generateClips(videoPath, plan, {
        onProgress: (progress) => {
          const currentPercent = 50 + Math.round((progress.current / progress.total) * 45);
          // Gunakan subPercent realtime dari FFmpeg jika ada
          const taskPercent = progress.subPercent ? Math.round(progress.subPercent) : Math.round((progress.current / progress.total) * 100);
          
          reportProgress(
            currentPercent, 
            taskPercent, 
            progress.taskName || `Menganalisa AI Klip ${progress.current} dari ${progress.total}...`, 
            'Tahap 3: Pembuatan Klip'
          );
        }
      });
      
      results.stages.push({ name: 'generation', status: 'complete', clipsGenerated: clips.length });
      
      reportProgress(100, 100, 'Semua proses selesai! Membersihkan file sampah...', 'Selesai');
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      const validClips = clips.filter(c => !c.error);
      const avgScore = validClips.length > 0 
        ? Math.round(validClips.reduce((sum, c) => sum + (c.metadata?.fypScore || 0), 0) / validClips.length)
        : 0;

      results.summary = {
        totalClips: clips.length,
        totalDuration: clips.reduce((sum, c) => sum + (c.duration || 0), 0),
        averageFYPScore: avgScore,
        processingTime: `${duration}s`,
        outputDirectory: require('path').dirname(clips[0]?.videoPath || '')
      };
      
      results.clips = clips;
      return results;
      
    } catch (error) {
      reportProgress(0, 0, `ERROR: ${error.message}`, 'Proses Gagal');
      throw error;
    } finally {
      await this.detector.cleanup();
      await this.generator.cleanup();
    }
  }
}

module.exports = LongVideoProcessor;
