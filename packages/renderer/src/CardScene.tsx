/**
 * The card, as DOM. The editor mounts this live (scaled with a CSS transform); the export renders
 * the same component to static markup and screenshots it in headless Chrome (PRD §54). There is no
 * second implementation of positioning anywhere.
 *
 * Fidelity rules that keep it pixel-identical to the legacy renderers:
 *  - gradient fills are direct children of the card root, never wrapped: a wrapper with opacity or a
 *    transform would isolate their mix-blend-mode from the photo underneath;
 *  - the text block is a bottom-anchored flow (kicker → headline → rule), as in card.py;
 *  - identity transforms, filters and opacities are omitted rather than written as no-ops;
 *  - every inherited text property is set explicitly, so the host page's CSS cannot leak in.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { BackgroundLayer, Design, Fill, GradientLayer, ImageLayer, Layer, LogoLayer, ShapeLayer, TextLayer } from '@acs/types';
import { fillBackground, fontStack, maskCss, OBJECT_FIT, pct, photoFilter, shadowsCss } from './css';
import { ARNIFI_LOGO_INK, ARNIFI_LOGO_SVG } from './logo';
import { effectiveFontSize } from './resolve';

export type SrcResolver = (ref: string) => string | null | undefined;

export interface CardSceneProps {
  design: Design;
  resolveSrc: SrcResolver;
  /** Editor only: called with the root element so overlays can measure layer boxes. */
  rootRef?: (el: HTMLDivElement | null) => void;
  /** Editor only: dim nothing, but mark layers hidden by the user as hidden. */
  className?: string;
}

export function CardScene({ design, resolveSrc, rootRef, className }: CardSceneProps) {
  const { canvas, layers } = design;
  const byId = new Map(layers.map((l) => [l.id, l]));

  // text layers stacked on a root text layer render inside that root's flow block
  const stacks = new Map<string, TextLayer[]>();
  const stackedIds = new Set<string>();
  for (const l of layers) {
    if (l.type !== 'text' || !l.stackOn) continue;
    const root = byId.get(l.stackOn);
    if (root && root.type === 'text' && !root.stackOn) {
      stacks.set(root.id, [...(stacks.get(root.id) ?? []), l]);
      stackedIds.add(l.id);
    }
  }

  const nodes: ReactNode[] = [];
  for (const l of layers) {
    if (stackedIds.has(l.id)) continue;
    if (l.type === 'text') {
      const stacked = (stacks.get(l.id) ?? []).filter((s) => s.visible);
      if (!l.visible && !stacked.length) continue;
      nodes.push(<TextBlock key={l.id} root={l} stacked={stacked} canvasH={canvas.height} />);
      continue;
    }
    if (!l.visible) continue;
    nodes.push(renderLayer(l, resolveSrc));
  }

  return (
    <div
      ref={rootRef}
      data-card-root=""
      className={className}
      style={{
        position: 'relative', width: canvas.width, height: canvas.height, overflow: 'hidden',
        background: canvas.background, fontFamily: 'Inter, sans-serif', fontSize: 16, fontWeight: 400,
        lineHeight: 'normal', letterSpacing: 'normal', color: '#000', textAlign: 'left',
        WebkitFontSmoothing: 'antialiased', textRendering: 'geometricPrecision', margin: 0, padding: 0,
      }}
    >
      {nodes}
    </div>
  );
}

function renderLayer(l: Layer, resolveSrc: SrcResolver): ReactNode {
  switch (l.type) {
    case 'background':
      return <Background key={l.id} layer={l} src={l.assetId ? resolveSrc(l.assetId) : null} />;
    case 'gradient':
      return <Gradient key={l.id} layer={l} resolveSrc={resolveSrc} />;
    case 'logo':
      return <Logo key={l.id} layer={l} resolveSrc={resolveSrc} />;
    case 'shape':
      return <Shape key={l.id} layer={l} />;
    case 'image':
      return <ImageBox key={l.id} layer={l} src={l.assetId ? resolveSrc(l.assetId) : null} />;
    default:
      return null;
  }
}

