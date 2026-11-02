import type { Employee, PhotoData } from './types';

/**
 * Semua koordinat diukur langsung dari gambar referensi (2121 × 3000 px)
 * lalu dinormalisasi, sehingga tetap presisi pada resolusi berapa pun.
 */
export const REF_W = 2121;
export const REF_H = 3000;

export const L = {
  textColor: '#353432',
  centerX: 1060,
  // Bingkai foto: kotak + lengkung bawah (lingkaran) persis seperti potongan baju di template
  photo: {
    x0: 558,
    x1: 1567,
    top: 820, // foto dengan background
    topCutout: 430, // foto tanpa background (boleh lebih tinggi, rambut tidak terpotong)
    radius: 46,
    cx: 1060,
    cy: 1061,
    r: 689,
    bottom: 1750,
  },
  name: { capTop: 1899, size: 92, min1: 66, min2: 58, maxW: 1420, lineGap: 1.12 },
  title: { gap: 55, size: 77, min1: 58, min2: 50, maxW: 1440, lineGap: 1.22 },
  wok: { inkLeft: 320, labelBase: 2509, labelSize: 74, locBase: 2595, locSize: 73, locMin: 34, maxW: 760 },
};

export const FONT = 'Poppins, "Segoe UI", Arial, sans-serif';

const imgCache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

export function loadImg(url: string): Promise<HTMLImageElement> {
  const c = imgCache.get(url);
  if (c) return Promise.resolve(c);
  const p = pending.get(url);
  if (p) return p;
  const pr = new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => {
      imgCache.set(url, im);
      pending.delete(url);
      res(im);
    };
    im.onerror = () => {
      pending.delete(url);
      rej(new Error('Gambar gagal dimuat'));
    };
    im.src = url;
  });
  pending.set(url, pr);
  return pr;
}

export function getCachedImg(url?: string) {
  return url ? imgCache.get(url) : undefined;
}

/** Pastikan foto karyawan (asli / cutout) sudah dimuat sebelum render. */
export async function ensurePhotoLoaded(p?: PhotoData) {
  if (!p) return;
  await loadImg(p.useCutout && p.cutoutUrl ? p.cutoutUrl : p.url);
}

export function designSize(tpl: HTMLImageElement) {
  const W = REF_W;
  const H = Math.round((REF_W * tpl.naturalHeight) / tpl.naturalWidth);
  return { W, H, ky: H / REF_H };
}

export function photoFramePath(ctx: CanvasRenderingContext2D, cutout: boolean, ky = 1) {
  const P = L.photo;
  const top = (cutout ? P.topCutout : P.top) * ky;
  const rad = cutout ? 0 : P.radius;
  const cy = P.cy * ky;
  const yAt = (x: number) => cy + Math.sqrt(P.r * P.r - (x - P.cx) ** 2);
  const a1 = Math.atan2(yAt(P.x1) - cy, P.x1 - P.cx);
  const a0 = Math.atan2(yAt(P.x0) - cy, P.x0 - P.cx);
  ctx.beginPath();
  ctx.moveTo(P.x0, top + rad);
  if (rad) ctx.arcTo(P.x0, top, P.x0 + rad, top, rad);
  ctx.lineTo(P.x1 - rad, top);
  if (rad) ctx.arcTo(P.x1, top, P.x1, top + rad, rad);
  ctx.lineTo(P.x1, yAt(P.x1));
  ctx.arc(P.cx, cy, P.r, a1, a0, false);
  ctx.closePath();
}

/** Skala dasar: foto menutupi kotak bingkai (tanpa distorsi). */
export function baseScale(iw: number, ih: number, ky = 1) {
  const P = L.photo;
  const bw = P.x1 - P.x0;
  const bh = (P.bottom - P.top) * ky;
  return Math.max(bw / iw, bh / ih);
}

/** Posisi otomatis: kepala tidak terpotong (anchor ke bagian atas foto). */
export function autoFit(iw: number, ih: number, ky = 1): Pick<PhotoData, 'zoom' | 'offX' | 'offY' | 'rot'> {
  const P = L.photo;
  const s = baseScale(iw, ih, ky);
  const bh = (P.bottom - P.top) * ky;
  const over = ih * s - bh;
  return { zoom: 1, offX: 0, offY: over > 0 ? Math.round(over * 0.42) : 0, rot: 0 };
}

