import JSZip from 'jszip';
import { PDFDocument, rgb } from 'pdf-lib';
import { designSize, ensurePhotoLoaded, renderCard } from './render';
import type { CardSize, Employee, ExportSettings } from './types';
import { isAndroidApp, nativeSave } from './native';

export const SIZES: CardSize[] = [
  { id: 'orig54', label: 'Rasio asli template – 54 × 76,4 mm', wMm: 54, hMm: 76.37 },
  { id: 'a7', label: 'Rasio asli – A7 74 × 105 mm', wMm: 74, hMm: 105 },
  { id: 'cr80', label: 'CR80 portrait – 53,98 × 85,60 mm', wMm: 53.98, hMm: 85.6 },
  { id: 'a6', label: 'Rasio asli – A6 105 × 148 mm', wMm: 105, hMm: 148 },
  { id: 'custom', label: 'Custom size…', wMm: 60, hMm: 90 },
];

export function resolveSize(s: ExportSettings): CardSize {
  const base = SIZES.find((x) => x.id === s.sizeId) || SIZES[0];
  if (base.id === 'custom') return { ...base, wMm: s.customW, hMm: s.customH, label: `Custom ${s.customW} × ${s.customH} mm` };
  return base;
}

export function pxFor(size: CardSize, dpi: number) {
  return { w: Math.round((size.wMm / 25.4) * dpi), h: Math.round((size.hMm / 25.4) * dpi) };
}

