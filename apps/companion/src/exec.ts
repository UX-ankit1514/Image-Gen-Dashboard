/**
 * Running the official CLIs safely. The environment is scrubbed of API keys before every spawn, so a
 * CLI can never fall back to paid API usage (PRD Rule 10, §62).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { findBin as findBinOn, launchFor } from './resolve';

const STRIP = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'AZURE_OPENAI_API_KEY'];

export function cleanEnv() {
  const env = { ...process.env };
  for (const k of STRIP) delete env[k];
  return env;
}

export const findBin = (name: string) => findBinOn(name);

/** Stops a CLI and what it started: Windows needs the whole tree ended, elsewhere SIGTERM is enough. */
function stop(child: ChildProcess) {
  if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => child.kill());
  else child.kill('SIGTERM');
}

export interface RunResult { code: number; stdout: string; stderr: string; timedOut: boolean }

export function run(bin: string, args: string[], opts: { input?: string; cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const launch = launchFor(bin, args);
    const child = spawn(launch.command, launch.args, { cwd: opts.cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stop(child); }, opts.timeoutMs ?? 300_000);
    opts.signal?.addEventListener('abort', () => stop(child));
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
