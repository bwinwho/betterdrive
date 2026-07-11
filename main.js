const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

let win;
const ROOT = path.join(app.getPath('documents'), 'BetterDrive');

function guessMime(name) {
  const ext = path.extname(name).toLowerCase().slice(1);
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac',
    mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo',
    pdf: 'application/pdf',
    txt: 'text/plain', md: 'text/markdown', json: 'application/json', js: 'text/javascript', html: 'text/html', css: 'text/css',
    ts: 'text/typescript', jsx: 'text/javascript', tsx: 'text/typescript', py: 'text/x-python', java: 'text/x-java',
    c: 'text/x-c', cpp: 'text/x-c', h: 'text/x-c', cs: 'text/x-csharp', php: 'text/x-php', rb: 'text/x-ruby',
    go: 'text/x-go', rs: 'text/x-rust', sh: 'text/x-sh', yml: 'text/yaml', yaml: 'text/yaml', xml: 'text/xml',
    ini: 'text/plain', cfg: 'text/plain', log: 'text/plain', csv: 'text/csv', sql: 'text/x-sql', bat: 'text/plain',
    zip: 'application/zip', rar: 'application/x-rar-compressed', '7z': 'application/x-7z-compressed', tar: 'application/x-tar', gz: 'application/gzip',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext] || 'application/octet-stream';
}

async function ensureDir(p) { await fsp.mkdir(p, { recursive: true }); return p; }

async function copyRecursive(src, dest) {
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    await ensureDir(dest);
    const kids = await fsp.readdir(src);
    for (const k of kids) await copyRecursive(path.join(src, k), path.join(dest, k));
  } else {
    await fsp.copyFile(src, dest);
  }
}

