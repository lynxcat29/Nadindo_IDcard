# Narindo ID Card Generator

Aplikasi web (React + TypeScript + Tailwind CSS + Canvas) untuk membuat ID Card karyawan
Narindo × Telkomsel dari template resmi. Semua data & foto diproses **lokal di browser**.

## Cara pakai tercepat (tanpa instalasi)
Buka `narindo-idcard-generator.html` di Chrome / Edge (laptop atau HP). Selesai.

## Menjalankan dari source
```bash
npm install
npm run dev        # mode pengembangan  -> http://localhost:5173
npm run build      # hasil: dist/index.html (satu file mandiri)
```

## Struktur
| File | Isi |
|---|---|
| `src/lib/render.ts` | Koordinat layout (diukur dari template 2121×3000 px) & fungsi `renderCard` — dipakai preview **dan** export, jadi hasilnya identik |
| `src/lib/photo.ts` | Upload foto, auto-fit, hapus background polos (offline) & AI (online, opsional) |
| `src/lib/exporters.ts` | PNG/JPG (metadata DPI), PDF (pdf-lib), ZIP (JSZip), Print |
| `src/lib/data.ts` | Import Excel (.xlsx) / CSV, template Excel, pencocokan foto massal |
| `src/App.tsx` | Dashboard: form, kontrol foto, preview, generator massal |
| `src/assets/template-narindo.jpg` | Template bersih (foto, Nama, Jabatan, WOK dihapus; pola jaringan direkonstruksi) |
| `tools/clean_template.py` | Skrip OpenCV yang membersihkan template asli |

## Format Excel/CSV
Kolom: `No | Nama | Jabatan | WOK | Foto`  (unduh contoh lewat tombol **Template Excel**).
Foto massal dicocokkan otomatis berdasarkan: nama file di kolom Foto → No/ID → nama karyawan.

## Ukuran cetak
- Rasio asli template (1 : 1,414) — 54 × 76,4 mm, A7, A6
- CR80 portrait 53,98 × 85,60 mm & Custom — rasio berbeda, pilih *Fit* (margin putih) atau *Crop tepi*; template tidak pernah didistorsi.
