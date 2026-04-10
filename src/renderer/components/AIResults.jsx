import React from 'react';
import FYPScore from './FYPScore';

function AIResults({ results }) {
  if (!results) return null;

  return (
    <div className="ai-results">
      <FYPScore score={results.fypScore} />
      
      <div className="card">
        <h3>📝 Title Options</h3>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {results.title?.map((t, i) => (
            <li key={i} style={{ margin: '0.5rem 0', cursor: 'pointer', padding: '0.5rem', borderRadius: '4px', background: 'rgba(255,255,255,0.03)' }}
                onClick={() => navigator.clipboard.writeText(t)}
                title="Klik untuk copy">
              {i + 1}. {t}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>💬 Caption</h3>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{results.caption}</pre>
        <button onClick={() => navigator.clipboard.writeText(results.caption)} className="btn-primary" style={{ marginTop: '0.5rem' }}>
          📋 Copy
        </button>
      </div>

      <div className="card">
        <h3>🏷️ Hashtags ({results.hashtags?.length || 0})</h3>
        <p className="hashtags">{results.hashtags?.join(' ')}</p>
        <button onClick={() => navigator.clipboard.writeText(results.hashtags?.join(' ') || '')} className="btn-primary" style={{ marginTop: '0.5rem' }}>
          📋 Copy
        </button>
      </div>

      {results.visualAnalysis && (
        <div className="card">
          <h3>🔍 Visual Analysis</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{results.visualAnalysis}</p>
        </div>
      )}
    </div>
  );
}

export default AIResults;