function boxStyle(l: Layer): CSSProperties {
  const s: CSSProperties = { position: 'absolute', left: l.x, top: l.y, width: l.width, height: l.height };
  if (l.opacity !== 1) s.opacity = l.opacity;
  if (l.rotation) s.transform = `rotate(${l.rotation}deg)`;
  return s;
}

function Background({ layer: l, src }: { layer: BackgroundLayer; src: string | null | undefined }) {
  const style = boxStyle(l);
  const moved = l.zoom !== 1 || l.offsetX || l.offsetY || l.flipX || l.flipY;
  const transforms: string[] = [];
  if (l.offsetX || l.offsetY) transforms.push(`translate(${l.offsetX}px,${l.offsetY}px)`);
  if (l.zoom !== 1) transforms.push(`scale(${l.zoom})`);
  if (l.flipX || l.flipY) transforms.push(`scale(${l.flipX ? -1 : 1},${l.flipY ? -1 : 1})`);
  if (moved) style.overflow = 'hidden';
  return (
    <div data-layer-id={l.id} style={style}>
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            width: '100%', height: '100%', objectFit: OBJECT_FIT[l.fit],
            objectPosition: `${pct(l.focalX)} ${pct(l.focalY)}`,
            filter: photoFilter(l.adjust),
            transform: transforms.length ? transforms.join(' ') : undefined,
            transformOrigin: transforms.length ? `${pct(l.focalX)} ${pct(l.focalY)}` : undefined,
            display: 'block', maxWidth: 'none',
          }}
        />
      ) : null}
    </div>
  );
}

function fillStyle(l: GradientLayer, f: Fill): CSSProperties {
  const s: CSSProperties = { position: 'absolute', left: l.x, top: l.y, width: l.width, height: l.height };
  const o = f.opacity * l.opacity;
  if (o !== 1) s.opacity = +o.toFixed(4);
  if (f.blend !== 'normal') s.mixBlendMode = f.blend;
  if (f.mask) {
    s.WebkitMaskImage = maskCss(f.mask);
    s.maskImage = maskCss(f.mask);
  }
  return s;
}

function Gradient({ layer: l, resolveSrc }: { layer: GradientLayer; resolveSrc: SrcResolver }) {
  return (
    <>
      {l.fills.map((f, i) => {
        const style = fillStyle(l, f);
        const key = `${l.id}:${i}`;
        if (f.kind === 'image') {
          const src = resolveSrc(f.src);
          if (!src) return null;
          return <img key={key} data-fill-of={l.id} src={src} alt="" draggable={false} style={{ ...style, display: 'block', maxWidth: 'none' }} />;
        }
        if (f.kind === 'pattern') {
          const src = resolveSrc(f.src);
          if (!src) return null;
          return <div key={key} data-fill-of={l.id} style={{ ...style, backgroundImage: `url(${src})`, backgroundSize: `${f.size}px ${f.size}px` }} />;
        }
        return <div key={key} data-fill-of={l.id} style={{ ...style, background: fillBackground(f) ?? undefined }} />;
      })}
    </>
  );
}

