/**
 * Templates / recipes (PRD §38): repeated production logic captured as a base design.
 *
 * "Arnifi Classic" is the card.py template and "Arnifi Light" the relight.py one. Their geometry
 * (logo 64/52 at 196×55, text block left 64 / right 120 / bottom 64, kicker gap 20, rule 26 below)
 * reproduces the shipped 1600×1000 cards exactly. Other sizes derive from the same rules.
 */
import type { BackgroundLayer, Design, GradientLayer, Layer, LogoLayer, TextLayer } from '@acs/types';
import { CUSTOM_GRADIENT_PRESET, PHOTO_DARK, PHOTO_LIGHT, PHOTO_NEUTRAL, presetFills } from './presets';

/** card.py fsize(): longer headlines step down so the block stays one shape. */
export const LEGACY_LADDER = [{ max: 34, size: 66 }, { max: 48, size: 58 }, { max: 62, size: 52 }, { max: 100000, size: 46 }];

export const HEADLINE_SHADOWS = [
  { x: 0, y: 2, blur: 26, color: 'rgba(5,3,24,.78)' },
  { x: 0, y: 1, blur: 3, color: 'rgba(5,3,24,.5)' },
];
export const KICKER_SHADOWS = [{ x: 0, y: 1, blur: 10, color: 'rgba(0,0,0,.65)' }];

export interface RecipeDef {
  id: string;
  name: string;
  description: string;
  base: Design;
  brief?: string;
  negativeConstraints?: string[];
}

interface Geometry {
  width: number;
  height: number;
  /** canvas-relative scale against the 1600-wide reference card */
  s: number;
}

function geo(width: number, height: number): Geometry {
  return { width, height, s: Math.min(width / 1600, height / 1000) };
}

const r = (v: number, s: number) => Math.round(v * s * 100) / 100;

export function backgroundLayer(g: Geometry, adjust = PHOTO_LIGHT): BackgroundLayer {
  return {
    id: 'background', name: 'Background', type: 'background', visible: true, locked: false, protected: true,
    x: 0, y: 0, width: g.width, height: g.height, rotation: 0, opacity: 1,
    assetId: null, source: 'none', fit: 'cover', focalX: 0.5, focalY: 0.42, zoom: 1, offsetX: 0, offsetY: 0,
    flipX: false, flipY: false, adjust: { ...adjust },
  };
}

export function gradientLayer(g: Geometry, preset: string): GradientLayer {
  return {
    id: 'gradient', name: 'Gradient', type: 'gradient', visible: true, locked: false, protected: true,
    x: 0, y: 0, width: g.width, height: g.height, rotation: 0, opacity: 1,
    preset, fills: presetFills(preset),
  };
}

export function logoLayer(g: Geometry): LogoLayer {
  return {
    id: 'logo', name: 'Logo', type: 'logo', visible: true, locked: false, protected: true,
    x: r(64, g.s), y: r(52, g.s), width: r(196, g.s), height: r(55, g.s), rotation: 0, opacity: 1,
    src: 'builtin:arnifi-logo', color: '#FFFFFF',
    shadow: { x: 0, y: r(2, g.s), blur: r(12, g.s), color: 'rgba(0,0,0,.55)' }, keepAspect: true,
  };
}

export function headlineLayer(g: Geometry, opts: { fontFamily?: string } = {}): TextLayer {
  const left = r(64, g.s);
  const right = r(120, g.s);
  return {
    id: 'headline', name: 'Heading', type: 'text', role: 'headline', visible: true, locked: false, protected: true,
    x: left, y: g.height - r(64, g.s), width: g.width - left - right, height: r(120, g.s), rotation: 0, opacity: 1,
    text: '', suffix: null, provenance: { kind: 'manual', original: null },
    fontFamily: opts.fontFamily ?? 'Lora', fontWeight: 500, fontSize: r(66, g.s),
    autoSize: { steps: LEGACY_LADDER.map((st) => ({ max: st.max, size: r(st.size, g.s) })) },
    lineHeight: 1.19, letterSpacing: -0.005, textTransform: 'none', align: 'left', color: '#ffffff',
    maxLines: 3, shadows: HEADLINE_SHADOWS.map((sh) => ({ ...sh, y: r(sh.y, g.s), blur: r(sh.blur, g.s) })),
    anchorY: 'bottom', stackOn: null, stackGap: 0, lead: null,
    rule: { width: r(96, g.s), height: r(3, g.s), gap: r(26, g.s), radius: r(2, g.s), from: '#a79eff', to: 'rgba(167,158,255,0)' },
  };
}

