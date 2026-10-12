import { slugify } from './ids';

/** Export file names (PRD §69): `{project}-{card}-{version}.{ext}` by default, configurable. */
export const DEFAULT_NAMING = '{project}-{card}-{version}';

export const NAMING_TOKENS = ['project', 'card', 'version', 'n', 'w', 'h', 'country', 'status'] as const;

export function renderName(template: string, vars: Partial<Record<(typeof NAMING_TOKENS)[number], string | number>>, ext: string) {
  const base = (template || DEFAULT_NAMING).replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = (vars as Record<string, string | number | undefined>)[k];
    if (v === undefined || v === null) return '';
    if (k === 'version') return typeof v === 'number' ? `v${v}` : String(v);
    if (k === 'n') return String(v).padStart(2, '0');
    return typeof v === 'number' ? String(v) : slugify(String(v), 80);
  });
  const clean = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '') || 'card';
  return `${clean}.${ext}`;
}

/** Makes every name in a set unique by suffixing -2, -3… */
export function uniqueNames(names: string[]) {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const c = seen.get(k) ?? 0;
    seen.set(k, c + 1);
    if (!c) return n;
    const dot = n.lastIndexOf('.');
    return `${n.slice(0, dot)}-${c + 1}${n.slice(dot)}`;
  });
}
