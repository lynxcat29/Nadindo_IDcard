import { autoFit, loadImg } from './render';
import type { PhotoData } from './types';

export const ACCEPT_IMG = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_MB = 25;
const MAX_SIDE = 2600;

export function validateImageFile(f: File): string | null {
  const ext = f.name.split('.').pop()?.toLowerCase() || '';
  if (!OK_TYPES.includes(f.type) && !['jpg', 'jpeg', 'png', 'webp'].includes(ext))
    return `Format "${f.name}" tidak didukung. Gunakan JPG, JPEG, PNG, atau WebP.`;
  if (f.size > MAX_MB * 1024 * 1024) return `Ukuran "${f.name}" melebihi ${MAX_MB} MB.`;
  return null;
}

function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', q?: number) {
  return new Promise<Blob>((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('Gagal membuat gambar'))), type, q),
  );
}

/** Muat foto, perkecil bila terlalu besar (tetap proporsional), kembalikan PhotoData siap pakai. */
export async function photoFromFile(f: File): Promise<PhotoData> {
  const err = validateImageFile(f);
  if (err) throw new Error(err);
  const raw = URL.createObjectURL(f);
  let img: HTMLImageElement;
  try {
    img = await loadImg(raw);
  } catch {
    URL.revokeObjectURL(raw);
    throw new Error(`File "${f.name}" rusak atau bukan gambar.`);
  }
  let url = raw;
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (Math.max(w, h) > MAX_SIDE) {
    const k = MAX_SIDE / Math.max(w, h);
    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const x = c.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    const isPng = f.type === 'image/png' || f.type === 'image/webp';
    const b = await canvasToBlob(c, isPng ? 'image/png' : 'image/jpeg', 0.95);
    url = URL.createObjectURL(b);
    URL.revokeObjectURL(raw);
    await loadImg(url);
    w = c.width;
    h = c.height;
  }
  return { url, name: f.name, w, h, useCutout: false, ...autoFit(w, h) };
}

/**
 * Hapus background polos/seragam secara lokal (tanpa internet).
 * Flood-fill dari tepi foto berdasarkan kemiripan warna, lalu tepi dihaluskan.
 */
export async function removePlainBackground(p: PhotoData, tolerance = 38): Promise<string> {
  const img = await loadImg(p.url);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  const id = x.getImageData(0, 0, w, h);
  const d = id.data;
  // warna background = median piksel tepi
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const push = (i: number) => {
    rs.push(d[i]);
    gs.push(d[i + 1]);
    bs.push(d[i + 2]);
  };
  for (let X = 0; X < w; X += 2) {
    push(X * 4);
    push(((h - 1) * w + X) * 4);
  }
  for (let Y = 0; Y < h; Y += 2) {
    push(Y * w * 4);
    push((Y * w + w - 1) * 4);
  }
  const med = (a: number[]) => a.sort((m, n) => m - n)[a.length >> 1];
  const br = med(rs), bg = med(gs), bb = med(bs);
  const tol2 = tolerance * tolerance * 3;
  const dist = (i: number) => {
    const dr = d[i] - br, dg = d[i + 1] - bg, db = d[i + 2] - bb;
    return dr * dr + dg * dg + db * db;
  };
  const mask = new Uint8Array(w * h); // 1 = background
  const stack = new Int32Array(w * h);
  let sp = 0;
  const seed = (p0: number) => {
    if (!mask[p0] && dist(p0 * 4) < tol2) {
      mask[p0] = 1;
      stack[sp++] = p0;
    }
  };
  for (let X = 0; X < w; X++) {
    seed(X);
    seed((h - 1) * w + X);
  }
  for (let Y = 0; Y < h; Y++) {
    seed(Y * w);
    seed(Y * w + w - 1);
  }
  while (sp > 0) {
    const p0 = stack[--sp];
    const X = p0 % w;
    const Y = (p0 / w) | 0;
    if (X > 0) seed(p0 - 1);
    if (X < w - 1) seed(p0 + 1);
    if (Y > 0) seed(p0 - w);
    if (Y < h - 1) seed(p0 + w);
  }
  let bgCount = 0;
  for (let i = 0; i < mask.length; i++) bgCount += mask[i];
  if (bgCount < w * h * 0.03)
    throw new Error('Background tidak terdeteksi sebagai warna polos. Coba naikkan toleransi atau gunakan Hapus Background AI.');
  // alpha + feather (box blur 2 lintasan)
  const a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = mask[i] ? 0 : 1;
  const rad = Math.max(1, Math.round(Math.min(w, h) / 600));
  const tmp = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    for (let Y = 0; Y < h; Y++) {
      let s = 0;
      for (let X = -rad; X <= rad; X++) s += a[Y * w + Math.min(w - 1, Math.max(0, X))];
      for (let X = 0; X < w; X++) {
        tmp[Y * w + X] = s / (2 * rad + 1);
        s += a[Y * w + Math.min(w - 1, X + rad + 1)] - a[Y * w + Math.max(0, X - rad)];
      }
    }
    for (let X = 0; X < w; X++) {
      let s = 0;
      for (let Y = -rad; Y <= rad; Y++) s += tmp[Math.min(h - 1, Math.max(0, Y)) * w + X];
      for (let Y = 0; Y < h; Y++) {
        a[Y * w + X] = s / (2 * rad + 1);
        s += tmp[Math.min(h - 1, Y + rad + 1) * w + X] - tmp[Math.max(0, Y - rad) * w + X];
      }
    }
  }
  for (let i = 0; i < a.length; i++) d[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, (a[i] - 0.45) / 0.45)) * d[i * 4 + 3]); // defringe: tepi sedikit dikikis
  x.putImageData(id, 0, 0);
  const blob = await canvasToBlob(c, 'image/png');
  const url = URL.createObjectURL(blob);
  await loadImg(url);
  return url;
}

/**
 * Hapus background dengan AI (@imgly/background-removal).
 * Butuh internet saat pertama dipakai (memuat model ±40 MB), foto TETAP diproses di browser.
 */
const AI_LIB = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/+esm';
export async function removeBackgroundAI(p: PhotoData, onProgress?: (msg: string) => void): Promise<string> {
  if (!navigator.onLine) throw new Error('Hapus background AI membutuhkan koneksi internet.');
  onProgress?.('Memuat model AI…');
  let mod: { removeBackground: (src: Blob | string, cfg?: unknown) => Promise<Blob> };
  try {
    mod = await import(/* @vite-ignore */ AI_LIB);
  } catch {
    throw new Error('Library AI tidak dapat dimuat (cek internet / firewall). Gunakan "Hapus background polos".');
  }
  const src = await fetch(p.url).then((r) => r.blob());
  const blob = await mod.removeBackground(src, {
    progress: (key: string, cur: number, total: number) => {
      if (total) onProgress?.(`${key.includes('fetch') ? 'Mengunduh model' : 'Memproses'} ${Math.round((cur / total) * 100)}%`);
    },
  });
  const url = URL.createObjectURL(blob);
  const im = await loadImg(url);
  // pastikan ukuran sama dengan foto asli agar posisi tetap konsisten
  if (im.naturalWidth !== p.w || im.naturalHeight !== p.h) {
    const c = document.createElement('canvas');
    c.width = p.w;
    c.height = p.h;
    c.getContext('2d')!.drawImage(im, 0, 0, p.w, p.h);
    const b2 = await canvasToBlob(c);
    const u2 = URL.createObjectURL(b2);
    await loadImg(u2);
    return u2;
  }
  return url;
}
