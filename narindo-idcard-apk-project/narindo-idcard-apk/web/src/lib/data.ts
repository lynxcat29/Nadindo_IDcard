import JSZip from 'jszip';
import type { Employee } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---------------- CSV ----------------
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// ---------------- XLSX (pembaca ringan, tanpa server) ----------------
const colIndex = (ref: string) => {
  const m = ref.match(/^[A-Z]+/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error('File Excel tidak valid. Simpan sebagai .xlsx (bukan .xls lama) atau gunakan CSV.');
  }
  const dp = new DOMParser();
  const xml = async (p: string) => {
    const f = zip.file(p);
    return f ? dp.parseFromString(await f.async('text'), 'application/xml') : null;
  };
  const wb = await xml('xl/workbook.xml');
  const rels = await xml('xl/_rels/workbook.xml.rels');
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const firstSheet = wb?.getElementsByTagName('sheet')[0];
  const rid = firstSheet?.getAttribute('r:id') || firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  if (rid && rels) {
    for (const r of Array.from(rels.getElementsByTagName('Relationship'))) {
      if (r.getAttribute('Id') === rid) {
        const t = r.getAttribute('Target') || '';
        sheetPath = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      }
    }
  }
  const ssDoc = await xml('xl/sharedStrings.xml');
  const shared: string[] = ssDoc
    ? Array.from(ssDoc.getElementsByTagName('si')).map((si) =>
        Array.from(si.getElementsByTagName('t')).map((t) => t.textContent || '').join(''),
      )
    : [];
  const sh = await xml(sheetPath);
  if (!sh) throw new Error('Sheet pertama tidak ditemukan di file Excel.');
  const out: string[][] = [];
  for (const r of Array.from(sh.getElementsByTagName('row'))) {
    const line: string[] = [];
    let auto = 0;
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r');
      const ci = ref ? colIndex(ref) : auto;
      auto = ci + 1;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let val = '';
      if (t === 's') val = shared[+v] ?? '';
      else if (t === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent || '').join('');
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else val = v;
      line[ci] = val;
    }
    out.push(Array.from(line, (x) => x ?? ''));
  }
  return out.filter((r) => r.some((c) => String(c).trim()));
}

// ---------------- Mapping kolom ----------------
export function rowsToEmployees(rows: string[][]): { list: Employee[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!rows.length) throw new Error('File kosong.');
  const head = rows[0].map((h) => String(h).toLowerCase().trim());
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  let iNo = find(/^(no|no\.|nomor|id|nik|id karyawan)$/);
  let iNama = find(/nama|name/);
  let iJab = find(/jabatan|posisi|position|title/);
  let iWok = find(/wok|lokasi|location|wilayah/);
  let iFoto = find(/foto|photo|file|gambar/);
  let start = 1;
  if (iNama < 0) {
    // tanpa header: asumsikan urutan No, Nama, Jabatan, WOK, Foto
    [iNo, iNama, iJab, iWok, iFoto] = [0, 1, 2, 3, 4];
    start = 0;
    warnings.push('Header tidak dikenali, memakai urutan kolom: No, Nama, Jabatan, WOK, Foto.');
  }
  const get = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const list: Employee[] = [];
  rows.slice(start).forEach((r, k) => {
    const name = get(r, iNama);
    if (!name) {
      warnings.push(`Baris ${k + start + 1} dilewati (nama kosong).`);
      return;
    }
    list.push({
      id: uid(),
      no: get(r, iNo) || String(list.length + 1),
      name,
      title: get(r, iJab),
      wok: get(r, iWok),
      photoFile: get(r, iFoto) || undefined,
    });
  });
  return { list, warnings };
}

export async function readEmployeeFile(f: File) {
  const ext = f.name.split('.').pop()?.toLowerCase();
  if (ext === 'csv' || ext === 'txt') return rowsToEmployees(parseCsv(await f.text()));
  if (ext === 'xlsx' || ext === 'xlsm') return rowsToEmployees(await parseXlsx(await f.arrayBuffer()));
  if (ext === 'xls') throw new Error('Format .xls lama belum didukung. Buka di Excel lalu "Save As" .xlsx atau CSV.');
  throw new Error('Gunakan file .xlsx atau .csv');
}

// ---------------- Pencocokan foto ----------------
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');

export function matchPhoto(emp: Employee, files: File[]): File | undefined {
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const bySlug = new Map(files.map((f) => [slug(f.name), f]));
  if (emp.photoFile) {
    const hit = byName.get(emp.photoFile.toLowerCase()) || bySlug.get(slug(emp.photoFile));
    if (hit) return hit;
  }
  if (emp.no && bySlug.get(slug(emp.no))) return bySlug.get(slug(emp.no));
  const ns = slug(emp.name);
  if (ns && bySlug.get(ns)) return bySlug.get(ns);
  // nama file diawali ID, mis. "001_riki.jpg" atau "riki hasbullah (1).jpg"
  return files.find((f) => {
    const s = slug(f.name);
    return (ns && s.startsWith(ns)) || (emp.no && f.name.toLowerCase().split(/[_\-\s.]/)[0] === emp.no.toLowerCase());
  });
}

// ---------------- Template & export data ----------------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function buildXlsx(rows: string[][]): Promise<Blob> {
  const zip = new JSZip();
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetRows = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">${r
          .map((v, ci) => `<c r="${col(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t>${esc(v)}</t></is></c>`)
          .join('')}</row>`,
    )
    .join('');
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Karyawan" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE4002B"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`,
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="6" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/><col min="3" max="3" width="26" customWidth="1"/><col min="4" max="4" width="16" customWidth="1"/><col min="5" max="5" width="18" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export const TEMPLATE_ROWS = [
  ['No', 'Nama', 'Jabatan', 'WOK', 'Foto'],
  ['1', 'Riki Hasbullah', 'PIC TAP BERAU', 'Berau', 'foto1.png'],
  ['2', 'Karyawan 2', 'Direct Sales', 'Bulungan', 'foto2.png'],
  ['3', 'Karyawan 3', 'Indirect Sales', 'Talisayan', 'foto3.png'],
];

export function employeesToCsv(list: Employee[]) {
  const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [['No', 'Nama', 'Jabatan', 'WOK', 'Foto'], ...list.map((e) => [e.no, e.name, e.title, e.wok, e.photo?.name || e.photoFile || ''])];
  return '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
}
