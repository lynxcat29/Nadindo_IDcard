/**
 * NARINDO ID CARD GENERATOR — Backend Google Apps Script
 * Menyimpan file ID Card ke Google Drive dan mencatat datanya di Google Spreadsheet.
 *
 * CARA PASANG (sekali saja):
 * 1. Buka https://script.google.com → New project → hapus isi Code.gs → tempel file ini.
 * 2. (Opsional) Ubah API_KEY di bawah menjadi kata sandi Anda sendiri.
 * 3. Pilih fungsi "setup" di toolbar → Run → izinkan akses (Review permissions → Allow).
 *    Spreadsheet & folder Drive dibuat otomatis (lihat link di "Execution log").
 * 4. Deploy → New deployment → ⚙ Web app
 *      Execute as : Me
 *      Who has access : Anyone
 *    → Deploy → salin "Web app URL" (berakhiran /exec).
 * 5. Di aplikasi: kartu "Google Drive & Spreadsheet" → tempel URL (+ API key) → Tes koneksi.
 *
 * Jika kode ini diubah: Deploy → Manage deployments → Edit (✎) → Version: New version → Deploy.
 */

const CONFIG = {
  API_KEY: 'narindo-berau',          // samakan dengan isian "API Key" di aplikasi ('' = tanpa kunci)
  FOLDER_NAME: 'ID Card Narindo',     // folder utama di Google Drive
  SPREADSHEET_NAME: 'Database ID Card Narindo',
  SHEET_NAME: 'ID Card',
  SUBFOLDER_PER_WOK: true,            // simpan per WOK: ID Card Narindo/Berau/...
  SHARE_WITH_LINK: false,             // true = file bisa dilihat siapa pun yang punya link (dibutuhkan untuk kolom Preview gambar)
  SAVE_ORIGINAL_PHOTO: true,          // simpan juga foto asli karyawan ke subfolder "Foto Asli"
  // Isi bila ingin memakai spreadsheet/folder yang sudah ada (ID dari URL). Kosongkan = otomatis.
  SPREADSHEET_ID: '',
  FOLDER_ID: '',
};

const HEADERS = ['Timestamp', 'No', 'Nama', 'Jabatan', 'WOK', 'Nama File', 'Link ID Card', 'Preview', 'Link Foto Asli', 'Ukuran', 'Status', 'File ID', 'Foto ID', 'Dikirim dari'];

// ---------------------------------------------------------------- setup
function setup() {
  const ss = getSpreadsheet_();
  const folder = getRootFolder_();
  Logger.log('Spreadsheet : ' + ss.getUrl());
  Logger.log('Folder Drive: ' + folder.getUrl());
  Logger.log('Selanjutnya: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).');
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = CONFIG.SPREADSHEET_ID || props.getProperty('SPREADSHEET_ID');
  let ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(CONFIG.SPREADSHEET_NAME);
    props.setProperty('SPREADSHEET_ID', ss.getId());
    try { DriveApp.getFileById(ss.getId()).moveTo(getRootFolder_()); } catch (e) {}
  }
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) {
    const first = ss.getSheets()[0];
    if (ss.getSheets().length === 1 && first.getLastRow() === 0) { sh = first; sh.setName(CONFIG.SHEET_NAME); }
    else sh = ss.insertSheet(CONFIG.SHEET_NAME);
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setFontColor('#ffffff').setBackground('#EA1D29');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, HEADERS.length, 140);
    sh.setColumnWidth(3, 220);
    sh.setColumnWidth(8, 90);
  }
  return ss;
}

function getRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = CONFIG.FOLDER_ID || props.getProperty('FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {}
  }
  const it = DriveApp.getFoldersByName(CONFIG.FOLDER_NAME);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

function getSubFolder_(parent, name) {
  const clean = String(name || 'Lainnya').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Lainnya';
  const it = parent.getFoldersByName(clean);
  return it.hasNext() ? it.next() : parent.createFolder(clean);
}

