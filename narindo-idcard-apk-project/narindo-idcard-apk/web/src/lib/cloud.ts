import { blobToBase64, deviceName } from './native';
import { cardJpg, cardPng, resolveSize, safeFileName } from './exporters';
import { loadImg } from './render';
import type { Employee, ExportSettings } from './types';

export interface CloudConfig {
  url: string;
  key: string;
  format: 'png' | 'jpg';
  sendPhoto: boolean;
  autoSave: boolean;
}

export interface CloudInfo {
  ok: boolean;
  sheetUrl?: string;
  folderUrl?: string;
  rows?: number;
  owner?: string;
  error?: string;
}

export interface CloudResult {
  ok: boolean;
  status?: string;
  url?: string;
  row?: number;
  error?: string;
}

const LS = 'narindo-idcard-cloud';
export const DEFAULT_CLOUD: CloudConfig = { url: '', key: 'narindo-berau', format: 'png', sendPhoto: true, autoSave: false };

export function loadCloudConfig(): CloudConfig {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) return { ...DEFAULT_CLOUD, ...JSON.parse(raw) };
  } catch {
    /* storage tidak tersedia */
  }
  return { ...DEFAULT_CLOUD };
}
export function saveCloudConfig(c: CloudConfig) {
  try {
    localStorage.setItem(LS, JSON.stringify(c));
  } catch {
    /* abaikan */
  }
}

export function validateUrl(u: string): string | null {
  const s = u.trim();
  if (!s) return 'URL Web App belum diisi.';
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec(\?.*)?$/.test(s))
    return 'URL harus berupa Web App Apps Script yang berakhiran /exec.';
  return null;
}

async function readJson(r: Response) {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    if (/<html/i.test(t)) throw new Error('Server mengembalikan halaman HTML. Pastikan deploy "Who has access: Anyone" dan URL berakhiran /exec.');
    throw new Error('Respon server tidak valid.');
  }
}

export async function testConnection(c: CloudConfig): Promise<CloudInfo> {
  const err = validateUrl(c.url);
  if (err) return { ok: false, error: err };
  try {
    const u = c.url.trim() + (c.url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(c.key) + '&t=' + Date.now();
    const r = await fetch(u, { method: 'GET', redirect: 'follow' });
    return await readJson(r);
  } catch (e) {
    return { ok: false, error: (e as Error).message === 'Failed to fetch' ? 'Tidak dapat terhubung. Cek internet & URL Web App.' : (e as Error).message };
  }
}

/** JPEG ringan dari foto asli (maks 1600px) untuk arsip di Drive. */
async function originalPhoto(emp: Employee) {
  if (!emp.photo) return null;
  const im = await loadImg(emp.photo.url);
  const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * k);
  c.height = Math.round(im.naturalHeight * k);
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(im, 0, 0, c.width, c.height);
  const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
  return b;
}

export async function uploadCard(tpl: HTMLImageElement, emp: Employee, s: ExportSettings, c: CloudConfig): Promise<CloudResult> {
  const err = validateUrl(c.url);
  if (err) return { ok: false, error: err };
  const blob = c.format === 'jpg' ? await cardJpg(tpl, emp, s) : await cardPng(tpl, emp, s);
  const size = resolveSize(s);
  const item: Record<string, unknown> = {
    no: emp.no,
    name: emp.name.trim(),
    title: emp.title.trim(),
    wok: emp.wok.trim(),
    fileName: safeFileName(emp, c.format),
    mime: blob.type,
    file: await blobToBase64(blob),
    size: `${size.wMm}×${size.hMm} mm @${s.dpi} DPI`,
    device: deviceName(),
  };
  if (c.sendPhoto && emp.photo) {
    const pb = await originalPhoto(emp);
    if (pb) {
      item.photo = await blobToBase64(pb);
      item.photoMime = 'image/jpeg';
      item.photoName = safeFileName(emp, 'jpg').replace('IDCard_', 'Foto_');
    }
  }
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(c.url.trim(), {
        method: 'POST',
        // text/plain = "simple request" → tidak butuh preflight CORS di Apps Script
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'save', key: c.key, item }),
        redirect: 'follow',
      });
      const j = (await readJson(r)) as CloudResult;
      if (j.ok || /api key|tidak lengkap|tidak dikenal/i.test(j.error || '')) return j;
      lastErr = j.error || 'Gagal menyimpan.';
    } catch (e) {
      lastErr = (e as Error).message === 'Failed to fetch' ? 'Koneksi terputus.' : (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }
  return { ok: false, error: lastErr };
}
