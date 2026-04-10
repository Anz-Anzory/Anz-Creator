import React from 'react';

function FYPScore({ score }) {
  const getScoreColor = (value) => {
    if (value >= 90) return '#4ade80';
    if (value >= 75) return '#667eea';
    if (value >= 60) return '#fbbf24';
    return '#ef4444';
  };

  const getScoreLabel = (value) => {
    if (value >= 90) return '🔥 Viral Potential';
    if (value >= 75) return '✨ High Potential';
    if (value >= 60) return '👍 Good';
    return '📊 Average';
  };

  const value = score?.score || 0;
  const color = getScoreColor(value);

  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <h3>FYP Score</h3>
      <div className="fyp-score" style={{ color: color, fontSize: '3rem' }}>
        {value}
      </div>
      <p style={{ color: color }}>{getScoreLabel(value)}</p>
      {score?.reasoning && (
        <p style={{ marginTop: '1rem', fontSize: '0.9rem', opacity: 0.8 }}>
          {score.reasoning}
        </p>
      )}
    </div>
  );
}

export default FYPScore;