function styleString(s: Record<string, string | number | undefined>) {
  return Object.entries(s)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}:${typeof v === 'number' ? `${v}px` : v}`)
    .join(';');
}

function Logo({ layer: l, resolveSrc }: { layer: LogoLayer; resolveSrc: SrcResolver }) {
  const filter = l.shadow ? `drop-shadow(${l.shadow.x}px ${l.shadow.y}px ${l.shadow.blur}px ${l.shadow.color})` : undefined;
  if (l.src === 'builtin:arnifi-logo') {
    // inlined exactly as card.py does, so the vector renders identically
    const style = styleString({
      position: 'absolute', top: l.y, left: l.x, width: l.width, height: l.height, filter,
      opacity: l.opacity !== 1 ? String(l.opacity) : undefined,
      transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
      display: 'block', 'max-width': 'none',
    });
    let svg = ARNIFI_LOGO_SVG;
    if (l.color) svg = svg.split(ARNIFI_LOGO_INK).join(l.color);
    svg = svg.replace('<svg ', `<svg data-layer-id="${l.id}" style="${style}" `);
    return <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  const src = resolveSrc(l.src);
  return src ? (
    <img data-layer-id={l.id} src={src} alt="" draggable={false}
      style={{ ...boxStyle(l), filter, objectFit: 'contain', display: 'block', maxWidth: 'none' }} />
  ) : null;
}

function Shape({ layer: l }: { layer: ShapeLayer }) {
  return <div data-layer-id={l.id} style={{ ...boxStyle(l), background: l.fill, borderRadius: l.shape === 'ellipse' ? '50%' : l.radius }} />;
}

function ImageBox({ layer: l, src }: { layer: ImageLayer; src: string | null | undefined }) {
  return (
    <div data-layer-id={l.id} style={{ ...boxStyle(l), overflow: 'hidden' }}>
      {src ? <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: OBJECT_FIT[l.fit], display: 'block', maxWidth: 'none' }} /> : null}
    </div>
  );
}

function textStyle(l: TextLayer): CSSProperties {
  return {
    margin: 0, padding: 0,
    fontFamily: fontStack(l.fontFamily),
    fontWeight: l.fontWeight,
    fontSize: effectiveFontSize(l),
    lineHeight: l.lineHeight ?? 'normal',
    letterSpacing: `${l.letterSpacing}em`,
    textTransform: l.textTransform === 'none' ? undefined : l.textTransform,
    color: l.color,
    textShadow: shadowsCss(l.shadows),
    whiteSpace: l.nowrap ? 'nowrap' : undefined,
    textAlign: l.align === 'left' ? undefined : l.align,
    opacity: l.opacity !== 1 ? l.opacity : undefined,
  };
}

function TextRun({ l }: { l: TextLayer }) {
  return (
    <>
      {l.text}
      {l.suffix?.text ? <>{' '}<small style={{ fontSize: `${l.suffix.em}em` }}>{l.suffix.text}</small></> : null}
    </>
  );
}

/** A text layer with a lead line renders as the legacy kicker: [line] gap [text]. */
function TextLine({ l, marginBottom }: { l: TextLayer; marginBottom?: number }) {
  if (l.lead) {
    return (
      <div
        data-layer-id={l.id}
        style={{
          display: 'flex', alignItems: 'center', gap: l.lead.gap, marginBottom: marginBottom || undefined,
          justifyContent: l.align === 'center' ? 'center' : l.align === 'right' ? 'flex-end' : undefined,
          opacity: l.opacity !== 1 ? l.opacity : undefined,
        }}
      >
        <div style={{ width: l.lead.width, height: l.lead.height, background: l.lead.color, flex: 'none' }} />
        <span style={{ ...textStyle(l), opacity: undefined }}><TextRun l={l} /></span>
      </div>
    );
  }
  return (
    <div data-layer-id={l.id} style={{ ...textStyle(l), marginBottom: marginBottom || undefined }}>
      <TextRun l={l} />
    </div>
  );
}

function TextBlock({ root, stacked, canvasH }: { root: TextLayer; stacked: TextLayer[]; canvasH: number }) {
  const anchor: CSSProperties = root.anchorY === 'bottom' ? { bottom: canvasH - root.y } : { top: root.y };
  return (
    <div
      data-group-id={root.id}
      style={{
        position: 'absolute', left: root.x, width: root.width, ...anchor,
        transform: root.rotation ? `rotate(${root.rotation}deg)` : undefined,
      }}
    >
      {stacked.map((s) => <TextLine key={s.id} l={s} marginBottom={root.visible ? s.stackGap : 0} />)}
      {root.visible ? <TextLine l={root} /> : null}
      {root.visible && root.rule ? (
        <div
          data-rule-of={root.id}
          style={{
            marginTop: root.rule.gap, width: root.rule.width, height: root.rule.height, borderRadius: root.rule.radius,
            background: `linear-gradient(90deg,${root.rule.from},${root.rule.to})`,
            marginLeft: root.align === 'center' ? 'auto' : root.align === 'right' ? 'auto' : undefined,
            marginRight: root.align === 'center' ? 'auto' : undefined,
            opacity: root.opacity !== 1 ? root.opacity : undefined,
          }}
        />
      ) : null}
    </div>
  );
}
