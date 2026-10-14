/** AI client: connections, availability per capability, and job polling. Provider-agnostic (Rule 5–6). */
import { useQuery } from '@tanstack/react-query';
import type { Job, ProviderCapabilities, ProviderConnection, ProviderId } from '@acs/types';
import { api } from '../../lib/api';

export interface ConnectionsView {
  connections: ProviderConnection[];
  companion: { paired: boolean; online: boolean; devices: { id: string; name: string; lastSeenAt: string | null; codexInstalled?: boolean | null }[] };
  oauth: { openai: boolean };
}

/** `fast` while something is about to change (a sign-in in progress, a companion being paired). */
export const useConnections = (fast = false) =>
  useQuery({ queryKey: ['connections'], queryFn: () => api.get<ConnectionsView>('/connections'), refetchInterval: fast ? 2000 : 20_000 });

export type Need = keyof Pick<ProviderCapabilities, 'textGeneration' | 'visionAnalysis' | 'imageGeneration' | 'imageEditing' | 'structuredOutput'>;

/** Which connection serves a need, honouring the project's choice (PRD §12 step 6). Never an API key. */
export function pickProvider(view: ConnectionsView | undefined, choice: string, need: Need): ProviderConnection | null {
  const live = (view?.connections ?? []).filter((c) => c.status === 'connected' && c.capabilities[need]);
  if (choice === 'none') return null;
  const pref: ProviderId[] = choice === 'claude' ? ['claude'] : choice === 'chatgpt' ? ['openai'] : need === 'imageGeneration' || need === 'imageEditing' ? ['openai', 'claude'] : ['claude', 'openai'];
  for (const id of pref) {
    const c = live.find((x) => x.provider === id);
    if (c) return c;
  }
  return null;
}

export function planLabel(c: ProviderConnection | null) {
  if (!c) return null;
  return c.provider === 'openai' ? 'Using ChatGPT plan' : `Using ${c.planLabel ?? 'Claude plan'}`;
}

export async function waitForJob(id: string, onUpdate?: (j: Job) => void, timeoutMs = 15 * 60_000): Promise<Job> {
  const t0 = Date.now();
  let delay = 900;
  for (;;) {
    const j = await api.get<Job>(`/jobs/${id}`);
    onUpdate?.(j);
    if (['completed', 'failed', 'cancelled', 'paused'].includes(j.status)) return j;
    if (Date.now() - t0 > timeoutMs) return j;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(3000, delay * 1.25);
  }
}
