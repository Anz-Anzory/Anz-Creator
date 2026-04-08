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
    console.log('Starting Long Video Processing Pipeline\n');
    
    const startTime = Date.now();
    const results = {
      input: { path: videoPath },
      stages: []
    };
    
    try {
      console.log('='.repeat(50));
      console.log('STAGE 1: VIRAL MOMENT DETECTION');
      console.log('='.repeat(50));
      
      const viralMoments = await this.detector.detectViralMoments(videoPath, {
        minDuration: options.minDuration || 15,
        maxDuration: options.maxDuration || 60,
        targetClips: options.targetClips || 10,
        strategy: options.detectionStrategy || 'comprehensive'
      });
      
      results.stages.push({
        name: 'viral-detection',
        status: 'complete',
        data: {
          detectedScenes: viralMoments.detectedScenes,
          viralMoments: viralMoments.viralMoments,
          optimizedClips: viralMoments.optimizedClips
        }
      });
      
      console.log(`Detected ${viralMoments.optimizedClips} potential viral clips\n`);
      
      console.log('='.repeat(50));
      console.log('STAGE 2: PRODUCTION PLANNING');
      console.log('='.repeat(50));
      
      const plan = this.planner.createPlan(viralMoments.clips, {
        platform: options.platform || 'tiktok'
      });
      
      const seriesPlan = this.planner.generateSeriesPlan(plan, {
        seriesName: options.seriesName || 'Auto-Generated Series'
      });
      
      results.stages.push({
        name: 'planning',
        status: 'complete',
        data: seriesPlan
      });
      
      console.log(`Planned ${seriesPlan.totalClips} clips`);
      console.log(`Est. Engagement: ${seriesPlan.estimatedEngagement.averageFYPScore}/100\n`);
      
      console.log('='.repeat(50));
      console.log('STAGE 3: CLIP GENERATION');
      console.log('='.repeat(50));
      
      const clips = await this.generator.generateClips(videoPath, plan, {
        onProgress: (progress) => {
          console.log(`Progress: ${progress.current}/${progress.total} - ${progress.clip.metadata.title.substring(0, 40)}...`);
        }
      });
      
      results.stages.push({
        name: 'generation',
        status: 'complete',
        clipsGenerated: clips.length
      });
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      results.summary = {
        totalClips: clips.length,
        totalDuration: clips.reduce((sum, c) => sum + (c.duration || 0), 0),
        averageFYPScore: Math.round(
          clips.filter(c => !c.error).reduce((sum, c) => sum + c.metadata.fypScore, 0) / 
          clips.filter(c => !c.error).length
        ),
        processingTime: `${duration}s`,
        outputDirectory: require('path').dirname(clips[0]?.videoPath || '')
      };
      
      results.clips = clips;
      
      console.log('\n' + '='.repeat(50));
      console.log('PROCESSING COMPLETE!');
      console.log('='.repeat(50));
      console.log(`Total Clips: ${results.summary.totalClips}`);
      console.log(`Total Duration: ${results.summary.totalDuration}s`);
      console.log(`Avg FYP Score: ${results.summary.averageFYPScore}/100`);
      console.log(`Processing Time: ${results.summary.processingTime}`);
      
      return results;
      
    } catch (error) {
      results.error = error.message;
      throw error;
    } finally {
      await this.detector.cleanup();
      await this.generator.cleanup();
    }
  }
}

module.exports = LongVideoProcessor;
