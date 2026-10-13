/** The right panel (PRD §18): properties of the selection, or of the card when nothing is selected. */
import { useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
import { api } from '../../lib/api';
import type { ImageLayer, ShapeLayer } from '@acs/types';
import { layoutWarnings } from '@acs/renderer';
import { useEditor } from '../store';
import { useEditorCtx } from '../context';
import { pathOf } from '../../lib/format';
import { Badge, Button, ColorField, Input, NumberField, Segmented } from '../../ui';
import { BackgroundInspector } from './BackgroundInspector';
import { Geometry, LayerHeader } from './Common';
import { GradientInspector } from './GradientInspector';
import { LogoInspector } from './LogoInspector';
import { Row, Section } from './parts';
import { TextInspector } from './TextInspector';
import { AiPanel } from '../ai/AiPanel';

export function Inspector() {
  const design = useEditor((s) => s.design);
  const selection = useEditor((s) => s.selection);
  const ctx = useEditorCtx();
  if (!design) return null;
  const live = layoutWarnings(design, ctx.boxes);
  const sel = design.layers.filter((l) => selection.includes(l.id));
  const l = sel.length === 1 ? sel[0] : null;

  return (
    <aside className="flex w-[304px] shrink-0 flex-col overflow-y-auto border-l border-line bg-panel scroll-quiet" data-testid="inspector">
      {sel.length > 1 ? (
        <div className="px-4 py-4 text-[13px] text-muted">{sel.length} layers selected. Drag them together on the canvas, or nudge with the arrow keys.</div>
      ) : l ? (
        <>
          <LayerHeader layer={l} />
          {l.type === 'background' ? <BackgroundInspector layer={l} /> : null}
          {l.type === 'gradient' ? <GradientInspector layer={l} /> : null}
          {l.type === 'logo' ? <><LogoInspector layer={l} warnings={live} /><Geometry layer={l} /></> : null}
          {l.type === 'text' ? <TextInspector layer={l} warnings={[...live, ...ctx.bundle.card.warnings]} /> : null}
          {l.type === 'shape' ? <ShapeProps layer={l} /> : null}
          {l.type === 'image' ? <ImageProps layer={l} /> : null}
          {l.type === 'shape' || l.type === 'image' ? <Geometry layer={l} /> : null}
        </>
      ) : (
        <CardPanel />
      )}
      <AiPanel />
    </aside>
  );
}

/** Nothing selected: just where the card came from. Everything else is one click away on the canvas. */
function CardPanel() {
  const ctx = useEditorCtx();
  const { card, page } = ctx.bundle;
  return (
    <>
      <div className="flex h-12 items-center border-b border-line px-4">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">Card</span>
      </div>
      <Section title="Source">
        {page ? (
          <>
            {page.status === 'removed' ? <Badge tone="err">Source page is no longer available</Badge> : null}
            <a href={page.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] break-all text-info hover:underline">{pathOf(page.url)}<ExternalLink className="size-3 shrink-0" /></a>
          </>
        ) : (
          <>
            <div className="text-[12.5px] text-muted">{card.sourceLabel === 'Upload' || card.sourceLabel === 'Blank' ? 'No live page connected.' : card.sourceLabel}</div>
            <AttachUrl />
          </>
        )}
      </Section>
      <div className="px-4 pt-1 text-[12px] leading-relaxed text-faint">Click the heading, logo, gradient or background on the card to change it.</div>
    </>
  );
}

/** Screenshot / upload cards: never pretend a page was scraped (PRD §16). */
function AttachUrl() {
  const ctx = useEditorCtx();
  const [busy, setBusy] = useState(false);
  return (
    <form className="flex gap-1.5" onSubmit={async (e) => {
      e.preventDefault();
      const url = String(new FormData(e.currentTarget).get('url') ?? '').trim();
      if (!url) return;
      setBusy(true);
      try {
        await api.post(`/projects/${ctx.bundle.project.id}/cards/${ctx.bundle.card.id}/attach`, { url });
        toast.success('Scanning the page. The card links to it when the scan finishes; its text stays as you wrote it.');
      } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
    }}>
      <Input name="url" placeholder="Attach webpage URL" className="h-7" />
      <Button size="sm" type="submit" loading={busy}>Attach</Button>
    </form>
  );
}

function ShapeProps({ layer }: { layer: ShapeLayer }) {
  const update = useEditor((s) => s.updateLayer);
  return (
    <Section title="Shape">
      <Row label="Kind"><Segmented size="sm" value={layer.shape} onChange={(shape) => update(layer.id, { shape } as Partial<ShapeLayer>)} options={[{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Ellipse' }]} /></Row>
      <Row label="Fill"><ColorField value={layer.fill} onChange={(fill) => update(layer.id, { fill } as Partial<ShapeLayer>, 'shape-fill')} /></Row>
      <Row label="Radius"><NumberField value={layer.radius} min={0} onChange={(radius) => update(layer.id, { radius } as Partial<ShapeLayer>, 'shape-r')} /></Row>
    </Section>
  );
}

function ImageProps({ layer }: { layer: ImageLayer }) {
  const update = useEditor((s) => s.updateLayer);
  const ctx = useEditorCtx();
  return (
    <Section title="Image">
      <Button size="sm" onClick={() => ctx.pickImage('image-layer')}>Replace image</Button>
      <Row label="Fit"><Segmented size="sm" value={layer.fit} onChange={(fit) => update(layer.id, { fit } as Partial<ImageLayer>)} options={[{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }]} /></Row>
    </Section>
  );
}
