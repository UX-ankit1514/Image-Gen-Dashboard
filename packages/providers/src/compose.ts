/**
 * Prompt architecture (PRD §35–37, §43): the user writes only the final instruction; everything else
 * comes from the project, so nobody has to re-explain the folder, the brief or what was rejected.
 *
 *   SYSTEM CREATIVE RULES + PROJECT RECIPE + PROJECT BRIEF + PAGE CONTEXT + CURRENT DESIGN STATE
 *   + REFERENCE IMAGES + PREVIOUS REJECTION HISTORY + USER REQUEST (+ negative constraints, size)
 *
 * The composed prompt is stored on the job, so any result can be traced back to exactly what was asked.
 */
import type { Design, Feedback, Project, SourcePage, TextLayer } from '@acs/types';

export interface GenerationContext {
  project: Pick<Project, 'name' | 'brief' | 'negativeConstraints' | 'rules' | 'recipeId'>;
  recipeName?: string;
  page?: Pick<SourcePage, 'url' | 'h1' | 'name' | 'highlights' | 'country' | 'authority' | 'category' | 'jurisdiction'> | null;
  design?: Design | null;
  references?: { kind: 'approved' | 'rejected' | 'style' | 'direction'; note: string; file?: string }[];
  rejections?: Pick<Feedback, 'tags' | 'text' | 'createdAt'>[];
  originalPrompt?: string | null;
  request: string;
  width: number;
  height: number;
}

export const SYSTEM_CREATIVE_RULES = [
  'You create background photography for Arnifi marketing cards (business setup, licences, legal and compliance services).',
  'The card adds its own logo (top-left), a small key line and a serif headline (bottom-left) on top of your image, plus a colour gradient. So:',
  '- Produce a clean photograph only: no text, letters, numbers, logos, watermarks, borders or UI in the image.',
  '- Keep the lower-left area (roughly the left 55% of the bottom 35%) and the top-left logo area visually quiet: no faces, key objects or bright highlights there.',
  '- Realistic, premium, editorial; natural materials and light; no cartoon or illustration look; no AI-polished faces.',
  '- Do not add gradients, colour washes or vignettes into the photograph itself; the card applies its own.',
].join('\n');

function aspectLabel(w: number, h: number) {
  const r = w / h;
  const known: [number, string][] = [[16 / 10, '16:10'], [16 / 9, '16:9'], [1, '1:1'], [4 / 5, '4:5'], [9 / 16, '9:16'], [2.4, '12:5']];
  const best = known.reduce((a, b) => (Math.abs(b[0] - r) < Math.abs(a[0] - r) ? b : a));
  return Math.abs(best[0] - r) < 0.03 ? best[1] : `${w}:${h}`;
}

export function describeDesign(d: Design) {
  const lines: string[] = [];
  for (const l of d.layers) {
    if (!l.visible) continue;
    if (l.type === 'background') lines.push(`- background image (focal point ${Math.round(l.focalX * 100)}% / ${Math.round(l.focalY * 100)}%, fit ${l.fit})`);
    if (l.type === 'gradient') lines.push(`- gradient "${l.preset}" at ${Math.round(l.opacity * 100)}%`);
    if (l.type === 'logo') lines.push(`- logo at x ${Math.round(l.x)}, y ${Math.round(l.y)}, ${Math.round(l.width)} px wide`);
    if (l.type === 'text') lines.push(`- ${l.role}: "${(l as TextLayer).text}"`);
  }
  return lines.join('\n');
}

export function composeGenerationPrompt(c: GenerationContext) {
  const s: string[] = [];
  s.push(`SYSTEM CREATIVE RULES\n${SYSTEM_CREATIVE_RULES}`);
  s.push(`PROJECT RECIPE\n${c.recipeName ?? c.project.recipeId}. Output a ${c.width} × ${c.height} px (${aspectLabel(c.width, c.height)}) landscape-safe photograph.`);
  if (c.project.brief?.trim()) s.push(`PROJECT BRIEF\n${c.project.brief.trim()}`);
  const rules = (c.project.rules ?? []).map((r) => `- ${r.text}`).join('\n');
  if (rules) s.push(`PROJECT RULES\n${rules}`);
  if (c.page) {
    const hl = (c.page.highlights ?? []).slice(0, 5).map((h) => `- ${h.title}`).join('\n');
    s.push(`PAGE CONTEXT\nService: ${c.page.h1 || c.page.name}\n${[c.page.category && `Category: ${c.page.category}`, c.page.country && `Country: ${c.page.country}`, c.page.authority && `Authority / jurisdiction: ${c.page.authority}`, `Page: ${c.page.url}`].filter(Boolean).join('\n')}${hl ? `\nHighlights:\n${hl}` : ''}`);
  }
  if (c.design) s.push(`CURRENT DESIGN STATE\n${describeDesign(c.design)}`);
  if (c.references?.length) {
    const ok = c.references.filter((r) => r.kind === 'approved' || r.kind === 'style' || r.kind === 'direction');
    const no = c.references.filter((r) => r.kind === 'rejected');
    const refs: string[] = [];
    if (ok.length) refs.push(`Approved in this project (match their style, avoid repeating their subject):\n${ok.slice(0, 8).map((r) => `- ${r.note}${r.file ? ` [${r.file}]` : ''}`).join('\n')}`);
    if (no.length) refs.push(`Rejected (do not resemble):\n${no.slice(0, 8).map((r) => `- ${r.note}${r.file ? ` [${r.file}]` : ''}`).join('\n')}`);
    s.push(`REFERENCE IMAGES\n${refs.join('\n')}`);
  }
  if (c.rejections?.length || c.originalPrompt) {
    const hist: string[] = [];
    if (c.originalPrompt) hist.push(`Previous prompt for this card: ${c.originalPrompt}`);
    for (const r of c.rejections ?? []) hist.push(`- Rejected: ${r.tags.join(', ')}${r.text ? ` — "${r.text}"` : ''}`);
    s.push(`PREVIOUS REJECTION HISTORY\n${hist.join('\n')}`);
  }
  const neg = (c.project.negativeConstraints ?? []).map((n) => `- ${n}`).join('\n');
  if (neg) s.push(`NEGATIVE CONSTRAINTS\n${neg}`);
  s.push(`USER REQUEST\n${c.request.trim() || `A new background for "${c.page?.h1 ?? c.project.name}" that fits the brief.`}`);
  return s.join('\n\n');
}

/** For text intents (copy, critique, classification): the same context, minus image rules. */
export function composeTextContext(c: Omit<GenerationContext, 'width' | 'height'> & { width?: number; height?: number }) {
  const s: string[] = [`PROJECT: ${c.project.name}`];
  if (c.project.brief?.trim()) s.push(`BRIEF\n${c.project.brief.trim()}`);
  if (c.page) s.push(`PAGE\nH1: ${c.page.h1}\nHighlights:\n${(c.page.highlights ?? []).slice(0, 8).map((h) => `- ${h.title}${h.desc ? `: ${h.desc}` : ''}`).join('\n')}\nURL: ${c.page.url}`);
  if (c.design) s.push(`CURRENT DESIGN\n${describeDesign(c.design)}`);
  if (c.rejections?.length) s.push(`REJECTIONS\n${c.rejections.map((r) => `- ${r.tags.join(', ')} ${r.text}`).join('\n')}`);
  s.push(`REQUEST\n${c.request}`);
  return s.join('\n\n');
}
