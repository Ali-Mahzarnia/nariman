const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openVideo:   () => ipcRenderer.invoke('open-video'),
  detectFps:   (fileUrl) => ipcRenderer.invoke('detect-fps', fileUrl),
  saveExport:  (payload) => ipcRenderer.invoke('save-export', payload),
  saveExcel:     (payload) => ipcRenderer.invoke('save-excel', payload),
  pickXlsxPath:  (defaultPath) => ipcRenderer.invoke('pick-xlsx-path', defaultPath),
  pickLogPath: () => ipcRenderer.invoke('pick-log-path'),
  writeLog:    (path, content) => ipcRenderer.invoke('write-log', { path, content }),
  saveDefsFile: (content) => ipcRenderer.invoke('save-defs-file', content),
  loadDefsFile: () => ipcRenderer.invoke('load-defs-file'),
  segCreate: (content, defaultName) => ipcRenderer.invoke('seg-create', { content, defaultName }),
  segLoad:   () => ipcRenderer.invoke('seg-load'),
  segRead:   (path) => ipcRenderer.invoke('seg-read', path),
  segWrite:  (path, content) => ipcRenderer.invoke('seg-write', { path, content }),
  confirmKeep: (message) => ipcRenderer.invoke('confirm-keep', message),
  audioScan:       (payload) => ipcRenderer.invoke('audio-scan', payload),
  audioScanCancel: ()        => ipcRenderer.invoke('audio-scan-cancel'),
  onAudioProgress: (cb)      => ipcRenderer.on('audio-progress', (_e, d) => cb(d)),
  saveMedia:       (payload) => ipcRenderer.invoke('save-media', payload),
  bladeInfer:      (blade, rgba, size, conf) => ipcRenderer.invoke('blade-infer', { blade, rgba, size, conf }),
  bladeWarmup:     (blade) => ipcRenderer.invoke('blade-warmup', blade),
});
