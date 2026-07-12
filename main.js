const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');

let win;
const ROOT = path.join(app.getPath('documents'), 'BetterDrive');

/* ---------- Google OAuth config for the Cloud world ----------
   Precedence: real env var > .env (gitignored, for local dev, see .env.example)
   > google-config.js (tracked, empty by default — the release workflow
   overwrites it from repository secrets right before packaging, so the
   shipped .exe has working credentials without ever committing them). */
(function loadDotEnv(){
  try{
    const text = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for(const line of text.split(/\r?\n/)){
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if(!m) continue;
      let val = m[2];
      if(/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
      if(process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }catch(e){ /* no .env present — falls back to google-config.js */ }
})();
let googleConfigFile = {};
try{ googleConfigFile = require('./google-config.js'); }catch(e){}
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || googleConfigFile.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || googleConfigFile.GOOGLE_CLIENT_SECRET || '';

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

/* ---------- standby mode: when the window sits unfocused for a while, swap the
   heavy index.html for a near-empty standby page so Chromium can release the
   renderer's JS heap/DOM/cached thumbnails back to the OS. Waking just reloads
   index.html — all real state already lives in localStorage, so it comes back
   looking the same. Never suspends mid-upload, mid-modal, or with unsaved
   text-editor changes. ---------- */
const SUSPEND_DELAY_MS = 45000;
const SAFETY_RECHECK_MS = 15000;
let suspended = false;
let suspendTimer = null;

function isSafeToSuspend() {
  return win.webContents.executeJavaScript(`
    (function(){
      try {
        const uploading = (document.querySelector('#uploads')?.children.length||0) > 0;
        const modalOpen = document.querySelector('#modal-scrim')?.classList.contains('show');
        const paletteOpen = document.querySelector('#palette-scrim')?.classList.contains('show');
        const pcbrowseOpen = document.querySelector('#pcbrowse-scrim')?.classList.contains('show');
        const unsavedEdit = document.querySelector('#editor-status')?.classList.contains('dirty');
        return !(uploading || modalOpen || paletteOpen || pcbrowseOpen || unsavedEdit);
      } catch (e) { return true; }
    })();
  `).catch(() => true);
}

function scheduleSuspendCheck(delay) {
  clearTimeout(suspendTimer);
  suspendTimer = setTimeout(async () => {
    if (!win || win.isDestroyed() || win.isFocused()) return;
    const safe = await isSafeToSuspend();
    if (!win || win.isDestroyed() || win.isFocused()) return;
    if (!safe) { scheduleSuspendCheck(SAFETY_RECHECK_MS); return; }
    suspended = true;
    win.loadFile('standby.html');
  }, delay);
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
  /* window.open() calls (Open in Drive, saved link cards) have no explicit
     handler by default, which would pop an unhardened Electron window with no
     browser session — Google's own pages would then demand a fresh sign-in
     right inside that window. Send everything to the user's real, already
     signed-in system browser instead. */
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('maximize', () => win.webContents.send('win:state', 'maximized'));
  win.on('unmaximize', () => win.webContents.send('win:state', 'normal'));
  win.on('blur', () => { if (!suspended) scheduleSuspendCheck(SUSPEND_DELAY_MS); });
  win.on('focus', () => {
    clearTimeout(suspendTimer);
    if (suspended) { suspended = false; win.loadFile('index.html'); }
  });
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

/* ---------- zip extraction via PowerShell's built-in Expand-Archive — no bundled
   archive library needed. Extracts next to the zip, into a same-named folder,
   picking "(2)", "(3)"... if that folder already exists. ---------- */
ipcMain.handle('fs:extractZip', (e, zipPath) => new Promise((resolve, reject) => {
  if (process.platform !== 'win32') return reject(new Error('Zip extraction is only available on Windows'));
  const dir = path.dirname(zipPath);
  const base = path.basename(zipPath, path.extname(zipPath));
  let dest = path.join(dir, base);
  let n = 2;
  while (fs.existsSync(dest)) { dest = path.join(dir, `${base} (${n})`); n++; }
  const psScript = [
    `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
  ].join('\n');
  execFile('powershell', ['-NoProfile', '-Command', psScript], { timeout: 60000 }, (err, stdout, stderr) => {
    if (err) return reject(new Error(stderr || err.message));
    resolve(dest);
  });
}));

/* Compress one or more paths (files and/or folders) into a single .zip placed
   next to them, via PowerShell's Compress-Archive — the mirror of extractZip
   above, no compiled dependency. Names the archive after the first item (or
   "Archive"), de-duping if that name already exists. */
ipcMain.handle('fs:zip', (e, paths, destDir) => new Promise((resolve, reject) => {
  if (process.platform !== 'win32') return reject(new Error('Zipping is only available on Windows'));
  if (!Array.isArray(paths) || !paths.length) return reject(new Error('Nothing to zip'));
  const dir = destDir || path.dirname(paths[0]);
  const firstBase = path.basename(paths[0], path.extname(paths[0]));
  const stem = paths.length === 1 ? firstBase : (firstBase + ' +' + (paths.length - 1));
  let dest = path.join(dir, `${stem}.zip`);
  let n = 2;
  while (fs.existsSync(dest)) { dest = path.join(dir, `${stem} (${n}).zip`); n++; }
  const list = paths.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
  const psScript = `Compress-Archive -LiteralPath ${list} -DestinationPath '${dest.replace(/'/g, "''")}' -Force`;
  execFile('powershell', ['-NoProfile', '-Command', psScript], { timeout: 120000 }, (err, stdout, stderr) => {
    if (err) return reject(new Error(stderr || err.message));
    resolve(dest);
  });
}));

/* ---------- HideOut: a PIN-gated vault for files the user wants out of normal
   view. Honest scope: this hides files from Explorer using the standard
   Windows "Hidden" file attribute and gates the app's own UI behind a PIN —
   it is obscurity + a lock on the app, not disk encryption. Anyone with
   "show hidden files" turned on in Explorer, or access to the raw disk,
   can still see the files. The PIN itself is stored via safeStorage (same
   OS-level encryption already used for the Cloud OAuth tokens above), not
   as plaintext. ---------- */
const HIDEOUT_DIR = path.join(ROOT, '.hideout');
const HIDEOUT_PIN_PATH = path.join(app.getPath('userData'), 'hideout-pin.dat');
const HIDEOUT_MANIFEST_PATH = path.join(app.getPath('userData'), 'hideout-manifest.json');

function hideAttrib(targetPath) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve();
    execFile('attrib', ['+h', targetPath], () => resolve()); // best-effort — never blocks the operation on failure
  });
}
function loadHideoutManifest() {
  try { return JSON.parse(fs.readFileSync(HIDEOUT_MANIFEST_PATH, 'utf8')); } catch (e) { return {}; }
}
function saveHideoutManifest(m) {
  try { fs.writeFileSync(HIDEOUT_MANIFEST_PATH, JSON.stringify(m)); } catch (e) {}
}