function drawPhoto(ctx: CanvasRenderingContext2D, p: PhotoData, ky: number) {
  const cut = !!(p.useCutout && p.cutoutUrl);
  const img = getCachedImg(cut ? p.cutoutUrl : p.url);
  if (!img) return;
  const P = L.photo;
  const s = baseScale(img.naturalWidth, img.naturalHeight, ky) * p.zoom;
  const cx = (P.x0 + P.x1) / 2 + p.offX;
  const cy = ((P.top + P.bottom) / 2) * ky + p.offY;
  ctx.save();
  photoFramePath(ctx, cut, ky);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate((p.rot * Math.PI) / 180);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, ky: number) {
  const P = L.photo;
  ctx.save();
  photoFramePath(ctx, false, ky);
  ctx.fillStyle = 'rgba(30,41,59,0.05)';
  ctx.fill();
  ctx.setLineDash([18, 14]);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(30,41,59,0.25)';
  ctx.stroke();
  ctx.clip();
  ctx.fillStyle = 'rgba(30,41,59,0.14)';
  const cx = P.cx;
  ctx.beginPath();
  ctx.arc(cx, 1170 * ky, 150, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, 1720 * ky, 380, 320, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = 'rgba(30,41,59,0.45)';
  ctx.font = `500 52px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('Unggah foto karyawan', cx, 930 * ky);
  ctx.restore();
}

interface Fit {
  size: number;
  lines: string[];
}

function measure(ctx: CanvasRenderingContext2D, t: string, weight: number, size: number) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  return ctx.measureText(t).width;
}

/** Ukuran font otomatis: 1 baris → mengecil → maksimal 2 baris. */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  maxSize: number,
  min1: number,
  min2: number,
  maxW: number,
  allowTwo = true,
): Fit {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return { size: maxSize, lines: [] };
  const w = measure(ctx, t, weight, maxSize);
  const s1 = Math.min(maxSize, (maxSize * maxW) / w);
  if (s1 >= min1 || !allowTwo || !t.includes(' ')) {
    return { size: Math.max(Math.min(s1, maxSize), 8), lines: [t] };
  }
  const words = t.split(' ');
  let best: string[] = [t];
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const mw = Math.max(measure(ctx, a, weight, maxSize), measure(ctx, b, weight, maxSize));
    if (mw < bestW) {
      bestW = mw;
      best = [a, b];
    }
  }
  const s2 = Math.min(maxSize, (maxSize * maxW) / bestW);
  // 2 baris; bila kata sangat panjang font tetap mengecil agar tidak keluar area
  return { size: Math.max(Math.min(s2, maxSize * 0.85), 8), lines: best };
}

export interface RenderOpts {
  showPlaceholder?: boolean;
  safeInset?: number | null; // dalam px desain
  showFrame?: boolean;
}

export function renderCard(
  ctx: CanvasRenderingContext2D,
  tpl: HTMLImageElement,
  emp: Employee,
  opts: RenderOpts = {},
) {
  const { W, H, ky } = designSize(tpl);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tpl, 0, 0, W, H);

  if (emp.photo) drawPhoto(ctx, emp.photo, ky);
  else if (opts.showPlaceholder) drawPlaceholder(ctx, ky);

  ctx.fillStyle = L.textColor;
  ctx.textBaseline = 'alphabetic';

  const up = (s: string) => (emp.uppercase ? s.toLocaleUpperCase('id-ID') : s);

  // ---- NAMA ----
  const N = L.name;
  const nf = fitText(ctx, up(emp.name), 700, N.size, N.min1, N.min2, N.maxW);
  ctx.textAlign = 'center';
  ctx.font = `700 ${nf.size}px ${FONT}`;
  let base = N.capTop * ky + nf.size * 0.705;
  nf.lines.forEach((ln, i) => {
    if (i > 0) base += nf.size * N.lineGap;
    ctx.fillText(ln, L.centerX, base);
  });
  if (!nf.lines.length) base = N.capTop * ky + N.size * 0.705;

  // ---- JABATAN ----
  const T = L.title;
  const tf = fitText(ctx, up(emp.title), 300, T.size, T.min1, T.min2, T.maxW);
  ctx.font = `300 ${tf.size}px ${FONT}`;
  let tb = base + T.gap + tf.size * 0.7;
  tf.lines.forEach((ln, i) => {
    if (i > 0) tb += tf.size * T.lineGap;
    ctx.fillText(ln, L.centerX, tb);
  });

  // ---- WOK ----
  const K = L.wok;
  ctx.textAlign = 'left';
  ctx.font = `300 ${K.labelSize}px ${FONT}`;
  const lm = ctx.measureText('WOK');
  ctx.fillText('WOK', K.inkLeft + lm.actualBoundingBoxLeft, K.labelBase * ky);
  const loc = up(emp.wok || '').trim();
  if (loc) {
    const lf = fitText(ctx, loc, 700, K.locSize, K.locMin, K.locMin, K.maxW, false);
    ctx.font = `700 ${lf.size}px ${FONT}`;
    const m = ctx.measureText(loc);
    ctx.fillText(loc, K.inkLeft + m.actualBoundingBoxLeft, K.locBase * ky);
  }

  // ---- PANDUAN (hanya preview) ----
  if (opts.showFrame) {
    ctx.save();
    photoFramePath(ctx, !!(emp.photo?.useCutout && emp.photo.cutoutUrl), ky);
    ctx.setLineDash([16, 12]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(37,99,235,0.8)';
    ctx.stroke();
    ctx.restore();
  }
  if (opts.safeInset && opts.safeInset > 0) {
    const s = opts.safeInset;
    ctx.save();
    ctx.setLineDash([22, 14]);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(228,0,43,0.85)';
    ctx.strokeRect(s, s, W - 2 * s, H - 2 * s);
    ctx.fillStyle = 'rgba(228,0,43,0.9)';
    ctx.font = `600 34px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('Batas aman cetak', s + 14, s + 44);
    ctx.restore();
  }
  ctx.restore();
}
