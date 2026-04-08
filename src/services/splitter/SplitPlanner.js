class SplitPlanner {
  constructor() {
    this.optimalDurations = {
      tiktok: { min: 15, ideal: 21, max: 60 },
      instagram: { min: 15, ideal: 30, max: 90 },
      youtube: { min: 15, ideal: 58, max: 60 }
    };
  }

  createPlan(clips, options = {}) {
    const platform = options.platform || 'tiktok';
    const durationConfig = this.optimalDurations[platform];
    
    const plan = clips.map((clip, index) => {
      const structure = this.analyzeClipStructure(clip);
      
      return {
        ...clip,
        sequence: index + 1,
        platform,
        durationConfig,
        structure,
        timing: {
          uploadTime: this.calculateBestUploadTime(index, clips.length),
          postDelay: index * 120
        }
      };
    });
    
    return plan.sort((a, b) => b.fypScore - a.fypScore);
  }

  analyzeClipStructure(clip) {
    return {
      hookWindow: { start: clip.start, end: clip.start + 3 },
      contentWindow: { start: clip.start + 3, end: clip.end - 3 },
      ctaWindow: { start: clip.end - 3, end: clip.end },
      pacing: clip.duration < 20 ? 'fast' : clip.duration < 40 ? 'medium' : 'standard'
    };
  }

  calculateBestUploadTime(index, totalClips) {
    const now = new Date();
    const optimalTimes = [11, 15, 19, 21];
    
    const timeSlot = optimalTimes[index % optimalTimes.length];
    const dayOffset = Math.floor(index / optimalTimes.length);
    
    const uploadTime = new Date(now);
    uploadTime.setDate(uploadTime.getDate() + dayOffset);
    uploadTime.setHours(timeSlot, 0, 0, 0);
    
    return uploadTime;
  }

  generateSeriesPlan(plannedClips, options = {}) {
    const seriesName = options.seriesName || 'Video Series';
    const clips = plannedClips.map((clip, index) => ({
      ...clip,
      seriesInfo: {
        name: seriesName,
        part: index + 1,
        total: plannedClips.length,
        isFirst: index === 0,
        isLast: index === plannedClips.length - 1
      }
    }));

    return {
      seriesName,
      totalClips: clips.length,
      totalDuration: clips.reduce((sum, c) => sum + c.duration, 0),
      estimatedEngagement: this.calculateSeriesEngagement(clips),
      clips,
      postingSchedule: this.createPostingSchedule(clips)
    };
  }

  calculateSeriesEngagement(clips) {
    const avgScore = clips.reduce((sum, c) => sum + c.fypScore, 0) / clips.length;
    const viralClips = clips.filter(c => c.fypScore > 85).length;
    
    return {
      averageFYPScore: Math.round(avgScore),
      viralPotential: viralClips,
      totalReach: Math.round(avgScore * clips.length * 1000)
    };
  }

  createPostingSchedule(clips) {
    return clips.map((clip, index) => ({
      clipId: clip.id,
      sequence: clip.sequence,
      scheduledTime: clip.timing.uploadTime,
      recommendedCaption: clip.suggestedCaption,
      postImmediately: index === 0
    }));
  }
}

module.exports = SplitPlanner;
