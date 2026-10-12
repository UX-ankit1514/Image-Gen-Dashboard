/** Before / after (PRD §45): side by side, slider (clip-path), overlay (opacity). */
import { useRef, useState } from 'react';
import type { VersionX } from '../lib/types';
import { Dialog, Segmented, Select, Slider } from '../ui';

export function CompareDialog({ open, onOpenChange, versions, initialA }: { open: boolean; onOpenChange: (v: boolean) => void; versions: VersionX[]; initialA: VersionX }) {
  const [mode, setMode] = useState<'side' | 'slider' | 'overlay'>('slider');
  const [aId, setA] = useState(initialA.id);
  const [bId, setB] = useState(versions.find((v) => v.id !== initialA.id)?.id ?? initialA.id);
  const [split, setSplit] = useState(50);
  const [opacity, setOpacity] = useState(0.5);
  const box = useRef<HTMLDivElement>(null);
  const a = versions.find((v) => v.id === aId)!;
  const b = versions.find((v) => v.id === bId)!;
  const opts = versions.map((v) => ({ value: v.id, label: `V${v.number} · ${v.reason.slice(0, 40)}` }));
  const aspect = a.width / a.height;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Compare versions" width={1100}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-64"><Select size="sm" value={aId} onChange={setA} options={opts} label="Before" /></div>
        <span className="text-muted">vs</span>
        <div className="w-64"><Select size="sm" value={bId} onChange={setB} options={opts} label="After" /></div>
        <Segmented size="sm" className="ml-auto" value={mode} onChange={setMode} options={[{ value: 'side', label: 'Side by side' }, { value: 'slider', label: 'Slider' }, { value: 'overlay', label: 'Overlay' }]} />
      </div>
      {mode === 'side' ? (
        <div className="grid grid-cols-2 gap-3">
          {[a, b].map((v) => (
            <figure key={v.id}>
              <img src={v.previewUrl ?? v.thumbUrl ?? ''} alt="" className="w-full rounded-md bg-hover" style={{ aspectRatio: String(v.width / v.height) }} />
              <figcaption className="mt-1 text-[12px] text-muted">V{v.number} · {v.reason}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div ref={box} className="relative w-full overflow-hidden rounded-md bg-hover select-none" style={{ aspectRatio: String(aspect) }}
          onPointerMove={(e) => { if (mode !== 'slider' || (e.buttons !== 1 && e.pointerType === 'mouse')) return; const r = box.current!.getBoundingClientRect(); setSplit(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))); }}
          onPointerDown={(e) => { if (mode !== 'slider') return; const r = box.current!.getBoundingClientRect(); setSplit(((e.clientX - r.left) / r.width) * 100); }}>
          <img src={a.previewUrl ?? ''} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
          <img src={b.previewUrl ?? ''} alt="" draggable={false} className="absolute inset-0 size-full object-cover"
            style={mode === 'slider' ? { clipPath: `inset(0 0 0 ${split}%)` } : { opacity }} />
          {mode === 'slider' ? (
            <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.25)]" style={{ left: `${split}%` }}>
              <div className="absolute top-1/2 left-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/30" />
            </div>
          ) : null}
          <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 text-[11px] text-white">V{a.number}</span>
          <span className="absolute top-2 right-2 rounded bg-black/60 px-1.5 text-[11px] text-white">V{b.number}</span>
        </div>
      )}
      {mode === 'overlay' ? <div className="mt-3 flex items-center gap-3"><span className="text-[12px] text-muted">V{a.number}</span><Slider value={opacity} onChange={setOpacity} label="Overlay opacity" /><span className="text-[12px] text-muted">V{b.number}</span></div> : null}
    </Dialog>
  );
}
