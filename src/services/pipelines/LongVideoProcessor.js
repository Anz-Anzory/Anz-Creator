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
      
      // FIX: Pesan yang lebih akurat — "optimizedClips" adalah jumlah klip yang akan dibuat
      reportProgress(
        40, 100, 
        `Ditemukan ${viralMoments.viralMoments} momen viral, dioptimasi menjadi ${viralMoments.optimizedClips} klip.`, 
        'Tahap 1: Selesai'
      );
      
      // FIX: Handle jika tidak ada klip yang ditemukan
      if (viralMoments.optimizedClips === 0) {
        throw new Error('Tidak ada momen viral yang terdeteksi dalam video. Coba ubah pengaturan durasi atau gunakan video yang lebih variatif.');
      }
      
      const plan = this.planner.createPlan(viralMoments.clips, {
        platform: options.platform || 'tiktok'
      });
      
      const seriesPlan = this.planner.generateSeriesPlan(plan, {
        seriesName: options.seriesName || 'Auto-Generated Series'
      });
      
      results.stages.push({ name: 'planning', status: 'complete', data: seriesPlan });
      reportProgress(50, 100, `Memulai rendering ${seriesPlan.totalClips} klip video...`, 'Tahap 2: Perencanaan Konten');
      
      const clips = await this.generator.generateClips(videoPath, plan, {
        onProgress: (progress) => {
          const currentPercent = 50 + Math.round((progress.current / progress.total) * 45);
          const taskPercent = progress.subPercent ? Math.round(progress.subPercent) : Math.round((progress.current / progress.total) * 100);
          
          reportProgress(
            currentPercent, 
            taskPercent, 
            progress.taskName || `Memproses klip ${progress.current} dari ${progress.total}...`, 
            'Tahap 3: Pembuatan Klip'
          );
        }
      });
      
      results.stages.push({ name: 'generation', status: 'complete', clipsGenerated: clips.length });
      reportProgress(100, 100, 'Semua proses selesai! Video siap diunduh.', 'Selesai');
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      const validClips = clips.filter(c => !c.error);
      const avgScore = validClips.length > 0 
        ? Math.round(validClips.reduce((sum, c) => sum + (c.metadata?.fypScore || 0), 0) / validClips.length)
        : 0;

      results.summary = {
        totalClips: clips.length,
        successClips: validClips.length,
        failedClips: clips.length - validClips.length,
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
      try { await this.detector.cleanup(); } catch (e) {}
      // Cleanup temp frame samples dari generator
      try {
        const genDir = this.generator.outputDir;
        const fsSync = require('fs');
        const path = require('path'); // FIX: Tambahkan module 'path' di sini
        
        if (fsSync.existsSync(genDir)) {
          const tempFiles = fsSync.readdirSync(genDir).filter(f => f.startsWith('frame-sample-'));
          for (const f of tempFiles) {
            fsSync.unlinkSync(path.join(genDir, f)); 
          }
        }
      } catch (e) {}
    } // Menutup blok finally
  } // Menutup fungsi async process()
} // Menutup class LongVideoProcessor

module.exports = LongVideoProcessor;
