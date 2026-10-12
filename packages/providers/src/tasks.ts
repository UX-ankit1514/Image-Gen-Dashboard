/**
 * Intent + project context → an AI task with a strict output schema, and the post-processing kind
 * the server applies to the reply. Context always comes from the database (Rule 7), never from chat.
 */
import type { Design, Feedback, Intent, Project, SourcePage } from '@acs/types';
import type { AiTask } from './provider';
import { composeGenerationPrompt, composeTextContext, SYSTEM_CREATIVE_RULES, type GenerationContext } from './compose';

const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const nullable = (t: Record<string, unknown>) => ({ anyOf: [t, { type: 'null' }] });
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export const SCHEMAS = {
  route: obj({
    intent: { type: 'string', enum: ['EDIT_GRADIENT', 'GENERATE_BACKGROUND', 'EDIT_BACKGROUND', 'EDIT_COPY', 'CHANGE_LAYOUT', 'CHANGE_DIMENSIONS', 'REPOSITION_LAYER', 'GENERATE_VARIATIONS', 'ANALYZE_CARD', 'UNKNOWN'] },
    confidence: num,
    targets: { type: 'array', items: str },
    gradient: nullable(obj({ opacity: nullable(num), angle: nullable(num), start: nullable(str), end: nullable(str), startAlpha: nullable(num), endAlpha: nullable(num), position: nullable(num), darken: nullable(num) })),
    copy: nullable(obj({ layerId: { type: 'string', enum: ['headline', 'subheading'] }, text: str })),
    layout: nullable(obj({ moves: { type: 'array', items: obj({ layerId: str, dx: nullable(num), dy: nullable(num), visible: nullable({ type: 'boolean' }), width: nullable(num), fontSize: nullable(num) }) } })),
    dimensions: nullable(obj({ width: num, height: num })),
    imagePrompt: nullable(str),
    variations: nullable(num),
    explanation: str,
  }),
  copy: obj({ text: str, alternatives: { type: 'array', items: str }, rationale: str }),
  gradient: obj({ opacity: nullable(num), angle: nullable(num), start: nullable(str), end: nullable(str), startAlpha: nullable(num), endAlpha: nullable(num), position: nullable(num), darken: nullable(num), explanation: str }),
  critique: obj({ summary: str, issues: { type: 'array', items: obj({ text: str, severity: { type: 'string', enum: ['high', 'medium', 'low'] } }) }, suggestedRules: { type: 'array', items: str } }),
  consistency: obj({
    summary: str,
    issues: { type: 'array', items: obj({ text: str, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, cards: { type: 'array', items: num } }) },
    duplicateSubjects: { type: 'array', items: obj({ cards: { type: 'array', items: num }, note: str }) },
    suggestedRules: { type: 'array', items: str },
  }),
  analysis: obj({ description: str, visibleText: str, containsText: { type: 'boolean' }, containsLogo: { type: 'boolean' }, layoutNotes: str, tags: { type: 'array', items: str } }),
} as const;

/** Drop the nulls strict schemas force on optional fields. */
export function compact<T>(v: T): T {
  if (Array.isArray(v)) return v.map(compact) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) out[k] = compact(x);
    return out as T;
  }
  return v;
}

export type PostKind = 'route' | 'copy' | 'gradient' | 'critique' | 'analysis' | 'images' | 'consistency';

export interface TaskContext {
  project: Pick<Project, 'name' | 'brief' | 'negativeConstraints' | 'rules' | 'recipeId'>;
  page?: SourcePage | null;
  design: Design;
  rejections?: Pick<Feedback, 'tags' | 'text' | 'createdAt'>[];
  request: string;
  layerId?: 'headline' | 'subheading';
  previewUrl?: string | null;
}

const JSON_ONLY = 'Reply with JSON only, matching the schema. No prose, no code fences.';