export function subheadingLayer(g: Geometry, opts: { fontFamily?: string } = {}): TextLayer {
  const left = r(64, g.s);
  const right = r(120, g.s);
  return {
    id: 'subheading', name: 'Subheading', type: 'text', role: 'subheading', visible: true, locked: false, protected: true,
    x: left, y: g.height - r(200, g.s), width: g.width - left - right, height: r(20, g.s), rotation: 0, opacity: 1,
    text: '', suffix: null, provenance: { kind: 'manual', original: null },
    fontFamily: opts.fontFamily ?? 'Inter', fontWeight: 600, fontSize: r(16, g.s), autoSize: null,
    lineHeight: null, letterSpacing: 0.17, textTransform: 'uppercase', align: 'left', color: '#d3ceff',
    maxLines: 2, shadows: KICKER_SHADOWS.map((sh) => ({ ...sh, y: r(sh.y, g.s), blur: r(sh.blur, g.s) })),
    anchorY: 'bottom', stackOn: 'headline', stackGap: r(20, g.s),
    lead: { width: r(38, g.s), height: r(2, g.s), gap: r(13, g.s), color: '#a79eff' }, rule: null,
  };
}

/** The standard five layers in render order. */
export function standardLayers(g: Geometry, preset: string, adjust = PHOTO_LIGHT): Layer[] {
  return [backgroundLayer(g, adjust), gradientLayer(g, preset), logoLayer(g), subheadingLayer(g), headlineLayer(g)];
}

function design(g: Geometry, layers: Layer[]): Design {
  return { canvas: { width: g.width, height: g.height, background: '#0b0922', safeMargin: r(64, g.s) }, layers };
}

function hide(layers: Layer[], ids: string[]): Layer[] {
  return layers.map((l) => (ids.includes(l.id) ? { ...l, visible: false } : l));
}

export function buildRecipe(id: string, width = 1600, height = 1000): Design {
  const g = geo(width, height);
  switch (id) {
    case 'arnifi-classic':
      return design(g, standardLayers(g, 'arnifi-dark', PHOTO_DARK));
    case 'website-banner':
      return design(g, hide(standardLayers(g, 'none', PHOTO_NEUTRAL), ['gradient', 'headline', 'subheading']));
    case 'generated-editorial': {
      const layers = standardLayers(g, 'arnifi-soft', PHOTO_NEUTRAL);
      return design(g, layers);
    }
    case 'social-post':
      return design(geo(width, height), standardLayers(g, 'arnifi-light', PHOTO_LIGHT));
    case 'my-gradient':
      // the gradient fills come from the uploaded image when the project is created
      return design(g, standardLayers(g, 'none', PHOTO_NEUTRAL).map((l) => (l.type === 'gradient' ? { ...l, preset: CUSTOM_GRADIENT_PRESET } : l)));
    case 'background-only':
      return design(g, hide(standardLayers(g, 'none', PHOTO_NEUTRAL), ['gradient', 'logo', 'headline', 'subheading']));
    case 'blank':
      return design(g, hide(standardLayers(g, 'none', PHOTO_NEUTRAL), ['gradient', 'logo', 'headline', 'subheading']));
    case 'legal-services':
    case 'uploaded-branding':
    case 'arnifi-light':
    default:
      return design(g, standardLayers(g, 'arnifi-light', PHOTO_LIGHT));
  }
}

