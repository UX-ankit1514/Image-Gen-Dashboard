import { describe, expect, it } from 'vitest';
import { parseConnectCode } from './connect';
import { findBin, launchFor, type Host } from './resolve';

/** A fake machine: only the listed files exist. */
function host(platform: NodeJS.Platform, files: Record<string, string>, env: Record<string, string> = {}): Host {
  return {
    platform, env, home: platform === 'win32' ? 'C:\\Users\\sam' : '/Users/sam',
    exists: (p) => p in files, read: (p) => files[p] ?? '', execPath: platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/local/bin/node',
  };
}

describe('connect code', () => {
  it('takes the site and code from one pasted line', () => {
    expect(parseConnectCode('https://studio.example.com/#482913')).toEqual({ url: 'https://studio.example.com', code: '482913' });
    expect(parseConnectCode('  "http://localhost:5173/#000123"  ')).toEqual({ url: 'http://localhost:5173', code: '000123' });
    expect(parseConnectCode('https://studio.example.com 482913')).toEqual({ url: 'https://studio.example.com', code: '482913' });
    expect(parseConnectCode('studio.example.com/#482913')).toEqual({ url: 'https://studio.example.com', code: '482913' });
  });
  it('explains what is wrong instead of failing silently', () => {
    expect(parseConnectCode('482913')).toMatchObject({ error: expect.stringMatching(/only the 6-digit code/) });
    expect(parseConnectCode('')).toMatchObject({ error: expect.any(String) });
    expect(parseConnectCode('hello world')).toMatchObject({ error: expect.stringMatching(/does not look like/) });
    expect(parseConnectCode('ftp://x.com/#123456')).toMatchObject({ error: expect.stringMatching(/not valid/) });
  });
});

describe('finding the CLIs', () => {
  it('macOS: usual folders first, else the bare name', () => {
    expect(findBin('codex', host('darwin', { '/opt/homebrew/bin/codex': '' }))).toBe('/opt/homebrew/bin/codex');
    expect(findBin('claude', host('darwin', { '/Users/sam/.local/bin/claude': '', '/opt/homebrew/bin/claude': '' }))).toBe('/Users/sam/.local/bin/claude');
    expect(findBin('codex', host('darwin', {}))).toBe('codex');
  });
  it('Windows: .exe on the PATH or in Claude Code\'s folder, npm shims in %APPDATA%\\npm', () => {
    const env = { Path: 'C:\\Windows;C:\\tools', APPDATA: 'C:\\Users\\sam\\AppData\\Roaming' };
    expect(findBin('claude', host('win32', { 'C:\\Users\\sam\\.local\\bin\\claude.exe': '' }, env))).toBe('C:\\Users\\sam\\.local\\bin\\claude.exe');
    expect(findBin('codex', host('win32', { 'C:\\Users\\sam\\AppData\\Roaming\\npm\\codex.cmd': '' }, env))).toBe('C:\\Users\\sam\\AppData\\Roaming\\npm\\codex.cmd');
    expect(findBin('codex', host('win32', { 'C:\\tools\\codex.exe': '', 'C:\\Users\\sam\\AppData\\Roaming\\npm\\codex.cmd': '' }, env))).toBe('C:\\tools\\codex.exe');
    expect(findBin('codex', host('win32', {}, env))).toBe('codex');
  });
});

describe('starting the CLIs', () => {
  const shim = '@ECHO off\r\nGOTO start\r\n:start\r\nSETLOCAL\r\nSET dp0=%~dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n';
  const cmd = 'C:\\Users\\sam\\AppData\\Roaming\\npm\\codex.cmd';
  const js = 'C:\\Users\\sam\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';
  it('Windows: an npm .cmd shim runs as node + its script, so long prompts are not mangled by cmd.exe', () => {
    const h = host('win32', { [cmd]: shim, [js]: '' });
    expect(launchFor(cmd, ['exec', 'a "quoted" & long\nprompt'], h)).toEqual({ command: h.execPath, args: [js, 'exec', 'a "quoted" & long\nprompt'] });
  });
  it('leaves .exe files, other platforms and unreadable shims alone', () => {
    expect(launchFor('C:\\x\\claude.exe', ['-p'], host('win32', {}))).toEqual({ command: 'C:\\x\\claude.exe', args: ['-p'] });
    expect(launchFor('/usr/local/bin/codex', ['exec'], host('darwin', {}))).toEqual({ command: '/usr/local/bin/codex', args: ['exec'] });
    expect(launchFor(cmd, ['exec'], host('win32', { [cmd]: 'nothing useful here' }))).toEqual({ command: cmd, args: ['exec'] });
    expect(launchFor(cmd, ['exec'], host('win32', { [cmd]: shim }))).toEqual({ command: cmd, args: ['exec'] });   // script missing
  });
});
