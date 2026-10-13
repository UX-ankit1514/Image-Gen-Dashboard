/** Request validation schemas shared by the SPA and the Worker API (PRD §78 request validation). */
import { z } from 'zod';
import { Overrides } from './design';
import { REJECT_TAGS } from './domain';
import { GradientPatch, Scope } from './ai';

const name = z.string().trim().min(1).max(120);

export const LayerToggles = z.object({
  background: z.boolean(),
  gradient: z.boolean(),
  logo: z.boolean(),
  headline: z.boolean(),
  subheading: z.boolean(),
});
export type LayerToggles = z.infer<typeof LayerToggles>;

export const InputType = z.enum(['url', 'urls', 'upload', 'screenshot', 'import', 'blank']);
export type InputType = z.infer<typeof InputType>;

export const CreateProjectBody = z.object({
  name,
  description: z.string().max(2000).optional(),
  inputType: InputType,
  urls: z.array(z.string().max(2048)).max(50).optional(),
  recipeId: z.string().min(1),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  layers: LayerToggles,
  provider: z.enum(['chatgpt', 'claude', 'auto', 'none']),
  brief: z.string().max(4000).optional(),
  /** An uploaded gradient (a global asset) used as the gradient layer, and how it mixes with the photo. */
  gradient: z.object({ assetId: z.string().min(1).max(64), mix: z.enum(['designed', 'tint', 'darken', 'soft']) }).optional(),
  /** Which built-in brief and rules AI image requests use (see PHOTO_STYLES). */
  photoStyle: z.enum(['corporate', 'documents', 'editorial']).optional(),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBody>;

export const UpdateProjectBody = z.object({
  name: name.optional(),
  description: z.string().max(2000).optional(),
  brief: z.string().max(4000).optional(),
  negativeConstraints: z.array(z.string().max(300)).max(40).optional(),
  namingTemplate: z.string().max(200).optional(),
  provider: z.enum(['chatgpt', 'claude', 'auto', 'none']).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export const StartScanBody = z.object({ urls: z.array(z.string().max(2048)).min(1).max(50), rescan: z.boolean().optional() });

export const CreateCardsBody = z.object({
  pageIds: z.array(z.string()).min(1).max(500),
  /** pageId → chosen background asset id (image discovery, PRD §15). */
  backgrounds: z.record(z.string(), z.string()).optional(),
});

export const CreateBlankCardBody = z.object({
  name: z.string().trim().min(1).max(120),
  backgroundAssetId: z.string().nullable().optional(),
  headline: z.string().max(300).optional(),
  subheading: z.string().max(300).optional(),
});

export const SaveDraftBody = z.object({ draft: Overrides, baseRev: z.string() });

export const CommitVersionBody = z.object({
  reason: z.string().max(200).optional(),
  prompt: z.string().max(8000).nullable().optional(),
  provider: z.string().max(60).nullable().optional(),
});

export const RejectBody = z.object({
  tags: z.array(z.enum(REJECT_TAGS)).min(1),
  text: z.string().max(2000).optional(),
});

export const BatchAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('toggle_layer'), layerId: z.string(), visible: z.boolean() }),
  z.object({ action: z.literal('apply_gradient'), preset: z.string().optional(), patch: GradientPatch.optional() }),
  z.object({ action: z.literal('apply_template'), recipeId: z.string() }),
  z.object({ action: z.literal('resize'), width: z.number().int().min(16).max(8192), height: z.number().int().min(16).max(8192),
    mode: z.enum(['scale', 'keep', 'reflow']), fit: z.enum(['cover', 'contain']) }),
  z.object({ action: z.literal('replace_background'), assetId: z.string() }),
  z.object({ action: z.literal('patch'), overrides: Overrides, reason: z.string().max(200) }),
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), tags: z.array(z.enum(REJECT_TAGS)).min(1), text: z.string().max(2000).optional() }),
  z.object({ action: z.literal('status'), status: z.enum(['draft', 'needs_review', 'archived']) }),
]);
export type BatchAction = z.infer<typeof BatchAction>;

export const BatchBody = z.object({
  cardIds: z.array(z.string()).max(1000),
  scope: Scope,
  /** No longer used: every card can be changed. */
  includeApproved: z.boolean().optional(),
  op: BatchAction,
});
export type BatchBody = z.infer<typeof BatchBody>;

export const ExportBody = z.object({
  scope: z.enum(['current', 'selected', 'all']),
  cardIds: z.array(z.string()).max(1000).optional(),
  format: z.enum(['png', 'jpg', 'webp']),
  scale: z.number().min(0.25).max(4),
  /** Approval no longer gates Export: kept so older callers still validate. */
  includeUnapproved: z.boolean().optional(),
  contactSheet: z.boolean().optional(),
  csv: z.boolean().optional(),
  manifest: z.boolean().optional(),
  namingTemplate: z.string().max(200).optional(),
});
export type ExportBody = z.infer<typeof ExportBody>;

export const PromptBody = z.object({
  cardId: z.string().optional(),
  cardIds: z.array(z.string()).max(1000).optional(),
  text: z.string().trim().min(1).max(2000),
  scope: Scope,
  provider: z.enum(['openai', 'claude', 'auto']).optional(),
});
export type PromptBody = z.infer<typeof PromptBody>;
