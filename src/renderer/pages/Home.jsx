import React, { useState } from 'react';
import VideoSplitterPanel from '../components/VideoSplitterPanel';
import WatermarkInpaintPanel from '../components/WatermarkInpaintPanel';

function Home() {
  const [activeTab, setActiveTab] = useState('splitter');

  return (
    <div>
      <h2>AI Video Tools</h2>
      
      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'splitter' ? 'active' : ''}`}
          onClick={() => setActiveTab('splitter')}
        >
          ✂️ Video Splitter
        </button>
        <button 
          className={`tab ${activeTab === 'watermark' ? 'active' : ''}`}
          onClick={() => setActiveTab('watermark')}
        >
          🎨 Watermark Remover
        </button>
      </div>

      {activeTab === 'splitter' && <VideoSplitterPanel />}
      {activeTab === 'watermark' && <WatermarkInpaintPanel />}
    </div>
  );
}

export default Home;
