/**
 * Heading / subheading (PRD §25–26, §94): content with provenance, typography, overflow with an
 * auto-fit that never goes below a readable size, and AI suggestions that never silently replace
 * the source copy.
 */
import { AlignCenter, AlignLeft, AlignRight, Link2, Link2Off, RotateCcw, Scissors, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CardWarning, TextLayer } from '@acs/types';
import { effectiveFontSize, LEGACY_LADDER, minReadable } from '@acs/renderer';
import { sceneRef } from '../Canvas';
import { useEditor } from '../store';
import { useEditorCtx } from '../context';
import { Badge, Button, ColorField, NumberField, Segmented, Select, Switch, Textarea, Tip } from '../../ui';
import { Grid2, Row, Section } from './parts';

const PROV: Record<string, string> = {
  'website-h1': 'Website H1', 'page-highlight': 'Page highlight', 'page-benefit': 'Page benefit', 'page-title': 'Page details',
  ai: 'AI suggestion', manual: 'Manual', imported: 'Imported from a previous run',
};
const FONTS = [
  { value: 'Lora', label: 'Lora' }, { value: 'Inter', label: 'Inter' }, { value: 'Georgia', label: 'Georgia' },
  { value: 'Helvetica Neue', label: 'Helvetica Neue' }, { value: 'serif', label: 'System serif (legacy)' }, { value: 'sans-serif', label: 'System sans (legacy)' },
];

/** The legacy size ladder scaled to this canvas. */
function ladderFor(d: { canvas: { width: number; height: number } }) {
  const k = Math.min(d.canvas.width / 1600, d.canvas.height / 1000);
  return { steps: LEGACY_LADDER.map((st) => ({ max: st.max, size: Math.round(st.size * k * 100) / 100 })) };
}

/** Lines the text would take at a given size, measured on the live element and restored at once. */
function linesAt(layerId: string, size: number) {
  const root = sceneRef.current;
  const el = root?.querySelector<HTMLElement>(`[data-layer-id="${layerId}"]`);
  if (!el) return null;
  const target = el.style.display === 'flex' ? (el.lastElementChild as HTMLElement) : el;
  const prev = target.style.fontSize;
  target.style.fontSize = `${size}px`;
  const cs = getComputedStyle(target);
  const lh = parseFloat(cs.lineHeight) || size * 1.2;
  const h = target.offsetHeight;
  target.style.fontSize = prev;
  return Math.max(1, Math.round(h / lh));
}

