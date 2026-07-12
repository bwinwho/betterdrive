/* PDF preview plugin — pdf.js at the Components layer (build/pdf.min.mjs +
   web/pdf_viewer.mjs), not the prebuilt viewer.html app. Reasoning: viewer.html
   expects to fetch its PDF from a URL, and under file:// that's effectively
   cross-origin with no clean way to hand it a blob without patching the
   vendored file — the Components layer takes raw bytes directly instead
   (getDocument({data})), which is exactly what we already have via
   window.localFS.readFile / fetchBlob / exportBlob. This also means our own
   toolbar is the ONLY toolbar (no fighting Mozilla's iframed chrome), which is
   what makes "one consistent toolbar across every viewer" possible at all. */

const esc = (s) => (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let pdfjsLib = null;
let ViewerMod = null;
let cssInjected = false;
let workersUsablePromise = null; // cached per app session — this is a property of the environment, not of any one PDF

async function loadLibs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('../../vendor/pdfjs/build/pdf.min.mjs');
    /* Worker loading is the single most fragile part of embedding pdf.js in
       Electron — it has to work across file://, our custom app:// scheme, and
       inside/outside asar, and a URL that's fine for a normal `<script>` fetch
       can still silently fail to instantiate as a Worker. Hand it a blob: URL
       (same-origin with this document, universally instantiable as a module
       worker regardless of the page's own scheme) rather than a scheme-based
       one — this removes URL/scheme mismatches as a variable even though it
       turned out not to be the whole story (see testWorkerAlive below). */
    const workerUrl = new URL('../../vendor/pdfjs/build/pdf.worker.min.mjs', import.meta.url).href;
    try {
      const workerCode = await (await fetch(workerUrl)).text();
      const blob = new Blob([workerCode], { type: 'text/javascript' });
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    } catch (e) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl; // fall back to the direct URL if the fetch itself fails
    }
  }
  if (!ViewerMod) {
    ViewerMod = await import('../../vendor/pdfjs/web/pdf_viewer.mjs');
  }
  if (!cssInjected) {
    cssInjected = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../../vendor/pdfjs/web/pdf_viewer.css', import.meta.url).href;
    document.head.appendChild(link);
    document.head.appendChild(makeChromeStyle());
  }
}

/* Even a same-origin blob: module worker can, in some Electron/Windows builds,
   start executing without ever completing its handshake back to the main
   thread — no error event fires (so pdf.js's own error-triggered fallback
   never kicks in), it just hangs forever. A trivial, totally independent
   worker (nothing to do with pdf.js) tells us in ~3s whether module workers
   function AT ALL in this environment, once per app session. */
function testWorkerAlive() {
  if (workersUsablePromise) return workersUsablePromise;
  workersUsablePromise = new Promise((resolve) => {
    try {
      const blob = new Blob(['postMessage("bd-worker-alive")'], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url, { type: 'module' });
      const done = (ok) => { clearTimeout(timer); try { w.terminate(); } catch (e) {} URL.revokeObjectURL(url); resolve(ok); };
      const timer = setTimeout(() => done(false), 3000);
      w.onmessage = () => done(true);
      w.onerror = () => done(false);
    } catch (e) { resolve(false); }
  });
  return workersUsablePromise;
}

/* If workers don't function here, force pdf.js's OWN built-in main-thread
   fallback (it already has one — it's what runs pdf.js in Node/testing
   environments) rather than reimplementing any of its internals ourselves.
   pdf.js only takes that path if constructing the real Worker throws
   synchronously, so we make it throw by swapping the global Worker
   constructor out for the duration of this one call, then restoring it. */
async function makeLoadingTask(bytes) {
  const usable = await testWorkerAlive();
  if (usable) return pdfjsLib.getDocument({ data: bytes });
  const RealWorker = window.Worker;
  window.Worker = function () { throw new Error('workers disabled — forcing pdf.js main-thread fallback'); };
  try {
    return pdfjsLib.getDocument({ data: bytes }); // constructs its PDFWorker synchronously, so the patched Worker is what it sees
  } finally {
    window.Worker = RealWorker;
  }
}

