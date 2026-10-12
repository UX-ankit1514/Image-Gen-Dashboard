/**
 * The provider abstraction (PRD §6, Rules 5–6). Application code never talks to ChatGPT or Claude
 * directly: it asks for a task, and an adapter with the right detected capability runs it.
 *
 *   AIProvider
 *    ├── OpenAICodexLocal   (companion: official `codex` CLI, signed in with ChatGPT)
 *    ├── ClaudeCodeLocal    (companion: official `claude` CLI, signed in with Claude Pro/Max)
 *    └── OpenAIOAuth        (cloud, PKCE; disabled until OpenAI approves the integration)
 *
 * No adapter accepts an API key, and none may fall back to API billing (Rule 10).
 */
import type { ProviderCapabilities, ProviderErrorInfo, ProviderId } from '@acs/types';

export type TaskKind = 'text' | 'structured' | 'vision' | 'image' | 'image-edit';

export interface AiTask {
  kind: TaskKind;
  system?: string;
  prompt: string;
  /** JSON Schema for structured replies (strict: every object closed, every key required). */
  schema?: Record<string, unknown>;
  /** Image inputs. On the server these are URLs; the companion downloads them to local files. */
  images?: string[];
  /** Image outputs wanted. */
  n?: number;
  size?: { width: number; height: number };
  model?: string;
}

export interface AiResult {
  text?: string;
  json?: unknown;
  /** Local file paths of generated images (companion side). */
  images?: string[];
}

export interface DetectedCli {
  installed: boolean;
  version: string | null;
  loggedIn: boolean;
  /** "claude.ai" / "ChatGPT" = subscription; anything else is refused. */
  authMethod: string | null;
  plan: string | null;
  account: string | null;
  subscriptionBacked: boolean;
}

export interface AIProvider {
  id: ProviderId;
  detect(): Promise<DetectedCli>;
  capabilities(d: DetectedCli): ProviderCapabilities;
  run(task: AiTask, signal?: AbortSignal): Promise<AiResult>;
}

export class ProviderError extends Error {
  constructor(public code: ProviderErrorInfo['code'], message: string, public resetAt: string | null = null) {
    super(message);
  }
}

/** Recognise a provider's usage-limit messages (PRD §60) and when it says to try again. */
export function parseUsageLimit(text: string, now = new Date()): { limited: boolean; resetAt: string | null } {
  const limited = /usage limit|rate.?limit|\b429\b|too many requests|cooling down|quota|limit reached|try again (at|in)/i.test(text);
  if (!limited) return { limited: false, resetAt: null };
  const at = text.match(/try again at\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (at) {
    let h = Number(at[1]) % 12;
    if ((at[3] ?? '').toLowerCase() === 'pm') h += 12;
    if (!at[3] && Number(at[1]) >= 13) h = Number(at[1]);
    const d = new Date(now);
    d.setHours(h, Number(at[2]), 0, 0);
    if (d < now) d.setDate(d.getDate() + 1);
    return { limited: true, resetAt: d.toISOString() };
  }
  const inMin = text.match(/try again in\s+(\d+)\s*(minute|min|hour|h)/i);
  if (inMin) {
    const n = Number(inMin[1]) * (/h/i.test(inMin[2]) ? 60 : 1);
    return { limited: true, resetAt: new Date(now.getTime() + n * 60_000).toISOString() };
  }
  return { limited: true, resetAt: new Date(now.getTime() + 30 * 60_000).toISOString() };
}

export const CLAUDE_CAPS = (d: DetectedCli): ProviderCapabilities => {
  const ok = d.installed && d.loggedIn && d.subscriptionBacked;
  return { textGeneration: ok, visionAnalysis: ok, structuredOutput: ok, imageGeneration: false, imageEditing: false, subscriptionBacked: ok, cloudExecution: false, localExecution: ok };
};

export const CODEX_CAPS = (d: DetectedCli, imageVerified: boolean | null): ProviderCapabilities => {
  const ok = d.installed && d.loggedIn && d.subscriptionBacked;
  // image generation is provider dependent: on unless a run proved it unavailable on this plan
  const img = ok && imageVerified !== false;
  return { textGeneration: ok, visionAnalysis: ok, structuredOutput: ok, imageGeneration: img, imageEditing: img, subscriptionBacked: ok, cloudExecution: false, localExecution: ok };
};
