const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localFS', {
  root: () => ipcRenderer.invoke('fs:root'),
  specialFolders: () => ipcRenderer.invoke('fs:specialFolders'),
  fileIcon: (targetPath) => ipcRenderer.invoke('fs:fileIcon', targetPath),
  recentFiles: () => ipcRenderer.invoke('fs:recentFiles'),
  driveInfo: () => ipcRenderer.invoke('fs:driveInfo'),
  list: (dirPath) => ipcRenderer.invoke('fs:list', dirPath),
  mkdir: (parentPath, name) => ipcRenderer.invoke('fs:mkdir', parentPath, name),
  rename: (targetPath, newName) => ipcRenderer.invoke('fs:rename', targetPath, newName),
  trash: (targetPath) => ipcRenderer.invoke('fs:trash', targetPath),
  move: (targetPath, destDir) => ipcRenderer.invoke('fs:move', targetPath, destDir),
  writeFile: (destPath, arrayBuffer) => ipcRenderer.invoke('fs:writeFile', destPath, arrayBuffer),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  copyFileInto: (srcPath, destDir) => ipcRenderer.invoke('fs:copyFileInto', srcPath, destDir),
  copyPathInto: (srcPath, destDir) => ipcRenderer.invoke('fs:copyPathInto', srcPath, destDir),
  openPath: (targetPath) => ipcRenderer.invoke('fs:openPath', targetPath),
  showInFolder: (targetPath) => ipcRenderer.invoke('fs:showInFolder', targetPath),
  search: (rootPath, query) => ipcRenderer.invoke('fs:search', rootPath, query),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  watchDir: (dirPath) => ipcRenderer.invoke('fs:watchDir', dirPath),
  unwatch: () => ipcRenderer.invoke('fs:unwatch'),
  onChanged: (cb) => ipcRenderer.on('fs:changed', (e, dirPath) => cb(dirPath)),
  searchPC: (query) => ipcRenderer.invoke('fs:searchPC', query),
  listPC: (dirPath) => ipcRenderer.invoke('fs:listPC', dirPath),
});

contextBridge.exposeInMainWorld('winControl', {
  minimize: () => ipcRenderer.invoke('win:minimize'),
  maximize: () => ipcRenderer.invoke('win:maximize'),
  close: () => ipcRenderer.invoke('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  onStateChange: (cb) => ipcRenderer.on('win:state', (e, state) => cb(state)),
});