function makeChromeStyle() {
  const s = document.createElement('style');
  s.textContent = `
.bdpdf{position:relative;display:flex;flex-direction:column;height:100%;width:100%}
.bdpdf-toolbar{display:flex;align-items:center;gap:6px;padding:8px 10px;flex-shrink:0;
  border-bottom:1px solid var(--faint);font-family:var(--mono);font-size:11px}
.bdpdf-toolbar button{
  font-family:var(--mono);font-size:11px;color:var(--dim);padding:6px 10px;border-radius:2px;
  transition:all .2s var(--ease);border:1px solid transparent;
}
.bdpdf-toolbar button:hover{color:var(--cream);background:rgba(234,228,214,.07)}
.bdpdf-toolbar button.active{color:var(--cream);border-color:var(--faint-2)}
.bdpdf-toolbar .spacer{flex:1}
.bdpdf-pagenav,.bdpdf-zoom{display:flex;align-items:center;gap:4px}
.bdpdf-pageinput{width:44px;background:transparent;border:1px solid var(--faint);border-radius:2px;
  color:var(--cream);font-family:var(--mono);font-size:11px;text-align:center;padding:5px 2px}
.bdpdf-zoomlabel{min-width:42px;text-align:center;color:var(--dim);font-size:11px}
.bdpdf-search-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;flex-shrink:0;
  border-bottom:1px solid var(--faint);background:rgba(234,228,214,.03)}
.bdpdf-search-bar.hidden{display:none}
.bdpdf-search-input{flex:1;background:transparent;border:1px solid var(--faint);border-radius:2px;
  color:var(--cream);font-family:var(--mono);font-size:12px;padding:7px 10px}
.bdpdf-search-count{font-family:var(--mono);font-size:10px;color:var(--dim);white-space:nowrap}
.bdpdf-body{position:relative;flex:1;display:flex;overflow:hidden}
.bdpdf-thumbs{width:132px;flex-shrink:0;overflow-y:auto;padding:12px 10px;border-right:1px solid var(--faint);
  display:flex;flex-direction:column;gap:10px}
.bdpdf-thumbs.hidden{display:none}
.bdpdf-thumb{cursor:pointer;border:1px solid var(--faint);border-radius:2px;overflow:hidden;
  transition:border-color .2s var(--ease);position:relative;background:rgba(234,228,214,.03)}
.bdpdf-thumb:hover{border-color:rgba(234,228,214,.4)}
.bdpdf-thumb.active{border-color:var(--cream)}
.bdpdf-thumb canvas{display:block;width:100%;height:auto}
.bdpdf-thumb .num{position:absolute;bottom:3px;right:5px;font-family:var(--mono);font-size:9px;color:var(--dim);
  background:rgba(10,10,9,.7);padding:1px 4px;border-radius:2px}
.bdpdf-viewerContainer{position:absolute;inset:0;overflow:auto;background:#0c0c0b}
.bdpdf-viewerContainer.thumbs-open{left:132px}
.bdpdf-print-container{display:none}
@media print{
  body>*:not(.bdpdf-print-container){display:none!important}
  .bdpdf-print-container{display:block!important;position:static!important}
  .bdpdf-print-container canvas{width:100%;display:block;page-break-after:always}
}
`;
  return s;
}

const THUMB_SCALE = 0.2;
const ZOOM_MIN = 0.25, ZOOM_MAX = 5;