ipcMain.handle('hideout:hasPin', () => fs.existsSync(HIDEOUT_PIN_PATH));

ipcMain.handle('hideout:setPin', async (e, pin) => {
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(pin) : Buffer.from(pin, 'utf8');
  fs.writeFileSync(HIDEOUT_PIN_PATH, data);
  await ensureDir(HIDEOUT_DIR);
  await hideAttrib(HIDEOUT_DIR);
});

ipcMain.handle('hideout:verifyPin', (e, pin) => {
  try {
    const buf = fs.readFileSync(HIDEOUT_PIN_PATH);
    const stored = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return stored === pin;
  } catch (e) { return false; }
});

ipcMain.handle('hideout:list', async () => {
  await ensureDir(HIDEOUT_DIR);
  const names = await fsp.readdir(HIDEOUT_DIR);
  const out = [];
  for (const name of names) {
    const full = path.join(HIDEOUT_DIR, name);
    try {
      const st = await fsp.stat(full);
      out.push({ name, path: full, isDir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs, mime: st.isDirectory() ? null : guessMime(full) });
    } catch (e) { /* vanished between readdir and stat — skip */ }
  }
  return out;
});

/* moves a file/folder into the vault, hides it, and remembers where it came
   from so unlock() can put it back. Name collisions inside the vault get a
   " (2)" suffix, same convention as extractZip/zip above. */
ipcMain.handle('hideout:lock', async (e, targetPath) => {
  await ensureDir(HIDEOUT_DIR);
  await hideAttrib(HIDEOUT_DIR);
  const base = path.basename(targetPath);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  let dest = path.join(HIDEOUT_DIR, base);
  let n = 2;
  while (fs.existsSync(dest)) { dest = path.join(HIDEOUT_DIR, `${stem} (${n})${ext}`); n++; }
  const finalPath = await safeMove(targetPath, HIDEOUT_DIR);
  const renamedPath = finalPath === dest ? finalPath : (await fsp.rename(finalPath, dest).then(() => dest).catch(() => finalPath));
  await hideAttrib(renamedPath);
  const manifest = loadHideoutManifest();
  manifest[renamedPath] = path.dirname(targetPath);
  saveHideoutManifest(manifest);
  return renamedPath;
});

/* moves a vault file back to the folder it was locked from — or Documents/
   BetterDrive itself if that folder no longer exists — and forgets it. */
