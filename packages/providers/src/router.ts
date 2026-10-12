/**
 * Prompt intent router (PRD §30–31). Requests are classified before anything runs, and each intent
 * touches the smallest part of the design: "make the gradient darker" never regenerates the
 * background; "another person for the background" never touches typography.
 *
 * The deterministic rules below handle the common edits with no AI at all (and instantly). Anything
 * they can't classify with confidence goes to a connected provider's structured classifier.
 */
import type { Design, GradientLayer, Intent, LinearFill, RouterResult, TextLayer } from '@acs/types';

const has = (t: string, re: RegExp) => re.test(t);

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, a: 1, an: 1, couple: 2, few: 3 };
const COLORS: Record<string, string> = {
  black: '#080808', 'almost black': '#0b0b0f', navy: '#0b1736', indigo: '#232656', purple: '#342d7c', violet: '#4b3b8f',
  blue: '#1d3a8a', white: '#ffffff', grey: '#3a3a3a', gray: '#3a3a3a', green: '#0f3d2e', teal: '#0f4c4c', brown: '#3b2a1e',
};

function amount(t: string) {
  if (has(t, /\b(much|a lot|way|significantly|far|very)\b/)) return 2.2;
  if (has(t, /\b(slightly|a bit|a little|little|tad|touch|subtly)\b/)) return 0.5;
  return 1;
}

function direction(t: string): { dx: number; dy: number } | null {
  const a = amount(t);
  const step = 40 * a;
  if (has(t, /\b(left|leftwards)\b/)) return { dx: -step, dy: 0 };
  if (has(t, /\b(right|rightwards)\b/)) return { dx: step, dy: 0 };
  if (has(t, /\b(up|higher|upwards|top)\b/)) return { dx: 0, dy: -step };
  if (has(t, /\b(down|lower|downwards|bottom)\b/)) return { dx: 0, dy: step };
  return null;
}

function quoted(t: string) {
  const m = t.match(/["“'‘]([^"”'’]{2,200})["”'’]/);
  return m ? m[1].trim() : null;
}

function target(t: string): 'logo' | 'headline' | 'subheading' | 'gradient' | 'background' | null {
  if (has(t, /\b(sub ?headings?|key ?lines?|kickers?|taglines?|small caps|sub ?titles?)\b/)) return 'subheading';
  if (has(t, /\b(headlines?|headings?|titles?|h1)\b/)) return 'headline';
  if (has(t, /\blogos?\b/)) return 'logo';
  if (has(t, /\b(gradients?|wash|overlay|tint|shade|vignette|fade)\b/)) return 'gradient';
  if (has(t, /\b(background|photo|image|picture|subject|person|people|building|scene)\b/)) return 'background';
  return null;
}

