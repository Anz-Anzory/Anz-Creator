const { contextBridge, ipcRenderer } = require('electron');

const validChannels = [
  'save-api-keys',
  'get-key-status',
  'get-gemini-stats',
  'analyze-video',
  'detect-watermark',
  'remove-watermark',
  'split-long-video',
  'get-video-info',
  'select-output-dir',
  'split-progress',
  'save-file'
];

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, data) => {
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, data);
      }
      return Promise.reject(new Error(`Akses IPC ditolak: ${channel}`));
    },
    on: (channel, callback) => {
      if (validChannels.includes(channel)) {
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
      }
    },
    removeAllListeners: (channel) => {
      if (validChannels.includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      }
    }
  }
});