ipcMain.handle('hideout:unlock', async (e, hiddenPath) => {
  const manifest = loadHideoutManifest();
  let destDir = manifest[hiddenPath];
  if (!destDir || !fs.existsSync(destDir)) destDir = ROOT;
  await ensureDir(destDir);
  const restored = await safeMove(hiddenPath, destDir);
  delete manifest[hiddenPath];
  saveHideoutManifest(manifest);
  return restored;
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

/* ---------- Google Drive "Cloud" world — OAuth 2.0 (PKCE + loopback redirect) ----------
   The renderer runs over file://, which Google's Identity Services / GIS token
   client refuses to work with (it requires a real http(s) origin registered in
   Google Cloud Console). The standard fix for installed/desktop apps is exactly
   this: open the system browser to Google's consent screen, catch the redirect
   on a local loopback server, and exchange the code for tokens ourselves. */
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CLOUD_SCOPE = 'https://www.googleapis.com/auth/drive';
const LOOPBACK_PORT = 53682; // conventional fixed port for installed-app OAuth loopbacks

function base64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function makePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

const TOKEN_PATH = path.join(app.getPath('userData'), 'cloud-tokens.json');
function saveTokens(tok) {
  const json = JSON.stringify(tok);
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  fs.writeFileSync(TOKEN_PATH, data);
}
function loadTokens() {
  try {
    const buf = fs.readFileSync(TOKEN_PATH);
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return JSON.parse(json);
  } catch (e) { return null; }
}
function clearTokens() { try { fs.unlinkSync(TOKEN_PATH); } catch (e) {} }

async function tokenRequest(params) {
  const body = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, ...params });
  if (GOOGLE_CLIENT_SECRET) body.set('client_secret', GOOGLE_CLIENT_SECRET);
  const r = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error_description || d.error || ('Google token request failed (' + r.status + ')'));
  return d;
}

const PAGE_STYLE = 'font-family:-apple-system,Segoe UI,sans-serif;background:#0a0a09;color:#eae4d6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:15px';
function connectPage(msg) { return `<body style="${PAGE_STYLE}"><div>${msg}</div></body>`; }

let connectInFlight = null;
ipcMain.handle('cloud:connect', () => {
  if (!connectInFlight) connectInFlight = doCloudConnect().finally(() => { connectInFlight = null; });
  return connectInFlight;
});
function doCloudConnect() {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_CLIENT_ID) return reject(new Error('BetterDrive has no Google Client ID configured'));
    const { verifier, challenge } = makePkce();
    let usedPort = LOOPBACK_PORT;
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timer); try { server.close(); } catch (e) {} fn(arg); };

    const server = http.createServer((req, res) => {
      let u;
      try { u = new URL(req.url, `http://127.0.0.1:${usedPort}`); } catch (e) { res.end(); return; }
      const authErr = u.searchParams.get('error');
      const code = u.searchParams.get('code');
      if (authErr) {
        res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(connectPage('Sign-in cancelled — you can close this tab.'));
        return finish(reject, new Error('Sign-in was cancelled'));
      }
      if (!code) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(connectPage('Connected — you can close this tab and go back to BetterDrive.'));
      const redirectUri = `http://127.0.0.1:${usedPort}/`;
      tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier })
        .then(tok => {
          saveTokens({ refresh_token: tok.refresh_token, access_token: tok.access_token, expiry: Date.now() + (tok.expires_in || 3600) * 1000 });
          finish(resolve, { access_token: tok.access_token, expires_in: tok.expires_in });
        })
        .catch(e => finish(reject, e));
    });

    server.once('error', () => { usedPort = 0; server.listen(0, '127.0.0.1'); });
    server.on('listening', () => {
      usedPort = server.address().port;
      const redirectUri = `http://127.0.0.1:${usedPort}/`;
      const authUrl = GOOGLE_AUTH_URL + '?' + new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
        scope: CLOUD_SCOPE, access_type: 'offline', prompt: 'consent',
        code_challenge: challenge, code_challenge_method: 'S256',
      }).toString();
      shell.openExternal(authUrl);
    });
    server.listen(usedPort, '127.0.0.1');

    const timer = setTimeout(() => finish(reject, new Error('Sign-in timed out — try again')), 180000);
  });
}

ipcMain.handle('cloud:token', async () => {
  const stored = loadTokens();
  if (!stored) return null;
  if (stored.access_token && stored.expiry && Date.now() < stored.expiry - 60000) {
    return { access_token: stored.access_token, expires_in: Math.round((stored.expiry - Date.now()) / 1000) };
  }
  if (!stored.refresh_token) return null;
  try {
    const tok = await tokenRequest({ refresh_token: stored.refresh_token, grant_type: 'refresh_token' });
    saveTokens({ refresh_token: stored.refresh_token, access_token: tok.access_token, expiry: Date.now() + (tok.expires_in || 3600) * 1000 });
    return { access_token: tok.access_token, expires_in: tok.expires_in };
  } catch (e) { return null; } // refresh failed (revoked?) — renderer falls back to an interactive connect
});
ipcMain.handle('cloud:disconnect', () => clearTokens());
ipcMain.handle('cloud:isConfigured', () => !!GOOGLE_CLIENT_ID);