export default {
  async mount(container, file, ctx) {
    await loadLibs();
    const { EventBus, PDFLinkService, PDFFindController, PDFViewer, GenericL10n } = ViewerMod;

    const bytes = new Uint8Array(ctx.arrayBuffer);

    container.innerHTML = `
      <div class="bdpdf">
        <div class="bdpdf-toolbar">
          <button data-act="thumbs" title="Toggle thumbnails">▤ Thumbnails</button>
          <div class="bdpdf-pagenav">
            <button data-act="prev" title="Previous page">‹</button>
            <input class="bdpdf-pageinput" type="number" min="1" value="1">
            <span class="bdpdf-pagecount">/ …</span>
            <button data-act="next" title="Next page">›</button>
          </div>
          <div class="bdpdf-zoom">
            <button data-act="zoomout" title="Zoom out">−</button>
            <span class="bdpdf-zoomlabel">100%</span>
            <button data-act="zoomin" title="Zoom in">+</button>
          </div>
          <div class="spacer"></div>
          <button data-act="search" title="Find in document (Ctrl+F)">🔍 Find</button>
          <button data-act="print" title="Print">🖨 Print</button>
        </div>
        <div class="bdpdf-search-bar hidden">
          <input class="bdpdf-search-input" placeholder="Find in document…">
          <span class="bdpdf-search-count"></span>
          <button data-act="find-prev" title="Previous match">↑</button>
          <button data-act="find-next" title="Next match">↓</button>
          <button data-act="find-close" title="Close">×</button>
        </div>
        <div class="bdpdf-body">
          <div class="bdpdf-thumbs hidden"></div>
          <div class="bdpdf-viewerContainer"><div class="pdfViewer"></div></div>
        </div>
      </div>
    `;
    /* the @media print rule hides every *other* direct child of <body> — so the
       print container has to actually be one, not nested inside #pv-body/
       #preview, or its own ancestors would get display:none'd right along with
       everything else and it'd print blank. */
    const printContainer = document.createElement('div');
    printContainer.className = 'bdpdf-print-container';
    document.body.appendChild(printContainer);

    const el = {
      root: container.querySelector('.bdpdf'),
      thumbsBtn: container.querySelector('[data-act="thumbs"]'),
      prevBtn: container.querySelector('[data-act="prev"]'),
      nextBtn: container.querySelector('[data-act="next"]'),
      pageInput: container.querySelector('.bdpdf-pageinput'),
      pageCount: container.querySelector('.bdpdf-pagecount'),
      zoomOutBtn: container.querySelector('[data-act="zoomout"]'),
      zoomInBtn: container.querySelector('[data-act="zoomin"]'),
      zoomLabel: container.querySelector('.bdpdf-zoomlabel'),
      searchBtn: container.querySelector('[data-act="search"]'),
      printBtn: container.querySelector('[data-act="print"]'),
      searchBar: container.querySelector('.bdpdf-search-bar'),
      searchInput: container.querySelector('.bdpdf-search-input'),
      searchCount: container.querySelector('.bdpdf-search-count'),
      findPrevBtn: container.querySelector('[data-act="find-prev"]'),
      findNextBtn: container.querySelector('[data-act="find-next"]'),
      findCloseBtn: container.querySelector('[data-act="find-close"]'),
      thumbsRail: container.querySelector('.bdpdf-thumbs'),
      viewerContainer: container.querySelector('.bdpdf-viewerContainer'),
      pdfViewerDiv: container.querySelector('.pdfViewer'),
      printContainer,
    };

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const findController = new PDFFindController({ eventBus, linkService });
    const pdfViewer = new PDFViewer({
      container: el.viewerContainer,
      viewer: el.pdfViewerDiv,
      eventBus, linkService, findController,
      l10n: new GenericL10n(),
      textLayerMode: 1,
    });
    linkService.setViewer(pdfViewer);

    const handle = {
      eventBus, pdfViewer, findController, el, ctx,
      pdfDocument: null,
      thumbsOpen: !!ctx.state?.thumbsOpen,
      abortController: new AbortController(),
      saveTimer: null,
    };

    const loadingTask = await makeLoadingTask(bytes);
    handle.loadingTask = loadingTask;
    /* never hang blank: if the document (i.e. the worker) hasn't come back in
       25s, show an error instead of sitting on an empty canvas forever. We
       render the error ourselves and return a (degraded) handle rather than
       throwing, so the engine still tracks this mount for teardown and the
       preview panel's own action buttons ("Open with default app") stay usable. */
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Timed out loading the PDF (the render worker may have failed to start).')), 25000);
    });
    let pdfDocument;
    try {
      pdfDocument = await Promise.race([loadingTask.promise, timeout]);
      clearTimeout(timeoutId);
    } catch (e) {
      clearTimeout(timeoutId);
      el.root.querySelector('.bdpdf-body').innerHTML =
        `<div style="margin:auto;text-align:center;color:var(--dim);font-size:13px;padding:48px 24px;max-width:420px">
          <div style="font-family:var(--serif);font-size:22px;color:rgba(234,228,214,.55);margin-bottom:14px">Couldn't render this PDF</div>
          <div style="opacity:.75;line-height:1.5">${esc(e.message || 'Unknown error')}</div>
          <div style="opacity:.6;margin-top:12px">Try “Open with default app” below.</div>
        </div>`;
      return handle; // degraded handle: unmount() tolerates a null pdfDocument
    }
    handle.pdfDocument = pdfDocument;
    pdfViewer.setDocument(pdfDocument);
    linkService.setDocument(pdfDocument, null);
    findController.setDocument(pdfDocument);

    el.pageCount.textContent = '/ ' + pdfDocument.numPages;
    if (handle.thumbsOpen) openThumbs(handle);

    const debouncedSave = () => {
      clearTimeout(handle.saveTimer);
      handle.saveTimer = setTimeout(() => {
        ctx.saveState({
          page: pdfViewer.currentPageNumber,
          scale: pdfViewer.currentScale,
          thumbsOpen: handle.thumbsOpen,
        });
      }, 400);
    };

    const { signal } = handle.abortController;
    eventBus.on('pagesinit', () => {
      const restoredScale = ctx.state?.scale;
      pdfViewer.currentScaleValue = restoredScale ? String(restoredScale) : 'page-width';
      if (ctx.state?.page && ctx.state.page <= pdfDocument.numPages) {
        pdfViewer.currentPageNumber = ctx.state.page;
      }
    }, { signal });
    eventBus.on('pagechanging', (evt) => {
      el.pageInput.value = evt.pageNumber;
      setActiveThumb(handle, evt.pageNumber);
      debouncedSave();
    }, { signal });
    eventBus.on('scalechanging', (evt) => {
      el.zoomLabel.textContent = Math.round(evt.scale * 100) + '%';
      debouncedSave();
    }, { signal });
    /* pdf.js reports match counts from two different events: 'updatefindmatchescount'
       fires as each page's raw matches are first tallied (often 0/0 before the
       actual match on some other page has been selected yet), while
       'updatefindcontrolstate' fires once the find controller has actually
       settled on (possibly navigated to) a selected match and carries an
       equally-fresh matchesCount of its own. Listening to just the first one
       shows a permanent "No matches" whenever the match lands on a page other
       than the one you started the search from — this is the fix. */
    const updateSearchCount = (matchesCount) => {
      const { current, total } = matchesCount || { current: 0, total: 0 };
      el.searchCount.textContent = total ? `${current} / ${total}` : (el.searchInput.value ? 'No matches' : '');
    };
    eventBus.on('updatefindmatchescount', (evt) => updateSearchCount(evt.matchesCount), { signal });
    eventBus.on('updatefindcontrolstate', (evt) => updateSearchCount(evt.matchesCount), { signal });

    el.prevBtn.addEventListener('click', () => { pdfViewer.currentPageNumber--; }, { signal });
    el.nextBtn.addEventListener('click', () => { pdfViewer.currentPageNumber++; }, { signal });
    el.pageInput.addEventListener('change', () => {
      const n = Math.max(1, Math.min(pdfDocument.numPages, +el.pageInput.value || 1));
      pdfViewer.currentPageNumber = n;
    }, { signal });
    el.zoomInBtn.addEventListener('click', () => { setZoom(pdfViewer, pdfViewer.currentScale * 1.15); }, { signal });
    el.zoomOutBtn.addEventListener('click', () => { setZoom(pdfViewer, pdfViewer.currentScale / 1.15); }, { signal });

    el.thumbsBtn.addEventListener('click', () => {
      handle.thumbsOpen = !handle.thumbsOpen;
      handle.thumbsOpen ? openThumbs(handle) : closeThumbs(handle);
      debouncedSave();
    }, { signal });

    const runFind = (findPrevious) => {
      eventBus.dispatch('find', {
        source: null, type: findPrevious === undefined ? '' : 'again',
        query: el.searchInput.value, caseSensitive: false, entireWord: false,
        highlightAll: true, findPrevious: !!findPrevious,
      });
    };
    el.searchBtn.addEventListener('click', () => toggleSearch(el, true), { signal });
    el.findCloseBtn.addEventListener('click', () => toggleSearch(el, false), { signal });
    el.searchInput.addEventListener('input', () => runFind(), { signal });
    el.findNextBtn.addEventListener('click', () => runFind(false), { signal });
    el.findPrevBtn.addEventListener('click', () => runFind(true), { signal });
    el.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runFind(e.shiftKey);
      if (e.key === 'Escape') { e.stopPropagation(); toggleSearch(el, false); }
    }, { signal });

    el.printBtn.addEventListener('click', () => printDocument(handle), { signal });
    el.root.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); toggleSearch(el, true); }
    }, { signal });

    return handle;
  },

  async unmount(handle) {
    if (!handle) return;
    clearTimeout(handle.saveTimer);
    handle.abortController.abort();
    handle.thumbObserver?.disconnect();
    try { await handle.loadingTask?.destroy(); } catch (e) { /* covers the case where the doc never finished loading (timeout/failure) */ }
    try { await handle.pdfDocument?.destroy(); } catch (e) { /* already gone */ }
    handle.el.printContainer?.remove(); // body-level, not a descendant of #pv-body — must remove explicitly
  },
};

