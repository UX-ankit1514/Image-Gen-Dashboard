/** Canvas resize (PRD §27–28). The previous size is kept as a version. */
import { useState } from 'react';
import { useBootstrap } from '../lib/queries';
import { Button, cx, Dialog, Field, Input, Segmented } from '../ui';

export interface ResizeChoice { width: number; height: number; mode: 'scale' | 'keep' | 'reflow'; fit: 'cover' | 'contain' }

export function ResizeDialog({ open, onOpenChange, initial, onResize, busy, title = 'Resize canvas' }: {
  open: boolean; onOpenChange: (v: boolean) => void; initial: { width: number; height: number }; onResize: (c: ResizeChoice) => void; busy?: boolean; title?: string;
}) {
  const { data: boot } = useBootstrap();
  const [w, setW] = useState(initial.width);
  const [h, setH] = useState(initial.height);
  const [mode, setMode] = useState<ResizeChoice['mode']>('scale');
  const [fit, setFit] = useState<ResizeChoice['fit']>('cover');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} width={520}
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={w === initial.width && h === initial.height} onClick={() => onResize({ width: w, height: h, mode, fit })}>Resize</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          {(boot?.dimensionPresets ?? []).map((p) => (
            <button key={p.label} onClick={() => { setW(p.width); setH(p.height); }} className={cx('press h-7 rounded-md border px-2.5 text-[12.5px] tabular-nums', w === p.width && h === p.height ? 'border-ink bg-ink text-white' : 'border-line bg-panel hover:border-line-strong')}>{p.label}</button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <Field label="W" className="w-28"><Input type="number" value={w} onChange={(e) => setW(Math.max(16, Math.min(8192, Number(e.target.value) || 16)))} /></Field>
          <span className="pb-2 text-muted">×</span>
          <Field label="H" className="w-28"><Input type="number" value={h} onChange={(e) => setH(Math.max(16, Math.min(8192, Number(e.target.value) || 16)))} /></Field>
          <span className="pb-2 text-[12px] text-muted">from {initial.width} × {initial.height}</span>
        </div>
        <Field label="Layout">
          <div className="flex flex-col gap-1.5">
            {([['scale', 'Scale layout proportionally', 'Positions stay relative; logo, text and margins scale.'], ['keep', 'Keep element sizes', 'Positions stay relative; nothing changes size.'], ['reflow', 'Reflow using template', 'Re-anchor to the edges each element hugs, scaled margins.']] as const).map(([v, t, d]) => (
              <button key={v} onClick={() => setMode(v)} className={cx('press flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left', mode === v ? 'border-ink' : 'border-line hover:border-line-strong')}>
                <span className={cx('mt-0.5 size-3.5 shrink-0 rounded-full border', mode === v ? 'border-[4px] border-ink' : 'border-line-strong')} />
                <span><span className="block text-[13px] font-medium">{t}</span><span className="block text-[12px] text-muted">{d}</span></span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Background">
          <Segmented value={fit} onChange={setFit} options={[{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }]} />
        </Field>
      </div>
    </Dialog>
  );
}