async function safeMove(src, destDir) {
  const dest = path.join(destDir, path.basename(src));
  try {
    await fsp.rename(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') { await copyRecursive(src, dest); await fsp.rm(src, { recursive: true, force: true }); }
    else throw e;
  }
  return dest;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920,
    frame: false, fullscreen: true, resizable: false, backgroundColor: '#0A0A09', show: false,
    icon: path.join(__dirname, 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile('index.html');
  win.on('maximize', () => win.webContents.send('win:state', 'maximized'));
  win.on('unmaximize', () => win.webContents.send('win:state', 'normal'));
}

app.whenReady().then(async () => {
  await ensureDir(ROOT);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* ---------- window controls ---------- */
ipcMain.handle('win:minimize', () => win.minimize());
ipcMain.handle('win:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.handle('win:close', () => win.close());
ipcMain.handle('win:isMaximized', () => win.isMaximized());

/* ---------- filesystem ---------- */
ipcMain.handle('fs:root', () => ROOT);

ipcMain.handle('fs:specialFolders', () => ({
  documents: app.getPath('documents'),
  pictures: app.getPath('pictures'),
  downloads: app.getPath('downloads'),
}));

ipcMain.handle('fs:fileIcon', async (e, targetPath) => {
  try {
    const img = await app.getFileIcon(targetPath, { size: 'normal' });
    return img.toDataURL();
  } catch (err) { return null; }
});

/* ---------- Windows' own "Recent" list — the .lnk shortcuts Explorer/Office/etc.
   already drop into %AppData%/Microsoft/Windows/Recent every time any app opens a
   file. Resolving them via the WScript.Shell COM object (through PowerShell) needs
   no compiled addon and gives genuine system-wide recent files, not just ones opened
   through BetterDrive itself. ---------- */
ipcMain.handle('fs:recentFiles', () => new Promise((resolve) => {
  if (process.platform !== 'win32') return resolve([]);
  const recentDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Recent');
  const psScript = [
    '$sh = New-Object -ComObject WScript.Shell',
    `$items = @(Get-ChildItem -LiteralPath '${recentDir.replace(/'/g, "''")}' -Filter *.lnk -ErrorAction SilentlyContinue |`,
    'Sort-Object LastWriteTime -Descending | Select-Object -First 40 | ForEach-Object {',
    '  $t = $null; try { $t = $sh.CreateShortcut($_.FullName).TargetPath } catch {}',
    '  [PSCustomObject]@{ target = $t; mtime = $_.LastWriteTime.ToString("o") }',
    '})',
    '$items | ConvertTo-Json -Compress',
  ].join('\n');
  execFile('powershell', ['-NoProfile', '-Command', psScript], { timeout: 8000 }, async (err, stdout) => {
    if (err) return resolve([]);
    let rows;
    try { rows = JSON.parse(stdout || '[]'); if (!Array.isArray(rows)) rows = [rows]; } catch (parseErr) { return resolve([]); }
    const out = [];
    const seen = new Set();
    for (const r of rows) {
      if (!r.target || seen.has(r.target)) continue;
      seen.add(r.target);
      try {
        const st = await fsp.stat(r.target);
        out.push({ name: path.basename(r.target), path: r.target, isDir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs, mime: st.isDirectory() ? null : guessMime(r.target) });
      } catch (statErr) { /* target since moved/deleted — skip */ }
    }
    resolve(out);
  });
}));

ipcMain.handle('fs:list', async (e, dirPath) => {
  await ensureDir(dirPath);
  const names = await fsp.readdir(dirPath);
  const out = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const full = path.join(dirPath, name);
    try {
      const st = await fsp.stat(full);
      out.push({
        name, path: full, isDir: st.isDirectory(),
        size: st.size, mtimeMs: st.mtimeMs, mime: st.isDirectory() ? null : guessMime(name),
      });
    } catch (err) { /* skip unreadable entries (locked files, permission) */ }
  }
  return out;
});

ipcMain.handle('fs:mkdir', async (e, parentPath, name) => {
  const full = path.join(parentPath, name);
  await fsp.mkdir(full, { recursive: false });
  return full;
});

ipcMain.handle('fs:rename', async (e, targetPath, newName) => {
  const dest = path.join(path.dirname(targetPath), newName);
  await fsp.rename(targetPath, dest);
  return dest;
});

ipcMain.handle('fs:trash', async (e, targetPath) => { await shell.trashItem(targetPath); });

ipcMain.handle('fs:move', async (e, targetPath, destDir) => safeMove(targetPath, destDir));

ipcMain.handle('fs:writeFile', async (e, destPath, arrayBuffer) => {
  await fsp.writeFile(destPath, Buffer.from(arrayBuffer));
  const st = await fsp.stat(destPath);
  return { path: destPath, size: st.size, mtimeMs: st.mtimeMs };
});

ipcMain.handle('fs:readFile', async (e, filePath) => {
  const buf = await fsp.readFile(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

ipcMain.handle('fs:copyFileInto', async (e, srcPath, destDir) => {
  const dest = path.join(destDir, path.basename(srcPath));
  await fsp.copyFile(srcPath, dest);
  const st = await fsp.stat(dest);
  return { path: dest, size: st.size, mtimeMs: st.mtimeMs };
});

ipcMain.handle('fs:copyPathInto', async (e, srcPath, destDir) => {
  const dest = path.join(destDir, path.basename(srcPath));
  await copyRecursive(srcPath, dest);
  const st = await fsp.stat(dest);
  return { path: dest, isDir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs };
});

ipcMain.handle('fs:openPath', async (e, targetPath) => shell.openPath(targetPath));
ipcMain.handle('fs:showInFolder', async (e, targetPath) => shell.showItemInFolder(targetPath));

ipcMain.handle('fs:search', async (e, rootPath, query) => {
  const q = query.toLowerCase();
  const out = [];
  async function walk(dir, label) {
    let names;
    try { names = await fsp.readdir(dir); } catch (err) { return; }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const full = path.join(dir, name);
      let st;
      try { st = await fsp.stat(full); } catch (err) { continue; }
      if (name.toLowerCase().includes(q)) {
        out.push({ name, path: full, isDir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs, mime: st.isDirectory() ? null : guessMime(name), label });
      }
      if (st.isDirectory() && out.length < 300) await walk(full, name);
    }
  }
  await walk(rootPath, path.basename(rootPath));
  return out.slice(0, 300);
});

ipcMain.handle('dialog:pickFiles', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

/* ---------- PC browser: list drive roots, or contents of a given folder ---------- */
ipcMain.handle('fs:listPC', async (e, dirPath) => {
  if (!dirPath) {
    const roots = await driveRoots();
    const named = [
      { name: 'Desktop', path: app.getPath('desktop') },
      { name: 'Documents', path: app.getPath('documents') },
      { name: 'Downloads', path: app.getPath('downloads') },
      { name: 'Pictures', path: app.getPath('pictures') },
      { name: 'Videos', path: app.getPath('videos') },
      { name: 'Music', path: app.getPath('music') },
    ];
    const out = [...named.map(n => ({ ...n, isDir: true, isRoot: true, size: 0, mtimeMs: 0 }))];
    for (const r of roots) out.push({ name: r, path: r, isDir: true, isRoot: true, isDrive: true, size: 0, mtimeMs: 0 });
    return out;
  }
  let names;
  try { names = await fsp.readdir(dirPath); } catch (err) { return []; }
  const out = [];
  for (const name of names) {
    if (name.startsWith('.') || SEARCH_SKIP.has(name)) continue;
    const full = path.join(dirPath, name);
    try {
      const st = await fsp.stat(full);
      out.push({ name, path: full, isDir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs, mime: st.isDirectory() ? null : guessMime(name) });
    } catch (err) {}
  }
  return out;
});

/* ---------- live folder watching — so files pasted in via Explorer show up ----------
   Windows' underlying ReadDirectoryChangesW fires multiple raw events per single real
   file operation, which used to cause the UI to refresh several times in a row. Beyond
   debouncing, we compare a cheap directory-name signature and only notify the renderer
   when something actually changed. */
let activeWatcher = null, watchedPath = null, watchDebounce = null, lastWatchSig = null;
ipcMain.handle('fs:watchDir', (e, dirPath) => {
  if (activeWatcher) { try { activeWatcher.close(); } catch (err) {} activeWatcher = null; }
  watchedPath = dirPath;
  lastWatchSig = null;
  try {
    activeWatcher = fs.watch(dirPath, { persistent: false }, () => {
      clearTimeout(watchDebounce);
      watchDebounce = setTimeout(async () => {
        if (!win || win.isDestroyed()) return;
        let sig;
        try { sig = (await fsp.readdir(dirPath)).sort().join('\u0000'); } catch (err) { sig = null; }
        if (sig === lastWatchSig) return;
        lastWatchSig = sig;
        win.webContents.send('fs:changed', dirPath);
      }, 400);
    });
  } catch (err) { /* folder may have been removed externally — ignore */ }
});
ipcMain.handle('fs:unwatch', () => { if (activeWatcher) { try { activeWatcher.close(); } catch (err) {} activeWatcher = null; } });

/* ---------- drive labels/types (Windows only) — used to show real volume names in the PC browser ---------- */
const DRIVE_TYPE_NAMES = { 0: 'Unknown', 1: 'No Root Dir', 2: 'Removable', 3: 'Local Disk', 4: 'Network Drive', 5: 'CD-ROM', 6: 'RAM Disk' };
ipcMain.handle('fs:driveInfo', () => new Promise((resolve) => {
  if (process.platform !== 'win32') return resolve([]);
  execFile('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType | ConvertTo-Json'],
    { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([]);
      try {
        let rows = JSON.parse(stdout || '[]');
        if (!Array.isArray(rows)) rows = [rows];
        resolve(rows.map(r => ({
          deviceId: r.DeviceID, label: r.VolumeName || '', type: DRIVE_TYPE_NAMES[r.DriveType] || 'Drive',
        })));
      } catch (parseErr) { resolve([]); }
    });
}));

/* ---------- whole-PC search — common user folders + drive roots, capped so it can't hang ---------- */
async function driveRoots() {
  if (process.platform !== 'win32') return [app.getPath('home')];
  const roots = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const r = `${letter}:\\`;
    try { await fsp.access(r); roots.push(r); } catch (err) {}
  }
  return roots;
}
const SEARCH_SKIP = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information', 'Windows', 'ProgramData',
  '$WinREAgent', 'Recovery', 'PerfLogs', 'AppData']);

ipcMain.handle('fs:searchPC', async (e, query) => {
  const q = query.toLowerCase();
  const out = []; const seen = new Set();
  const deadline = Date.now() + 6000; // hard time budget
  const CAP = 400;

  async function walk(dir, depth) {
    if (out.length >= CAP || Date.now() > deadline) return;
    let names;
    try { names = await fsp.readdir(dir); } catch (err) { return; }
    for (const name of names) {
      if (out.length >= CAP || Date.now() > deadline) return;
      if (name.startsWith('.') || SEARCH_SKIP.has(name)) continue;
      const full = path.join(dir, name);
      if (seen.has(full)) continue;
      let st;
      try { st = await fsp.stat(full); } catch (err) { continue; }
      if (name.toLowerCase().includes(q)) {
        seen.add(full);
        out.push({ name, path: full, isDir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs, mime: st.isDirectory() ? null : guessMime(name) });
      }
      if (st.isDirectory() && depth < 6) await walk(full, depth + 1);
    }
  }

  const priority = [app.getPath('desktop'), app.getPath('documents'), app.getPath('downloads'), app.getPath('pictures'), app.getPath('videos'), app.getPath('music')];
  for (const p of priority) { if (out.length < CAP) await walk(p, 0); }
  if (out.length < CAP && Date.now() < deadline) {
    for (const root of await driveRoots()) { if (out.length >= CAP || Date.now() > deadline) break; await walk(root, 0); }
  }
  return out;
});
