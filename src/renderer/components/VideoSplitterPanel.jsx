import React, { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import ClipCard from './ClipCard';

function VideoSplitterPanel() {
  const [video, setVideo] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  
  const [options, setOptions] = useState({
    minDuration: 15,
    maxDuration: 60,
    targetClips: 10,
    platform: 'tiktok',
    seriesName: '',
    strategy: 'comprehensive'
  });

  const onDrop = (files) => {
    setVideo(files[0]);
  };

  const { getRootProps, getInputProps } = useDropzone({ onDrop, accept: 'video/*' });

  const handleProcess = async () => {
    if (!video) return;
    
    setProcessing(true);
    
    const result = await window.electron.ipcRenderer.invoke('split-long-video', {
      videoPath: video.path,
      options: options
    });
    
    setProcessing(false);
    
    if (result.success) {
      setResults(result.data);
    } else {
      alert('Error: ' + result.error);
    }
  };

  return (
    <div className="splitter-panel">
      <div {...getRootProps()} className="dropzone">
        <input {...getInputProps()} />
        {video ? (
          <div>
            <p>📹 {video.name}</p>
            <p>Click to change video</p>
          </div>
        ) : (
          <p>Drop long video (1-2 hours) here</p>
        )}
      </div>

      {video && (
        <div className="options" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label>Target Clips: {options.targetClips}</label>
              <input 
                type="range" 
                min="3" max="30" 
                value={options.targetClips}
                onChange={(e) => setOptions({...options, targetClips: parseInt(e.target.value)})}
              />
            </div>
            
            <div>
              <label>Platform:</label>
              <select 
                value={options.platform}
                onChange={(e) => setOptions({...options, platform: e.target.value})}
              >
                <option value="tiktok">TikTok</option>
                <option value="instagram">Instagram</option>
                <option value="youtube">YouTube Shorts</option>
              </select>
            </div>
            
            <div>
              <label>Min Duration: {options.minDuration}s</label>
              <input 
                type="range" 
                min="15" max="30" 
                value={options.minDuration}
                onChange={(e) => setOptions({...options, minDuration: parseInt(e.target.value)})}
              />
            </div>
            
            <div>
              <label>Max Duration: {options.maxDuration}s</label>
              <input 
                type="range" 
                min="30" max="90" 
                value={options.maxDuration}
                onChange={(e) => setOptions({...options, maxDuration: parseInt(e.target.value)})}
              />
            </div>
          </div>
          
          <div style={{ marginTop: '1rem' }}>
            <label>Series Name (optional):</label>
            <input 
              type="text" 
              placeholder="My Video Series"
              value={options.seriesName}
              onChange={(e) => setOptions({...options, seriesName: e.target.value})}
            />
          </div>
        </div>
      )}

      <button 
        onClick={handleProcess}
        disabled={!video || processing}
        className="btn-primary"
        style={{ marginTop: '1rem', width: '100%' }}
      >
        {processing ? 'Processing...' : '✨ Split into Viral Clips'}
      </button>

      {results && (
        <div className="results" style={{ marginTop: '2rem' }}>
          <h3>🎉 {results.summary.totalClips} Clips Generated!</h3>
          <p>Avg FYP Score: {results.summary.averageFYPScore}/100 | 
             Total Duration: {results.summary.totalDuration}s |
             Time: {results.summary.processingTime}</p>
          
          <div className="clips-grid">
            {results.clips.map((clip, idx) => (
              <ClipCard key={idx} clip={clip} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default VideoSplitterPanel;