function setZoom(pdfViewer, scale) {
  pdfViewer.currentScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale));
}

function toggleSearch(el, show) {
  el.searchBar.classList.toggle('hidden', !show);
  if (show) { el.searchInput.focus(); el.searchInput.select(); }
}

function setActiveThumb(handle, pageNumber) {
  handle.el.thumbsRail.querySelectorAll('.bdpdf-thumb').forEach((t) => {
    t.classList.toggle('active', +t.dataset.page === pageNumber);
  });
}

function openThumbs(handle) {
  const { el, pdfDocument, pdfViewer } = handle;
  el.thumbsRail.classList.remove('hidden');
  el.viewerContainer.classList.add('thumbs-open');
  el.thumbsBtn.classList.add('active');
  if (el.thumbsRail.childElementCount) return; // already built once — just re-show

  for (let n = 1; n <= pdfDocument.numPages; n++) {
    const cell = document.createElement('div');
    cell.className = 'bdpdf-thumb';
    cell.dataset.page = n;
    cell.innerHTML = `<canvas></canvas><span class="num">${n}</span>`;
    cell.onclick = () => { pdfViewer.currentPageNumber = n; };
    el.thumbsRail.appendChild(cell);
  }
  setActiveThumb(handle, pdfViewer.currentPageNumber || 1);

  /* render each thumbnail lazily as it scrolls into view, same pattern the
     rest of the app already uses for local image thumbnails */
  handle.thumbObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      handle.thumbObserver.unobserve(entry.target);
      renderThumb(pdfDocument, entry.target);
    });
  }, { root: handle.el.thumbsRail, rootMargin: '200px' });
  el.thumbsRail.querySelectorAll('.bdpdf-thumb').forEach((c) => handle.thumbObserver.observe(c));
}

function closeThumbs(handle) {
  handle.el.thumbsRail.classList.add('hidden');
  handle.el.viewerContainer.classList.remove('thumbs-open');
  handle.el.thumbsBtn.classList.remove('active');
}

async function renderThumb(pdfDocument, cell) {
  const n = +cell.dataset.page;
  const canvas = cell.querySelector('canvas');
  try {
    const page = await pdfDocument.getPage(n);
    const viewport = page.getViewport({ scale: THUMB_SCALE });
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  } catch (e) { /* page failed to render — leave the blank canvas, not worth surfacing */ }
}

async function printDocument(handle) {
  const { pdfDocument, el, printBtn } = handle;
  const original = printBtn.textContent;
  printBtn.disabled = true; printBtn.textContent = 'Preparing…';
  try {
    el.printContainer.innerHTML = '';
    const PRINT_SCALE = 2;
    for (let n = 1; n <= pdfDocument.numPages; n++) {
      const page = await pdfDocument.getPage(n);
      const viewport = page.getViewport({ scale: PRINT_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      el.printContainer.appendChild(canvas);
    }
    window.print();
  } finally {
    printBtn.disabled = false; printBtn.textContent = original;
  }
}
