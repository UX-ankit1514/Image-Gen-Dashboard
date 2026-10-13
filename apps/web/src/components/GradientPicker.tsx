/**
 * "My gradients": gradients the team designed elsewhere and uploads as images. They live with the
 * global brand assets, so one upload serves every project. A PNG with transparency goes on top of the
 * photo as designed; a solid gradient tints it. The mix is detected and can be switched.
 */
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { GRADIENT_MIXES, type GradientMix } from '@acs/renderer';
import { api } from '../lib/api';
import { useProjectAssets } from '../lib/queries';
import type { AssetX } from '../lib/types';
import { cx, Segmented, Spinner } from '../ui';

export interface GradientChoice { assetId: string; mix: GradientMix }

export function useGradients() {
  const q = useProjectAssets(null);
  const data = useMemo(() => (q.data ?? []).filter((a) => a.type === 'gradient' && a.status !== 'failed'), [q.data]);
  return { ...q, data };
}

/** The URL to draw a gradient asset with (the 2000px preview for very large files). */
export const gradientUrl = (a: AssetX | undefined) => (a ? (a.width > 2000 ? a.previewUrl : a.url) ?? a.url : null);

/** Whether a picked file has any see-through pixels, read locally before it uploads. */
async function hasTransparency(file: File): Promise<boolean> {
  if (file.type === 'image/jpeg') return false;
  try {
    const bmp = await createImageBitmap(file);
    const w = Math.min(96, bmp.width);
    const h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return true;
    return false;
  } catch {
    return file.type === 'image/png';
  }
}

export const defaultMix = (a: AssetX | undefined, local?: boolean): GradientMix => ((local ?? a?.flags.hasAlpha) ? 'designed' : 'tint');

export function GradientPicker({ value, onChange, compact }: {
  value: GradientChoice | null;
  onChange: (v: GradientChoice) => void;
  /** narrower tiles for the editor inspector */
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const { data: gradients, isLoading } = useGradients();
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  // transparency read from files uploaded in this session, until ingest records it on the asset
  const [local, setLocal] = useState<Record<string, boolean>>({});

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const alpha = await hasTransparency(file);
      const a = await api.upload<AssetX>('/assets', file, { purpose: 'gradient' });
      return { a, alpha };
    },
    onSuccess: ({ a, alpha }) => {
      setLocal((m) => ({ ...m, [a.id]: alpha }));
      qc.setQueryData<AssetX[]>(['assets', 'global'], (cur) => [a, ...(cur ?? [])]);
      void qc.invalidateQueries({ queryKey: ['assets', 'global'] });
      onChange({ assetId: a.id, mix: alpha ? 'designed' : 'tint' });
      toast.success(alpha ? 'Gradient saved. It has transparency, so it goes on top as designed.' : 'Gradient saved. It’s solid, so it tints the photo.');
    },
    onError: (e) => toast.error(e.message),
  });
  const accept = (f: File | undefined) => {
    if (!f) return;
    if (!/image\/(png|jpe?g|webp)/.test(f.type)) { toast.error('Use a PNG, JPG or WebP file.'); return; }
    upload.mutate(f);
  };

  const selected = gradients.find((g) => g.id === value?.assetId);
  const mix = GRADIENT_MIXES.find((m) => m.id === value?.mix);
  const tile = compact ? 'h-14' : 'h-[72px]';

  return (
    <div className="flex flex-col gap-3">
      <div className={cx('grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-[repeat(auto-fill,minmax(112px,1fr))]')}>
        <button type="button" onClick={() => ref.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); accept(e.dataTransfer.files[0]); }}
          className={cx('press flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-panel text-[12px] text-muted', tile, over ? 'border-ink text-ink' : 'border-line-strong hover:border-ink hover:text-ink')}>
          {upload.isPending ? <Spinner className="size-4" /> : <Plus className="size-4" />}
          {upload.isPending ? 'Uploading…' : 'Upload gradient'}
        </button>
        {isLoading ? <div className={cx('skeleton rounded-lg', tile)} /> : null}
        {gradients.map((g) => {
          const on = g.id === value?.assetId;
          return (
            <button key={g.id} type="button" title={g.name} aria-pressed={on}
              onClick={() => onChange({ assetId: g.id, mix: on && value ? value.mix : defaultMix(g, local[g.id]) })}
              className={cx('press checker relative overflow-hidden rounded-lg border', tile, on ? 'border-ink shadow-[0_0_0_1px_#111]' : 'border-line hover:border-line-strong')}>
              {g.thumbUrl ?? g.url ? <img src={g.thumbUrl ?? g.url ?? ''} alt="" className="absolute inset-0 size-full object-cover" /> : <div className="skeleton absolute inset-0" />}
            </button>
          );
        })}
      </div>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { accept(e.target.files?.[0]); e.target.value = ''; }} />
      {!gradients.length && !isLoading ? (
        <p className="text-[12px] text-muted">Export your gradient at the card size (1600 × 1000). A PNG with see-through areas is laid over the photo exactly as designed; a solid gradient tints the photo.</p>
      ) : null}
      {selected && value ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="shrink-0 font-medium">{compact ? 'Mix' : 'How it mixes with the photo'}</span>
            <span className="min-w-0 truncate text-faint" title={selected.name}>{selected.name}{selected.width && !compact ? ` · ${selected.width} × ${selected.height}` : ''}</span>
          </div>
          <Segmented size={compact ? 'sm' : 'md'} value={value.mix} onChange={(m) => onChange({ ...value, mix: m })}
            options={GRADIENT_MIXES.map((m) => ({ value: m.id, label: <span className={cx('whitespace-nowrap', compact && 'text-[11.5px]')}>{compact && m.id === 'designed' ? 'Designed' : m.name}</span>, title: m.description }))} />
          <p className="text-[11.5px] leading-snug text-muted">{mix?.description}{value.mix !== defaultMix(selected, local[selected.id]) ? ' (Detected: ' + (defaultMix(selected, local[selected.id]) === 'designed' ? 'has transparency' : 'solid') + '.)' : ''}</p>
        </div>
      ) : null}
    </div>
  );
}
