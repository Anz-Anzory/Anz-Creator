const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
    on: (channel, callback) => ipcRenderer.on(channel, callback),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
  }
});
