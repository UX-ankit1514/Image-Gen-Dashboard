/** Logo layer (PRD §24): position, size, scale, opacity, aspect lock, snap to safe area, warnings. */
import { AlignStartVertical, ImagePlus } from 'lucide-react';
import type { CardWarning, LogoLayer } from '@acs/types';
import { useEditor } from '../store';
import { useEditorCtx } from '../context';
import { Badge, Button, Segmented, Slider, Switch } from '../../ui';
import { Row, Section } from './parts';

export function LogoInspector({ layer, warnings }: { layer: LogoLayer; warnings: CardWarning[] }) {
  const update = useEditor((s) => s.updateLayer);
  const design = useEditor((s) => s.design)!;
  const ctx = useEditorCtx();
  const set = (p: Partial<LogoLayer>, key?: string) => update(layer.id, p, key);
  const margin = design.canvas.safeMargin ?? 64;
  const scale = layer.width / 196;
  const mine = warnings.filter((w) => w.code.startsWith('logo'));
  return (
    <Section title="Logo">
      <Row label="Scale">
        <div className="flex items-center gap-2">
          <Slider value={scale} min={0.3} max={3} step={0.01} onChange={(s) => set({ width: Math.round(196 * s), height: Math.round(196 * s * (layer.height / layer.width)) }, 'logo-scale')} label="Logo scale" />
          <span className="w-9 text-right text-[12px] text-muted tabular-nums">{Math.round(scale * 100)}%</span>
        </div>
      </Row>
      <Row label="Keep ratio"><Switch checked={layer.keepAspect} onCheckedChange={(keepAspect) => set({ keepAspect })} label="Preserve aspect ratio" /></Row>
      {layer.src === 'builtin:arnifi-logo' ? (
        <Row label="Colour">
          <Segmented size="sm" value={layer.color === '#FFFFFF' || layer.color === '#ffffff' ? 'white' : layer.color === '#111111' ? 'ink' : 'brand'}
            onChange={(v) => set({ color: v === 'white' ? '#FFFFFF' : v === 'ink' ? '#111111' : null })}
            options={[{ value: 'white', label: 'White' }, { value: 'ink', label: 'Black' }, { value: 'brand', label: 'Brand' }]} />
        </Row>
      ) : null}
      <Row label="Shadow"><Switch checked={!!layer.shadow} onCheckedChange={(on) => set({ shadow: on ? { x: 0, y: 2, blur: 12, color: 'rgba(0,0,0,.55)' } : null })} label="Drop shadow" /></Row>
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" icon={<AlignStartVertical className="size-3.5" />} onClick={() => set({ x: Math.round(margin), y: Math.round(margin * 0.8125) })}>Snap to safe area</Button>
        <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => ctx.pickImage('logo')}>Other logo</Button>
      </div>
      {mine.length ? <div className="flex flex-col gap-1">{mine.map((w, i) => <Badge key={i} tone="warn" className="h-auto py-1 whitespace-normal">{w.message}</Badge>)}</div> : null}
    </Section>
  );
}
