import React, { useState, useEffect } from 'react';

function Settings() {
  const [apiKeys, setApiKeys] = useState([]);
  const [newKey, setNewKey] = useState('');
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadKeyStatus();
  }, []);

  const loadKeyStatus = async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('get-key-status');
      if (result.success) {
        setStatus(result);
      }
    } catch (err) {
      console.error('Gagal memuat status key:', err);
    }
  };

  const handleAddKey = () => {
    const trimmed = newKey.trim();
    if (trimmed) {
      if (apiKeys.includes(trimmed)) {
        alert('API key ini sudah ada di daftar.');
        return;
      }
      setApiKeys([...apiKeys, trimmed]);
      setNewKey('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAddKey();
  };

  const handleRemoveKey = (index) => {
    setApiKeys(apiKeys.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await window.electron.ipcRenderer.invoke('save-api-keys', apiKeys);
      if (result.success) {
        alert(`✅ Berhasil menyimpan ${result.keyCount} API key!`);
        loadKeyStatus();
        setApiKeys([]); // Reset daftar setelah disimpan
      } else {
        alert('❌ Gagal menyimpan: ' + result.error);
      }
    } catch (err) {
      alert('❌ Error: ' + err.message);
    }
    setSaving(false);
  };

  return (
    <div>
      <h2>Settings</h2>
      
      <div className="card">
        <h3>🔑 Gemini API Keys</h3>
        <p style={{ marginBottom: '1rem', opacity: 0.7 }}>
          Status: {status?.hasKeys 
            ? `✅ ${status.count} key terkonfigurasi` 
            : '❌ Belum ada key'}
        </p>
        
        <div style={{ marginTop: '1rem' }}>
          <input
            type="password"
            placeholder="Masukkan API Key (AIza...)"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ marginBottom: '0.5rem' }}
          />
          <button onClick={handleAddKey} className="btn-primary" style={{ marginRight: '0.5rem' }}>
            + Tambah Key
          </button>
        </div>

        {apiKeys.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <h4>Key yang akan disimpan:</h4>
            {apiKeys.map((key, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.5rem 0', padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                <code style={{ opacity: 0.7 }}>{key.substring(0, 10)}...{key.substring(key.length - 4)}</code>
                <button onClick={() => handleRemoveKey(i)} style={{ color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                  ✕ Hapus
                </button>
              </div>
            ))}
            <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ marginTop: '1rem', width: '100%' }}>
              {saving ? '⏳ Menyimpan...' : `💾 Simpan ${apiKeys.length} Key`}
            </button>
          </div>
        )}
        
        <p style={{ marginTop: '1rem', fontSize: '0.8rem', opacity: 0.5 }}>
          💡 Dapatkan API key gratis di{' '}
          <span style={{ color: '#667eea', cursor: 'pointer' }} 
                onClick={() => require('electron').shell?.openExternal('https://makersuite.google.com/app/apikey')}>
            Google AI Studio
          </span>
        </p>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>ℹ️ Tentang</h3>
        <p>Anz Video Publisher v1.0.0</p>
        <p style={{ opacity: 0.7, marginTop: '0.5rem' }}>AI-powered video generation untuk social media</p>
      </div>
    </div>
  );
}

export default Settings;