// ---------------------------------------------------------------- HTTP
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (CONFIG.API_KEY && p.key !== CONFIG.API_KEY) return json_({ ok: false, error: 'API key salah.' });
    const ss = getSpreadsheet_();
    const sh = ss.getSheetByName(CONFIG.SHEET_NAME);
    return json_({
      ok: true,
      app: 'narindo-idcard',
      version: 2,
      sheetUrl: ss.getUrl(),
      folderUrl: getRootFolder_().getUrl(),
      rows: Math.max(0, sh.getLastRow() - 1),
      owner: Session.getEffectiveUser().getEmail(),
    });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (CONFIG.API_KEY && body.key !== CONFIG.API_KEY) return json_({ ok: false, error: 'API key salah.' });
    if (body.action !== 'save') return json_({ ok: false, error: 'Aksi tidak dikenal.' });
    const it = body.item || {};
    if (!it.name || !it.file) return json_({ ok: false, error: 'Data tidak lengkap (nama/file).' });

    // --- simpan file ID Card ---
    const root = getRootFolder_();
    const folder = CONFIG.SUBFOLDER_PER_WOK ? getSubFolder_(root, it.wok) : root;
    const mime = it.mime || 'image/png';
    const blob = Utilities.newBlob(Utilities.base64Decode(it.file), mime, it.fileName || 'IDCard.png');
    const file = folder.createFile(blob);
    file.setDescription('ID Card ' + it.name + ' — ' + (it.title || '') + ' — WOK ' + (it.wok || ''));
    if (CONFIG.SHARE_WITH_LINK) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    let photoFile = null;
    if (CONFIG.SAVE_ORIGINAL_PHOTO && it.photo) {
      const pf = getSubFolder_(folder, 'Foto Asli');
      photoFile = pf.createFile(Utilities.newBlob(Utilities.base64Decode(it.photo), it.photoMime || 'image/jpeg', it.photoName || ('Foto_' + it.name + '.jpg')));
    }

    // --- catat di spreadsheet (update bila No/Nama sama) ---
    lock.waitLock(30000);
    const sh = getSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME);
    const last = sh.getLastRow();
    let row = -1;
    if (last > 1) {
      const data = sh.getRange(2, 2, last - 1, 4).getValues(); // No, Nama, Jabatan, WOK
      const no = String(it.no || '').trim().toLowerCase();
      const nm = String(it.name).trim().toLowerCase();
      for (let i = data.length - 1; i >= 0; i--) {
        const rNo = String(data[i][0]).trim().toLowerCase();
        const rNm = String(data[i][1]).trim().toLowerCase();
        if (rNm === nm && (!no || !rNo || rNo === no)) { row = i + 2; break; }
      }
    }
    let status = 'Baru';
    if (row > 0) {
      status = 'Diperbarui';
      // file lama dipindah ke sampah agar tidak dobel
      const oldIds = sh.getRange(row, 12, 1, 2).getValues()[0];
      oldIds.forEach(function (id) { if (id) { try { DriveApp.getFileById(String(id)).setTrashed(true); } catch (x) {} } });
    } else {
      row = sh.getLastRow() + 1;
    }
    const url = file.getUrl();
    const preview = CONFIG.SHARE_WITH_LINK ? '=IMAGE("https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400")' : '';
    const values = [[
      new Date(),
      it.no || '',
      it.name,
      it.title || '',
      it.wok || '',
      file.getName(),
      url,
      preview,
      photoFile ? photoFile.getUrl() : '',
      it.size || '',
      status,
      file.getId(),
      photoFile ? photoFile.getId() : '',
      it.device || '',
    ]];
    sh.getRange(row, 1, 1, HEADERS.length).setValues(values);
    sh.getRange(row, 7).setFormula('=HYPERLINK("' + url + '","Lihat ID Card")'); // Apps Script selalu memakai pemisah koma
    if (photoFile) sh.getRange(row, 9).setFormula('=HYPERLINK("' + photoFile.getUrl() + '","Lihat Foto")');
    if (preview) sh.setRowHeight(row, 120);
    SpreadsheetApp.flush();
    return json_({ ok: true, status: status, row: row, fileId: file.getId(), url: url, folderUrl: folder.getUrl() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
