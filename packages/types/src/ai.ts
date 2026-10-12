/** AI connection layer contracts (PRD §6, §31, §58). Provider-agnostic by construction. */
import { z } from 'zod';
import { BlendMode, Stop } from './design';

export const ProviderId = z.enum(['openai', 'claude']);
export type ProviderId = z.infer<typeof ProviderId>;

export const PROVIDER_LABEL: Record<ProviderId, string> = { openai: 'ChatGPT', claude: 'Claude' };

/** What a connection can actually do right now. Detected, never assumed (PRD §4, §6). */
export const ProviderCapabilities = z.object({
  textGeneration: z.boolean(),
  visionAnalysis: z.boolean(),
  structuredOutput: z.boolean(),
  imageGeneration: z.boolean(),
  imageEditing: z.boolean(),
  subscriptionBacked: z.boolean(),
  cloudExecution: z.boolean(),
  localExecution: z.boolean(),
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilities>;

export const NO_CAPABILITIES: ProviderCapabilities = {
  textGeneration: false, visionAnalysis: false, structuredOutput: false, imageGeneration: false,
  imageEditing: false, subscriptionBacked: false, cloudExecution: false, localExecution: false,
};

export type ConnectionMode = 'local-companion' | 'cloud-oauth';
export type ConnectionStatus = 'connected' | 'disconnected' | 'unavailable' | 'limited' | 'error';

export interface ProviderConnection {
  id: ProviderId;
  provider: ProviderId;
  mode: ConnectionMode;
  status: ConnectionStatus;
  /** "Using ChatGPT plan", "Claude Max" — what the provider reports, never a password or token. */
  planLabel: string | null;
  accountLabel: string | null;
  capabilities: ProviderCapabilities;
  deviceId: string | null;
  cli: { installed: boolean; version: string | null; authMethod: string | null } | null;
  usageLimit: { reached: boolean; resetAt: string | null; message: string | null } | null;
  /** Cloud OAuth only, AES-GCM encrypted at rest; refresh tokens never leave the server. */
  tokens?: { iv: string; data: string } | null;
  lastCheckedAt: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------- prompt intents (PRD §31)
export const Intent = z.enum([
  'EDIT_GRADIENT', 'GENERATE_BACKGROUND', 'EDIT_BACKGROUND', 'EDIT_COPY', 'CHANGE_LAYOUT',
  'CHANGE_DIMENSIONS', 'REPOSITION_LAYER', 'GENERATE_VARIATIONS', 'ANALYZE_CARD', 'UNKNOWN',
]);
export type Intent = z.infer<typeof Intent>;

export const Scope = z.enum(['card', 'selected', 'project', 'project_default']);
export type Scope = z.infer<typeof Scope>;

/** A structured gradient change — the AI returns this, never a new card image (PRD §23). */
export const GradientPatch = z.object({
  opacity: z.number().min(0).max(1).optional(),
  angle: z.number().optional(),
  start: z.string().optional(),          // colour, or "transparent"
  end: z.string().optional(),
  startAlpha: z.number().min(0).max(1).optional(),
  endAlpha: z.number().min(0).max(1).optional(),
  position: z.number().min(0).max(100).optional(),   // where the start colour stops, %
  blend: BlendMode.optional(),
  preset: z.string().optional(),
  darken: z.number().min(-1).max(1).optional(),      // relative: +0.15 = 15% darker
  stops: z.array(Stop).optional(),
});
export type GradientPatch = z.infer<typeof GradientPatch>;

export const CopyPatch = z.object({
  layerId: z.enum(['headline', 'subheading']),
  text: z.string(),
  rationale: z.string().optional(),
});
export type CopyPatch = z.infer<typeof CopyPatch>;

export const LayoutPatch = z.object({
  moves: z.array(z.object({
    layerId: z.string(),
    dx: z.number().optional(), dy: z.number().optional(),
    x: z.number().optional(), y: z.number().optional(),
    width: z.number().optional(), fontSize: z.number().optional(),
    visible: z.boolean().optional(),
  })),
});
export type LayoutPatch = z.infer<typeof LayoutPatch>;

export const RouterResult = z.object({
  intent: Intent,
  confidence: z.number().min(0).max(1),
  /** The smallest part of the design the request touches (PRD §31). */
  targets: z.array(z.string()),
  gradient: GradientPatch.optional(),
  copy: CopyPatch.optional(),
  layout: LayoutPatch.optional(),
  dimensions: z.object({ width: z.number(), height: z.number() }).optional(),
  imagePrompt: z.string().optional(),
  variations: z.number().int().min(1).max(4).optional(),
  explanation: z.string(),
  source: z.enum(['rules', 'ai']),
});
export type RouterResult = z.infer<typeof RouterResult>;

/** Raised by providers / the companion; mapped to the PRD §60 messages. */
export interface ProviderErrorInfo {
  code: 'usage_limit' | 'not_connected' | 'capability' | 'timeout' | 'bad_output' | 'provider_error';
  message: string;
  resetAt?: string | null;
}
