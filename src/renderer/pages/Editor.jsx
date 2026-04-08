import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

function Editor() {
  const [video, setVideo] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState(null);

  const onDrop = useCallback(async (files) => {
    const file = files[0];
    setVideo(file);
    setAnalyzing(true);
    
    const result = await window.electron.ipcRenderer.invoke('analyze-video', {
      videoPath: file.path,
      settings: {
        contentType: 'entertainment',
        audience: 'general',
        transcribeAudio: true
      }
    });
    
    setAnalyzing(false);
    
    if (result.success) {
      setResults(result.data);
    }
  }, []);

  const { getRootProps, getInputProps } = useDropzone({ onDrop, accept: 'video/*' });

  return (
    <div>
      <h2>AI Video Analyzer</h2>
      
      <div {...getRootProps()} className="dropzone">
        <input {...getInputProps()} />
        {video ? (
          <div>
            <p>📹 {video.name}</p>
            {analyzing && <p>Analyzing...</p>}
          </div>
        ) : (
          <p>Drop video here to analyze</p>
        )}
      </div>

      {results && (
        <div className="results">
          <div className="card">
            <h3>FYP Score</h3>
            <div className="fyp-score">{results.fypScore.score}/100</div>
            <p>{results.fypScore.reasoning}</p>
          </div>

          <div className="card">
            <h3>Title Options</h3>
            {results.title.map((t, i) => (
              <p key={i}>{i + 1}. {t}</p>
            ))}
          </div>

          <div className="card">
            <h3>Caption</h3>
            <pre>{results.caption}</pre>
          </div>

          <div className="card">
            <h3>Hashtags</h3>
            <p className="hashtags">{results.hashtags.join(' ')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default Editor;
