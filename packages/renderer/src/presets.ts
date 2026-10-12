/**
 * Gradient presets (PRD §22). Values are lifted verbatim from the shipped renderers so a card
 * built from a preset is pixel-identical to the legacy output:
 *   arnifi-dark  ← arnifi-studio/pipeline/card.py   (wash, tone, side, vig, grain)
 *   arnifi-light ← new images/_system/relight.py    (grade as color, grade as multiply, tint)
 */
import type { BackgroundLayer, Fill, Stop } from '@acs/types';

function hex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** rgba(r,g,b,a) at pos% — the notation the legacy CSS uses, as a Stop. */
export function rgba(r: number, g: number, b: number, a: number, pos: number): Stop {
  return { color: hex(r, g, b), alpha: a, pos };
}

export interface GradientPreset {
  id: string;
  name: string;
  description: string;
  fills: Fill[];
  /** The photo grade that belongs with this wash; applied with the preset from the UI. */
  photoAdjust?: BackgroundLayer['adjust'];
  /** Whether the simple angle/colour controls map onto fill 0. */
  editable: boolean;
}

const DARK: Fill[] = [
  { kind: 'linear', name: 'wash', angle: 130, blend: 'multiply', opacity: 1,
    stops: [rgba(52, 45, 124, 0.7, 0), rgba(84, 74, 148, 0.46, 44), rgba(46, 46, 163, 0.58, 100)] },
  { kind: 'linear', name: 'tone', angle: 180, blend: 'normal', opacity: 1,
    stops: [rgba(16, 13, 50, 0.46, 0), rgba(16, 13, 50, 0.08, 30), rgba(13, 11, 42, 0.52, 68), rgba(10, 8, 32, 0.88, 100)] },
  { kind: 'linear', name: 'side', angle: 90, blend: 'normal', opacity: 1,
    stops: [rgba(10, 8, 34, 0.66, 0), rgba(10, 8, 34, 0.18, 42), rgba(10, 8, 34, 0, 66)] },
  { kind: 'radial', name: 'vig', rx: 118, ry: 94, cx: 62, cy: 32, blend: 'normal', opacity: 1,
    stops: [rgba(0, 0, 0, 0, 44), rgba(8, 6, 30, 0.58, 100)] },
  { kind: 'pattern', name: 'grain', src: 'builtin:grain', size: 256, blend: 'overlay', opacity: 0.05 },
];

const LIGHT: Fill[] = [
  { kind: 'image', name: 'grade', src: 'builtin:light-grade', blend: 'color', opacity: 0.75 },
  { kind: 'image', name: 'grade2', src: 'builtin:light-grade', blend: 'multiply', opacity: 0.9 },
  { kind: 'image', name: 'tint', src: 'builtin:light-tint', blend: 'normal', opacity: 1 },
];

/** relight.py BOOST_CSS: extra indigo under the headline for cards below WCAG AA (4.5:1). */
export const LIGHT_BOOST: Fill = {
  kind: 'linear', name: 'boost', angle: 90, blend: 'normal', opacity: 1,
  stops: [rgba(35, 38, 86, 0.62, 0), rgba(35, 38, 86, 0.42, 45), rgba(35, 38, 86, 0, 82)],
  mask: { angle: 180, stops: [rgba(0, 0, 0, 0, 52), rgba(0, 0, 0, 1, 84)] },
};

export const PHOTO_DARK = { saturate: 0.6, contrast: 1.07, brightness: 0.86 };
export const PHOTO_LIGHT = { saturate: 1.08, contrast: 1.1, brightness: 1 };
export const PHOTO_NEUTRAL = { saturate: 1, contrast: 1, brightness: 1 };

export const GRADIENT_PRESETS: GradientPreset[] = [
  { id: 'arnifi-light', name: 'Arnifi Light', editable: false, photoAdjust: PHOTO_LIGHT,
    description: 'Periwinkle sky, lavender haze, indigo base under the headline.', fills: LIGHT },
  { id: 'arnifi-dark', name: 'Arnifi Dark', editable: true, photoAdjust: PHOTO_DARK,
    description: 'The original purple wash, tone, side shade, vignette and grain.', fills: DARK },
  { id: 'arnifi-soft', name: 'Arnifi Soft', editable: true, photoAdjust: PHOTO_NEUTRAL,
    description: 'A light indigo fade along the bottom and left.',
    fills: [
      { kind: 'linear', name: 'soft', angle: 180, blend: 'normal', opacity: 1,
        stops: [rgba(17, 15, 52, 0, 38), rgba(17, 15, 52, 0.42, 72), rgba(17, 15, 52, 0.72, 100)] },
      { kind: 'linear', name: 'side', angle: 90, blend: 'normal', opacity: 1,
        stops: [rgba(17, 15, 52, 0.4, 0), rgba(17, 15, 52, 0, 55)] },
    ] },
  { id: 'left-readability', name: 'Left Readability', editable: true, photoAdjust: PHOTO_NEUTRAL,
    description: 'Darkens the left side for type, leaves the right side clean.',
    fills: [{ kind: 'linear', name: 'left', angle: 90, blend: 'normal', opacity: 1,
      stops: [rgba(8, 8, 8, 0.72, 0), rgba(8, 8, 8, 0.35, 40), rgba(8, 8, 8, 0, 70)] }] },
  { id: 'bottom-fade', name: 'Bottom Fade', editable: true, photoAdjust: PHOTO_NEUTRAL,
    description: 'A plain fade to near black at the bottom.',
    fills: [{ kind: 'linear', name: 'bottom', angle: 180, blend: 'normal', opacity: 1,
      stops: [rgba(8, 8, 8, 0, 45), rgba(8, 8, 8, 0.8, 100)] }] },
  { id: 'none', name: 'None', editable: true, description: 'No gradient.', fills: [] },
];

export function presetById(id: string): GradientPreset | undefined {
  return GRADIENT_PRESETS.find((p) => p.id === id);
}

/** A deep copy, so editing a card's fills never mutates the shared preset. */
export function presetFills(id: string): Fill[] {
  return JSON.parse(JSON.stringify(presetById(id)?.fills ?? []));
}
