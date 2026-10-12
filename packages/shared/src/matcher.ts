/**
 * Mixed uploads → pages (PRD §95): match uploaded files to pages by filename, slug and title.
 * Returns a confidence per match; anything below CONFIDENT needs the user to confirm.
 */
import { slugify } from './ids';

export const CONFIDENT = 0.8;

const STOP = new Set(['the', 'and', 'of', 'for', 'a', 'an', 'to', 'in', 'png', 'jpg', 'jpeg', 'webp', 'final', 'copy', 'image', 'img', 'v1', 'v2', 'v3', 'or']);

export function tokens(s: string) {
  return slugify(s.replace(/\.[a-z0-9]+$/i, ''), 200)
    .split('-')
    .filter((t) => t && !STOP.has(t) && !/^\d{1,3}$/.test(t));
}

function score(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  // Dice coefficient, so a short file name fully inside a long title still scores well
  return (2 * inter) / (A.size + B.size);
}

export interface MatchPage { id: string; slug: string; title: string }
export interface MatchResult { fileName: string; pageId: string | null; confidence: number; alternatives: { pageId: string; confidence: number }[] }

export function matchUploads(files: string[], pages: MatchPage[]): MatchResult[] {
  const scored = files.map((f) => {
    const ft = tokens(f);
    const fslug = slugify(f.replace(/\.[a-z0-9]+$/i, ''));
    const ranked = pages
      .map((p) => {
        if (fslug && (fslug === p.slug || fslug.endsWith(p.slug) || p.slug.endsWith(fslug))) return { pageId: p.id, confidence: 1 };
        const s = Math.max(score(ft, tokens(p.slug)), score(ft, tokens(p.title)));
        return { pageId: p.id, confidence: Math.round(s * 100) / 100 };
      })
      .sort((a, b) => b.confidence - a.confidence);
    return { fileName: f, ranked };
  });
  // greedy one-to-one assignment, best scores first
  const taken = new Set<string>();
  const order = [...scored].sort((a, b) => (b.ranked[0]?.confidence ?? 0) - (a.ranked[0]?.confidence ?? 0));
  const out = new Map<string, MatchResult>();
  for (const s of order) {
    const best = s.ranked.find((r) => !taken.has(r.pageId) && r.confidence >= 0.34);
    if (best) taken.add(best.pageId);
    out.set(s.fileName, {
      fileName: s.fileName,
      pageId: best?.pageId ?? null,
      confidence: best?.confidence ?? 0,
      alternatives: s.ranked.filter((r) => r.pageId !== best?.pageId).slice(0, 3),
    });
  }
  return files.map((f) => out.get(f)!);
}