/** Render kartu ke canvas dengan ukuran fisik & DPI tertentu (contain / cover tanpa distorsi). */
export async function renderToCanvas(
  tpl: HTMLImageElement,
  emp: Employee,
  size: CardSize,
  dpi: number,
  fit: ExportSettings['fit'],
  maxPx?: number,
) {
  await ensurePhotoLoaded(emp.photo);
  let { w, h } = pxFor(size, dpi);
  if (maxPx && w > maxPx) {
    h = Math.round((h * maxPx) / w);
    w = maxPx;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  const { W, H } = designSize(tpl);
  const k = fit === 'cover' ? Math.max(w / W, h / H) : Math.min(w / W, h / H);
  ctx.setTransform(k, 0, 0, k, (w - W * k) / 2, (h - H * k) / 2);
  renderCard(ctx, tpl, emp);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Export gagal'))), type, q));

// ---------- DPI metadata ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pngWithDpi(blob: Blob, dpi: number) {
  const src = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // pHYs
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const at = 33; // setelah signature (8) + IHDR (25)
  const out = new Uint8Array(src.length + 21);
  out.set(src.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(src.subarray(at), at + 21);
  return new Blob([out], { type: 'image/png' });
}

async function jpgWithDpi(blob: Blob, dpi: number) {
  const b = new Uint8Array(await blob.arrayBuffer());
  if (b[2] === 0xff && b[3] === 0xe0 && String.fromCharCode(b[6], b[7], b[8], b[9]) === 'JFIF') {
    b[13] = 1;
    b[14] = dpi >> 8;
    b[15] = dpi & 255;
    b[16] = dpi >> 8;
    b[17] = dpi & 255;
  }
  return new Blob([b], { type: 'image/jpeg' });
}

export async function cardPng(tpl: HTMLImageElement, emp: Employee, s: ExportSettings) {
  const c = await renderToCanvas(tpl, emp, resolveSize(s), s.dpi, s.fit);
  return pngWithDpi(await toBlob(c, 'image/png'), s.dpi);
}
export async function cardJpg(tpl: HTMLImageElement, emp: Employee, s: ExportSettings, q = 0.95) {
  const c = await renderToCanvas(tpl, emp, resolveSize(s), s.dpi, s.fit);
  return jpgWithDpi(await toBlob(c, 'image/jpeg', q), s.dpi);
}

export function safeFileName(emp: Employee, ext: string) {
  const base = [emp.no, emp.name].filter(Boolean).join('_') || 'id-card';
  return `IDCard_${base.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '')}.${ext}`;
}

/** Download di browser, atau simpan ke folder Download bila berjalan di APK Android. */
export async function downloadBlob(blob: Blob, name: string, share = false): Promise<string | void> {
  if (isAndroidApp()) return nativeSave(blob, name, share);
  if (share && navigator.canShare) {
    const f = new File([blob], name, { type: blob.type });
    if (navigator.canShare({ files: [f] })) {
      await navigator.share({ files: [f], title: name });
      return;
    }
  }
  const a = document.createElement('a');
  const u = URL.createObjectURL(blob);
  a.href = u;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

// ---------- PDF ----------
const MM = 72 / 25.4;
export type PdfLayout = 'single' | 'a4';

export async function buildPdf(
  tpl: HTMLImageElement,
  emps: Employee[],
  s: ExportSettings,
  layout: PdfLayout,
  onProgress?: (i: number, n: number) => void,
) {
  const size = resolveSize(s);
  const doc = await PDFDocument.create();
  doc.setTitle('Narindo ID Card');
  doc.setCreator('Narindo ID Card Generator');
  const W = size.wMm * MM;
  const H = size.hMm * MM;
  const A4W = 210 * MM, A4H = 297 * MM;
  const margin = 10 * MM, gap = 4 * MM;
  const cols = Math.max(1, Math.floor((A4W - 2 * margin + gap) / (W + gap)));
  const rows = Math.max(1, Math.floor((A4H - 2 * margin + gap) / (H + gap)));
  const per = cols * rows;
  const gridW = cols * W + (cols - 1) * gap;
  const gridH = rows * H + (rows - 1) * gap;
  const ox = (A4W - gridW) / 2, oy = (A4H - gridH) / 2;
  let page = null as ReturnType<typeof doc.addPage> | null;
  for (let i = 0; i < emps.length; i++) {
    onProgress?.(i, emps.length);
    const c = await renderToCanvas(tpl, emps[i], size, s.dpi, s.fit);
    const jpg = await toBlob(c, 'image/jpeg', 0.95);
    const img = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    if (layout === 'single') {
      const p = doc.addPage([W, H]);
      p.drawImage(img, { x: 0, y: 0, width: W, height: H });
    } else {
      if (i % per === 0) page = doc.addPage([A4W, A4H]);
      const k = i % per;
      const cx = ox + (k % cols) * (W + gap);
      const cy = A4H - oy - Math.floor(k / cols) * (H + gap) - H;
      page!.drawImage(img, { x: cx, y: cy, width: W, height: H });
      // garis potong tipis
      const cm = 3 * MM, col = rgb(0.6, 0.6, 0.6), t = 0.4;
      for (const [x, y] of [[cx, cy], [cx + W, cy], [cx, cy + H], [cx + W, cy + H]]) {
        const sx = x === cx ? -1 : 1, sy = y === cy ? -1 : 1;
        page!.drawLine({ start: { x: x + sx * 1, y }, end: { x: x + sx * (1 + cm), y }, thickness: t, color: col });
        page!.drawLine({ start: { x, y: y + sy * 1 }, end: { x, y: y + sy * (1 + cm) }, thickness: t, color: col });
      }
    }
  }
  onProgress?.(emps.length, emps.length);
  const bytes = await doc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

// ---------- ZIP ----------
export async function buildZip(
  tpl: HTMLImageElement,
  emps: Employee[],
  s: ExportSettings,
  onProgress?: (i: number, n: number) => void,
) {
  const zip = new JSZip();
  const used = new Set<string>();
  for (let i = 0; i < emps.length; i++) {
    onProgress?.(i, emps.length);
    let name = safeFileName(emps[i], 'png');
    let k = 2;
    while (used.has(name)) name = safeFileName(emps[i], 'png').replace('.png', `_${k++}.png`);
    used.add(name);
    zip.file(name, await cardPng(tpl, emps[i], s));
  }
  onProgress?.(emps.length, emps.length);
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

// ---------- PRINT ----------
export async function printCards(tpl: HTMLImageElement, emps: Employee[], s: ExportSettings, layout: PdfLayout) {
  const size = resolveSize(s);
  const urls: string[] = [];
  const android = isAndroidApp();
  for (const e of emps) {
    const c = await renderToCanvas(tpl, e, size, s.dpi, s.fit);
    // Android: data URL (dicetak oleh WebView terpisah); browser: blob URL
    urls.push(android ? c.toDataURL('image/jpeg', 0.95) : URL.createObjectURL(await toBlob(c, 'image/png')));
  }
  const w = size.wMm, h = size.hMm;
  const css =
    layout === 'single'
      ? `@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0}img{display:block;width:${w}mm;height:${h}mm;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}`
      : `@page{size:A4 portrait;margin:10mm}html,body{margin:0}.g{display:flex;flex-wrap:wrap;gap:4mm;justify-content:center}img{display:block;width:${w}mm;height:${h}mm;outline:0.2mm dashed #bbb;break-inside:avoid}`;
  const body =
    layout === 'single' ? urls.map((u) => `<img src="${u}">`).join('') : `<div class="g">${urls.map((u) => `<img src="${u}">`).join('')}</div>`;
  const doc = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Print ID Card</title><style>${css}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${body}</body></html>`;
  if (android) {
    window.AndroidBridge!.printHtml(doc, `IDCard_${emps.length}_kartu`);
    return;
  }
  const ifr = document.createElement('iframe');
  ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(ifr);
  const d = ifr.contentDocument!;
  d.open();
  d.write(doc);
  d.close();
  await Promise.all(
    Array.from(d.images).map((im) => (im.complete ? Promise.resolve() : new Promise((r) => ((im.onload = r), (im.onerror = r))))),
  );
  ifr.contentWindow!.focus();
  ifr.contentWindow!.print();
  setTimeout(() => {
    ifr.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
  }, 60000);
}
