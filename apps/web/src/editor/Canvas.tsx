/**
 * The canvas (PRD §19, §29). The card is the same CardScene the export renders, scaled with a CSS
 * transform. Interaction lives in an overlay drawn in screen pixels, so handles stay crisp at any
 * zoom: select, drag, resize, multi-select (shift / marquee), snapping to the canvas centre, safe
 * margins and other layers, keyboard nudging, zoom and pan. Direct manipulation never animates.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CardScene, getLayer, type Box, type SrcResolver } from '@acs/renderer';
import type { BackgroundLayer, Design, Layer, TextLayer } from '@acs/types';
import { useEditor } from './store';
import { cx } from '../ui';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type Boxes = Record<string, Box & { lines?: number }>;

interface DragState {
  kind: 'move' | 'resize' | 'pan-image' | 'pan-view' | 'marquee';
  startX: number;
  startY: number;
  ids: string[];
  handle?: Handle;
  start: Record<string, { x: number; y: number; width: number; height: number; focalX?: number; focalY?: number; offsetX?: number; offsetY?: number }>;
  startBox?: Box;
  pan?: { x: number; y: number };
  key: string;
}

const SNAP_PX = 6;

/** The live scene root, for measurements outside the canvas (auto-fit). */
export const sceneRef: { current: HTMLDivElement | null } = { current: null };

function intersects(a: Box, b: Box) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** The box a layer occupies, in canvas px. Text comes from the DOM (it wraps); the rest from props. */
function layerBox(l: Layer, boxes: Boxes, d: Design): Box {
  if (l.type === 'text') {
    const b = boxes[`group:${l.id}`] ?? boxes[l.id];
    if (b) return b;
    return { x: l.x, y: l.anchorY === 'bottom' ? l.y - l.height : l.y, w: l.width, h: l.height };
  }
  if (l.type === 'background' || l.type === 'gradient') return { x: l.x, y: l.y, w: l.width || d.canvas.width, h: l.height || d.canvas.height };
  return { x: l.x, y: l.y, w: l.width, h: l.height };
}

