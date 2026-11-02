export interface PhotoData {
  /** object URL foto asli */
  url: string;
  /** nama file asli */
  name: string;
  w: number;
  h: number;
  /** object URL hasil hapus background (PNG transparan) */
  cutoutUrl?: string;
  useCutout: boolean;
  /** 1 = menutupi bingkai foto (auto-fit) */
  zoom: number;
  /** geser dalam satuan piksel desain (template 2121 px) */
  offX: number;
  offY: number;
  /** derajat */
  rot: number;
}

export interface Employee {
  id: string;
  no: string;
  name: string;
  title: string;
  wok: string;
  /** nama file foto dari Excel/CSV (untuk pencocokan otomatis) */
  photoFile?: string;
  photo?: PhotoData;
  uppercase?: boolean;
  /** status simpan ke Google Drive */
  cloud?: { url: string; at: string; status: string };
}

export interface CardSize {
  id: string;
  label: string;
  wMm: number;
  hMm: number;
}

export type FitMode = 'contain' | 'cover';

export interface ExportSettings {
  sizeId: string;
  customW: number;
  customH: number;
  fit: FitMode;
  dpi: number;
}
