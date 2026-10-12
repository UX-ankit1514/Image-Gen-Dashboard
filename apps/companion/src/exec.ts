/**
 * Running the official CLIs safely. The environment is scrubbed of API keys before every spawn, so a
 * CLI can never fall back to paid API usage (PRD Rule 10, §62).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STRIP = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'AZURE_OPENAI_API_KEY'];

export function cleanEnv() {
  const env = { ...process.env };
  for (const k of STRIP) delete env[k];
  return env;
}

export function findBin(name: string) {
  const candidates = [join(homedir(), '.local/bin', name), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, join(homedir(), '.npm-global/bin', name)];
  return candidates.find((p) => existsSync(p)) ?? name;
}

export interface RunResult { code: number; stdout: string; stderr: string; timedOut: boolean }

export function run(bin: string, args: string[], opts: { input?: string; cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, opts.timeoutMs ?? 300_000);
    opts.signal?.addEventListener('abort', () => child.kill('SIGTERM'));
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + e.message, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr, timedOut }); });
    // codex needs stdin closed (`< /dev/null` in the shell scripts); claude reads the prompt from it
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('reply was not JSON');
}
