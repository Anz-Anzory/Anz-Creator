import React, { useState, useEffect } from 'react';

function Settings() {
  const [apiKeys, setApiKeys] = useState([]);
  const [newKey, setNewKey] = useState('');
  const [status, setStatus] = useState(null);

  useEffect(() => {
    loadKeyStatus();
  }, []);

  const loadKeyStatus = async () => {
    const result = await window.electron.ipcRenderer.invoke('get-key-status');
    if (result.success) {
      setStatus(result);
    }
  };

  const handleAddKey = () => {
    if (newKey.trim()) {
      setApiKeys([...apiKeys, newKey.trim()]);
      setNewKey('');
    }
  };

  const handleRemoveKey = (index) => {
    setApiKeys(apiKeys.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    const result = await window.electron.ipcRenderer.invoke('save-api-keys', apiKeys);
    if (result.success) {
      alert(`Saved ${result.keyCount} API keys!`);
      loadKeyStatus();
    }
  };

  return (
    <div>
      <h2>Settings</h2>
      
      <div className="card">
        <h3>Gemini API Keys</h3>
        <p>Status: {status?.hasKeys ? `${status.count} keys configured` : 'No keys'}</p>
        
        <div style={{ marginTop: '1rem' }}>
          <input
            type="text"
            placeholder="Enter API Key (AIza...)"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            style={{ marginBottom: '0.5rem' }}
          />
          <button onClick={handleAddKey} className="btn-primary" style={{ marginRight: '0.5rem' }}>
            Add Key
          </button>
        </div>

        {apiKeys.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <h4>Keys to save:</h4>
            {apiKeys.map((key, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', margin: '0.5rem 0' }}>
                <code>{key.substring(0, 20)}...</code>
                <button onClick={() => handleRemoveKey(i)}>Remove</button>
              </div>
            ))}
            <button onClick={handleSave} className="btn-primary" style={{ marginTop: '1rem' }}>
              Save All Keys
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>About</h3>
        <p>Anz Video Publisher v1.0.0</p>
        <p>AI-powered video generation for social media</p>
      </div>
    </div>
  );
}

export default Settings;