export function EditorCanvas({ resolveSrc, assetSize, onBoxes, onTextDoubleClick }: {
  resolveSrc: SrcResolver;
  assetSize: (id: string | null) => { width: number; height: number } | null;
  onBoxes?: (b: Boxes) => void;
  onTextDoubleClick?: (layerId: string) => void;
}) {
  const design = useEditor((s) => s.design);
  const previewing = useEditor((s) => s.previewing);
  const selection = useEditor((s) => s.selection);
  const zoom = useEditor((s) => s.zoom);
  const pan = useEditor((s) => s.pan);
  const version = useEditor((s) => s.version);
  const { select, updateLayers, checkpoint, setView, updateLayer } = useEditor.getState();
  const viewport = useRef<HTMLDivElement>(null);
  const sceneRoot = useRef<HTMLDivElement | null>(null);
  const [boxes, setBoxes] = useState<Boxes>({});
  const [hover, setHover] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [space, setSpace] = useState(false);
  const drag = useRef<DragState | null>(null);
  const shown = previewing?.design ?? design;

  // ---------------------------------------------------------------- measuring
  const measure = useCallback(() => {
    const root = sceneRoot.current;
    if (!root) return;
    const r0 = root.getBoundingClientRect();
    const z = useEditor.getState().zoom;
    const out: Boxes = {};
    root.querySelectorAll<HTMLElement>('[data-layer-id],[data-group-id]').forEach((el) => {
      const r = el.getBoundingClientRect();
      const id = el.getAttribute('data-layer-id');
      const group = el.getAttribute('data-group-id');
      const box: Box & { lines?: number } = { x: (r.left - r0.left) / z, y: (r.top - r0.top) / z, w: r.width / z, h: r.height / z };
      if (id) {
        const textEl = el.style.display === 'flex' ? (el.lastElementChild as HTMLElement) : el;
        const cs = getComputedStyle(textEl);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        box.lines = Math.max(1, Math.round(textEl.getBoundingClientRect().height / z / lh));
        out[id] = box;
      }
      if (group) out[`group:${group}`] = box;
    });
    setBoxes(out);
    onBoxes?.(out);
  }, [onBoxes]);

  useLayoutEffect(() => { measure(); }, [shown, zoom, measure]);
  useEffect(() => {
    // fonts and images change layout after first paint
    document.fonts?.ready.then(measure);
    const t = setTimeout(measure, 400);
    return () => clearTimeout(t);
  }, [version, measure]);

  // ---------------------------------------------------------------- fit / zoom
  const fit = useCallback(() => {
    const vp = viewport.current;
    const d = useEditor.getState().design;
    if (!vp || !d) return;
    const pad = 64;
    const z = Math.min((vp.clientWidth - pad * 2) / d.canvas.width, (vp.clientHeight - pad * 2) / d.canvas.height, 2);
    setView(z, { x: (vp.clientWidth - d.canvas.width * z) / 2, y: (vp.clientHeight - d.canvas.height * z) / 2 });
  }, [setView]);

  const zoomTo = useCallback((z: number, at?: { x: number; y: number }) => {
    const vp = viewport.current;
    if (!vp) return;
    const s = useEditor.getState();
    const nz = Math.min(8, Math.max(0.05, z));
    const px = at?.x ?? vp.clientWidth / 2;
    const py = at?.y ?? vp.clientHeight / 2;
    const cx0 = (px - s.pan.x) / s.zoom;
    const cy0 = (py - s.pan.y) / s.zoom;
    setView(nz, { x: px - cx0 * nz, y: py - cy0 * nz });
  }, [setView]);

  useEffect(() => { requestAnimationFrame(fit); }, [version, fit]);
  useEffect(() => {
    // the viewport, not the window: side panels (the arnifi.com preview) resize it too
    const vp = viewport.current;
    if (!vp) return;
    let last = `${vp.clientWidth}x${vp.clientHeight}`;
    const ro = new ResizeObserver(() => {
      const now = `${vp.clientWidth}x${vp.clientHeight}`;
      if (now !== last) { last = now; fit(); }
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [fit]);
  useEffect(() => {
    const w = window as unknown as { __acsCanvas?: unknown };
    w.__acsCanvas = { fit, zoomTo };
  }, [fit, zoomTo]);

  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const s = useEditor.getState();
      if (e.ctrlKey || e.metaKey) zoomTo(s.zoom * Math.exp(-e.deltaY * 0.0022), { x: e.clientX - r.left, y: e.clientY - r.top });
      else setView(s.zoom, { x: s.pan.x - e.deltaX, y: s.pan.y - e.deltaY });
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoomTo, setView]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('input,textarea,[contenteditable]')) { setSpace(true); e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // ---------------------------------------------------------------- pointer interactions
  if (!shown) return <div className="flex-1" />;
  const d = shown;
  const W = d.canvas.width;
  const H = d.canvas.height;
  const margin = d.canvas.safeMargin ?? 64 * Math.min(W / 1600, H / 1000);
  const readOnly = !!previewing;

  const toCanvas = (clientX: number, clientY: number) => {
    const r = viewport.current!.getBoundingClientRect();
    return { x: (clientX - r.left - pan.x) / zoom, y: (clientY - r.top - pan.y) / zoom };
  };

  const startMove = (e: React.PointerEvent, l: Layer) => {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    if (space) return startPanView(e);
    let ids = selection.includes(l.id) ? selection : [l.id];
    if (e.shiftKey) ids = selection.includes(l.id) ? selection.filter((x) => x !== l.id) : [...selection, l.id];
    select(ids);
    if (!ids.includes(l.id)) return;
    const s = useEditor.getState();
    const movable = (s.design?.layers ?? []).filter((x) => ids.includes(x.id) && !x.locked);
    if (!movable.length) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (movable.length === 1 && movable[0].type === 'background') {
      const bg = movable[0] as BackgroundLayer;
      drag.current = { kind: 'pan-image', startX: e.clientX, startY: e.clientY, ids: [bg.id], key: `pan:${bg.id}:${Date.now()}`,
        start: { [bg.id]: { x: bg.x, y: bg.y, width: bg.width, height: bg.height, focalX: bg.focalX, focalY: bg.focalY, offsetX: bg.offsetX, offsetY: bg.offsetY } } };
      return;
    }
    // a stacked kicker dragged on its own detaches from the headline flow
    const patches: Record<string, Partial<Layer>> = {};
    for (const m of movable) {
      if (m.type === 'text' && m.stackOn && !ids.includes(m.stackOn)) {
        const b = boxes[m.id];
        if (b) patches[m.id] = { stackOn: null, anchorY: 'top', x: b.x, y: b.y, width: Math.max(b.w, 120), height: b.h } as Partial<TextLayer>;
      }
    }
    if (Object.keys(patches).length) updateLayers(patches, 'detach');
    const fresh = useEditor.getState().design!;
    const start: DragState['start'] = {};
    for (const id of ids) {
      const x = fresh.layers.find((q) => q.id === id);
      if (x && !x.locked && x.type !== 'background' && x.type !== 'gradient' && !(x.type === 'text' && x.stackOn && ids.includes(x.stackOn))) start[id] = { x: x.x, y: x.y, width: x.width, height: x.height };
    }
    const union = unionBox(Object.keys(start).map((id) => layerBox(fresh.layers.find((q) => q.id === id)!, boxes, fresh)));
    drag.current = { kind: 'move', startX: e.clientX, startY: e.clientY, ids: Object.keys(start), start, startBox: union, key: `move:${Date.now()}` };
  };

  const startResize = (e: React.PointerEvent, l: Layer, handle: Handle) => {
    if (readOnly) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const b = layerBox(l, boxes, d);
    drag.current = { kind: 'resize', startX: e.clientX, startY: e.clientY, ids: [l.id], handle, key: `resize:${Date.now()}`,
      start: { [l.id]: { x: l.x, y: l.y, width: l.width, height: l.height } }, startBox: b };
  };

  const startPanView = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: 'pan-view', startX: e.clientX, startY: e.clientY, ids: [], start: {}, pan: { ...pan }, key: 'pan' };
  };

  const onViewportDown = (e: React.PointerEvent) => {
    if (e.button === 1 || space) return startPanView(e);
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (!e.shiftKey) select([]);
    drag.current = { kind: 'marquee', startX: e.clientX, startY: e.clientY, ids: e.shiftKey ? selection : [], start: {}, key: 'marquee' };
  };

  const onMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const dx = (e.clientX - g.startX) / zoom;
    const dy = (e.clientY - g.startY) / zoom;
    const cur = useEditor.getState().design!;
    if (g.kind === 'pan-view') {
      setView(zoom, { x: g.pan!.x + (e.clientX - g.startX), y: g.pan!.y + (e.clientY - g.startY) });
      return;
    }
    if (g.kind === 'marquee') {
      const a = toCanvas(g.startX, g.startY);
      const b = toCanvas(e.clientX, e.clientY);
      const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
      setMarquee(rect);
      const hit = cur.layers.filter((l) => l.visible && !l.locked && l.type !== 'background' && l.type !== 'gradient' && intersects(rect, layerBox(l, boxes, cur))).map((l) => l.id);
      select([...new Set([...g.ids, ...hit])]);
      return;
    }
    if (g.kind === 'pan-image') {
      const id = g.ids[0];
      const s0 = g.start[id];
      const bg = cur.layers.find((l) => l.id === id) as BackgroundLayer;
      if (bg.zoom !== 1 || bg.fit !== 'cover') {
        updateLayer(id, { offsetX: Math.round(s0.offsetX! + dx), offsetY: Math.round(s0.offsetY! + dy) } as Partial<BackgroundLayer>, g.key);
        return;
      }
      const sz = assetSize(bg.assetId);
      if (!sz) return;
      const scale = Math.max(bg.width / sz.width, bg.height / sz.height);
      const ox = sz.width * scale - bg.width;
      const oy = sz.height * scale - bg.height;
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      updateLayer(id, {
        focalX: ox > 0.5 ? +clamp(s0.focalX! - dx / ox).toFixed(4) : s0.focalX,
        focalY: oy > 0.5 ? +clamp(s0.focalY! - dy / oy).toFixed(4) : s0.focalY,
      } as Partial<BackgroundLayer>, g.key);
      return;
    }
    if (g.kind === 'move') {
      const others = cur.layers.filter((l) => l.visible && !g.ids.includes(l.id) && l.type !== 'background' && l.type !== 'gradient' && !(l.type === 'text' && l.stackOn && g.ids.includes(l.stackOn)))
        .map((l) => layerBox(l, boxes, cur));
      const moving = { ...g.startBox!, x: g.startBox!.x + dx, y: g.startBox!.y + dy };
      const snapped = e.altKey ? { dx: 0, dy: 0, gx: [], gy: [] } : snapBox(moving, others, W, H, margin, SNAP_PX / zoom);
      setGuides({ x: snapped.gx, y: snapped.gy });
      const patches: Record<string, Partial<Layer>> = {};
      for (const id of g.ids) {
        const s0 = g.start[id];
        patches[id] = { x: Math.round(s0.x + dx + snapped.dx), y: Math.round(s0.y + dy + snapped.dy) };
      }
      updateLayers(patches, g.key);
      return;
    }
    if (g.kind === 'resize') {
      const id = g.ids[0];
      const l = cur.layers.find((q) => q.id === id)!;
      const s0 = g.start[id];
      const h = g.handle!;
      let { x, y, width, height } = s0;
      const keep = l.type === 'logo' ? l.keepAspect : e.shiftKey;
      if (l.type === 'text') {
        if (h.includes('e')) width = Math.max(40, s0.width + dx);
        if (h.includes('w')) { width = Math.max(40, s0.width - dx); x = s0.x + (s0.width - width); }
        updateLayer(id, { x: Math.round(x), width: Math.round(width) }, g.key);
        return;
      }
      if (h.includes('e')) width = s0.width + dx;
      if (h.includes('w')) { width = s0.width - dx; x = s0.x + dx; }
      if (h.includes('s')) height = s0.height + dy;
      if (h.includes('n')) { height = s0.height - dy; y = s0.y + dy; }
      if (keep && h.length === 2) {
        const ratio = s0.width / s0.height;
        if (Math.abs(width / s0.width) > Math.abs(height / s0.height)) height = width / ratio; else width = height * ratio;
        if (h.includes('n')) y = s0.y + s0.height - height;
        if (h.includes('w')) x = s0.x + s0.width - width;
      }
      width = Math.max(8, width);
      height = Math.max(8, height);
      updateLayer(id, { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }, g.key);
    }
  };

  const onUp = () => {
    if (drag.current && drag.current.kind !== 'pan-view' && drag.current.kind !== 'marquee') checkpoint();
    drag.current = null;
    setGuides({ x: [], y: [] });
    setMarquee(null);
  };

  const sel = d.layers.filter((l) => selection.includes(l.id) && l.visible);
  const single = sel.length === 1 ? sel[0] : null;
  const hb = (b: Box) => ({ left: b.x * zoom, top: b.y * zoom, width: b.w * zoom, height: b.h * zoom });

  return (
    <div
      ref={viewport}
      className={cx('relative min-w-0 flex-1 overflow-hidden bg-[#ececec] select-none', space && 'cursor-grab')}
      onPointerDown={onViewportDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      data-testid="canvas-viewport"
    >
      <div style={{ position: 'absolute', left: pan.x, top: pan.y, width: W * zoom, height: H * zoom }}>
        <div className="shadow-[0_2px_10px_rgba(0,0,0,0.12)]" style={{ width: W, height: H, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
          <CardScene design={d} resolveSrc={resolveSrc} rootRef={(el) => { sceneRoot.current = el; sceneRef.current = el; }} />
        </div>

        {/* hit areas, in layer order so the topmost wins */}
        {!readOnly && [...d.layers].sort((a, b) => Number(a.type === 'text' && !!a.stackOn) - Number(b.type === 'text' && !!b.stackOn)).map((l) => {
          if (!l.visible || l.type === 'gradient') return null;
          if (l.type === 'text' && l.stackOn && d.layers.some((r) => r.id === l.stackOn && r.visible)) {
            const b = boxes[l.id];
            if (!b) return null;
            return <div key={l.id} style={hb(b)} className={cx('absolute', l.locked ? 'pointer-events-none' : 'cursor-move')}
              onPointerDown={(e) => startMove(e, l)} onPointerEnter={() => setHover(l.id)} onPointerLeave={() => setHover(null)} onDoubleClick={() => onTextDoubleClick?.(l.id)} />;
          }
          const b = layerBox(l, boxes, d);
          return (
            <div key={l.id} style={hb(b)} data-hit={l.id}
              className={cx('absolute', l.locked ? 'pointer-events-none' : l.type === 'background' ? 'cursor-grab' : 'cursor-move')}
              onPointerDown={(e) => startMove(e, l)} onPointerEnter={() => setHover(l.id)} onPointerLeave={() => setHover(null)}
              onDoubleClick={() => l.type === 'text' && onTextDoubleClick?.(l.id)} />
          );
        })}

        {/* hover + selection outlines, overflow warnings */}
        {!readOnly && hover && !selection.includes(hover) && (() => {
          const l = getLayer(d, hover);
          if (!l || l.type === 'background') return null;
          const b = l.type === 'text' && l.stackOn ? boxes[l.id] : layerBox(l, boxes, d);
          return b ? <div className="pointer-events-none absolute border border-[#111]/40" style={hb(b)} /> : null;
        })()}
        {d.layers.map((l) => {
          if (l.type !== 'text' || !l.visible || !l.text) return null;
          const b = boxes[l.id];
          return b && (b.lines ?? 1) > l.maxLines ? <div key={`ovf-${l.id}`} className="pointer-events-none absolute border border-dashed border-err" style={hb(b)} /> : null;
        })}
        {!readOnly && sel.map((l) => {
          const b = l.type === 'text' && l.stackOn && sel.every((x) => x.id !== l.stackOn) ? boxes[l.id] : layerBox(l, boxes, d);
          if (!b) return null;
          return <div key={`sel-${l.id}`} className={cx('pointer-events-none absolute border', l.type === 'background' ? 'border-[#111]/60 border-dashed' : 'border-ink')} style={hb(b)} />;
        })}
        {!readOnly && single && !single.locked && single.type !== 'background' && single.type !== 'gradient' && !(single.type === 'text' && single.stackOn)
          ? <Handles box={layerBox(single, boxes, d)} zoom={zoom} layer={single} onDown={(e, h) => startResize(e, single, h)} /> : null}

        {/* snapping guides + safe margins while dragging */}
        {guides.x.length || guides.y.length ? (
          <>
            <div className="pointer-events-none absolute border border-dashed border-[#ff3b6b]/40" style={{ left: margin * zoom, top: margin * zoom, width: (W - 2 * margin) * zoom, height: (H - 2 * margin) * zoom }} />
            {guides.x.map((x, i) => <div key={`gx${i}`} className="pointer-events-none absolute w-px bg-[#ff3b6b]" style={{ left: x * zoom, top: -8, height: H * zoom + 16 }} />)}
            {guides.y.map((y, i) => <div key={`gy${i}`} className="pointer-events-none absolute h-px bg-[#ff3b6b]" style={{ top: y * zoom, left: -8, width: W * zoom + 16 }} />)}
          </>
        ) : null}
        {marquee ? <div className="pointer-events-none absolute border border-ink bg-ink/5" style={hb(marquee)} /> : null}
      </div>
      {previewing ? (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-ink px-3 py-1 text-[12px] text-white shadow">Previewing {previewing.label} · read only</div>
      ) : null}
    </div>
  );
}

function unionBox(bs: Box[]): Box {
  const x0 = Math.min(...bs.map((b) => b.x));
  const y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.w));
  const y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Snap a moving box's edges/centre to the canvas centre, safe margins, edges and other layers. */
function snapBox(m: Box, others: Box[], W: number, H: number, margin: number, t: number) {
  const tx = [0, W / 2, W, margin, W - margin, ...others.flatMap((b) => [b.x, b.x + b.w / 2, b.x + b.w])];
  const ty = [0, H / 2, H, margin, H - margin, ...others.flatMap((b) => [b.y, b.y + b.h / 2, b.y + b.h])];
  const ex = [m.x, m.x + m.w / 2, m.x + m.w];
  const ey = [m.y, m.y + m.h / 2, m.y + m.h];
  let bx: { d: number; g: number } | null = null;
  for (const target of tx) for (const e of ex) { const d = target - e; if (Math.abs(d) <= t && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, g: target }; }
  let by: { d: number; g: number } | null = null;
  for (const target of ty) for (const e of ey) { const d = target - e; if (Math.abs(d) <= t && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, g: target }; }
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0, gx: bx ? [bx.g] : [], gy: by ? [by.g] : [] };
}

function Handles({ box, zoom, layer, onDown }: { box: Box; zoom: number; layer: Layer; onDown: (e: React.PointerEvent, h: Handle) => void }) {
  const text = layer.type === 'text';
  const keep = layer.type === 'logo' && layer.keepAspect;
  const all: Handle[] = text ? ['e', 'w'] : keep ? ['nw', 'ne', 'se', 'sw'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const pos = (h: Handle) => {
    const x = h.includes('w') ? 0 : h.includes('e') ? box.w : box.w / 2;
    const y = h.includes('n') ? 0 : h.includes('s') ? box.h : box.h / 2;
    return { left: (box.x + x) * zoom - 4.5, top: (box.y + y) * zoom - 4.5 };
  };
  const cursor: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
  return (
    <>
      {all.map((h) => (
        <div key={h} data-handle={h} onPointerDown={(e) => onDown(e, h)} style={{ ...pos(h), cursor: cursor[h] }}
          className="absolute size-[9px] rounded-[2px] border-[1.5px] border-ink bg-white shadow-[0_0_0_1px_rgba(255,255,255,.7)]" />
      ))}
    </>
  );
}
