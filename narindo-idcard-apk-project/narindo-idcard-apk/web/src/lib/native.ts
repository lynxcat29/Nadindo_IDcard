/**
 * Jembatan ke aplikasi Android (WebView). Di browser biasa objek ini tidak ada,
 * sehingga aplikasi otomatis memakai cara download / print bawaan browser.
 */
interface AndroidBridgeApi {
  saveStart(name: string, mime: string): string;
  saveChunk(id: string, base64: string): void;
  saveEnd(id: string, share: boolean): string; // mengembalikan pesan / lokasi file
  printHtml(html: string, jobName: string): void;
  getDeviceName?(): string;
  appVersion?(): string;
}

declare global {
  interface Window {
    AndroidBridge?: AndroidBridgeApi;
  }
}

export const isAndroidApp = () => typeof window !== 'undefined' && !!window.AndroidBridge;

export function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(new Error('Gagal membaca file'));
    r.readAsDataURL(b);
  });
}

/** Simpan blob ke folder Download HP (dikirim bertahap agar file besar/ZIP tetap aman). */
export async function nativeSave(blob: Blob, name: string, share = false): Promise<string> {
  const br = window.AndroidBridge!;
  const id = br.saveStart(name, blob.type || 'application/octet-stream');
  const CHUNK = 768 * 1024; // kelipatan 3 byte → base64 per potongan tetap valid
  for (let off = 0; off < blob.size; off += CHUNK) {
    br.saveChunk(id, await blobToBase64(blob.slice(off, off + CHUNK)));
  }
  return br.saveEnd(id, share);
}

export function deviceName() {
  try {
    if (window.AndroidBridge?.getDeviceName) return 'APK · ' + window.AndroidBridge.getDeviceName();
  } catch {
    /* abaikan */
  }
  const ua = navigator.userAgent;
  const m = ua.match(/\(([^)]+)\)/);
  return 'Web · ' + (m ? m[1].split(';').slice(0, 2).join(' ').trim() : 'browser');
}
