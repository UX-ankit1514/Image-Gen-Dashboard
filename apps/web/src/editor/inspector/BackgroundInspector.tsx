/** Background layer (PRD §21): source, replace/generate, fit, focal point, zoom, reposition, flip, reset. */
import { useRef } from 'react';
import { FlipHorizontal2, FlipVertical2, ImagePlus, RotateCcw, Sparkles } from 'lucide-react';
import type { BackgroundLayer } from '@acs/types';
import { PHOTO_DARK, PHOTO_LIGHT, PHOTO_NEUTRAL } from '@acs/renderer';
import { useEditor } from '../store';
import { useEditorCtx } from '../context';
import { Badge, Button, IconButton, NumberField, Segmented, Slider, Tip } from '../../ui';
import { Row, Section } from './parts';

const SOURCE: Record<string, string> = { website: 'Website', generated: 'Generated', uploaded: 'Uploaded', project: 'Project asset', previous: 'Previous version', none: 'None' };

export function BackgroundInspector({ layer }: { layer: BackgroundLayer }) {
  const update = useEditor((s) => s.updateLayer);
  const ctx = useEditorCtx();
  const asset = layer.assetId ? ctx.assets.get(layer.assetId) : undefined;
  const set = (p: Partial<BackgroundLayer>, key?: string) => update(layer.id, p, key);
  const adj = layer.adjust;
  return (
    <>
      <Section title="Image">
        <div className="flex items-center gap-2">
          <div className="size-14 shrink-0 overflow-hidden rounded-md bg-hover">
            {asset?.thumbUrl ? <img src={asset.thumbUrl} alt="" className="size-full object-cover" /> : null}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-medium">{asset?.name ?? 'No image'}</div>
            <div className="text-[11.5px] text-muted">{SOURCE[layer.source] ?? layer.source}{asset ? ` · ${asset.width} × ${asset.height}` : ''}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => ctx.pickImage('background')}>Replace</Button>
          <Tip label={ctx.canGenerate ? 'Generate a new background' : 'Connect ChatGPT under AI Connections to generate'}>
            <span><Button size="sm" className="w-full" icon={<Sparkles className="size-3.5" />} disabled={!ctx.canGenerate} onClick={ctx.generateBackground}>Generate</Button></span>
          </Tip>
        </div>
      </Section>

      <Section title="Framing" action={<IconButton size="sm" label="Reset framing" onClick={() => set({ fit: 'cover', focalX: 0.5, focalY: 0.42, zoom: 1, offsetX: 0, offsetY: 0, flipX: false, flipY: false })}><RotateCcw className="size-3.5" /></IconButton>}>
        <Segmented size="sm" value={layer.fit} onChange={(fit) => set({ fit })} options={[{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }, { value: 'fill', label: 'Fill' }, { value: 'original', label: 'Original' }]} />
        <FocalPicker layer={layer} thumb={asset?.thumbUrl ?? null} onChange={(focalX, focalY) => set({ focalX, focalY }, `focal:${layer.id}`)} onEnd={() => useEditor.getState().checkpoint()} />
        <Row label="Zoom">
          <div className="flex items-center gap-2">
            <Slider value={layer.zoom} min={1} max={4} step={0.01} onChange={(zoom) => set({ zoom }, `zoom:${layer.id}`)} label="Zoom" />
            <span className="w-10 text-right text-[12px] text-muted tabular-nums">{layer.zoom.toFixed(2)}×</span>
          </div>
        </Row>
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField label="X" value={layer.offsetX} onChange={(offsetX) => set({ offsetX }, `off:${layer.id}`)} />
          <NumberField label="Y" value={layer.offsetY} onChange={(offsetY) => set({ offsetY }, `off:${layer.id}`)} />
        </div>
        <div className="flex items-center gap-1">
          <IconButton size="sm" label="Flip horizontally" active={layer.flipX} onClick={() => set({ flipX: !layer.flipX })}><FlipHorizontal2 className="size-3.5" /></IconButton>
          <IconButton size="sm" label="Flip vertically" active={layer.flipY} onClick={() => set({ flipY: !layer.flipY })}><FlipVertical2 className="size-3.5" /></IconButton>
          <span className="ml-auto text-[11.5px] text-faint">Drag the image on the canvas to reposition</span>
        </div>
      </Section>

      <Section title="Photo grade" action={
        <div className="flex gap-1">
          <button className="text-[11px] text-muted hover:text-ink" onClick={() => set({ adjust: { ...PHOTO_LIGHT } })}>Light</button>
          <span className="text-faint">·</span>
          <button className="text-[11px] text-muted hover:text-ink" onClick={() => set({ adjust: { ...PHOTO_DARK } })}>Dark</button>
          <span className="text-faint">·</span>
          <button className="text-[11px] text-muted hover:text-ink" onClick={() => set({ adjust: { ...PHOTO_NEUTRAL } })}>None</button>
        </div>}>
        {(['saturate', 'contrast', 'brightness'] as const).map((k) => (
          <Row key={k} label={k === 'saturate' ? 'Saturation' : k[0].toUpperCase() + k.slice(1)}>
            <div className="flex items-center gap-2">
              <Slider value={adj[k]} min={0} max={2} step={0.01} onChange={(v) => set({ adjust: { ...adj, [k]: +v.toFixed(2) } }, `adj:${k}`)} label={k} />
              <span className="w-9 text-right text-[12px] text-muted tabular-nums">{adj[k].toFixed(2)}</span>
            </div>
          </Row>
        ))}
        {layer.source === 'generated' ? <Badge tone="info">Generated image</Badge> : null}
      </Section>
    </>
  );
}

/** Focal point stored independently (PRD §21): drag the crosshair on the thumbnail. */
function FocalPicker({ layer, thumb, onChange, onEnd }: { layer: BackgroundLayer; thumb: string | null; onChange: (x: number, y: number) => void; onEnd: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(+Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)).toFixed(3), +Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)).toFixed(3));
  };
  return (
    <div>
      <div className="mb-1 flex justify-between text-[12px] text-muted"><span>Focal point</span><span className="tabular-nums">{Math.round(layer.focalX * 100)}% · {Math.round(layer.focalY * 100)}%</span></div>
      <div ref={ref} className="relative aspect-[1.6] cursor-crosshair overflow-hidden rounded-md bg-hover"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); at(e); }}
        onPointerMove={(e) => e.buttons === 1 && at(e)} onPointerUp={onEnd}>
        {thumb ? <img src={thumb} alt="" draggable={false} className="size-full object-contain" /> : null}
        <div className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.5)]" style={{ left: `${layer.focalX * 100}%`, top: `${layer.focalY * 100}%` }} />
      </div>
    </div>
  );
}
