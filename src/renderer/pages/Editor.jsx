import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

function Editor() {
  const [video, setVideo] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const onDrop = useCallback(async (files) => {
    const file = files[0];
    if (!file) return;
    
    setVideo(file);
    setAnalyzing(true);
    setResults(null);
    setError(null);
    
    try {
      const result = await window.electron.ipcRenderer.invoke('analyze-video', {
        videoPath: file.path,
        settings: {
          contentType: 'entertainment',
          audience: 'general',
          transcribeAudio: true
        }
      });
      
      if (result.success) {
        setResults(result.data);
      } else {
        setError(result.error || 'Analisa gagal. Pastikan API key sudah dikonfigurasi.');
      }
    } catch (err) {
      setError(err.message || 'Terjadi error saat menganalisa video.');
    }
    
    setAnalyzing(false);
  }, []);

  // FIX: Format accept yang benar untuk react-dropzone v14
  const { getRootProps, getInputProps } = useDropzone({ 
    onDrop, 
    accept: {
      'video/mp4': ['.mp4'],
      'video/x-matroska': ['.mkv'],
      'video/quicktime': ['.mov'],
      'video/x-msvideo': ['.avi'],
      'video/webm': ['.webm']
    },
    multiple: false
  });

  return (
    <div>
      <h2>AI Video Analyzer</h2>
      
      <div {...getRootProps()} className="dropzone">
        <input {...getInputProps()} />
        {video ? (
          <div>
            <p>📹 {video.name}</p>
            {analyzing && <p>⏳ Menganalisa dengan AI... Mohon tunggu.</p>}
          </div>
        ) : (
          <p>Drop video di sini untuk dianalisa oleh AI</p>
        )}
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid #ef4444', marginTop: '1rem' }}>
          <p style={{ color: '#ef4444' }}>❌ {error}</p>
        </div>
      )}

      {results && (
        <div className="results">
          <div className="card">
            <h3>FYP Score</h3>
            <div className="fyp-score">{results.fypScore?.score || 0}/100</div>
            <p>{results.fypScore?.reasoning || ''}</p>
          </div>

          <div className="card">
            <h3>Title Options</h3>
            {results.title?.map((t, i) => (
              <p key={i} style={{ cursor: 'pointer', margin: '0.5rem 0' }}
                 onClick={() => navigator.clipboard.writeText(t)}>
                {i + 1}. {t}
              </p>
            )) || <p>Tidak ada judul yang dihasilkan</p>}
          </div>

          <div className="card">
            <h3>Caption</h3>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{results.caption}</pre>
            <button onClick={() => navigator.clipboard.writeText(results.caption)} 
                    className="btn-primary" style={{ marginTop: '0.5rem' }}>
              📋 Copy Caption
            </button>
          </div>

          <div className="card">
            <h3>Hashtags</h3>
            <p className="hashtags">{results.hashtags?.join(' ') || ''}</p>
            <button onClick={() => navigator.clipboard.writeText(results.hashtags?.join(' ') || '')}
                    className="btn-primary" style={{ marginTop: '0.5rem' }}>
              📋 Copy Hashtags
            </button>
          </div>

          {results.visualAnalysis && (
            <div className="card">
              <h3>🔍 Visual Analysis</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{results.visualAnalysis}</p>
            </div>
          )}

          {results.audioTranscription && (
            <div className="card">
              <h3>🎤 Audio Transcription</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{results.audioTranscription}</p>
            </div>
          )}

          <button onClick={() => { setResults(null); setVideo(null); setError(null); }} 
                  style={{ marginTop: '1rem' }}>
            🔄 Analisa Video Lain
          </button>
        </div>
      )}
    </div>
  );
}

export default Editor;
