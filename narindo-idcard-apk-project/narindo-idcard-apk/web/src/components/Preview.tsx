import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { designSize, ensurePhotoLoaded, renderCard } from '../lib/render';
import type { Employee, PhotoData } from '../lib/types';

interface Props {
  tpl: HTMLImageElement;
  emp: Employee;
  zoom: number;
  safeInset: number | null;
  showFrame: boolean;
  onPhoto: (patch: Partial<PhotoData>) => void;
}

/** Live preview: memakai fungsi renderCard yang sama persis dengan export. */
export default function Preview({ tpl, emp, zoom, safeInset, showFrame, onPhoto }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 400, h: 600 });
  const { W, H } = designSize(tpl);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: Math.max(320, window.innerHeight - 300) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitW = Math.min(box.w - 8, (box.h * W) / H, 760);
  const cssW = Math.max(160, Math.round(fitW * zoom));
  const cssH = Math.round((cssW * H) / W);

  useEffect(() => {
    let alive = true;
    const draw = async () => {
      await ensurePhotoLoaded(emp.photo).catch(() => undefined);
      if (!alive || !cv.current) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const pw = Math.min(Math.round(cssW * dpr), W);
      const ph = Math.round((pw * H) / W);
      const c = cv.current;
      if (c.width !== pw || c.height !== ph) {
        c.width = pw;
        c.height = ph;
      }
      const ctx = c.getContext('2d')!;
      const k = pw / W;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      renderCard(ctx, tpl, emp, { showPlaceholder: true, safeInset, showFrame });
    };
    const id = requestAnimationFrame(() => void draw());
    return () => {
      alive = false;
      cancelAnimationFrame(id);
    };
  }, [tpl, emp, cssW, safeInset, showFrame, W, H]);

  // ------- drag / pinch / wheel untuk mengatur foto -------
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ offX: number; offY: number; zoom: number; dist: number; x: number; y: number } | null>(null);
  const photoRef = useRef(emp.photo);
  photoRef.current = emp.photo;
  const unit = W / cssW; // px desain per px layar

  const begin = () => {
    const p = photoRef.current;
    if (!p) return;
    const pts = [...ptrs.current.values()];
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
    const cy = pts.reduce((s, q) => s + q.y, 0) / pts.length;
    start.current = { offX: p.offX, offY: p.offY, zoom: p.zoom, dist, x: cx, y: cy };
  };

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      const p = photoRef.current;
      if (!p) return;
      e.preventDefault();
      const z = Math.min(6, Math.max(0.3, p.zoom * Math.exp(-e.deltaY * 0.0015)));
      onPhoto({ zoom: +z.toFixed(3) });
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [onPhoto]);

  return (
    <div ref={wrap} className="w-full overflow-auto checker rounded-xl" style={{ maxHeight: box.h + 24 }}>
      <div className="flex justify-center p-1" style={{ minWidth: cssW + 8 }}>
        <canvas
          ref={cv}
          data-testid="preview-canvas"
          style={{ width: cssW, height: cssH, touchAction: emp.photo ? 'none' : 'auto' }}
          className={`block bg-white shadow-[0_18px_50px_-18px_rgba(15,23,42,.45)] rounded-[6px] ${emp.photo ? 'cursor-grab active:cursor-grabbing' : ''}`}
          onPointerDown={(e) => {
            if (!photoRef.current) return;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            begin();
          }}
          onPointerMove={(e) => {
            if (!ptrs.current.has(e.pointerId) || !start.current) return;
            ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const pts = [...ptrs.current.values()];
            const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
            const cy = pts.reduce((s, q) => s + q.y, 0) / pts.length;
            const s = start.current;
            const patch: Partial<PhotoData> = {
              offX: Math.round(s.offX + (cx - s.x) * unit),
              offY: Math.round(s.offY + (cy - s.y) * unit),
            };
            if (pts.length > 1 && s.dist > 0) {
              const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
              patch.zoom = +Math.min(6, Math.max(0.3, (s.zoom * d) / s.dist)).toFixed(3);
            }
            onPhoto(patch);
          }}
          onPointerUp={(e) => {
            ptrs.current.delete(e.pointerId);
            if (ptrs.current.size) begin();
            else start.current = null;
          }}
          onPointerCancel={(e) => {
            ptrs.current.delete(e.pointerId);
            start.current = null;
          }}
        />
      </div>
    </div>
  );
}
