import React, { useState } from 'react';
import { useDropzone } from 'react-dropzone';

// FIX: Helper untuk convert Windows path ke media:// URL yang valid
function toMediaUrl(filePath) {
  if (!filePath) return '';
  return `media://${filePath.replace(/\\/g, '/')}`;
}

function WatermarkInpaintPanel() {
  const [video, setVideo] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [detectedWatermarks, setDetectedWatermarks] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  const onDrop = async (files) => {
    const file = files[0];
    if (!file) return;
    
    setVideo(file);
    setDetectedWatermarks([]);
    setPreview(null);
    setError(null);
    
    setDetecting(true);
    try {
      const result = await window.electron.ipcRenderer.invoke('detect-watermark', {
        videoPath: file.path
      });
      
      if (result.success) {
        setDetectedWatermarks(result.watermarks || []);
        setPreview(result.preview);
      } else {
        setError(result.error || 'Deteksi gagal');
      }
    } catch (err) {
      setError(err.message);
    }
    setDetecting(false);
  };

  const { getRootProps, getInputProps } = useDropzone({ 
    onDrop, 
    accept: {
      'video/*': ['.mp4', '.avi', '.mov', '.mkv', '.webm']
    },
    multiple: false
  });

  const handleRemoveWatermark = async () => {
    setProcessing(true);
    setError(null);
    
    try {
      const result = await window.electron.ipcRenderer.invoke('remove-watermark', {
        videoPath: video.path,
        options: {
          method: 'hybrid',
          outputPath: video.path.replace(/(\.\w+)$/, '_no-watermark$1')
        }
      });
      
      if (result.success) {
        alert('✅ Watermark berhasil dihapus! Disimpan di: ' + result.result.finalPath);
      } else {
        setError(result.error || 'Penghapusan gagal');
      }
    } catch (err) {
      setError(err.message);
    }
    
    setProcessing(false);
  };

  return (
    <div className="watermark-panel">
      <div {...getRootProps()} className="dropzone">
        <input {...getInputProps()} />
        {video ? (
          <div>
            <p>📹 {video.name}</p>
            {detecting && <p>🔍 Mendeteksi watermark...</p>}
          </div>
        ) : (
          <p>Drop video yang ada watermark-nya</p>
        )}
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid #ef4444', marginTop: '1rem' }}>
          <p style={{ color: '#ef4444' }}>❌ {error}</p>
        </div>
      )}

      {preview && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Preview Deteksi:</h4>
          <img 
            src={toMediaUrl(preview)} 
            alt="Watermark detection" 
            style={{ maxWidth: '100%', borderRadius: '8px' }}
          />
        </div>
      )}

      {detectedWatermarks.length > 0 && (
        <div className="detection-results" style={{ marginTop: '1rem' }}>
          <h3>🔍 Watermark Terdeteksi ({detectedWatermarks.length})</h3>
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
            {processing ? '⏳ Menghapus...' : '✨ Hapus Watermark'}
          </button>
        </div>
      )}

      {detectedWatermarks.length === 0 && video && !detecting && !error && (
        <p style={{ marginTop: '1rem', color: '#4ade80' }}>✅ Tidak ada watermark terdeteksi!</p>
      )}
    </div>
  );
}

export default WatermarkInpaintPanel;