export function routeByRules(text: string, design: Design | null): RouterResult {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const base = { confidence: 0.9, source: 'rules' as const };

  // variations / generation first: they name the background but are not edits of it
  const nMatch = t.match(/\b(\d+|one|two|three|four|a couple|a few)\s+(alternatives?|variations?|options?|versions?|backgrounds?|images?)\b/);
  if (has(t, /\b(alternatives?|variations?|options)\b/) && has(t, /\b(background|image|photo|picture)\b/) || (nMatch && has(t, /\b(generate|give|make|create|show)\b/))) {
    const raw = nMatch?.[1]?.replace('a ', '') ?? '4';
    const n = Math.min(4, Math.max(1, Number(raw) || NUM_WORDS[raw] || 4));
    return { ...base, intent: 'GENERATE_VARIATIONS', targets: ['background'], variations: n, imagePrompt: text, explanation: `Generate ${n} background alternatives; everything else stays.` };
  }
  if (has(t, /\b(replace|new|different|another|generate|create|swap|change)\b/) && has(t, /\b(background|photo|image|picture|person|subject|scene)\b/)
    && !has(t, /\b(gradient|darker|lighter|brighter|crop|move|shift|position|zoom)\b/)) {
    const keep = has(t, /\b(keep|preserve|same|but)\b/) && has(t, /\b(edit|adjust|remove|retouch|clean)\b/);
    return { ...base, intent: keep ? 'EDIT_BACKGROUND' : 'GENERATE_BACKGROUND', targets: ['background'], imagePrompt: text,
      explanation: keep ? 'Edit the current background image; typography and layout stay.' : 'A new background image; typography and layout stay.' };
  }
  if (has(t, /\b(edit|retouch|clean up|remove the|erase)\b/) && has(t, /\b(background|photo|image|from the (photo|image|background))\b/)) {
    return { ...base, intent: 'EDIT_BACKGROUND', targets: ['background'], imagePrompt: text, explanation: 'Edit the current background image only.' };
  }

  // dimensions
  const dim = t.match(/\b(\d{3,4})\s*(?:x|×|by)\s*(\d{3,4})\b/);
  if (dim || has(t, /\b(square|portrait|story|stories|landscape|instagram|linkedin)\b/) && has(t, /\b(make|resize|change|turn|convert|format)\b/)) {
    let w = 1600, h = 1000;
    if (dim) { w = Number(dim[1]); h = Number(dim[2]); }
    else if (has(t, /\bsquare\b/)) { w = 1080; h = 1080; }
    else if (has(t, /\b(story|stories)\b/)) { w = 1080; h = 1920; }
    else if (has(t, /\b(portrait|instagram)\b/)) { w = 1080; h = 1350; }
    else if (has(t, /\b(landscape|linkedin)\b/)) { w = 1920; h = 1080; }
    return { ...base, intent: 'CHANGE_DIMENSIONS', targets: ['canvas'], dimensions: { width: w, height: h }, explanation: `Resize to ${w} × ${h}, scaling the layout proportionally.` };
  }

  const tg = target(t);

  // show / hide
  if (tg && tg !== 'background' && has(t, /\b(remove|hide|without|no|turn off|drop|get rid of|disable)\b/)) {
    return { ...base, intent: 'CHANGE_LAYOUT', targets: [tg], layout: { moves: [{ layerId: tg, visible: false }] }, explanation: `Hide the ${tg}.` };
  }
  if (tg && tg !== 'background' && has(t, /\b(show|add back|bring back|turn on|enable|restore)\b/)) {
    return { ...base, intent: 'CHANGE_LAYOUT', targets: [tg], layout: { moves: [{ layerId: tg, visible: true }] }, explanation: `Show the ${tg}.` };
  }

  // gradient edits — structured, never a new image (PRD §23)
  // colour talk with no other target is about the wash ("reduce the purple and make it almost black")
  const colourTalk = !tg && has(t, /\b(purple|violet|black|navy|indigo|blue|colou?rs?|tones?|hue|tint)\b/) && has(t, /\b(make|reduce|less|more|turn|remove)\b/);
  if (tg === 'gradient' || colourTalk || (!tg && has(t, /\b(darker|lighter|brighter|softer|stronger|weaker)\b/) && !has(t, /\b(text|font)\b/))) {
    const g = design?.layers.find((l) => l.type === 'gradient') as GradientLayer | undefined;
    const lin = g?.fills.find((f) => f.kind === 'linear') as LinearFill | undefined;
    const a = amount(t);
    const gp: NonNullable<RouterResult['gradient']> = {};
    if (has(t, /\b(darker|darken|deeper|stronger|heavier|more (dark|contrast|intense))\b/)) gp.darken = Math.min(0.6, 0.15 * a);
    if (has(t, /\b(lighter|lighten|softer|weaker|subtler|less (dark|intense|heavy)|brighter)\b/)) gp.darken = -Math.min(0.6, 0.15 * a);
    for (const [name, hex] of Object.entries(COLORS)) {
      if (has(t, new RegExp(`\\b${name}\\b`))) { gp.start = hex; if (name.includes('black')) gp.darken = Math.max(gp.darken ?? 0, 0.2); }
    }
    if (has(t, /\b(reduce|less|remove) (the )?(purple|violet|colou?r)\b/)) { gp.start = gp.start ?? '#0b0b0f'; gp.darken = Math.max(gp.darken ?? 0, 0.1); }
    const pos = lin?.stops[lin.stops.length - 1]?.pos ?? 70;
    if (has(t, /\b(towards?|to|more) (the )?left\b/)) { gp.angle = 90; gp.position = Math.max(15, pos - 15 * a); }
    else if (has(t, /\b(towards?|to|more) (the )?right\b/)) { gp.angle = 270; gp.position = Math.max(15, pos - 15 * a); }
    else if (has(t, /\b(towards?|to|more) (the )?bottom\b/)) { gp.angle = 180; }
    else if (has(t, /\b(towards?|to|more) (the )?top\b/)) { gp.angle = 0; }
    if (has(t, /\b(wider|further|longer|extend)\b/)) gp.position = Math.min(100, pos + 15 * a);
    const pct = t.match(/(\d{1,3})\s*%/);
    if (pct) gp.opacity = Math.min(1, Number(pct[1]) / 100);
    if (Object.keys(gp).length) {
      return { ...base, intent: 'EDIT_GRADIENT', targets: ['gradient'], gradient: gp, explanation: 'Adjust the gradient only; the image and text stay.' };
    }
  }

  // copy
  if (tg === 'headline' || tg === 'subheading' || has(t, /\b(copy|wording|text)\b/)) {
    const layerId = tg === 'subheading' ? 'subheading' : 'headline';
    const q = quoted(text);
    if (q && has(t, /\b(to|say|read|reads|change|set|use|make it)\b/)) {
      return { ...base, intent: 'EDIT_COPY', targets: [layerId], copy: { layerId, text: q }, explanation: `Set the ${layerId} to “${q}”.` };
    }
    if (has(t, /\b(bigger|larger|smaller|increase|decrease)\b/) && has(t, /\b(size|font|text|bigger|smaller|larger)\b/)) {
      const cur = (design?.layers.find((l) => l.id === layerId) as TextLayer | undefined)?.fontSize ?? 60;
      const f = has(t, /\b(bigger|larger|increase)\b/) ? 1 + 0.12 * amount(t) : 1 - 0.12 * amount(t);
      return { ...base, intent: 'CHANGE_LAYOUT', targets: [layerId], layout: { moves: [{ layerId, fontSize: Math.round(cur * f) }] }, explanation: `Make the ${layerId} ${f > 1 ? 'larger' : 'smaller'}.` };
    }
    if (has(t, /\b(shorter|shorten|concise|trim|tighter|rewrite|rephrase|punchier|better|improve|clearer)\b/)) {
      return { ...base, confidence: 0.8, intent: 'EDIT_COPY', targets: [layerId], explanation: `Suggest new ${layerId} copy (the original is kept).` };
    }
  }

  // reposition / scale
  const dir = direction(t);
  if (has(t, /\b(move|shift|nudge|push|slide|place|put)\b/) && dir) {
    if (tg === 'background' || has(t, /\b(subject|person|building)\b/)) {
      return { ...base, intent: 'REPOSITION_LAYER', targets: ['background'], layout: { moves: [{ layerId: 'background', dx: dir.dx, dy: dir.dy }] }, explanation: 'Reframe the background image.' };
    }
    if (tg) return { ...base, intent: 'REPOSITION_LAYER', targets: [tg], layout: { moves: [{ layerId: tg, dx: dir.dx, dy: dir.dy }] }, explanation: `Move the ${tg}.` };
  }
  if (tg === 'logo' && has(t, /\b(bigger|larger|smaller|increase|decrease)\b/)) {
    const logo = design?.layers.find((l) => l.id === 'logo');
    const f = has(t, /\b(bigger|larger|increase)\b/) ? 1 + 0.2 * amount(t) : 1 - 0.2 * amount(t);
    return { ...base, intent: 'CHANGE_LAYOUT', targets: ['logo'], layout: { moves: [{ layerId: 'logo', width: Math.round((logo?.width ?? 196) * f) }] }, explanation: `Make the logo ${f > 1 ? 'larger' : 'smaller'}.` };
  }

  if (has(t, /\b(what'?s wrong|review|critique|analy[sz]e|feedback|check|assess|how does it look|improve this)\b/)) {
    return { ...base, confidence: 0.85, intent: 'ANALYZE_CARD', targets: [], explanation: 'Review the card and suggest fixes (nothing changes until you apply).' };
  }
  return { intent: 'UNKNOWN', confidence: 0, targets: [], explanation: "I couldn't tell what to change.", source: 'rules' };
}

/** Intents that only need the design, never an AI provider. */
export function isLocalIntent(r: RouterResult) {
  if (r.intent === 'EDIT_GRADIENT' || r.intent === 'CHANGE_LAYOUT' || r.intent === 'CHANGE_DIMENSIONS' || r.intent === 'REPOSITION_LAYER') return true;
  if (r.intent === 'EDIT_COPY' && r.copy?.text) return true;
  return false;
}

export const INTENT_LABEL: Record<Intent, string> = {
  EDIT_GRADIENT: 'Gradient edit', GENERATE_BACKGROUND: 'New background', EDIT_BACKGROUND: 'Background edit', EDIT_COPY: 'Copy edit',
  CHANGE_LAYOUT: 'Layout change', CHANGE_DIMENSIONS: 'Resize', REPOSITION_LAYER: 'Reposition', GENERATE_VARIATIONS: 'Background variations',
  ANALYZE_CARD: 'Review', UNKNOWN: 'Unclear request',
};
