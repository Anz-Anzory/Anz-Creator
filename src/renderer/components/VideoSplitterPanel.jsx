import React, { useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import ClipCard from './ClipCard';

function VideoSplitterPanel() {
  const [video, setVideo] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progressData, setProgressData] = useState({ 
    overallPercent: 0, 
    taskPercent: 0, 
    message: '', 
    taskName: '' 
  });
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

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
    setError(null);
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
    setError(null);
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
        setError(result.error || 'Proses gagal');
        setProgressData({ overallPercent: 0, taskPercent: 0, message: '', taskName: '' });
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Terjadi error saat processing');
      setProgressData({ overallPercent: 0, taskPercent: 0, message: '', taskName: '' });
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
            <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>Klik untuk ganti video</p>
          </div>
        ) : (
          <p>Drop video panjang (1-2 jam) di sini</p>
        )}
      </div>

      {video && !processing && !results && (
        <div className="options" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label>Target Klip: {options.targetClips}</label>
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
              <label>Min Durasi: {options.minDuration}s</label>
              <input
                type="range" min="15" max="30" value={options.minDuration}
                onChange={(e) => setOptions({ ...options, minDuration: parseInt(e.target.value) })}
              />
            </div>
            <div>
              <label>Max Durasi: {options.maxDuration}s</label>
              <input
                type="range" min="30" max="90" value={options.maxDuration}
                onChange={(e) => setOptions({ ...options, maxDuration: parseInt(e.target.value) })}
              />
            </div>
          </div>
          <div style={{ marginTop: '1rem' }}>
            <label>Nama Series (opsional):</label>
            <input
              type="text" placeholder="My Video Series" value={options.seriesName}
              onChange={(e) => setOptions({ ...options, seriesName: e.target.value })}
            />
          </div>
        </div>
      )}

      {/* ERROR MESSAGE */}
      {error && (
        <div className="card" style={{ borderLeft: '4px solid #ef4444', marginTop: '1rem' }}>
          <p style={{ color: '#ef4444' }}>❌ {error}</p>
        </div>
      )}

      {/* PROGRESS BAR 2 LAPIS */}
      {processing && (
        <div className="progress-container" style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
          
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              <span>Total Progress</span>
              <span style={{ color: '#667eea' }}>{progressData.overallPercent}%</span>
            </div>
            <div style={{ width: '100%', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '8px', height: '14px', overflow: 'hidden' }}>
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

          <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem', fontSize: '0.9rem', color: 'rgba(255,255,255,0.7)', fontWeight: '500' }}>
              <span>
                {progressData.taskName && <strong style={{color: '#fff', marginRight: '6px'}}>[{progressData.taskName}]</strong>} 
                ⏳ {progressData.message}
              </span>
              <span style={{ color: '#10b981', fontWeight: 'bold' }}>{progressData.taskPercent}%</span>
            </div>
            <div style={{ width: '100%', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '6px', height: '8px', overflow: 'hidden' }}>
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
          ✨ Split Menjadi Klip Viral
        </button>
      )}

      {results && (
        <div className="results" style={{ marginTop: '2rem' }}>
          <h3>🎉 {results.summary?.totalClips || 0} Klip Berhasil Dibuat!</h3>
          <p>
            Rata-rata FYP Score: {results.summary?.averageFYPScore || 0}/100 | 
            Total Durasi: {Math.round(results.summary?.totalDuration || 0)}s | 
            Waktu Proses: {results.summary?.processingTime || '0s'}
          </p>

          <div className="clips-grid">
            {results.clips?.map((clip, idx) => (
              <ClipCard key={idx} clip={clip} />
            ))}
          </div>
          
          <button onClick={() => { setResults(null); setVideo(null); setError(null); }} className="btn-secondary" style={{ marginTop: '2rem' }}>
            🔄 Potong Video Lainnya
          </button>
        </div>
      )}
    </div>
  );
}

export default VideoSplitterPanel;
