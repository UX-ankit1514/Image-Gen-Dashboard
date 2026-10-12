import { Eye, EyeOff, Lock, Unlock } from 'lucide-react';
import type { Layer } from '@acs/types';
import { useEditor } from '../store';
import { IconButton, NumberField, Slider } from '../../ui';
import { Grid2, Row, Section } from './parts';

export function LayerHeader({ layer }: { layer: Layer }) {
  const update = useEditor((s) => s.updateLayer);
  return (
    <div className="flex h-12 items-center gap-2 border-b border-line px-4">
      <input
        value={layer.name}
        onChange={(e) => update(layer.id, { name: e.target.value }, `name:${layer.id}`)}
        className="min-w-0 flex-1 rounded px-1 py-0.5 text-[13.5px] font-semibold outline-none focus:bg-hover"
        aria-label="Layer name"
      />
      <IconButton size="sm" label={layer.visible ? 'Hide layer' : 'Show layer'} onClick={() => update(layer.id, { visible: !layer.visible })}>
        {layer.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
      </IconButton>
      <IconButton size="sm" label={layer.locked ? 'Unlock layer' : 'Lock layer'} onClick={() => update(layer.id, { locked: !layer.locked })}>
        {layer.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
      </IconButton>
    </div>
  );
}

export function Geometry({ layer, height = true }: { layer: Layer; height?: boolean }) {
  const update = useEditor((s) => s.updateLayer);
  const k = `geo:${layer.id}`;
  return (
    <Section title="Position">
      <Grid2>
        <NumberField label="X" value={layer.x} onChange={(x) => update(layer.id, { x }, k)} />
        <NumberField label="Y" value={layer.y} onChange={(y) => update(layer.id, { y }, k)} />
        <NumberField label="W" value={layer.width} min={8} onChange={(width) => update(layer.id, { width }, k)} />
        {height ? <NumberField label="H" value={layer.height} min={8} onChange={(h) => update(layer.id, { height: h }, k)} /> : <div />}
        <NumberField label="↻" value={layer.rotation} suffix="°" onChange={(rotation) => update(layer.id, { rotation }, k)} />
      </Grid2>
      <Row label="Opacity">
        <div className="flex items-center gap-2">
          <Slider value={layer.opacity} onChange={(opacity) => update(layer.id, { opacity }, `op:${layer.id}`)} label="Opacity" />
          <span className="w-9 text-right text-[12px] text-muted tabular-nums">{Math.round(layer.opacity * 100)}%</span>
        </div>
      </Row>
    </Section>
  );
}
