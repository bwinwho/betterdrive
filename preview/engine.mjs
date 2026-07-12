/* Preview Engine — a small, lazily-loaded plugin registry for the file preview
   panel (#pv-body). One plugin module per file kind, loaded via dynamic
   import() only the first time that kind is actually opened, so kinds nobody
   ever previews (e.g. PDF, for someone who only ever looks at photos) never
   cost anything.

   Plugin contract (see preview/plugins/pdf.mjs for a full example):
     export default {
       mount(container, file, ctx): handle,       // build the viewer, return whatever state it needs later
       unmount(handle): void,                      // tear down workers/audio contexts/canvases — required
       toolbarActions(handle)?: [{label,title,onClick}],  // optional — contributed into the shared action bar
     }
   ctx passed to mount(): { state, saveState(next) } — state is whatever this
   plugin last saved for this exact file (or null), saveState persists more.

   This module is loaded once, eagerly, via a small <script type="module">
   bootstrap in index.html that exposes it on window.PreviewEngine — the rest
   of index.html is a plain classic script and calls into it that way. */

const PLUGINS = {
  pdf: () => import('./plugins/pdf.mjs'),
  image: () => import('./plugins/image.mjs'),
};

let current = null; // { kindName, plugin, handle }

export function hasPlugin(kindName) {
  return Object.prototype.hasOwnProperty.call(PLUGINS, kindName);
}

export async function unmountCurrent() {
  if (!current) return;
  const { plugin, handle } = current;
  current = null; // clear first so a throwing unmount can't wedge future opens
  try { await plugin.unmount(handle); } catch (e) { console.error('[PreviewEngine] unmount failed', e); }
}

/* container: the DOM node to mount into (#pv-body).
   opts.arrayBuffer: raw file bytes, pre-fetched by the caller (openPreview()
   already knows how to read local files vs. Drive-backed ones via
   fetchBlob/exportBlob — the engine and its plugins don't need to know that
   distinction at all, they just get bytes).
   opts.toolbarEl: where to render any toolbarActions the plugin declares
   (#pv-actions) — optional, plugins that build their own internal chrome
   (like the PDF one) can ignore it. */
export async function openInEngine(kindName, file, container, opts = {}) {
  const { toolbarEl, ...rest } = opts; // everything except toolbarEl is plugin-specific payload (arrayBuffer for pdf, items/index/src for image, …) and just passes through
  await unmountCurrent();
  const loader = PLUGINS[kindName];
  if (!loader) throw new Error('No preview-engine plugin registered for kind: ' + kindName);
  const mod = await loader();
  const plugin = mod.default;
  const state = loadState(file);
  const handle = await plugin.mount(container, file, {
    ...rest,
    state,
    saveState: (next) => saveState(file, next),
  });
  current = { kindName, plugin, handle };
  if (toolbarEl && typeof plugin.toolbarActions === 'function') {
    const actions = plugin.toolbarActions(handle) || [];
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'iconbtn';
      b.textContent = a.label;
      if (a.title) b.title = a.title;
      b.onclick = a.onClick;
      toolbarEl.appendChild(b);
    }
  }
  return handle;
}

/* ---------- per-file viewer state (zoom, page, scroll, playback position…) ----------
   One shared home so every plugin persists state the same way, capped so it
   can't grow unbounded across a long-lived install. Keyed by file id, plus
   mtime for local files so state doesn't get replayed against a file that's
   since changed on disk. */
const STATE_KEY = 'bd_previewState';
const STATE_CAP = 200;

function readAllStates() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (e) { return {}; }
}
function writeAllStates(all) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(all)); } catch (e) { /* storage full/unavailable — state just won't persist */ }
}
function stateKeyFor(file) {
  return file._local ? file.id + ':' + (file.modifiedTime || '') : file.id;
}
export function saveState(file, state) {
  const all = readAllStates();
  all[stateKeyFor(file)] = state;
  const keys = Object.keys(all);
  while (keys.length > STATE_CAP) { delete all[keys.shift()]; }
  writeAllStates(all);
}
export function loadState(file) {
  return readAllStates()[stateKeyFor(file)] || null;
}
