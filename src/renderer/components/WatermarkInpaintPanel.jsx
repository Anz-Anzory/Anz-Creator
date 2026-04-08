import React, { useState } from 'react';
import { useDropzone } from 'react-dropzone';

function WatermarkInpaintPanel() {
  const [video, setVideo] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [detectedWatermarks, setDetectedWatermarks] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState(null);

  const onDrop = async (files) => {
    const file = files[0];
    setVideo(file);
    setDetectedWatermarks([]);
    setPreview(null);
    
    setDetecting(true);
    const result = await window.electron.ipcRenderer.invoke('detect-watermark', {
      videoPath: file.path
    });
    setDetecting(false);
    
    if (result.success) {
      setDetectedWatermarks(result.watermarks || []);
      setPreview(result.preview);
    }
  };

  const { getRootProps, getInputProps } = useDropzone({ onDrop, accept: 'video/*' });

  const handleRemoveWatermark = async () => {
    setProcessing(true);
    
    const result = await window.electron.ipcRenderer.invoke('remove-watermark', {
      videoPath: video.path,
      options: {
        method: 'hybrid',
        outputPath: video.path.replace('.mp4', '_no-watermark.mp4')
      }
    });
    
    setProcessing(false);
    
    if (result.success) {
      alert('Watermark removed! Saved to: ' + result.result.finalPath);
    }
  };

  return (
    <div className="watermark-panel">
      <div {...getRootProps()} className="dropzone">
        <input {...getInputProps()} />
        {video ? (
          <div>
            <p>📹 {video.name}</p>
            {detecting && <p>🔍 Detecting watermarks...</p>}
          </div>
        ) : (
          <p>Drop video with watermark</p>
        )}
      </div>

      {preview && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Detection Preview:</h4>
          <img 
            src={`file://${preview}`} 
            alt="Watermark detection" 
            style={{ maxWidth: '100%', borderRadius: '8px' }}
          />
        </div>
      )}

      {detectedWatermarks.length > 0 && (
        <div className="detection-results" style={{ marginTop: '1rem' }}>
          <h3>🔍 Detected Watermarks ({detectedWatermarks.length})</h3>
          {detectedWatermarks.map((wm, idx) => (
            <div key={idx} className="card" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{wm.type} - {wm.position}</span>
              <span style={{ color: '#667eea' }}>{Math.round(wm.confidence * 100)}%</span>
            </div>
          ))}
          
          <button 
            onClick={handleRemoveWatermark}
            disabled={processing}
            className="btn-primary"
            style={{ marginTop: '1rem', width: '100%' }}
          >
            {processing ? 'Removing...' : '✨ Remove Watermarks'}
          </button>
        </div>
      )}

      {detectedWatermarks.length === 0 && video && !detecting && (
        <p style={{ marginTop: '1rem', color: '#4ade80' }}>✅ No watermarks detected!</p>
      )}
    </div>
  );
}

export default WatermarkInpaintPanel;
