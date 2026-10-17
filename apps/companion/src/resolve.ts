/**
 * Finding and starting the official CLIs on macOS, Linux and Windows.
 *
 * Windows differs in two ways that matter here: the CLIs are usually `.exe` files or npm shims
 * (`codex.cmd`), and a `.cmd` cannot be started without a shell, which mangles long prompts. So an
 * npm shim is replaced by what it runs: `node <package>/bin/codex.js`. Everything takes its
 * environment as a parameter so it can be tested for every platform from any machine.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export interface Host {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  exists: (path: string) => boolean;
  read: (path: string) => string;
  /** The running node binary, which runs a shim's JavaScript entry point. */
  execPath: string;
}

export const realHost = (): Host => ({
  platform: process.platform, env: process.env, home: homedir(), exists: existsSync, read: (p) => readFileSync(p, 'utf8'), execPath: process.execPath,
});

const pathOf = (h: Host) => (h.platform === 'win32' ? win32 : posix);

/** An environment variable, ignoring case (Windows spells PATH as "Path"). */
function envOf(h: Host, name: string) {
  const k = Object.keys(h.env).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? h.env[k] : undefined;
}

/** The full path of a CLI when it is in a usual place, otherwise its bare name for the PATH to resolve. */
export function findBin(name: string, h: Host = realHost()): string {
  const p = pathOf(h);
  if (h.platform === 'win32') {
    const dirs = [
      ...(envOf(h, 'PATH') ?? '').split(';').filter(Boolean),
      p.join(h.home, '.local', 'bin'),                          // Claude Code's own installer
      ...(envOf(h, 'APPDATA') ? [p.join(envOf(h, 'APPDATA')!, 'npm')] : []),   // npm i -g
      ...(envOf(h, 'LOCALAPPDATA') ? [p.join(envOf(h, 'LOCALAPPDATA')!, 'Programs', name)] : []),
    ];
    for (const ext of ['.exe', '.cmd', '.bat']) {
      for (const d of dirs) {
        const f = p.join(d, name + ext);
        if (h.exists(f)) return f;
      }
    }
    return name;
  }
  const candidates = [p.join(h.home, '.local/bin', name), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, p.join(h.home, '.npm-global/bin', name)];
  return candidates.find((f) => h.exists(f)) ?? name;
}

/** The command and arguments that start `bin`: an npm `.cmd` shim becomes `node <its script>`. */
export function launchFor(bin: string, args: string[], h: Host = realHost()): { command: string; args: string[] } {
  if (h.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    try {
      // npm's shim runs  "%dp0%\node_modules\<package>\<entry>.js" %*
      const m = h.read(bin).match(/"%dp0%\\(node_modules\\[^"\r\n]+?\.[cm]?js)"/i);
      const script = m ? win32.join(win32.dirname(bin), m[1]) : null;
      if (script && h.exists(script)) return { command: h.execPath, args: [script, ...args] };
    } catch { /* unreadable shim: fall through */ }
  }
  return { command: bin, args };
}
