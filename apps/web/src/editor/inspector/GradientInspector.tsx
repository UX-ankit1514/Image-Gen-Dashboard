/** Gradient layer (PRD §22): enabled, opacity, angle, colours, position, blend, presets; apply beyond this card. */
import { Plus, Trash2 } from 'lucide-react';
import type { BlendMode, Fill, GradientLayer, GradientPatch, LinearFill } from '@acs/types';
import { applyGradientPatch, applyGradientPreset, GRADIENT_PRESETS, stopColor } from '@acs/renderer';
import { useEditor } from '../store';
import { useEditorCtx } from '../context';
import { Button, ColorField, IconButton, Menu, MenuItem, NumberField, Select, Slider, Switch } from '../../ui';
import { Row, Section } from './parts';

const BLENDS: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'darken', 'lighten', 'color', 'luminosity', 'hue', 'saturation'];

function hexOf(f: LinearFill | undefined, i: number) {
  const s = f?.stops[i === 0 ? 0 : f.stops.length - 1];
  return s?.color ?? '#000000';
}

export function GradientInspector({ layer }: { layer: GradientLayer }) {
  const apply = useEditor((s) => s.apply);
  const update = useEditor((s) => s.updateLayer);
  const ctx = useEditorCtx();
  const patch = (p: GradientPatch, key?: string) => apply((d) => applyGradientPatch(d, p), key);
  const lin = layer.fills.find((f) => f.kind === 'linear') as LinearFill | undefined;
  const preset = GRADIENT_PRESETS.find((p) => p.id === layer.preset);
  const fieldOnly = !lin;
  const startAlpha = lin?.stops[0]?.alpha ?? 1;
  const endAlpha = lin?.stops[lin.stops.length - 1]?.alpha ?? 0;
  const position = lin?.stops[lin.stops.length - 1]?.pos ?? 100;

  const setFill = (i: number, f: Partial<Fill>) => update(layer.id, { fills: layer.fills.map((x, j) => (j === i ? ({ ...x, ...f } as Fill) : x)) } as Partial<GradientLayer>, `fill:${i}`);
  const beyond = (scope: 'selected' | 'project' | 'project_default') =>
    ctx.applyBeyond(scope, { action: 'patch', reason: `Gradient: ${layer.preset}`, overrides: { layers: { gradient: { preset: layer.preset, fills: layer.fills, opacity: layer.opacity, visible: layer.visible } } } });

  return (
    <>
      <Section title="Gradient" action={<Switch checked={layer.visible} onCheckedChange={(visible) => update(layer.id, { visible })} label="Gradient enabled" />}>
        <Row label="Preset">
          <Select size="sm" value={preset ? layer.preset : '__custom'} onChange={(v) => v !== '__custom' && apply((d) => applyGradientPreset(d, v))}
            options={[...GRADIENT_PRESETS.map((p) => ({ value: p.id, label: p.name })), ...(!preset ? [{ value: '__custom', label: layer.preset }] : [])]} />
        </Row>
        <Row label="Opacity">
          <div className="flex items-center gap-2">
            <Slider value={layer.opacity} onChange={(opacity) => update(layer.id, { opacity }, 'g-op')} label="Gradient opacity" />
            <span className="w-9 text-right text-[12px] text-muted tabular-nums">{Math.round(layer.opacity * 100)}%</span>
          </div>
        </Row>
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" onClick={() => patch({ darken: 0.12 }, 'darken')}>Darker</Button>
          <Button size="sm" onClick={() => patch({ darken: -0.12 }, 'lighten')}>Lighter</Button>
        </div>
      </Section>

      <Section title={fieldOnly ? 'Colour field' : 'Linear fill'}>
        {fieldOnly ? (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-muted">{preset?.description ?? 'An image-based colour field.'} Its colours come from the field image, so there are no stops to edit.</p>
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => patch({ angle: 90, start: '#080808', startAlpha: 0.6, end: 'transparent', position: 70 })}>Add a linear fade on top</Button>
          </div>
        ) : (
          <>
            <Row label="Angle"><NumberField value={lin!.angle} suffix="°" onChange={(angle) => patch({ angle }, 'angle')} /></Row>
            <Row label="Start"><ColorField value={hexOf(lin, 0)} onChange={(start) => patch({ start, startAlpha }, 'start')} /></Row>
            <Row label="Start alpha">
              <Slider value={startAlpha} onChange={(v) => patch({ startAlpha: +v.toFixed(2) }, 'sa')} label="Start alpha" />
            </Row>
            <Row label="End"><ColorField value={hexOf(lin, 1)} onChange={(end) => patch({ end, endAlpha: endAlpha || 0 }, 'end')} /></Row>
            <Row label="End alpha">
              <Slider value={endAlpha} onChange={(v) => patch({ endAlpha: +v.toFixed(2) }, 'ea')} label="End alpha" />
            </Row>
            <Row label="Position">
              <div className="flex items-center gap-2">
                <Slider value={position} min={5} max={100} step={1} onChange={(v) => patch({ position: v }, 'pos')} label="Fade position" />
                <span className="w-9 text-right text-[12px] text-muted tabular-nums">{Math.round(position)}%</span>
              </div>
            </Row>
            <Row label="Blend">
              <Select size="sm" value={lin!.blend} onChange={(blend) => patch({ blend }, 'blend')} options={BLENDS.map((b) => ({ value: b, label: b }))} />
            </Row>
          </>
        )}
      </Section>

      <Section title="Layers in this gradient">
        {layer.fills.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="size-5 shrink-0 rounded border border-line" style={{
              background: f.kind === 'linear' || f.kind === 'radial' ? `linear-gradient(90deg,${f.stops.map((s) => stopColor(s)).join(',')})` : f.kind === 'pattern' ? '#999' : 'linear-gradient(180deg,#7487d3,#232656)',
            }} />
            <span className="min-w-0 flex-1 truncate text-[12px]">{f.name ?? f.kind} <span className="text-faint">· {f.blend}</span></span>
            <div className="w-16"><Slider value={f.opacity} onChange={(opacity) => setFill(i, { opacity: +opacity.toFixed(2) })} label={`${f.name ?? f.kind} opacity`} /></div>
            <IconButton size="sm" label="Remove" onClick={() => update(layer.id, { fills: layer.fills.filter((_, j) => j !== i) } as Partial<GradientLayer>)}><Trash2 className="size-3" /></IconButton>
          </div>
        ))}
        <Menu align="start" trigger={<Button size="sm" variant="secondary">Apply this gradient to…</Button>}>
          <MenuItem onSelect={() => beyond('project')}>Every card in the project</MenuItem>
          <MenuItem onSelect={() => beyond('project_default')}>The project default</MenuItem>
        </Menu>
      </Section>
    </>
  );
}
