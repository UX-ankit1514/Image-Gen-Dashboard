/**
 * ChatGPT through the official Codex CLI, signed in with the user's ChatGPT plan (PRD §4.1). Image
 * generation uses Codex's built-in image tool — the same invocation the relight scripts used
 * (`codex exec … -s workspace-write -C <dir> "…copy the generated PNG to <path>…" [-i image] < /dev/null`).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODEX_CAPS, parseUsageLimit, ProviderError, type AIProvider, type AiResult, type AiTask, type DetectedCli } from '@acs/providers';
import { extractJson, findBin, run } from '../exec';

const BASE = ['exec', '-c', 'model_reasoning_effort=low', '--skip-git-repo-check', '--ephemeral'];

function aspect(w: number, h: number) {
  const r = w / h;
  if (r > 1.9) return 'a WIDE landscape format (as close to 2.39:1 as the tool allows)';
  if (r > 1.25) return 'a landscape format (16:10)';
  if (r > 0.9) return 'a square format';
  if (r > 0.65) return 'a portrait format (4:5)';
  return 'a tall portrait format (9:16)';
}

export class OpenAICodexLocal implements AIProvider {
  id = 'openai' as const;
  bin = findBin('codex');
  /** null until an image run proves it either way */
  imageVerified: boolean | null = null;

  async detect(): Promise<DetectedCli> {
    const v = await run(this.bin, ['--version'], { timeoutMs: 20_000 });
    if (v.code !== 0) return { installed: false, version: null, loggedIn: false, authMethod: null, plan: null, account: null, subscriptionBacked: false };
    const s = await run(this.bin, ['login', 'status'], { timeoutMs: 30_000 });
    const out = `${s.stdout}\n${s.stderr}`;
    const chatgpt = /logged in using chatgpt/i.test(out);
    const apiKey = /api key/i.test(out);
    return {
      installed: true, version: v.stdout.trim().replace(/^codex-cli\s*/, '') || null, loggedIn: chatgpt || apiKey,
      authMethod: chatgpt ? 'ChatGPT' : apiKey ? 'API key' : null, plan: chatgpt ? 'ChatGPT plan' : null, account: null,
      subscriptionBacked: chatgpt,
    };
  }

  capabilities = (d: DetectedCli) => CODEX_CAPS(d, this.imageVerified);

  private model() {
    return process.env.ACS_CODEX_MODEL ? ['-m', process.env.ACS_CODEX_MODEL] : [];
  }

  private fail(r: { code: number; stdout: string; stderr: string; timedOut: boolean }, log: string): never {
    const text = `${r.stdout}\n${r.stderr}\n${log}`;
    const lim = parseUsageLimit(text);
    if (lim.limited) throw new ProviderError('usage_limit', 'Your ChatGPT plan has reached its current usage limit.', lim.resetAt);
    if (/not logged in|login required|codex login/i.test(text)) throw new ProviderError('not_connected', 'Codex is not signed in with ChatGPT.');
    if (r.timedOut) throw new ProviderError('timeout', 'Codex took too long.');
    throw new ProviderError('provider_error', (r.stderr || r.stdout || `codex exited ${r.code}`).slice(-500));
  }

  async run(task: AiTask, signal?: AbortSignal, onImage?: (file: string) => Promise<void>): Promise<AiResult> {
    const dir = mkdtempSync(join(tmpdir(), 'acs-codex-'));
    try {
      if (task.kind === 'image' || task.kind === 'image-edit') return await this.image(task, dir, signal, onImage);
      const args = [...BASE, ...this.model(), '-s', 'read-only', '-C', dir, '-o', join(dir, 'out.txt')];
      if (task.schema) {
        writeFileSync(join(dir, 'schema.json'), JSON.stringify(task.schema));
        args.push('--output-schema', join(dir, 'schema.json'));
      }
      args.push(`${task.system ? `${task.system}\n\n` : ''}${task.prompt}`);
      for (const img of task.images ?? []) args.push('-i', img);
      const r = await run(this.bin, args, { cwd: dir, timeoutMs: 600_000, signal });
      const out = existsSync(join(dir, 'out.txt')) ? readFileSync(join(dir, 'out.txt'), 'utf8') : '';
      if (r.code !== 0 || !out.trim()) this.fail(r, out);
      return task.schema ? { json: extractJson(out), text: out } : { text: out };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private async image(task: AiTask, dir: string, signal?: AbortSignal, onImage?: (file: string) => Promise<void>): Promise<AiResult> {
    const n = Math.max(1, Math.min(4, task.n ?? 1));
    const outDir = mkdtempSync(join(tmpdir(), 'acs-codex-out-'));
    const files: string[] = [];
    const fmt = aspect(task.size?.width ?? 1600, task.size?.height ?? 1000);
    for (let k = 1; k <= n; k++) {
      if (signal?.aborted) break;
      const target = join(outDir, `out-${k}.png`);
      const edit = task.kind === 'image-edit' && task.images?.length;
      const instruction = edit
        ? `Use your built-in image generation tool in EDIT mode on the attached image (do not draw with code). Keep the composition, camera angle, framing and aspect ratio unless the request says otherwise. Then copy the edited PNG to ${target} and stop.`
        : `Use your built-in image generation tool (do not draw with code) to generate exactly ONE photoreal image in ${fmt} from the brief below${n > 1 ? ` (this is variation ${k} of ${n}: make it clearly different from the others in subject arrangement and angle)` : ''}. Then copy the generated PNG file to ${target} and stop.`;
      const args = [...BASE, ...this.model(), '-s', 'workspace-write', '-C', dir, `${instruction}\n\n${task.prompt}`];
      if (edit) for (const img of task.images!) args.push('-i', img);
      const r = await run(this.bin, args, { cwd: dir, timeoutMs: 900_000, signal });
      if (existsSync(target) && statSync(target).size > 0) {
        files.push(target);
        this.imageVerified = true;
        await onImage?.(target);
        continue;
      }
      // the tool may have saved elsewhere in the workspace
      const stray = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => join(dir, f));
      if (stray.length) { files.push(stray[0]); this.imageVerified = true; await onImage?.(stray[0]); continue; }
      const text = `${r.stdout}\n${r.stderr}`;
      if (/image generation (is )?(not|un)available|don'?t have (access to )?(an )?image|cannot generate images|no image (generation )?tool/i.test(text)) {
        this.imageVerified = false;
        throw new ProviderError('capability', 'Image generation is unavailable on this ChatGPT connection.');
      }
      if (files.length) break;           // keep the variations we already have
      this.fail(r, '');
    }
    return { images: files };
  }
}
