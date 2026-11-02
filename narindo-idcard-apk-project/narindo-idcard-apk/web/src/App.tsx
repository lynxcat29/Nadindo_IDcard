import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import defaultTplUrl from './assets/template-narindo.jpg';
import Preview from './components/Preview';
import { Btn, Card, Field, Icon, Segmented, Slider, Toggle, inputCls } from './components/ui';
import { buildXlsx, employeesToCsv, matchPhoto, readEmployeeFile, TEMPLATE_ROWS, uid } from './lib/data';
import { buildPdf, buildZip, cardJpg, cardPng, downloadBlob, printCards, pxFor, renderToCanvas, resolveSize, safeFileName, SIZES } from './lib/exporters';
import type { PdfLayout } from './lib/exporters';
import { ACCEPT_IMG, photoFromFile, removeBackgroundAI, removePlainBackground, validateImageFile } from './lib/photo';
import { autoFit, designSize, loadImg, REF_H, REF_W } from './lib/render';
import type { Employee, ExportSettings, PhotoData } from './lib/types';
import { loadCloudConfig, saveCloudConfig, testConnection, uploadCard, validateUrl } from './lib/cloud';
import type { CloudConfig, CloudInfo } from './lib/cloud';
import { isAndroidApp } from './lib/native';

const WOK_OPTIONS = ['Berau', 'Bulungan', 'Talisayan', 'Tanjung Selor'];
const blank = (wok = 'Berau'): Employee => ({ id: uid(), no: '', name: '', title: '', wok, uppercase: false });

type Toast = { id: number; kind: 'ok' | 'err' | 'info'; msg: string };

