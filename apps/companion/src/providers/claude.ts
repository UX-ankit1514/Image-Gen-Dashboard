/** Claude through Claude Code, signed in with the user's Claude subscription (PRD §5). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLAUDE_CAPS, parseUsageLimit, ProviderError, type AIProvider, type AiResult, type AiTask, type DetectedCli } from '@acs/providers';
import { extractJson, findBin, run } from '../exec';

const BASE = ['-p', '--output-format', 'json', '--disable-slash-commands', '--strict-mcp-config', '--setting-sources', ''];
const NO_TOOLS = ['--disallowed-tools', 'Bash Edit Write WebFetch WebSearch Task Read Glob Grep NotebookEdit'];

export class ClaudeCodeLocal implements AIProvider {
  id = 'claude' as const;
  bin = findBin('claude');

  async detect(): Promise<DetectedCli> {
    const v = await run(this.bin, ['--version'], { timeoutMs: 20_000 });
    if (v.code !== 0) return { installed: false, version: null, loggedIn: false, authMethod: null, plan: null, account: null, subscriptionBacked: false };
    const s = await run(this.bin, ['auth', 'status'], { timeoutMs: 30_000 });
    let d: Record<string, any> = {};
    try { d = JSON.parse(s.stdout || '{}'); } catch { /* older CLI */ }
    const method = d.authMethod ?? null;
    return {
      installed: true, version: v.stdout.trim().split(/\s/)[0] ?? null, loggedIn: !!d.loggedIn, authMethod: method,
      plan: d.subscriptionType ?? null, account: d.email ?? null,
      // only the claude.ai subscription sign-in counts; an API key would be billed per token
      subscriptionBacked: method === 'claude.ai' && (d.apiProvider ?? 'firstParty') === 'firstParty',
    };
  }

  capabilities = CLAUDE_CAPS;

  async run(task: AiTask, signal?: AbortSignal): Promise<AiResult> {
    if (task.kind === 'image' || task.kind === 'image-edit') throw new ProviderError('capability', 'Claude does not generate images.');
    const dir = mkdtempSync(join(tmpdir(), 'acs-claude-'));
    try {
      const args = [...BASE, '--model', process.env.ACS_CLAUDE_MODEL || 'sonnet', '--effort', process.env.ACS_CLAUDE_EFFORT || 'medium'];
      if (task.system) args.push('--system-prompt', task.system);
      if (task.schema) args.push('--json-schema', JSON.stringify(task.schema));
      let prompt = task.prompt;
      if (task.images?.length) {
        args.push('--allowed-tools', 'Read', '--add-dir', dir);
        prompt = `Read each of these image files with the Read tool, then answer.\n${task.images.map((p) => `- ${p}`).join('\n')}\n\n${prompt}`;
      } else {
        args.push(...NO_TOOLS);
      }
      const r = await run(this.bin, args, { input: prompt, cwd: dir, timeoutMs: 600_000, signal });
      const combined = `${r.stdout}\n${r.stderr}`;
      let env: Record<string, any> | null = null;
      try { env = JSON.parse(r.stdout); } catch { /* not an envelope */ }
      const text = String(env?.result ?? '');
      if (r.code !== 0 || env?.is_error) {
        const lim = parseUsageLimit(`${text}\n${combined}`);
        if (lim.limited) throw new ProviderError('usage_limit', 'Your Claude plan has reached its current usage limit.', lim.resetAt);
        if (/not logged in|please log in|authentication/i.test(combined)) throw new ProviderError('not_connected', 'Claude Code is not signed in.');
        throw new ProviderError('provider_error', (text || r.stderr || `claude exited ${r.code}`).slice(0, 500));
      }
      if (!text.trim() && env?.structured_output === undefined) throw new ProviderError('bad_output', 'empty reply');
      return task.schema ? { json: env?.structured_output ?? extractJson(text), text } : { text };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
