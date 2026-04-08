import React from 'react';
import FYPScore from './FYPScore';

function AIResults({ results }) {
  if (!results) return null;

  return (
    <div className="ai-results">
      <FYPScore score={results.fypScore} />
      
      <div className="card">
        <h3>📝 Title Options</h3>
        <ul>
          {results.title?.map((t, i) => (
            <li key={i} style={{ margin: '0.5rem 0', cursor: 'pointer' }}
                onClick={() => navigator.clipboard.writeText(t)}>
              {i + 1}. {t}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>💬 Caption</h3>
        <pre>{results.caption}</pre>
        <button onClick={() => navigator.clipboard.writeText(results.caption)}>
          Copy
        </button>
      </div>

      <div className="card">
        <h3>🏷️ Hashtags ({results.hashtags?.length})</h3>
        <p className="hashtags">{results.hashtags?.join(' ')}</p>
        <button onClick={() => navigator.clipboard.writeText(results.hashtags?.join(' '))}>
          Copy
        </button>
      </div>

      {results.visualAnalysis && (
        <div className="card">
          <h3>🔍 Visual Analysis</h3>
          <p>{results.visualAnalysis}</p>
        </div>
      )}
    </div>
  );
}

export default AIResults;
