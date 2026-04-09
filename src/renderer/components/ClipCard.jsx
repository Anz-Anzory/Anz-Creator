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

  return (
    <div className="clip-card">
      <div className="clip-header" style={{ 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.75rem',
        background: 'rgba(0,0,0,0.2)'
      }}>
        <span>#{clip.sequence}</span>
        <span className="fyp-score" style={{ fontSize: '1rem' }}>
          🔥 {clip.metadata.fypScore}/100
        </span>
      </div>
      
      <video 
        // FIX: Ubah 'file://' menjadi 'media://' untuk load file lokal
        src={`media://${clip.videoPath}`} 
        controls 
        style={{ width: '100%', height: '200px', objectFit: 'cover' }}
      />
      
      <div className="clip-meta">
        <h4>{clip.metadata.title}</h4>
        <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.5rem' }}>
          {clip.duration}s | {clip.metadata.contentType}
        </p>
        
        <div className="thumbnails">
          {clip.thumbnails?.map((thumb, tidx) => (
            <img 
              key={tidx}
              // FIX: Ubah 'file://' menjadi 'media://' juga di sini
              src={`media://${thumb.path}`}
              alt={`Thumbnail ${tidx + 1}`}
              className={thumb.rank === 1 ? 'best' : ''}
              title={`Quality: ${thumb.qualityScore}`}
            />
          ))}
        </div>
        
        <button 
          onClick={() => setShowMetadata(!showMetadata)}
          style={{ marginTop: '1rem', width: '100%' }}
        >
          {showMetadata ? 'Hide' : 'Show'} Metadata
        </button>
        
        {showMetadata && (
          <div style={{ marginTop: '1rem' }}>
            <textarea 
              value={clip.metadata.caption}
              readOnly
              style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}
            />
            <p className="hashtags" style={{ fontSize: '0.75rem' }}>
              {clip.metadata.hashtags.slice(0, 5).join(' ')}...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ClipCard;