export function TextInspector({ layer, warnings }: { layer: TextLayer; warnings: CardWarning[] }) {
  const update = useEditor((s) => s.updateLayer);
  const design = useEditor((s) => s.design)!;
  const ctx = useEditorCtx();
  const set = (p: Partial<TextLayer>, key?: string) => update(layer.id, p, key);
  const size = effectiveFontSize(layer);
  const lines = ctx.boxes[layer.id]?.lines ?? 1;
  const overflow = !!layer.text && lines > layer.maxLines;
  const original = layer.provenance.original;
  const role = layer.role === 'headline' ? 'Heading' : layer.role === 'subheading' ? 'Subheading' : 'Text';
  const page = ctx.bundle.page;

  const autoFit = () => {
    const min = minReadable(design, layer.role);
    for (let s = Math.floor(size); s >= min; s--) {
      const n = linesAt(layer.id, s);
      if (n !== null && n <= layer.maxLines) {
        set({ fontSize: s, autoSize: null });
        toast.success(`Fitted at ${s}px`);
        return;
      }
    }
    toast.error(`It won't fit in ${layer.maxLines} line${layer.maxLines > 1 ? 's' : ''} at a readable size (≥ ${min}px). Shorten the text instead.`);
  };

  return (
    <>
      <Section title={role}>
        <Textarea id={`text-${layer.id}`} rows={layer.role === 'headline' ? 3 : 2} value={layer.text}
          onChange={(e) => set({ text: e.target.value, provenance: { ...layer.provenance, kind: e.target.value === original ? layer.provenance.kind : 'manual' } }, `text:${layer.id}`)}
          onBlur={() => useEditor.getState().checkpoint()} />
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
          <span>Source:</span><Badge tone={layer.provenance.kind === 'manual' ? 'neutral' : layer.provenance.kind === 'ai' ? 'info' : 'ok'}>{PROV[layer.provenance.kind] ?? layer.provenance.kind}</Badge>
        </div>
        {original && original !== layer.text ? (
          <div className="rounded-md bg-hover px-2.5 py-2 text-[12px]">
            <div className="text-muted">Original</div>
            <div className="mt-0.5">{original}</div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" icon={<RotateCcw className="size-3.5" />} disabled={!original || original === layer.text}
            onClick={() => set({ text: original!, provenance: { ...layer.provenance, kind: layer.role === 'headline' ? 'website-h1' : layer.provenance.kind === 'manual' || layer.provenance.kind === 'ai' ? 'page-highlight' : layer.provenance.kind } })}>Use original</Button>
          <Tip label={ctx.aiAvailable.text ? 'A shorter version, as a suggestion' : 'Connect ChatGPT or Claude to use AI'}>
            <span><Button size="sm" className="w-full" icon={<Scissors className="size-3.5" />} disabled={!ctx.aiAvailable.text || !layer.text}
              onClick={() => ctx.runAi(`Shorten the ${layer.role} so it fits in ${layer.maxLines} line${layer.maxLines > 1 ? 's' : ''} without losing its meaning.`, { layerId: layer.id, intentHint: 'EDIT_COPY' })}>Shorten with AI</Button></span>
          </Tip>
          <Tip label={ctx.aiAvailable.text ? 'An alternative line, as a suggestion' : 'Connect ChatGPT or Claude to use AI'}>
            <span className="col-span-2"><Button size="sm" className="w-full" icon={<Wand2 className="size-3.5" />} disabled={!ctx.aiAvailable.text}
              onClick={() => ctx.runAi(`Rewrite the ${layer.role} using the page's own facts.`, { layerId: layer.id, intentHint: 'EDIT_COPY' })}>Rewrite</Button></span>
          </Tip>
        </div>
        {layer.role === 'subheading' && page?.highlights?.length ? (
          <details className="text-[12px]">
            <summary className="cursor-pointer text-muted">Page highlights ({page.highlights.length})</summary>
            <div className="mt-1.5 flex flex-col gap-1">
              {page.highlights.map((h, i) => (
                <button key={i} onClick={() => set({ text: h.title.replace(/[\s:;,.-]+$/, ''), provenance: { kind: 'page-highlight', original: h.title.replace(/[\s:;,.-]+$/, ''), ref: `highlight:${i}` } })}
                  className="press rounded-md px-2 py-1 text-left hoverable">{h.title}</button>
              ))}
            </div>
          </details>
        ) : null}
        {overflow ? (
          <div className="flex flex-col gap-2 rounded-md bg-err-bg px-2.5 py-2 text-[12px] text-err">
            <span>{role} runs to {lines} lines (max {layer.maxLines}).</span>
            <div className="flex gap-1.5">
              <Button size="sm" onClick={autoFit}>Auto fit</Button>
              {ctx.aiAvailable.text ? <Button size="sm" icon={<Sparkles className="size-3.5" />} onClick={() => ctx.runAi(`Shorten the ${layer.role} to fit ${layer.maxLines} line(s).`, { layerId: layer.id, intentHint: 'EDIT_COPY' })}>Shorten with AI</Button> : null}
              <Button size="sm" onClick={() => document.getElementById(`text-${layer.id}`)?.focus()}>Edit manually</Button>
            </div>
          </div>
        ) : null}
        {warnings.filter((w) => w.code === 'key_line_contrast').map((w, i) => <Badge key={i} tone="warn" className="h-auto py-1 whitespace-normal">{w.message}</Badge>)}
      </Section>

      <Section title="Type">
        <Row label="Font"><Select size="sm" value={layer.fontFamily} onChange={(fontFamily) => set({ fontFamily })} options={FONTS} /></Row>
        <Row label="Weight"><Select size="sm" value={String(layer.fontWeight)} onChange={(v) => set({ fontWeight: Number(v) })} options={[400, 500, 600, 700].map((w) => ({ value: String(w), label: String(w) }))} /></Row>
        <Row label="Size">
          <div className="flex items-center gap-2">
            <NumberField value={size} min={6} max={400} suffix="px" onChange={(v) => set({ fontSize: v, autoSize: null }, `size:${layer.id}`)} />
            <Tip label="Size follows the text length, like the shipped cards"><label className="flex items-center gap-1.5 text-[11.5px] text-muted"><Switch checked={!!layer.autoSize} disabled={!layer.autoSize && layer.role !== 'headline'}
              onCheckedChange={(on) => set(on ? { autoSize: ladderFor(design) } : { autoSize: null, fontSize: size })} label="Auto size" />Auto</label></Tip>
          </div>
        </Row>
        <Grid2>
          <NumberField label="↕" value={layer.lineHeight ?? 1.2} step={0.01} min={0.7} max={3} onChange={(lineHeight) => set({ lineHeight }, `lh:${layer.id}`)} />
          <NumberField label="↔" value={layer.letterSpacing} step={0.005} min={-0.2} max={1} suffix="em" onChange={(letterSpacing) => set({ letterSpacing }, `ls:${layer.id}`)} />
        </Grid2>
        <Row label="Align">
          <Segmented size="sm" value={layer.align} onChange={(align) => set({ align })} options={[
            { value: 'left', label: <AlignLeft className="size-3.5" />, title: 'Left' }, { value: 'center', label: <AlignCenter className="size-3.5" />, title: 'Centre' }, { value: 'right', label: <AlignRight className="size-3.5" />, title: 'Right' }]} />
        </Row>
        <Row label="Case"><Segmented size="sm" value={layer.textTransform === 'uppercase' ? 'upper' : 'none'} onChange={(v) => set({ textTransform: v === 'upper' ? 'uppercase' : 'none' })} options={[{ value: 'none', label: 'As typed' }, { value: 'upper', label: 'UPPERCASE' }]} /></Row>
        <Row label="Colour"><ColorField value={layer.color} onChange={(color) => set({ color }, `color:${layer.id}`)} /></Row>
        <Row label="Max lines"><NumberField value={layer.maxLines} min={1} max={12} onChange={(maxLines) => set({ maxLines: Math.round(maxLines) })} /></Row>
        <Row label="Shadow"><Switch checked={layer.shadows.length > 0} onCheckedChange={(on) => set({ shadows: on ? [{ x: 0, y: 2, blur: 20, color: 'rgba(5,3,24,.7)' }] : [] })} label="Text shadow" /></Row>
      </Section>

      <Section title="Placement">
        {layer.role === 'subheading' ? (
          <Row label="Flow">
            {layer.stackOn ? (
              <Button size="sm" icon={<Link2Off className="size-3.5" />} onClick={() => {
                const b = ctx.boxes[layer.id];
                set({ stackOn: null, anchorY: 'top', x: b?.x ?? layer.x, y: b?.y ?? layer.y });
              }}>Detach from heading</Button>
            ) : (
              <Button size="sm" icon={<Link2 className="size-3.5" />} onClick={() => set({ stackOn: 'headline', anchorY: 'bottom' })}>Sit above the heading</Button>
            )}
          </Row>
        ) : null}
        {!layer.stackOn ? (
          <>
            <Grid2>
              <NumberField label="X" value={layer.x} onChange={(x) => set({ x }, `geo:${layer.id}`)} />
              <NumberField label={layer.anchorY === 'bottom' ? '⤓' : 'Y'} value={layer.y} onChange={(y) => set({ y }, `geo:${layer.id}`)} />
              <NumberField label="W" value={layer.width} min={40} onChange={(width) => set({ width }, `geo:${layer.id}`)} />
              <NumberField label="↻" value={layer.rotation} suffix="°" onChange={(rotation) => set({ rotation }, `geo:${layer.id}`)} />
            </Grid2>
            <Row label="Anchor">
              <Segmented size="sm" value={layer.anchorY} onChange={(anchorY) => {
                const b = ctx.boxes[`group:${layer.id}`] ?? ctx.boxes[layer.id];
                set({ anchorY, y: b ? Math.round(anchorY === 'bottom' ? b.y + b.h : b.y) : layer.y });
              }} options={[{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }]} />
            </Row>
          </>
        ) : <div className="text-[12px] text-muted">Follows the heading. Drag it on the canvas to place it freely.</div>}
        {layer.role === 'headline' ? <Row label="Rule"><Switch checked={!!layer.rule} onCheckedChange={(on) => set({ rule: on ? { width: 96, height: 3, gap: 26, radius: 2, from: '#a79eff', to: 'rgba(167,158,255,0)' } : null })} label="Rule under heading" /></Row> : null}
        {layer.role === 'subheading' ? <Row label="Lead line"><Switch checked={!!layer.lead} onCheckedChange={(on) => set({ lead: on ? { width: 38, height: 2, gap: 13, color: '#a79eff' } : null })} label="Line before the key line" /></Row> : null}
      </Section>
    </>
  );
}
