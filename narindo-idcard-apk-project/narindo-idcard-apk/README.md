# Narindo ID Card — APK Android + Google Drive & Spreadsheet

Aplikasi Android untuk membuat ID Card karyawan Narindo × Telkomsel. Setiap kartu bisa langsung
disimpan ke **Google Drive** (file PNG/JPG per WOK) dan dicatat di **Google Spreadsheet**.

```
HP (APK)  ──►  Google Apps Script (Web App milik Anda)  ──►  Drive: ID Card Narindo/<WOK>/IDCard_*.png
                                                         └►  Sheet: Database ID Card Narindo
```

Isi folder:

| Folder / file | Fungsi |
|---|---|
| `apps-script/Code.gs` | Backend: simpan file ke Drive + catat di Spreadsheet |
| `app/` | Proyek Android (WebView + kamera + simpan ke Download + print + bagikan) |
| `app/src/main/assets/www/index.html` | Aplikasi ID Card (hasil build dari folder `web/`) |
| `.github/workflows/build-apk.yml` | Build APK otomatis di GitHub (tanpa install Android Studio) |
| `web/` | Source code React + TypeScript (untuk pengembangan) |

---

## LANGKAH 1 — Pasang backend Google Drive & Spreadsheet (±5 menit)

1. Buka **https://script.google.com** (login akun Google yang akan menyimpan data) → **New project**.
2. Hapus isi `Code.gs`, lalu tempel seluruh isi file **`apps-script/Code.gs`**. Klik 💾 Save.
3. (Disarankan) ganti `API_KEY: 'narindo-berau'` dengan kata sandi Anda sendiri.
4. Di toolbar pilih fungsi **`setup`** → **Run** → *Review permissions* → pilih akun → *Advanced* → *Go to project* → **Allow**.
   Di *Execution log* muncul link Spreadsheet & Folder Drive yang baru dibuat.
5. **Deploy → New deployment** → ikon ⚙ → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   → **Deploy** → salin **Web app URL** (berakhiran `/exec`).

> Jika `Code.gs` diubah kemudian: **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy** (URL tetap sama).

Pengaturan di bagian atas `Code.gs`:

| Opsi | Default | Keterangan |
|---|---|---|
| `SUBFOLDER_PER_WOK` | `true` | File dipisah per WOK (Berau, Bulungan, …) |
| `SAVE_ORIGINAL_PHOTO` | `true` | Foto asli karyawan ikut diarsipkan (subfolder *Foto Asli*) |
| `SHARE_WITH_LINK` | `false` | `true` = file bisa dibuka siapa pun yang punya link + kolom *Preview* menampilkan gambar |
| `SPREADSHEET_ID` / `FOLDER_ID` | kosong | Isi bila ingin memakai spreadsheet/folder yang sudah ada |

Kolom spreadsheet: `Timestamp | No | Nama | Jabatan | WOK | Nama File | Link ID Card | Preview | Link Foto Asli | Ukuran | Status | File ID | Foto ID | Dikirim dari`.
Menyimpan ulang karyawan dengan No + Nama yang sama akan **memperbarui baris** dan memindahkan file lama ke Sampah (tidak dobel).

---

## LANGKAH 2 — Buat file APK

### Opsi A: lewat GitHub (gratis, tanpa install apa pun) ✅ disarankan

1. Buat akun di **https://github.com** (bila belum punya).
2. Klik **New repository** → nama misal `narindo-idcard` → pilih **Private** → *Create repository*.
3. Klik **uploading an existing file** → ekstrak ZIP ini di komputer → seret **semua isi** folder
   (`app`, `gradle`, `web`, `apps-script`, `build.gradle`, `settings.gradle`, `gradle.properties`, `gradlew`, `gradlew.bat`, `README.md`, `.gitignore`) → **Commit changes**.
4. Folder `.github` sering tersembunyi sehingga tidak ikut terunggah. Buat manual:
   **Add file → Create new file** → ketik nama `.github/workflows/build-apk.yml` →
   tempel isi file `build-apk.yml` dari ZIP → **Commit changes**.
5. Buka tab **Actions** → tunggu proses *Build APK Narindo ID Card* bercentang hijau (±5–8 menit).
6. Buka tab **Releases** (kanan halaman repo) → unduh **`NarindoIDCard-1.0-release.apk`**.
   (Atau: Actions → klik build → bagian *Artifacts* → `NarindoIDCard-APK`.)

### Opsi B: Android Studio
*File → Open* → pilih folder ini → tunggu Gradle sync → **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
APK ada di `app/build/outputs/apk/`.

---

## LANGKAH 3 — Install & atur di HP

1. Kirim APK ke HP (WhatsApp / Drive / kabel) → buka → izinkan **Install unknown apps** → Install.
2. Buka **Narindo ID Card** → gulir ke kartu **Google Drive & Spreadsheet**:
   - tempel **URL Web App** dari Langkah 1
   - isi **API Key** sama dengan `API_KEY` di `Code.gs`
   - tekan **Tes koneksi** → muncul *Terhubung* + tombol *Buka Spreadsheet* / *Buka Folder Drive*.
   Pengaturan tersimpan di HP, cukup sekali.
3. Pakai:
   - isi Nama, Jabatan, WOK → **Unggah foto** (bisa langsung **kamera**) → atur posisi foto
   - **Simpan ke Google Drive & Spreadsheet** (tombol hijau)
   - PNG / JPG / PDF tersimpan di **Download/Narindo ID Card** · **Bagikan** ke WhatsApp · **Print** via printer Android
   - Massal: Import Excel → Upload banyak foto → **Upload ke Drive · semua**

---

## Update aplikasi
1. Ubah source di `web/` lalu build (`node build.mjs`) → salin `web/dist/narindo-idcard-generator.html`
   menjadi `app/src/main/assets/www/index.html`.
2. Naikkan `versionCode` (mis. 1 → 2) dan `versionName` di `app/build.gradle`.
3. Commit ke GitHub → APK baru otomatis dibuat. Karena memakai keystore yang sama
   (`app/narindo-release.jks`), APK baru bisa langsung meng-update aplikasi lama.

## Keamanan
- Simpan repo sebagai **Private** (berisi keystore penanda tangan APK, password default `narindo2026`).
  Untuk mengganti: buat keystore baru dengan `keytool` lalu set *Secrets* `KEYSTORE_PASSWORD` & `KEY_PASSWORD` di GitHub.
- Siapa pun yang punya URL Web App + API Key bisa mengirim data. Jangan sebarkan di grup publik; ganti API Key bila bocor
  (ubah di `Code.gs` → deploy *New version* → ubah di aplikasi).

## Masalah umum
| Gejala | Solusi |
|---|---|
| *Server mengembalikan halaman HTML* | Deploy ulang dengan **Who has access: Anyone**; pastikan URL berakhiran `/exec` |
| *API key salah* | Samakan API Key di aplikasi dengan `API_KEY` di `Code.gs` |
| Build GitHub gagal di *Build APK* | Buka log merah → pastikan `gradle/wrapper/gradle-wrapper.jar` ikut terunggah |
| Tidak bisa install | Hapus versi lama bila sebelumnya dibuat dengan keystore berbeda |
| Android 9 ke bawah tidak bisa simpan | Izinkan akses penyimpanan saat diminta, lalu tekan download lagi |