export const RECIPES: { id: string; name: string; description: string; width: number; height: number;
  brief?: string; negativeConstraints?: string[] }[] = [
  { id: 'arnifi-light', name: 'Arnifi Light', width: 1600, height: 1000,
    description: 'The current production card: light cinematic gradient, logo top-left, key line and Lora headline bottom-left.',
    brief: 'Premium corporate photography. Keep the lower-left quiet for the key line and headline. Realistic materials and light.',
    negativeConstraints: ['No generated text inside photographs.', 'No fake logos.', 'No cartoon illustrations.',
      'No gradients inside the generated photograph.', 'Do not place important content underneath the card headline.'] },
  { id: 'arnifi-classic', name: 'Arnifi Classic', width: 1600, height: 1000,
    description: 'The original dark purple wash with grain. Same layout as Arnifi Light.' },
  { id: 'website-banner', name: 'Website Banner Card', width: 1600, height: 1000,
    description: 'The website image as it is, with the Arnifi logo. Gradient and text off.' },
  { id: 'generated-editorial', name: 'Generated Editorial', width: 1600, height: 1000,
    description: 'For AI-generated backgrounds: a soft indigo fade that leaves the photo clean.',
    brief: 'Editorial still life, natural light, shallow depth of field, calm composition with space on the left.' },
  { id: 'legal-services', name: 'Legal Services', width: 1600, height: 1000,
    description: 'Arnifi Light set up for document still lifes (legal, visa, attestation).',
    brief: 'Premium still-life of the document the service produces, on a dark desk. The paper shows relevant printed text, a title and a seal or stamp. Keep the lower-left clear for the headline.',
    negativeConstraints: ['No blank paper.', 'No real people\'s names or real company names on documents.',
      'No lorem ipsum or gibberish text.', 'Keep stamps and clips out of the top-left logo area and the lower-left headline area.'] },
  { id: 'social-post', name: 'Social Post', width: 1080, height: 1350,
    description: 'Portrait 4:5 for social, same brand layers scaled to the frame.' },
  { id: 'uploaded-branding', name: 'Uploaded Image + Branding', width: 1600, height: 1000,
    description: 'Your own image with the full Arnifi treatment.' },
  { id: 'my-gradient', name: 'My gradient', width: 1600, height: 1000,
    description: 'A gradient you designed, uploaded as an image, with the logo, key line and headline.' },
  { id: 'background-only', name: 'Background Only', width: 1600, height: 1000,
    description: 'Just the image. Every other layer off (and toggleable).' },
  { id: 'blank', name: 'Blank', width: 1600, height: 1000,
    description: 'An empty canvas with every layer available but hidden.' },
];

/**
 * The New Project "Look" step: four choices instead of the nine recipes, several of which build the
 * same card. Each maps to the recipe that builds it; layer switches and the size do the rest.
 */
export type LookId = 'light' | 'dark' | 'custom' | 'none';
export const LOOKS: { id: LookId; name: string; description: string; recipeId: string; gradient: boolean }[] = [
  { id: 'light', name: 'Light gradient', description: 'Today’s production card: periwinkle sky, indigo base under the text.', recipeId: 'arnifi-light', gradient: true },
  { id: 'dark', name: 'Dark gradient', description: 'The original deep purple wash with grain.', recipeId: 'arnifi-classic', gradient: true },
  { id: 'custom', name: 'My gradient', description: 'A gradient you designed. Upload it once, reuse it on any project.', recipeId: 'my-gradient', gradient: true },
  { id: 'none', name: 'No gradient', description: 'Just the photo, with the logo and text you switch on.', recipeId: 'website-banner', gradient: false },
];

/** What AI-generated photos should look like: the brief and rules sent with every image request. */
export type PhotoStyleId = 'corporate' | 'documents' | 'editorial';
export const PHOTO_STYLES: { id: PhotoStyleId; name: string; description: string; recipeId: string }[] = [
  { id: 'corporate', name: 'Corporate photography', description: 'Buildings, offices and city scenes, lower-left kept quiet.', recipeId: 'arnifi-light' },
  { id: 'documents', name: 'Document still life', description: 'The paper the service produces: legal, visa, attestation.', recipeId: 'legal-services' },
  { id: 'editorial', name: 'Editorial still life', description: 'Natural light, shallow depth of field, calm composition.', recipeId: 'generated-editorial' },
];

export function recipeById(id: string) {
  return RECIPES.find((x) => x.id === id) ?? RECIPES[0];
}

export const DIMENSION_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '1600 × 1000', width: 1600, height: 1000 },
  { label: '1680 × 704', width: 1680, height: 704 },
  { label: '1080 × 1350', width: 1080, height: 1350 },
  { label: '1920 × 1080', width: 1920, height: 1080 },
  { label: '1080 × 1920', width: 1080, height: 1920 },
];
