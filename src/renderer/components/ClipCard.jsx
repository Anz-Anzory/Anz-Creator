import React, { useState } from 'react';

function ClipCard({ clip }) {
  const [showMetadata, setShowMetadata] = useState(false);

  if (clip.error) {
    return (
      <div className="clip-card" style={{ padding: '1rem', color: '#ef4444' }}>
        Error: {clip.errorMessage}
      </div>
    );
  }

  // Fungsi untuk memanggil dialog Save As...
  const handleDownload = async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('save-file', {
        sourcePath: clip.videoPath,
        defaultName: clip.filename
      });
      if (result.success) {
        alert('✅ Video berhasil disimpan!');
      }
    } catch (err) {
      alert('Gagal menyimpan video.');
    }
  };

  return (
    <div className="clip-card">
      <div className="clip-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'rgba(0,0,0,0.2)' }}>
        <span>#{clip.sequence}</span>
        <span className="fyp-score" style={{ fontSize: '1rem' }}>🔥 {clip.metadata.fypScore}/100</span>
      </div>
      
      <video src={`media://${clip.videoPath}`} controls style={{ width: '100%', height: '200px', objectFit: 'cover' }} />
      
      <div className="clip-meta">
        <h4>{clip.metadata.title}</h4>
        <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.5rem' }}>
          {clip.duration}s | {clip.metadata.contentType}
        </p>
        
        <div className="thumbnails">
          {clip.thumbnails?.map((thumb, tidx) => (
            <img key={tidx} src={`media://${thumb.path}`} alt={`Thumbnail ${tidx + 1}`} className={thumb.rank === 1 ? 'best' : ''} title={`Quality: ${thumb.qualityScore}`} />
          ))}
        </div>
        
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button onClick={() => setShowMetadata(!showMetadata)} style={{ flex: 1 }}>
            {showMetadata ? 'Hide' : 'Show'} Data
          </button>
          <button onClick={handleDownload} className="btn-primary" style={{ flex: 1, background: '#10b981' }}>
            💾 Simpan Video
          </button>
        </div>
        
        {showMetadata && (
          <div style={{ marginTop: '1rem' }}>
            <textarea value={clip.metadata.caption} readOnly style={{ fontSize: '0.8rem', marginBottom: '0.5rem', width: '100%' }} />
            <p className="hashtags" style={{ fontSize: '0.75rem' }}>{clip.metadata.hashtags.join(' ')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ClipCard;
