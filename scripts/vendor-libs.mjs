#!/usr/bin/env node
/* Copies only the prebuilt dist output of each preview-engine library from
   node_modules into vendor/ (gitignored, regenerated on every npm install —
   same idea as node_modules/dist, nothing new). We deliberately don't ship
   full node_modules trees (source, tests, every module format) for these,
   just the specific files each plugin actually loads at runtime. Run via
   package.json's "prepare" script, so it's already done by the time
   electron-builder globs build.files. */
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NM = join(ROOT, 'node_modules');
const VENDOR = join(ROOT, 'vendor');

function copy(relSrc, relDest) {
  const src = join(NM, relSrc);
  const dest = join(VENDOR, relDest);
  if (!existsSync(src)) {
    console.warn(`[vendor-libs] skipping missing source: ${relSrc} (run npm install first)`);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

rmSync(VENDOR, { recursive: true, force: true });

/* pdf.js — Components layer (not the full prebuilt viewer app, see
   preview/plugins/pdf.mjs for why). Minified core + worker to keep the
   shipped app lean; pdf_viewer.mjs/css are the reusable PDFViewer/
   PDFFindController pieces, left unminified (small either way). */
copy('pdfjs-dist/build/pdf.min.mjs', 'pdfjs/build/pdf.min.mjs');
copy('pdfjs-dist/build/pdf.worker.min.mjs', 'pdfjs/build/pdf.worker.min.mjs');
copy('pdfjs-dist/web/pdf_viewer.mjs', 'pdfjs/web/pdf_viewer.mjs');
copy('pdfjs-dist/web/pdf_viewer.css', 'pdfjs/web/pdf_viewer.css');

/* PhotoSwipe — Core (not Lightbox: we drive open/close from our own gallery
   grid + toolbar, not by scanning DOM anchors), ESM build. */
copy('photoswipe/dist/photoswipe.esm.min.js', 'photoswipe/photoswipe.esm.min.js');
copy('photoswipe/dist/photoswipe.css', 'photoswipe/photoswipe.css');

/* TUI Image Editor (UMD, classic scripts loaded lazily only when the Edit
   button is used) + its one true external peer, tui-color-picker. fabric.js
   and tui-code-snippet are bundled directly inside tui-image-editor's own
   dist file (confirmed by inspecting its UMD wrapper — only tui-color-picker
   is require()'d externally), so they're not vendored separately. */
copy('tui-color-picker/dist/tui-color-picker.min.js', 'tui-image-editor/tui-color-picker.min.js');
copy('tui-color-picker/dist/tui-color-picker.min.css', 'tui-image-editor/tui-color-picker.min.css');
copy('tui-image-editor/dist/tui-image-editor.min.js', 'tui-image-editor/tui-image-editor.min.js');
copy('tui-image-editor/dist/tui-image-editor.min.css', 'tui-image-editor/tui-image-editor.min.css');

console.log('[vendor-libs] vendor/ ready:', VENDOR);
