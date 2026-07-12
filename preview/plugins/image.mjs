/* Image preview plugin — PhotoSwipe at the Core layer (new PhotoSwipe(...),
   not PhotoSwipeLightbox: we already know exactly which file to open and its
   siblings ourselves, there's no DOM gallery of <a> tags to scan) mounted
   inside our own #pv-body rather than left to append to document.body and
   take over the page with its own top bar. Same reasoning as pdf.mjs picking
   pdf.js's Components layer over the prebuilt viewer.html app: reuse the
   library for what it's good at (zoom/pan/swipe gestures, slide transitions)
   while our own preview panel remains the one consistent toolbar/close/title
   chrome across every viewer.

   ctx.items: array of { id, src, alt, _local } — every sibling image in the
   folder currently being browsed, already resolved to a real <img>-loadable
   URL by the caller (file:// for local, blob: for Drive-fetched). Plugins
   don't know how to turn a "file" into a URL — that's app-specific plumbing
   index.html already has (toFileUrl / fetchBlob) — so the caller resolves it
   once, up front, exactly like it hands PDF bytes to pdf.mjs.
   ctx.index: position of the file being opened within ctx.items. */

let PhotoSwipe = null;
let cssInjected = false;

async function loadLib() {
  if (!PhotoSwipe) {
    const mod = await import('../../vendor/photoswipe/photoswipe.esm.min.js');
    PhotoSwipe = mod.default;
  }
  if (!cssInjected) {
    cssInjected = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../../vendor/photoswipe/photoswipe.css', import.meta.url).href;
    document.head.appendChild(link);
    document.head.appendChild(makeChromeStyle());
  }
}

function makeChromeStyle() {
  const s = document.createElement('style');
  s.textContent = `
.bdimg{position:relative;height:100%;width:100%;overflow:hidden}
/* PhotoSwipe's own CSS is position:fixed (a page-covering lightbox) — pin it
   to our own container instead so it fills the preview panel, not the whole
   window, and never fights our title bar / close button / actions bar. */
.bdimg .pswp{position:absolute!important;background:transparent}
.bdimg .pswp__top-bar,.bdimg .pswp__button--arrow{display:none!important}
.bdimg .pv-nav{z-index:10}
.bdimg .pv-counter{z-index:10}
`;
  return s;
}

/* natural dimensions are only known for the image actually being displayed
   (measuring every sibling up front would mean firing hundreds of image
   loads just to open one photo in a large folder) — siblings get a
   reasonable placeholder that PhotoSwipe self-corrects once you swipe/click
   to them and their real <img> loads. */
function measure(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1600, h: img.naturalHeight || 1200 });
    img.onerror = () => resolve({ w: 1600, h: 1200 });
    img.src = src;
  });
}

export default {
  async mount(container, file, ctx) {
    await loadLib();
    const items = (ctx.items && ctx.items.length) ? ctx.items : [{ id: file.id, src: ctx.src, alt: file.name, _local: file._local }];
    const startIndex = Math.max(0, items.findIndex((it) => it.id === file.id));
    const dims = await measure(items[startIndex].src);

    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'bdimg';
    const stage = document.createElement('div');
    stage.className = 'bdimg-stage';
    stage.style.cssText = 'position:absolute;inset:0';
    root.appendChild(stage);

    const showNav = items.length > 1;
    let prevBtn, nextBtn, counter;
    if (showNav) {
      prevBtn = document.createElement('button'); prevBtn.className = 'pv-nav prev'; prevBtn.innerHTML = '‹';
      nextBtn = document.createElement('button'); nextBtn.className = 'pv-nav next'; nextBtn.innerHTML = '›';
      counter = document.createElement('div'); counter.className = 'pv-counter';
      root.append(prevBtn, nextBtn, counter);
    }
    container.appendChild(root);

    const dataSource = items.map((it, i) => ({
      src: it.src,
      width: i === startIndex ? dims.w : 1600,
      height: i === startIndex ? dims.h : 1200,
      alt: it.alt || '',
    }));

    const pswp = new PhotoSwipe({
      dataSource,
      index: startIndex,
      appendToEl: stage,
      wheelToZoom: true,
      showHideAnimationType: 'fade',
      bgOpacity: 1,
      padding: { top: 8, bottom: 8, left: 8, right: 8 },
      closeOnVerticalDrag: false,
      pinchToClose: false,
    });

    const updateCounter = () => { if (counter) counter.textContent = (pswp.currIndex + 1) + ' / ' + items.length; };
    pswp.on('change', updateCounter);
    pswp.init();
    updateCounter();

    if (showNav) {
      prevBtn.onclick = (e) => { e.stopPropagation(); pswp.prev(); };
      nextBtn.onclick = (e) => { e.stopPropagation(); pswp.next(); };
    }

    return { pswp, root };
  },

  async unmount(handle) {
    if (!handle) return;
    try { handle.pswp.destroy(); } catch (e) { /* already destroyed/never fully opened */ }
  },

  toolbarActions(handle) {
    return [];
  },
};