export function textTask(intent: Intent, c: TaskContext): { task: AiTask; post: PostKind } {
  const context = composeTextContext({ project: c.project, page: c.page ?? null, design: c.design, rejections: c.rejections, request: c.request });
  if (intent === 'EDIT_COPY') {
    const which = c.layerId ?? 'headline';
    return {
      post: 'copy',
      task: {
        kind: 'structured', schema: SCHEMAS.copy,
        system: `You write short card copy for Arnifi marketing cards. The ${which === 'headline' ? 'headline is a serif title of at most ~60 characters' : 'key line is an uppercase small-caps phrase of at most ~45 characters'}. Use only facts from the page; never invent prices, laws or claims. Give the best line in "text", two alternatives, and a one-sentence rationale. ${JSON_ONLY}`,
        prompt: `${context}\n\nLayer: ${which}`,
      },
    };
  }
  if (intent === 'EDIT_GRADIENT') {
    return {
      post: 'gradient',
      task: {
        kind: 'structured', schema: SCHEMAS.gradient,
        system: `You adjust a card's gradient overlay. Return only the structured change (colours as #hex or "transparent", angle in degrees, opacity/alpha 0..1, position 5..100 = where the fade ends, darken -1..1 relative). Never describe a new image. ${JSON_ONLY}`,
        prompt: context,
      },
    };
  }
  if (intent === 'ANALYZE_CARD') {
    return {
      post: 'critique',
      task: {
        kind: c.previewUrl ? 'vision' : 'structured', schema: SCHEMAS.critique, images: c.previewUrl ? [c.previewUrl] : undefined,
        system: `You are a senior art director reviewing an Arnifi marketing card against its brief. List concrete issues (subject, crop, readability of the bottom-left text over the photo, logo collisions, copy accuracy against the page, repetition). Suggest project rules only for patterns worth keeping for every card; they are suggestions the designer may ignore. ${JSON_ONLY}`,
        prompt: context,
      },
    };
  }
  return {
    post: 'route',
    task: {
      kind: 'structured', schema: SCHEMAS.route,
      system: `Classify a designer's request about one card into exactly one intent, and fill only the fields that intent needs. Change the smallest part of the design: a gradient request never generates an image; a background request never touches text. Layer ids: background, gradient, logo, headline, subheading. Canvas ${c.design.canvas.width}×${c.design.canvas.height}. ${JSON_ONLY}`,
      prompt: context,
    },
  };
}

export function imageTask(c: GenerationContext & { mode: 'generate' | 'edit'; editImageUrl?: string | null; referenceUrls?: string[]; n: number }): { task: AiTask; post: PostKind; prompt: string } {
  const prompt = composeGenerationPrompt(c);
  const task: AiTask = {
    kind: c.mode === 'edit' ? 'image-edit' : 'image', n: c.mode === 'edit' ? 1 : c.n, size: { width: c.width, height: c.height }, prompt,
    images: c.mode === 'edit' && c.editImageUrl ? [c.editImageUrl] : undefined,
    system: SYSTEM_CREATIVE_RULES,
  };
  return { task, post: 'images', prompt };
}

export function analysisTask(imageUrl: string): { task: AiTask; post: PostKind } {
  return {
    post: 'analysis',
    task: {
      kind: 'vision', schema: SCHEMAS.analysis, images: [imageUrl],
      system: `Describe this image for a designer: what it shows, any visible text (verbatim, short), whether it contains printed text or a logo, layout/typography notes, and 3-8 tags. ${JSON_ONLY}`,
      prompt: 'Analyse the attached image.',
    },
  };
}

/** Project-level visual consistency review (PRD §89): suggestions only, never applied on their own. */
export function consistencyTask(c: { project: TaskContext['project']; cards: { n: number; name: string; url: string }[] }): { task: AiTask; post: PostKind } {
  const list = c.cards.map((x) => `${x.n}. ${x.name}`).join('\n');
  return {
    post: 'consistency',
    task: {
      kind: 'vision', schema: SCHEMAS.consistency, images: c.cards.map((x) => x.url),
      system: `You are the art director of a set of Arnifi marketing cards. The images are the cards in this order:\n${list}\nJudge the SET: visual consistency (light, colour, crop, subject placement relative to the bottom-left text), repeated or near-identical subjects, and cards that break the brief. Refer to cards by their numbers. Suggest project rules only for patterns worth keeping for every future card; the designer decides. ${JSON_ONLY}`,
      prompt: `PROJECT: ${c.project.name}\nBRIEF:\n${c.project.brief || '(none)'}\nRULES:\n${(c.project.rules ?? []).map((r) => `- ${r.text}`).join('\n') || '(none)'}`,
    },
  };
}