export default function App() {
  // ---------------- state ----------------
  const [tpl, setTpl] = useState<HTMLImageElement | null>(null);
  const [tplCustom, setTplCustom] = useState<string | null>(null);
  const [draft, setDraft] = useState<Employee>(() => blank());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [list, setList] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [gallery, setGallery] = useState<{ id: string; url: string; name: string }[]>([]);
  const [settings, setSettings] = useState<ExportSettings>({ sizeId: 'orig54', customW: 60, customH: 90, fit: 'contain', dpi: 300 });
  const [pdfLayout, setPdfLayout] = useState<PdfLayout>('single');
  const [safeOn, setSafeOn] = useState(false);
  const [safeMm, setSafeMm] = useState(3);
  const [frameOn, setFrameOn] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState<{ label: string; pct?: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tol, setTol] = useState(38);
  const [touched, setTouched] = useState(false);
  const [cloud, setCloud] = useState<CloudConfig>(loadCloudConfig);
  const [cloudInfo, setCloudInfo] = useState<CloudInfo | null>(null);
  const android = isAndroidApp();

  const photoInput = useRef<HTMLInputElement>(null);
  const tplInput = useRef<HTMLInputElement>(null);
  const dataInput = useRef<HTMLInputElement>(null);
  const bulkPhotoInput = useRef<HTMLInputElement>(null);

  const toast = useCallback((kind: Toast['kind'], msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 4000);
  }, []);

  // ---------------- template ----------------
  useEffect(() => {
    loadImg(tplCustom || defaultTplUrl)
      .then(setTpl)
      .catch(() => toast('err', 'Template gagal dimuat.'));
  }, [tplCustom, toast]);

  const onTemplateFile = async (f?: File) => {
    if (!f) return;
    const e = validateImageFile(f);
    if (e) return toast('err', e);
    const url = URL.createObjectURL(f);
    try {
      const im = await loadImg(url);
      const r = im.naturalHeight / im.naturalWidth;
      if (Math.abs(r - REF_H / REF_W) > 0.03)
        toast('info', 'Rasio template berbeda dari referensi. Posisi elemen diskalakan otomatis, cek kembali preview.');
      setTplCustom(url);
      toast('ok', 'Template baru dipakai. Pastikan template sudah bersih dari teks/foto contoh.');
    } catch {
      toast('err', 'File template tidak dapat dibaca.');
    }
  };

  // ---------------- draft <-> list sync ----------------
  useEffect(() => {
    if (!editingId) return;
    setList((l) => l.map((e) => (e.id === editingId ? { ...draft, id: editingId } : e)));
  }, [draft, editingId]);

  const patch = (p: Partial<Employee>) => setDraft((d) => ({ ...d, ...p }));
  const patchPhoto = useCallback((p: Partial<PhotoData>) => setDraft((d) => (d.photo ? { ...d, photo: { ...d.photo, ...p } } : d)), []);

  const wokIsPreset = WOK_OPTIONS.includes(draft.wok);
  const [wokOther, setWokOther] = useState(false);
  const wokSelect = wokIsPreset && !wokOther ? draft.wok : '__other';

  // ---------------- validation ----------------
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!draft.name.trim()) e.name = 'Nama wajib diisi.';
    else if (draft.name.trim().length < 2) e.name = 'Nama terlalu pendek.';
    if (!draft.title.trim()) e.title = 'Jabatan wajib diisi.';
    if (!draft.wok.trim()) e.wok = 'WOK wajib diisi.';
    return e;
  }, [draft]);
  const valid = Object.keys(errors).length === 0;

  const ensureValid = (emp: Employee) => {
    if (!emp.name.trim() || !emp.title.trim() || !emp.wok.trim()) {
      setTouched(true);
      toast('err', 'Lengkapi Nama, Jabatan, dan WOK terlebih dahulu.');
      return false;
    }
    if (!emp.photo) toast('info', 'Catatan: kartu dibuat tanpa foto karyawan.');
    return true;
  };

  // ---------------- photo ----------------
  const onPhotoFile = async (f?: File) => {
    if (!f) return;
    setBusy({ label: 'Memuat foto…' });
    try {
      const p = await photoFromFile(f);
      patch({ photo: p });
      toast('ok', 'Foto dimuat & diposisikan otomatis. Geser/zoom langsung di preview bila perlu.');
    } catch (e) {
      toast('err', (e as Error).message);
    } finally {
      setBusy(null);
      if (photoInput.current) photoInput.current.value = '';
    }
  };

  const doAutoFit = () => {
    const p = draft.photo;
    if (!p) return;
    patchPhoto(autoFit(p.w, p.h, tpl ? designSize(tpl).ky : 1));
  };

  const doRemoveLocal = async () => {
    if (!draft.photo) return;
    setBusy({ label: 'Menghapus background…' });
    try {
      await new Promise((r) => setTimeout(r, 30));
      const url = await removePlainBackground(draft.photo, tol);
      patchPhoto({ cutoutUrl: url, useCutout: true });
      toast('ok', 'Background dihapus. Anda bisa beralih kembali ke foto asli kapan saja.');
    } catch (e) {
      toast('err', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doRemoveAI = async () => {
    if (!draft.photo) return;
    setBusy({ label: 'Menyiapkan AI…' });
    try {
      const url = await removeBackgroundAI(draft.photo, (m) => setBusy({ label: m }));
      patchPhoto({ cutoutUrl: url, useCutout: true });
      toast('ok', 'Background dihapus dengan AI (diproses di browser Anda).');
    } catch (e) {
      toast('err', (e as Error).message || 'Hapus background AI gagal.');
    } finally {
      setBusy(null);
    }
  };

  // ---------------- form actions ----------------
  const resetForm = () => {
    setDraft((d) => ({ ...blank('Berau'), id: d.id, no: d.no }));
    setWokOther(false);
    setTouched(false);
  };
  const newCard = () => {
    setEditingId(null);
    setDraft(blank(draft.wok));
    setTouched(false);
  };
  const addToList = () => {
    if (!valid) {
      setTouched(true);
      return toast('err', 'Lengkapi data sebelum menambah ke daftar.');
    }
    const id = uid();
    const emp = { ...draft, id, no: draft.no || String(list.length + 1) };
    setList((l) => [...l, emp]);
    setDraft(emp);
    setEditingId(id);
    toast('ok', `${emp.name} ditambahkan ke daftar (#${emp.no}).`);
  };
  const editRow = (e: Employee) => {
    setEditingId(e.id);
    setDraft(e);
    setWokOther(!WOK_OPTIONS.includes(e.wok));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const deleteRow = (id: string) => {
    setList((l) => l.filter((e) => e.id !== id));
    setSelected((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    setGallery((g) => g.filter((x) => x.id !== id));
    if (editingId === id) newCard();
  };

  // ---------------- export single ----------------
  const size = resolveSize(settings);
  const px = pxFor(size, settings.dpi);
  const ratioMismatch = tpl ? Math.abs(size.hMm / size.wMm - designSize(tpl).H / designSize(tpl).W) > 0.01 : false;

  const run = async (label: string, fn: () => Promise<void>) => {
    if (!tpl) return;
    setBusy({ label });
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast('err', `Gagal: ${(e as Error).message || e}`);
    } finally {
      setBusy(null);
    }
  };

  /** Simpan file: browser → download; APK → folder Download HP (opsional langsung dibagikan). */
  const save = async (blob: Blob, name: string, share = false) => {
    const msg = await downloadBlob(blob, name, share);
    if (msg) toast('ok', msg);
  };

  const exportPng = () => ensureValid(draft) && run('Membuat PNG…', async () => save(await cardPng(tpl!, draft, settings), safeFileName(draft, 'png')));
  const exportJpg = () => ensureValid(draft) && run('Membuat JPG…', async () => save(await cardJpg(tpl!, draft, settings), safeFileName(draft, 'jpg')));
  const exportPdf = () => ensureValid(draft) && run('Membuat PDF…', async () => save(await buildPdf(tpl!, [draft], settings, 'single'), safeFileName(draft, 'pdf')));
  const doPrint = () => ensureValid(draft) && run('Menyiapkan print…', () => printCards(tpl!, [draft], settings, 'single'));
  const doShare = () => ensureValid(draft) && run('Menyiapkan file…', async () => save(await cardPng(tpl!, draft, settings), safeFileName(draft, 'png'), true));

  // ---------------- Google Drive & Spreadsheet ----------------
  const cloudReady = !validateUrl(cloud.url);
  const updateCloud = (p: Partial<CloudConfig>) =>
    setCloud((c) => {
      const n = { ...c, ...p };
      saveCloudConfig(n);
      return n;
    });
  const doTest = async () => {
    setBusy({ label: 'Mengecek koneksi…' });
    const info = await testConnection(cloud);
    setBusy(null);
    setCloudInfo(info);
    if (info.ok) toast('ok', `Terhubung ke Drive ${info.owner || ''} · ${info.rows ?? 0} data tersimpan.`);
    else toast('err', info.error || 'Koneksi gagal.');
  };
  const markCloud = (id: string, c: Employee['cloud']) => {
    setList((l) => l.map((e) => (e.id === id ? { ...e, cloud: c } : e)));
    setDraft((d) => (d.id === id ? { ...d, cloud: c } : d));
  };
  const uploadOne = async (emp: Employee) => {
    const r = await uploadCard(tpl!, emp, settings, cloud);
    if (!r.ok) throw new Error(r.error || 'Gagal menyimpan ke Drive.');
    markCloud(emp.id, { url: r.url || '', at: new Date().toISOString(), status: r.status || 'OK' });
    return r;
  };
  const saveDrive = () => {
    if (!cloudReady) {
      document.getElementById('cloud-card')?.scrollIntoView({ behavior: 'smooth' });
      return toast('err', 'Isi URL Web App Google Apps Script terlebih dahulu (kartu "Google Drive & Spreadsheet").');
    }
    if (!ensureValid(draft)) return;
    run('Mengunggah ke Google Drive…', async () => {
      const r = await uploadOne(draft);
      toast('ok', `${draft.name} tersimpan di Drive & Spreadsheet (${r.status}${r.row ? `, baris ${r.row}` : ''}).`);
    });
  };

  // ---------------- batch ----------------
  const targets = selected.size ? list.filter((e) => selected.has(e.id)) : list;
  const targetLabel = selected.size ? `${selected.size} terpilih` : `semua (${list.length})`;

  const checkBatch = (arr: Employee[]) => {
    if (!arr.length) {
      toast('err', 'Daftar karyawan masih kosong.');
      return false;
    }
    const bad = arr.filter((e) => !e.name.trim());
    if (bad.length) {
      toast('err', `${bad.length} karyawan belum memiliki nama.`);
      return false;
    }
    const noPhoto = arr.filter((e) => !e.photo).length;
    if (noPhoto) toast('info', `${noPhoto} kartu dibuat tanpa foto.`);
    return true;
  };

  const generate = (arr: Employee[]) =>
    checkBatch(arr) &&
    run('Generate ID Card…', async () => {
      const out: { id: string; url: string; name: string }[] = [];
      for (let i = 0; i < arr.length; i++) {
        setBusy({ label: `Generate ${i + 1}/${arr.length}`, pct: (i / arr.length) * 100 });
        const c = await renderToCanvas(tpl!, arr[i], size, settings.dpi, settings.fit, 420);
        out.push({ id: arr[i].id, url: c.toDataURL('image/jpeg', 0.9), name: arr[i].name });
      }
      setGallery(out);
      toast('ok', `${out.length} ID Card berhasil dibuat.`);
      setTimeout(() => document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' }), 50);
    });

  const zipAll = () =>
    checkBatch(targets) &&
    run('Membuat ZIP…', async () => {
      const b = await buildZip(tpl!, targets, settings, (i, n) => setBusy({ label: `PNG ${Math.min(i + 1, n)}/${n}`, pct: (i / n) * 100 }));
      await save(b, `IDCard_Narindo_${targets.length}_kartu.zip`);
    });
  const pdfBatch = () =>
    checkBatch(targets) &&
    run('Membuat PDF…', async () => {
      const b = await buildPdf(tpl!, targets, settings, pdfLayout, (i, n) => setBusy({ label: `PDF ${Math.min(i + 1, n)}/${n}`, pct: (i / n) * 100 }));
      await save(b, `IDCard_Narindo_${targets.length}_kartu${pdfLayout === 'a4' ? '_A4' : ''}.pdf`);
    });
  const printBatch = () => checkBatch(targets) && run('Menyiapkan print…', () => printCards(tpl!, targets, settings, pdfLayout));
  const downloadOne = (e: Employee) => run('Membuat PNG…', async () => save(await cardPng(tpl!, e, settings), safeFileName(e, 'png')));
  const uploadBatch = () => {
    if (!cloudReady) return toast('err', 'Isi URL Web App Google Apps Script terlebih dahulu.');
    if (!checkBatch(targets)) return;
    run('Upload ke Drive…', async () => {
      let ok = 0;
      const fail: string[] = [];
      for (let i = 0; i < targets.length; i++) {
        setBusy({ label: `Upload ke Drive ${i + 1}/${targets.length} · ${targets[i].name}`, pct: (i / targets.length) * 100 });
        try {
          await uploadOne(targets[i]);
          ok++;
        } catch (e) {
          fail.push(`${targets[i].name} (${(e as Error).message})`);
          if (/api key|URL|HTML/i.test((e as Error).message)) break; // kesalahan konfigurasi → hentikan
        }
      }
      toast(ok ? 'ok' : 'err', `${ok}/${targets.length} ID Card tersimpan ke Google Drive & Spreadsheet.`);
      if (fail.length) toast('err', `Gagal: ${fail.slice(0, 3).join('; ')}${fail.length > 3 ? '…' : ''}`);
    });
  };

  const onDataFile = async (f?: File) => {
    if (!f) return;
    try {
      const { list: rows, warnings } = await readEmployeeFile(f);
      if (!rows.length) throw new Error('Tidak ada data karyawan yang valid di file.');
      setList((l) => {
        const offset = l.length;
        return [...l, ...rows.map((r, i) => ({ ...r, no: r.no || String(offset + i + 1), uppercase: false }))];
      });
      toast('ok', `${rows.length} karyawan diimpor dari ${f.name}. Unggah foto massal untuk pencocokan otomatis.`);
      warnings.slice(0, 3).forEach((w) => toast('info', w));
    } catch (e) {
      toast('err', (e as Error).message);
    } finally {
      if (dataInput.current) dataInput.current.value = '';
    }
  };

  const onBulkPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const arr = Array.from(files).filter((f) => {
      const e = validateImageFile(f);
      if (e) toast('err', e);
      return !e;
    });
    if (!list.length) {
      toast('err', 'Import data karyawan dulu, lalu unggah foto untuk dicocokkan.');
      return;
    }
    setBusy({ label: 'Mencocokkan foto…' });
    let ok = 0;
    const missing: string[] = [];
    const used = new Set<File>();
    const next: Employee[] = [];
    for (const e of list) {
      const f = matchPhoto(e, arr);
      if (f) {
        try {
          const p = await photoFromFile(f);
          next.push({ ...e, photo: p });
          used.add(f);
          ok++;
          continue;
        } catch (er) {
          toast('err', (er as Error).message);
        }
      } else if (!e.photo) missing.push(e.name);
      next.push(e);
    }
    setList(next);
    if (editingId) {
      const cur = next.find((x) => x.id === editingId);
      if (cur) setDraft(cur);
    }
    setBusy(null);
    toast(ok ? 'ok' : 'err', `${ok} foto cocok dari ${arr.length} file.`);
    if (missing.length) toast('info', `Belum ada foto: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` +${missing.length - 5} lainnya` : ''}`);
    const unused = arr.filter((f) => !used.has(f));
    if (unused.length) toast('info', `Tidak cocok: ${unused.slice(0, 4).map((f) => f.name).join(', ')}${unused.length > 4 ? '…' : ''}`);
    if (bulkPhotoInput.current) bulkPhotoInput.current.value = '';
  };

  const allSelected = list.length > 0 && selected.size === list.length;

  // ---------------- render ----------------
  return (
    <div className="min-h-screen bg-[#F5F6F8] text-ink">
      {/* HEADER */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="w-6 h-6 rounded-full bg-ink" />
            <span className="w-6 h-6 rounded-full bg-narindo -ml-3 ring-2 ring-white" />
          </div>
          <div className="leading-tight">
            <h1 className="text-[15px] sm:text-base font-bold tracking-tight">
              NARINDO <span className="text-brand">ID CARD</span> GENERATOR
            </h1>
            <p className="text-[11px] text-slate-500 hidden sm:block">Template Narindo × Telkomsel · WOK Kaltara</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 h-7 rounded-full">
              <Icon name="check" className="w-3.5 h-3.5" /> {android ? 'Aplikasi Android' : 'Data & foto diproses lokal di browser'}
            </span>
            <Btn variant="primary" icon="download" onClick={exportPng} className="hidden sm:inline-flex">
              PNG
            </Btn>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 py-5 space-y-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* ========== PANEL KIRI ========== */}
        <div className="space-y-5 min-w-0">
          <Card
            title="Data Karyawan"
            icon="user"
            right={
              editingId ? (
                <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded-lg">Mengedit #{draft.no}</span>
              ) : (
                <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">Kartu baru</span>
              )
            }
          >
            <div className="space-y-4">
              <Field label="Nama Karyawan" error={touched ? errors.name : undefined} hint="Contoh: RIKI HASBULLAH · otomatis mengecil / 2 baris bila panjang">
                <input
                  data-testid="input-name"
                  className={inputCls}
                  value={draft.name}
                  maxLength={70}
                  placeholder="Ketik nama karyawan"
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </Field>
              <Field label="Jabatan" error={touched ? errors.title : undefined} hint="Bebas diketik, contoh: PIC TAP BERAU">
                <input
                  data-testid="input-title"
                  className={inputCls}
                  value={draft.title}
                  maxLength={90}
                  placeholder="Ketik jabatan"
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="WOK (Working Location)" error={touched ? errors.wok : undefined}>
                  <select
                    data-testid="select-wok"
                    className={inputCls}
                    value={wokSelect}
                    onChange={(e) => {
                      if (e.target.value === '__other') {
                        setWokOther(true);
                        patch({ wok: '' });
                      } else {
                        setWokOther(false);
                        patch({ wok: e.target.value });
                      }
                    }}
                  >
                    {WOK_OPTIONS.map((w) => (
                      <option key={w}>{w}</option>
                    ))}
                    <option value="__other">Lainnya (input manual)</option>
                  </select>
                </Field>
                <Field label={wokSelect === '__other' ? 'Lokasi lainnya' : 'Edit nama lokasi'}>
                  <input
                    data-testid="input-wok"
                    className={inputCls}
                    value={draft.wok}
                    maxLength={40}
                    placeholder="Mis. Tanjung Redeb"
                    onChange={(e) => {
                      patch({ wok: e.target.value });
                      if (!WOK_OPTIONS.includes(e.target.value)) setWokOther(true);
                    }}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <Toggle checked={!!draft.uppercase} onChange={(v) => patch({ uppercase: v })} label="Semua huruf kapital" />
                <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                  No/ID
                  <input className="w-20 h-8 rounded-lg border border-slate-200 px-2 text-sm" value={draft.no} onChange={(e) => patch({ no: e.target.value })} placeholder="auto" />
                </label>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {editingId ? (
                  <Btn variant="dark" icon="plus" onClick={newCard}>
                    Kartu berikutnya
                  </Btn>
                ) : (
                  <Btn variant="dark" icon="plus" onClick={addToList}>
                    Tambah ke daftar
                  </Btn>
                )}
                <Btn icon="refresh" onClick={resetForm}>
                  Reset form
                </Btn>
              </div>
            </div>
          </Card>

          <Card
            title="Foto Karyawan"
            icon="image"
            right={draft.photo && <span className="text-[11px] text-slate-500 truncate max-w-[140px]">{draft.photo.name}</span>}
          >
            <input ref={photoInput} type="file" accept={ACCEPT_IMG} className="hidden" data-testid="photo-input" onChange={(e) => onPhotoFile(e.target.files?.[0])} />
            {!draft.photo ? (
              <button
                type="button"
                onClick={() => photoInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onPhotoFile(e.dataTransfer.files?.[0]);
                }}
                className="w-full rounded-2xl border-2 border-dashed border-slate-300 hover:border-brand hover:bg-brand/5 transition p-6 flex flex-col items-center text-center gap-2"
              >
                <span className="grid place-items-center w-12 h-12 rounded-2xl bg-brand/10 text-brand">
                  <Icon name="upload" className="w-6 h-6" />
                </span>
                <span className="font-semibold text-sm">Unggah / tarik foto ke sini</span>
                <span className="text-xs text-slate-500">JPG, JPEG, PNG, WebP · crop kepala hingga dada atas</span>
              </button>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-3 items-center">
                  <img src={draft.photo.useCutout && draft.photo.cutoutUrl ? draft.photo.cutoutUrl : draft.photo.url} alt="" className="w-16 h-16 rounded-xl object-cover bg-slate-100 border border-slate-200 checker" />
                  <div className="flex flex-wrap gap-2">
                    <Btn size="sm" icon="upload" onClick={() => photoInput.current?.click()}>
                      Ganti
                    </Btn>
                    <Btn size="sm" variant="danger" icon="trash" onClick={() => patch({ photo: undefined })}>
                      Hapus
                    </Btn>
                    <Btn size="sm" icon="fit" onClick={doAutoFit}>
                      Auto-fit
                    </Btn>
                    <Btn size="sm" icon="refresh" onClick={doAutoFit}>
                      Reset posisi
                    </Btn>
                  </div>
                </div>
                <p className="text-xs text-slate-500 flex items-center gap-1.5">
                  <Icon name="move" className="w-3.5 h-3.5" /> Tip: geser foto langsung di preview, scroll / cubit (2 jari) untuk zoom.
                </p>
                <div className="grid sm:grid-cols-2 gap-x-5 gap-y-3">
                  <Slider label="Zoom / skala" value={draft.photo.zoom} min={0.3} max={4} step={0.01} onChange={(v) => patchPhoto({ zoom: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
                  <Slider label="Rotasi" value={draft.photo.rot} min={-180} max={180} step={0.5} onChange={(v) => patchPhoto({ rot: v })} fmt={(v) => `${v}°`} />
                  <Slider label="Geser horizontal" value={draft.photo.offX} min={-1200} max={1200} step={1} onChange={(v) => patchPhoto({ offX: v })} />
                  <Slider label="Geser vertikal" value={draft.photo.offY} min={-1500} max={1500} step={1} onChange={(v) => patchPhoto({ offY: v })} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn size="sm" icon="zoomOut" onClick={() => patchPhoto({ zoom: Math.max(0.3, +(draft.photo!.zoom - 0.05).toFixed(2)) })}>
                    Zoom −
                  </Btn>
                  <Btn size="sm" icon="zoomIn" onClick={() => patchPhoto({ zoom: Math.min(4, +(draft.photo!.zoom + 0.05).toFixed(2)) })}>
                    Zoom +
                  </Btn>
                  <Btn size="sm" icon="rotL" onClick={() => patchPhoto({ rot: ((draft.photo!.rot - 90 + 540) % 360) - 180 })}>
                    −90°
                  </Btn>
                  <Btn size="sm" icon="rotR" onClick={() => patchPhoto({ rot: ((draft.photo!.rot + 90 + 540) % 360) - 180 })}>
                    +90°
                  </Btn>
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-3">
                  <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
                    <Icon name="wand" className="w-3.5 h-3.5" /> Background foto (opsional)
                  </div>
                  <Segmented
                    value={draft.photo.useCutout && draft.photo.cutoutUrl ? 'cut' : 'orig'}
                    onChange={(v) => {
                      if (v === 'cut' && !draft.photo?.cutoutUrl) return toast('info', 'Hapus background terlebih dahulu.');
                      patchPhoto({ useCutout: v === 'cut' });
                    }}
                    options={[
                      { value: 'orig', label: 'Pertahankan background' },
                      { value: 'cut', label: 'Tanpa background' },
                    ]}
                  />
                  <Slider label="Toleransi warna (background polos)" value={tol} min={10} max={90} step={1} onChange={setTol} />
                  <div className="flex flex-wrap gap-2">
                    <Btn size="sm" variant="dark" icon="wand" onClick={doRemoveLocal}>
                      Hapus background polos (offline)
                    </Btn>
                    <Btn size="sm" icon="wand" onClick={doRemoveAI}>
                      Hapus background AI (online)
                    </Btn>
                  </div>
                  <p className="text-[11px] text-slate-500">Foto tidak diubah dengan AI generatif. Mode AI memerlukan internet untuk memuat model, namun foto tetap diproses di perangkat Anda.</p>
                </div>
              </div>
            )}
          </Card>

          <Card title="Ukuran Cetak & Export" icon="ruler">
            <div className="space-y-4">
              <Field label="Ukuran ID Card">
                <select data-testid="select-size" className={inputCls} value={settings.sizeId} onChange={(e) => setSettings((s) => ({ ...s, sizeId: e.target.value }))}>
                  {SIZES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              {settings.sizeId === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Lebar (mm)">
                    <input type="number" min={20} max={300} step={0.1} className={inputCls} value={settings.customW} onChange={(e) => setSettings((s) => ({ ...s, customW: Math.min(300, Math.max(20, +e.target.value || 20)) }))} />
                  </Field>
                  <Field label="Tinggi (mm)">
                    <input type="number" min={20} max={400} step={0.1} className={inputCls} value={settings.customH} onChange={(e) => setSettings((s) => ({ ...s, customH: Math.min(400, Math.max(20, +e.target.value || 20)) }))} />
                  </Field>
                </div>
              )}
              {ratioMismatch && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-2">
                  <p className="text-xs text-amber-800">
                    Rasio ukuran ini berbeda dengan template. Template <b>tidak akan ditarik/distorsi</b>. Pilih cara penyesuaian:
                  </p>
                  <Segmented
                    value={settings.fit}
                    onChange={(v) => setSettings((s) => ({ ...s, fit: v }))}
                    options={[
                      { value: 'contain', label: 'Fit (margin putih)' },
                      { value: 'cover', label: 'Crop tepi (setujui)' },
                    ]}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Resolusi">
                  <select className={inputCls} value={settings.dpi} onChange={(e) => setSettings((s) => ({ ...s, dpi: +e.target.value }))}>
                    <option value={300}>300 DPI</option>
                    <option value={450}>450 DPI</option>
                    <option value={600}>600 DPI</option>
                  </select>
                </Field>
                <Field label="Hasil">
                  <div className="h-11 flex items-center px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm tabular-nums" data-testid="px-info">
                    {px.w} × {px.h} px
                  </div>
                </Field>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Btn variant="primary" icon="download" onClick={exportPng} data-testid="btn-png">
                  PNG
                </Btn>
                <Btn variant="dark" icon="download" onClick={exportJpg}>
                  JPG
                </Btn>
                <Btn icon="file" onClick={exportPdf}>
                  PDF
                </Btn>
                <Btn icon="printer" onClick={doPrint}>
                  Print
                </Btn>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <Btn variant="primary" icon="cloud" onClick={saveDrive} data-testid="btn-drive" className="!h-11 !bg-[#0F9D58] hover:!bg-[#0B8043] !shadow-[#0F9D58]/30">
                  Simpan ke Google Drive & Spreadsheet
                </Btn>
                <Btn icon="share" onClick={doShare}>
                  Bagikan
                </Btn>
              </div>
            </div>
          </Card>

          <div id="cloud-card">
            <Card
              title="Google Drive & Spreadsheet"
              icon="cloud"
              right={
                cloudInfo?.ok ? (
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">Terhubung</span>
                ) : (
                  <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">{cloudReady ? 'Belum dites' : 'Belum diatur'}</span>
                )
              }
            >
              <div className="space-y-3">
                <Field label="URL Web App (Apps Script)" error={cloud.url && validateUrl(cloud.url) ? validateUrl(cloud.url)! : undefined} hint="Deploy Code.gs sebagai Web App → salin URL berakhiran /exec">
                  <input
                    data-testid="input-cloud-url"
                    className={inputCls}
                    value={cloud.url}
                    placeholder="https://script.google.com/macros/s/…/exec"
                    onChange={(e) => {
                      updateCloud({ url: e.target.value.trim() });
                      setCloudInfo(null);
                    }}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="API Key">
                    <input data-testid="input-cloud-key" className={inputCls} value={cloud.key} onChange={(e) => updateCloud({ key: e.target.value })} placeholder="samakan dgn Code.gs" />
                  </Field>
                  <Field label="Format di Drive">
                    <select className={inputCls} value={cloud.format} onChange={(e) => updateCloud({ format: e.target.value as CloudConfig['format'] })}>
                      <option value="png">PNG (kualitas cetak)</option>
                      <option value="jpg">JPG (lebih kecil)</option>
                    </select>
                  </Field>
                </div>
                <div className="flex flex-col gap-2">
                  <Toggle checked={cloud.sendPhoto} onChange={(v) => updateCloud({ sendPhoto: v })} label="Arsipkan juga foto asli karyawan" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn size="sm" variant="dark" icon="refresh" onClick={doTest} disabled={!cloudReady} data-testid="btn-cloud-test">
                    Tes koneksi
                  </Btn>
                  {cloudInfo?.ok && cloudInfo.sheetUrl && (
                    <a href={cloudInfo.sheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl border border-slate-200 text-xs font-medium hover:bg-slate-50">
                      <Icon name="sheet" className="w-3.5 h-3.5" /> Buka Spreadsheet
                    </a>
                  )}
                  {cloudInfo?.ok && cloudInfo.folderUrl && (
                    <a href={cloudInfo.folderUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl border border-slate-200 text-xs font-medium hover:bg-slate-50">
                      <Icon name="layers" className="w-3.5 h-3.5" /> Buka Folder Drive
                    </a>
                  )}
                </div>
                {cloudInfo && !cloudInfo.ok && <p className="text-xs text-red-600">{cloudInfo.error}</p>}
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  File ID Card disimpan di folder Drive <b>ID Card Narindo/&lt;WOK&gt;</b>, datanya dicatat di Spreadsheet (Timestamp, No, Nama, Jabatan, WOK, link file). Simpan ulang nama yang sama akan memperbarui baris & mengganti file lama.
                </p>
              </div>
            </Card>
          </div>

          <Card title="Template" icon="layers">
            <input ref={tplInput} type="file" accept={ACCEPT_IMG} className="hidden" onChange={(e) => onTemplateFile(e.target.files?.[0])} />
            <div className="flex items-center gap-3">
              {tpl && <img src={tpl.src} alt="" className="w-12 h-[68px] object-cover rounded-md border border-slate-200" />}
              <div className="text-sm min-w-0">
                <div className="font-semibold">{tplCustom ? 'Template kustom' : 'Narindo × Telkomsel (bawaan)'}</div>
                <div className="text-xs text-slate-500">Area foto, nama, jabatan & WOK sudah dibersihkan · pola jaringan dipertahankan.</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Btn size="sm" icon="upload" onClick={() => tplInput.current?.click()}>
                Upload template
              </Btn>
              {tplCustom && (
                <Btn size="sm" icon="refresh" onClick={() => setTplCustom(null)}>
                  Kembalikan bawaan
                </Btn>
              )}
            </div>
          </Card>
        </div>

        {/* ========== PANEL KANAN: PREVIEW ========== */}
        <div className="min-w-0 lg:sticky lg:top-[84px] self-start">
          <Card>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h2 className="text-[15px] font-semibold flex items-center gap-2 mr-auto">
                <span className="grid place-items-center w-7 h-7 rounded-lg bg-brand/10 text-brand">
                  <Icon name="eye" />
                </span>
                Live Preview
              </h2>
              <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white">
                <button className="w-9 h-9 grid place-items-center text-slate-600 hover:text-ink" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Perkecil preview">
                  <Icon name="minus" />
                </button>
                <button className="px-2 text-xs tabular-nums w-14" onClick={() => setZoom(1)} title="Sesuaikan layar">
                  {Math.round(zoom * 100)}%
                </button>
                <button className="w-9 h-9 grid place-items-center text-slate-600 hover:text-ink" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label="Perbesar preview">
                  <Icon name="plus" />
                </button>
              </div>
              <Btn size="sm" variant="ghost" icon="fit" onClick={() => setZoom(1)}>
                Fit
              </Btn>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3">
              <Toggle checked={safeOn} onChange={setSafeOn} label="Batas aman cetak" />
              {safeOn && (
                <label className="text-xs text-slate-500 inline-flex items-center gap-1.5">
                  <input type="number" min={1} max={10} step={0.5} value={safeMm} onChange={(e) => setSafeMm(Math.min(10, Math.max(1, +e.target.value || 3)))} className="w-14 h-7 rounded-lg border border-slate-200 px-2" /> mm
                </label>
              )}
              <Toggle checked={frameOn} onChange={setFrameOn} label="Bingkai foto" />
            </div>
            {tpl ? (
              <Preview tpl={tpl} emp={draft} zoom={zoom} safeInset={safeOn ? (safeMm / size.wMm) * REF_W : null} showFrame={frameOn} onPhoto={patchPhoto} />
            ) : (
              <div className="aspect-[707/1000] grid place-items-center text-slate-400">Memuat template…</div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 mr-auto">
                {size.wMm} × {size.hMm} mm · {px.w}×{px.h}px @{settings.dpi} DPI · panduan tidak ikut tercetak
              </span>
              <Btn size="sm" variant="primary" icon="download" onClick={exportPng}>
                PNG
              </Btn>
              <Btn size="sm" icon="download" onClick={exportJpg}>
                JPG
              </Btn>
              <Btn size="sm" icon="file" onClick={exportPdf}>
                PDF
              </Btn>
              <Btn size="sm" icon="printer" onClick={doPrint}>
                Print
              </Btn>
              <Btn size="sm" variant="primary" icon="cloud" onClick={saveDrive} className="!bg-[#0F9D58] hover:!bg-[#0B8043]">
                Drive
              </Btn>
            </div>
            {draft.cloud && (
              <p className="mt-2 text-xs text-emerald-700 flex items-center gap-1.5">
                <Icon name="check" className="w-3.5 h-3.5" /> Tersimpan di Drive ({draft.cloud.status}) · {new Date(draft.cloud.at).toLocaleString('id-ID')}
                {draft.cloud.url && (
                  <a className="underline ml-1" href={draft.cloud.url} target="_blank" rel="noreferrer">
                    buka file
                  </a>
                )}
              </p>
            )}
          </Card>
        </div>

        </div>

        {/* ========== BATCH ========== */}
        <div className="min-w-0">
          <Card
            title="Generator Massal"
            icon="grid"
            right={<span className="text-xs text-slate-500">{list.length} karyawan · {list.filter((e) => e.photo).length} berfoto</span>}
          >
            <input ref={dataInput} type="file" accept=".xlsx,.xlsm,.csv,.xls" className="hidden" data-testid="data-input" onChange={(e) => onDataFile(e.target.files?.[0])} />
            <input ref={bulkPhotoInput} type="file" multiple accept={ACCEPT_IMG} className="hidden" data-testid="bulk-photo-input" onChange={(e) => onBulkPhotos(e.target.files)} />
            <div className="flex flex-wrap gap-2 mb-4">
              <Btn variant="dark" icon="sheet" onClick={() => dataInput.current?.click()}>
                Import Excel / CSV
              </Btn>
              <Btn icon="image" onClick={() => bulkPhotoInput.current?.click()}>
                Upload banyak foto
              </Btn>
              <Btn icon="plus" onClick={addToList} disabled={!!editingId} title={editingId ? 'Klik "Kartu berikutnya" dulu' : ''}>
                Tambah dari form
              </Btn>
              <Btn variant="ghost" icon="download" onClick={async () => save(await buildXlsx(TEMPLATE_ROWS), 'Template_Data_Karyawan.xlsx')}>
                Template Excel
              </Btn>
              <Btn variant="ghost" icon="download" disabled={!list.length} onClick={() => save(new Blob([employeesToCsv(list)], { type: 'text/csv' }), 'Data_Karyawan.csv')}>
                Export data CSV
              </Btn>
              {list.length > 0 && (
                <Btn
                  variant="danger"
                  icon="trash"
                  className="sm:ml-auto"
                  onClick={() => {
                    if (confirm('Kosongkan seluruh daftar karyawan?')) {
                      setList([]);
                      setSelected(new Set());
                      setGallery([]);
                      if (editingId) newCard();
                    }
                  }}
                >
                  Kosongkan
                </Btn>
              )}
            </div>

            {list.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                Belum ada data. Import file Excel/CSV dengan kolom <b>No, Nama, Jabatan, WOK, Foto</b>, atau klik <b>Tambah ke daftar</b> pada form.
                <br />
                Foto massal dicocokkan otomatis berdasarkan nama file (kolom Foto), No/ID, atau nama karyawan.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm" data-testid="emp-table">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="p-3 w-10">
                        <input type="checkbox" className="accent-[#EA1D29] w-4 h-4" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(list.map((e) => e.id)))} />
                      </th>
                      <th className="p-3 text-left w-14">No</th>
                      <th className="p-3 text-left w-16">Foto</th>
                      <th className="p-3 text-left">Nama</th>
                      <th className="p-3 text-left">Jabatan</th>
                      <th className="p-3 text-left">WOK</th>
                      <th className="p-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((e) => (
                      <tr key={e.id} className={`border-t border-slate-100 ${editingId === e.id ? 'bg-blue-50/60' : 'hover:bg-slate-50/60'}`}>
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            className="accent-[#EA1D29] w-4 h-4"
                            checked={selected.has(e.id)}
                            onChange={() =>
                              setSelected((s) => {
                                const n = new Set(s);
                                if (n.has(e.id)) n.delete(e.id);
                                else n.add(e.id);
                                return n;
                              })
                            }
                          />
                        </td>
                        <td className="p-3 tabular-nums text-slate-500">{e.no}</td>
                        <td className="p-3">
                          {e.photo ? (
                            <img src={e.photo.useCutout && e.photo.cutoutUrl ? e.photo.cutoutUrl : e.photo.url} className="w-10 h-10 rounded-lg object-cover border border-slate-200" alt="" />
                          ) : (
                            <span className="inline-flex flex-col w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 text-amber-600 items-center justify-center text-[9px] leading-tight text-center" title={e.photoFile ? `Menunggu ${e.photoFile}` : 'Belum ada foto'}>
                              <Icon name="image" className="w-3.5 h-3.5" />
                              foto?
                            </span>
                          )}
                        </td>
                        <td className="p-3 font-semibold">
                          {e.name}
                          {e.photoFile && !e.photo && <div className="text-[11px] font-normal text-slate-400">{e.photoFile}</div>}
                          {e.cloud && (
                            <a href={e.cloud.url || undefined} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                              <Icon name="cloud" className="w-3 h-3" /> Drive · {e.cloud.status}
                            </a>
                          )}
                        </td>
                        <td className="p-3 text-slate-600">{e.title}</td>
                        <td className="p-3 text-slate-600">{e.wok}</td>
                        <td className="p-3">
                          <div className="flex justify-end gap-1">
                            <Btn size="sm" variant="ghost" icon="edit" onClick={() => editRow(e)}>
                              Edit
                            </Btn>
                            <Btn size="sm" variant="ghost" icon="download" onClick={() => downloadOne(e)}>
                              PNG
                            </Btn>
                            <Btn size="sm" variant="ghost" icon="trash" className="!text-red-600" onClick={() => deleteRow(e.id)} aria-label="Hapus" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] items-end">
              <div className="flex flex-wrap gap-2">
                <Btn variant="dark" icon="card" disabled={!selected.size} onClick={() => generate(list.filter((e) => selected.has(e.id)))}>
                  Generate Selected ({selected.size})
                </Btn>
                <Btn variant="dark" icon="card" disabled={!list.length} onClick={() => generate(list)} data-testid="btn-gen-all">
                  Generate All
                </Btn>
                <Btn variant="primary" icon="zip" disabled={!list.length} onClick={zipAll} data-testid="btn-zip">
                  Download ZIP · {targetLabel}
                </Btn>
                <Btn icon="file" disabled={!list.length} onClick={pdfBatch} data-testid="btn-pdf-batch">
                  PDF Batch · {targetLabel}
                </Btn>
                <Btn icon="printer" disabled={!list.length} onClick={printBatch}>
                  Print batch
                </Btn>
                <Btn variant="primary" icon="cloud" disabled={!list.length} onClick={uploadBatch} data-testid="btn-drive-batch" className="!bg-[#0F9D58] hover:!bg-[#0B8043] !shadow-[#0F9D58]/30">
                  Upload ke Drive · {targetLabel}
                </Btn>
              </div>
              <div className="w-full md:w-72">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Tata letak PDF / Print batch</div>
                <Segmented
                  value={pdfLayout}
                  onChange={setPdfLayout}
                  options={[
                    { value: 'single', label: '1 kartu / halaman' },
                    { value: 'a4', label: 'Susun di A4' },
                  ]}
                />
              </div>
            </div>

            {gallery.length > 0 && (
              <div id="gallery" className="mt-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">Hasil generate ({gallery.length})</h3>
                  <Btn size="sm" variant="ghost" icon="x" onClick={() => setGallery([])}>
                    Tutup
                  </Btn>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3" data-testid="gallery">
                  {gallery.map((g) => {
                    const emp = list.find((e) => e.id === g.id);
                    return (
                      <figure key={g.id} className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                        <img src={g.url} alt={g.name} className="w-full rounded-md border border-slate-100" />
                        <figcaption className="mt-2 flex items-center gap-1">
                          <span className="text-xs font-medium truncate mr-auto">{g.name}</span>
                          {emp && (
                            <button className="w-7 h-7 grid place-items-center rounded-lg hover:bg-slate-100 text-slate-600" title="Download PNG" onClick={() => downloadOne(emp)}>
                              <Icon name="download" className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        </div>
      </main>

      <footer className="text-center text-xs text-slate-400 pb-8">Narindo ID Card Generator · desain diproses di perangkat; data hanya dikirim ke Google Drive & Spreadsheet milik Anda saat tombol Drive ditekan.</footer>

      {/* BUSY OVERLAY */}
      {busy && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-[2px] grid place-items-center p-4" data-testid="busy">
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 w-full max-w-xs text-center">
            <div className="mx-auto w-9 h-9 rounded-full border-4 border-slate-200 border-t-brand animate-spin" />
            <div className="mt-3 text-sm font-medium">{busy.label}</div>
            {busy.pct !== undefined && (
              <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-brand transition-all" style={{ width: `${busy.pct}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* TOASTS */}
      <div className="fixed z-[60] bottom-4 right-4 left-4 sm:left-auto sm:w-96 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`rounded-xl px-4 py-3 text-sm shadow-lg border flex gap-2 items-start ${
              t.kind === 'ok' ? 'bg-white border-emerald-200 text-emerald-800' : t.kind === 'err' ? 'bg-white border-red-200 text-red-700' : 'bg-white border-slate-200 text-slate-700'
            }`}
          >
            <Icon name={t.kind === 'ok' ? 'check' : t.kind === 'err' ? 'x' : 'eye'} className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{t.msg}</span>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-slate-400 hover:text-slate-600" aria-label="Tutup">
              <Icon name="x" className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
