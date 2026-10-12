/**
 * Design JSON — the structured visual state of one card (PRD §52).
 *
 * The database stores this configuration; object storage stores the binaries it points at.
 * The editor and the export renderer read exactly the same shape, in the same canvas pixel
 * coordinates (PRD §54), so positioning logic exists once.
 *
 * Layers render bottom → top in array order. Asset references are strings:
 *   - "builtin:<name>"  bundled with the renderer (arnifi-logo, grain, light-grade, light-tint)
 *   - anything else     an Asset document id
 */
import { z } from 'zod';

export const BlendMode = z.enum([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);
export type BlendMode = z.infer<typeof BlendMode>;

/** One colour stop. `pos` is a percentage along the gradient line. */
export const Stop = z.object({
  color: z.string(),          // #rrggbb
  alpha: z.number().min(0).max(1),
  pos: z.number(),
});
export type Stop = z.infer<typeof Stop>;

/** A linear alpha mask (CSS mask-image), used by the light-gradient depth boost. */
export const Mask = z.object({ angle: z.number(), stops: z.array(Stop) });
export type Mask = z.infer<typeof Mask>;

const fillBase = {
  name: z.string().optional(),
  blend: BlendMode,
  opacity: z.number().min(0).max(1),
  mask: Mask.nullable().optional(),
};

export const LinearFill = z.object({ kind: z.literal('linear'), angle: z.number(), stops: z.array(Stop), ...fillBase });
/** `rx`/`ry` are the ellipse size in % of the box, `cx`/`cy` its centre in %. */
export const RadialFill = z.object({
  kind: z.literal('radial'), rx: z.number(), ry: z.number(), cx: z.number(), cy: z.number(),
  stops: z.array(Stop), ...fillBase,
});
/** A full-frame image stretched over the canvas (the light-gradient colour fields). */
export const ImageFill = z.object({ kind: z.literal('image'), src: z.string(), ...fillBase });
/** A tiled image (the grain). `size` is the tile edge in canvas px. */
export const PatternFill = z.object({ kind: z.literal('pattern'), src: z.string(), size: z.number(), ...fillBase });

export const Fill = z.discriminatedUnion('kind', [LinearFill, RadialFill, ImageFill, PatternFill]);
export type Fill = z.infer<typeof Fill>;
export type LinearFill = z.infer<typeof LinearFill>;
export type RadialFill = z.infer<typeof RadialFill>;

export const Shadow = z.object({ x: z.number(), y: z.number(), blur: z.number(), color: z.string() });
export type Shadow = z.infer<typeof Shadow>;

const layerBase = {
  id: z.string(),
  name: z.string(),
  visible: z.boolean(),
  locked: z.boolean(),
  /** Template layers may be protected from deletion but stay toggleable (PRD §20). */
  protected: z.boolean().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  opacity: z.number().min(0).max(1),
};

export const BackgroundSource = z.enum(['website', 'generated', 'uploaded', 'project', 'previous', 'none']);
export type BackgroundSource = z.infer<typeof BackgroundSource>;
export const Fit = z.enum(['cover', 'contain', 'fill', 'original']);
export type Fit = z.infer<typeof Fit>;

export const BackgroundLayer = z.object({
  ...layerBase,
  type: z.literal('background'),
  assetId: z.string().nullable(),
  source: BackgroundSource,
  fit: Fit,
  /** CSS object-position semantics, 0..1: the point at focalX of the image aligns with focalX of
   *  the frame. The legacy "center 42%" is focalX .5, focalY .42. Stored independently (§21). */
  focalX: z.number(),
  focalY: z.number(),
  zoom: z.number().min(0.1).max(10),
  offsetX: z.number(),
  offsetY: z.number(),
  flipX: z.boolean(),
  flipY: z.boolean(),
  adjust: z.object({ saturate: z.number(), contrast: z.number(), brightness: z.number() }),
});
export type BackgroundLayer = z.infer<typeof BackgroundLayer>;

export const GradientLayer = z.object({
  ...layerBase,
  type: z.literal('gradient'),
  preset: z.string(),
  fills: z.array(Fill),
});
export type GradientLayer = z.infer<typeof GradientLayer>;

export const LogoLayer = z.object({
  ...layerBase,
  type: z.literal('logo'),
  src: z.string(),                 // builtin:arnifi-logo or an asset id
  color: z.string().nullable(),    // recolour for the builtin SVG; null keeps the artwork
  shadow: Shadow.nullable(),
  keepAspect: z.boolean(),
});
export type LogoLayer = z.infer<typeof LogoLayer>;

export const TextRole = z.enum(['headline', 'subheading', 'body']);
export type TextRole = z.infer<typeof TextRole>;

/** Where the words came from — always shown, never silently replaced (PRD §25–26). */
export const ProvenanceKind = z.enum(['website-h1', 'page-highlight', 'page-benefit', 'page-title', 'ai', 'manual', 'imported']);
export type ProvenanceKind = z.infer<typeof ProvenanceKind>;
export const Provenance = z.object({
  kind: ProvenanceKind,
  /** The source copy this text came from (the page's H1 or highlight), kept for "Use original". */
  original: z.string().nullable(),
  ref: z.string().nullable().optional(),       // e.g. "highlight:2"
});
export type Provenance = z.infer<typeof Provenance>;

export const AutoSize = z.object({
  /** Ascending by `max` chars; the legacy ladder is 34→66, 48→58, 62→52, else 46. Objects, not
   *  tuples: Firestore cannot store an array directly inside an array. */
  steps: z.array(z.object({ max: z.number(), size: z.number() })),
});
export type AutoSize = z.infer<typeof AutoSize>;

export const TextLayer = z.object({
  ...layerBase,
  type: z.literal('text'),
  role: TextRole,
  text: z.string(),
  /** A smaller trailing run inside the same line box (legacy relight `suffix`). */
  suffix: z.object({ text: z.string(), em: z.number() }).nullable().optional(),
  provenance: Provenance,
  fontFamily: z.string(),
  fontWeight: z.number(),
  fontSize: z.number(),
  /** When set the size follows text length (resolved at render time); a manual size clears it. */
  autoSize: AutoSize.nullable(),
  lineHeight: z.number().nullable(),           // multiple of font size; null = normal
  letterSpacing: z.number(),                   // em
  textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']),
  align: z.enum(['left', 'center', 'right']),
  color: z.string(),
  maxLines: z.number().int().min(1).max(12),
  nowrap: z.boolean().optional(),
  shadows: z.array(Shadow),
  /** 'bottom': `y` is the block's bottom edge (the legacy text block is bottom-anchored). */
  anchorY: z.enum(['top', 'bottom']),
  /** Flow-stacks this layer above another text layer, as the legacy kicker sits above the
   *  headline. Dragging the layer on its own detaches it (stackOn → null). */
  stackOn: z.string().nullable(),
  stackGap: z.number(),
  /** The short line before the kicker text. */
  lead: z.object({ width: z.number(), height: z.number(), gap: z.number(), color: z.string() }).nullable(),
  /** The short gradient rule under the headline. */
  rule: z.object({
    width: z.number(), height: z.number(), gap: z.number(), radius: z.number(),
    from: z.string(), to: z.string(),
  }).nullable(),
});
export type TextLayer = z.infer<typeof TextLayer>;

export const ShapeLayer = z.object({
  ...layerBase,
  type: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse']),
  fill: z.string(),
  radius: z.number(),
});
export type ShapeLayer = z.infer<typeof ShapeLayer>;

export const ImageLayer = z.object({
  ...layerBase,
  type: z.literal('image'),
  assetId: z.string().nullable(),
  fit: Fit,
});
export type ImageLayer = z.infer<typeof ImageLayer>;

export const Layer = z.discriminatedUnion('type', [BackgroundLayer, GradientLayer, LogoLayer, TextLayer, ShapeLayer, ImageLayer]);
export type Layer = z.infer<typeof Layer>;
export type LayerType = Layer['type'];

export const Canvas = z.object({
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  background: z.string(),
  /** Safe margin in canvas px, used by snapping and the edge warnings. */
  safeMargin: z.number().optional(),
});
export type Canvas = z.infer<typeof Canvas>;

export const Design = z.object({ canvas: Canvas, layers: z.array(Layer) });
export type Design = z.infer<typeof Design>;

/**
 * A sparse change set on top of a base design (project defaults, PRD §40). Stored on cards and
 * versions so a card only records what differs from its project.
 */
export const Overrides = z.object({
  canvas: Canvas.partial().optional(),
  /** Per-layer partial patches keyed by layer id; `null` deletes the base layer. */
  layers: z.record(z.string(), z.record(z.string(), z.unknown()).nullable()).optional(),
  /** Layers that don't exist in the base. */
  extra: z.array(Layer).optional(),
  /** Full z-order by id, when the card reordered layers. */
  order: z.array(z.string()).optional(),
});
export type Overrides = z.infer<typeof Overrides>;

/** Stable ids of the standard layers, shared by every recipe so overrides line up. */
export const LAYER = {
  background: 'background',
  gradient: 'gradient',
  logo: 'logo',
  headline: 'headline',
  subheading: 'subheading',
} as const;
