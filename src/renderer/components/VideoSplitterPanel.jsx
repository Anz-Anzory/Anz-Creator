import React, { useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import ClipCard from './ClipCard';

function VideoSplitterPanel() {
  const [video, setVideo] = useState(null);
  const [processing, setProcessing] = useState(false);
  
  // FIX: State untuk menyimpan 2 metrik progress secara terpisah
  const [progressData, setProgressData] = useState({ 
    overallPercent: 0, 
    taskPercent: 0, 
    message: '', 
    taskName: '' 
  });
  
  const [results, setResults] = useState(null);

  const [options, setOptions] = useState({
    minDuration: 15,
    maxDuration: 60,
    targetClips: 10,
    platform: 'tiktok',
    seriesName: '',
    strategy: 'comprehensive'
  });

  useEffect(() => {
    const handleProgress = (data) => {
      setProgressData({
        overallPercent: data.overallPercent || 0,
        taskPercent: data.taskPercent || 0,
        message: data.message || '',
        taskName: data.taskName || ''
      });
    };

    window.electron.ipcRenderer.on('split-progress', handleProgress);

    return () => {
      window.electron.ipcRenderer.removeAllListeners('split-progress');
    };
  }, []);

  const onDrop = (files) => {
    const file = files[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      alert('Hanya file video yang diperbolehkan!');
      return;
    }
    setVideo(file);
    setResults(null);
  };

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      'video/mp4': ['.mp4'],
      'video/x-matroska': ['.mkv'],
      'video/quicktime': ['.mov'],
      'video/x-msvideo': ['.avi']
    }
  });

  const handleProcess = async () => {
    if (!video) return;

    setProcessing(true);
    setProgressData({ overallPercent: 0, taskPercent: 0, message: 'Menyiapkan mesin AI...', taskName: 'Inisialisasi' });

    try {
      const result = await window.electron.ipcRenderer.invoke('split-long-video', {
        videoPath: video.path,
        options: options
      });

      if (result.success) {
        setProgressData({ overallPercent: 100, taskPercent: 100, message: 'Selesai merender klip!', taskName: 'Selesai' });
        setResults(result.data);
      } else {
        alert('Error: ' + result.error);
        setProgressData({ overallPercent: 0, taskPercent: 0, message: 'Gagal diproses.', taskName: 'Error' });
      }
    } catch (err) {
      console.error(err);
      alert('Terjadi error saat processing');
      setProgressData({ overallPercent: 0, taskPercent: 0, message: 'Error system.', taskName: 'Error' });
    }

    setProcessing(false);
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

      {video && !processing && !results && (
        <div className="options" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label>Target Clips: {options.targetClips}</label>
              <input
                type="range" min="3" max="30" value={options.targetClips}
                onChange={(e) => setOptions({ ...options, targetClips: parseInt(e.target.value) })}
              />
            </div>
            <div>
              <label>Platform:</label>
              <select
                value={options.platform}
                onChange={(e) => setOptions({ ...options, platform: e.target.value })}
              >
                <option value="tiktok">TikTok</option>
                <option value="instagram">Instagram</option>
                <option value="youtube">YouTube Shorts</option>
              </select>
            </div>
            <div>
              <label>Min Duration: {options.minDuration}s</label>
              <input
                type="range" min="15" max="30" value={options.minDuration}
                onChange={(e) => setOptions({ ...options, minDuration: parseInt(e.target.value) })}
              />
            </div>
            <div>
              <label>Max Duration: {options.maxDuration}s</label>
              <input
                type="range" min="30" max="90" value={options.maxDuration}
                onChange={(e) => setOptions({ ...options, maxDuration: parseInt(e.target.value) })}
              />
            </div>
          </div>
          <div style={{ marginTop: '1rem' }}>
            <label>Series Name (optional):</label>
            <input
              type="text" placeholder="My Video Series" value={options.seriesName}
              onChange={(e) => setOptions({ ...options, seriesName: e.target.value })}
            />
          </div>
        </div>
      )}

      {/* FIX: TAMPILAN 2 LAPIS PROGRESS BAR */}
      {processing && (
        <div className="progress-container" style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(0,0,0,0.03)', borderRadius: '12px', border: '1px solid rgba(0,0,0,0.08)' }}>
          
          {/* Progress 1: Keseluruhan (Warna Biru) */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              <span>Total Progress Keseluruhan</span>
              <span style={{ color: '#4f46e5' }}>{progressData.overallPercent}%</span>
            </div>
            <div style={{ width: '100%', backgroundColor: '#e2e8f0', borderRadius: '8px', height: '14px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${progressData.overallPercent}%`,
                  background: 'linear-gradient(90deg, #4f46e5 0%, #3b82f6 100%)',
                  height: '100%',
                  transition: 'width 0.4s ease-in-out'
                }}
              />
            </div>
          </div>

          {/* Progress 2: Per Bagian / Sub-Task (Warna Hijau) */}
          <div style={{ padding: '1rem', background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem', fontSize: '0.9rem', color: '#475569', fontWeight: '500' }}>
              <span>
                {progressData.taskName && <strong style={{color: '#1e293b', marginRight: '6px'}}>[{progressData.taskName}]</strong>} 
                ⏳ {progressData.message}
              </span>
              <span style={{ color: '#10b981', fontWeight: 'bold' }}>{progressData.taskPercent}%</span>
            </div>
            <div style={{ width: '100%', backgroundColor: '#f1f5f9', borderRadius: '6px', height: '8px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${progressData.taskPercent}%`,
                  background: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)',
                  height: '100%',
                  transition: 'width 0.4s ease-in-out'
                }}
              />
            </div>
          </div>
        </div>
      )}

      {!processing && !results && (
        <button
          onClick={handleProcess}
          disabled={!video}
          className="btn-primary"
          style={{ marginTop: '1.5rem', width: '100%' }}
        >
          ✨ Split into Viral Clips
        </button>
      )}

      {results && (
        <div className="results" style={{ marginTop: '2rem' }}>
          <h3>🎉 {results.summary.totalClips} Clips Generated!</h3>
          <p>
            Avg FYP Score: {results.summary.averageFYPScore}/100 | Total Duration:{' '}
            {results.summary.totalDuration}s | Time: {results.summary.processingTime}
          </p>

          <div className="clips-grid">
            {results.clips.map((clip, idx) => (
              <ClipCard key={idx} clip={clip} />
            ))}
          </div>
          
          <button onClick={() => { setResults(null); setVideo(null); }} className="btn-secondary" style={{ marginTop: '2rem' }}>
            Potong Video Lainnya
          </button>
        </div>
      )}
    </div>
  );
}

export default VideoSplitterPanel;
