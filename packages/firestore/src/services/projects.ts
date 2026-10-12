/** Projects / campaigns (PRD §9, §11–12). */
import { applyOverrides, buildRecipe, diffOverrides, RECIPES } from '@acs/renderer';
import { DEFAULT_NAMING, invalid, newId, notFound, nowIso, slugify } from '@acs/shared';
import type { Card, CreateProjectBody, DefaultsRevision, Design, LayerToggles, Overrides, Project, ProjectStats } from '@acs/types';
import type { WriteOp } from '../db';
import { P } from '../paths';
import { audit } from './audit';
import type { Ctx } from './context';
import { getRecipe, type RecipeDoc } from './recipes';

export const ZERO_STATS: ProjectStats = { total: 0, approved: 0, review: 0, needsImage: 0, needsCopy: 0, rejected: 0, draft: 0, exported: 0, errors: 0 };

/** The recipe's design at the project's size with the chosen layers switched on (PRD §12 steps 3–5). */
export function recipeAtSize(recipe: RecipeDoc, width: number, height: number): Design {
  if (recipe.builtin && RECIPES.some((r) => r.id === recipe.id)) return buildRecipe(recipe.id, width, height);
  if (recipe.base.canvas.width === width && recipe.base.canvas.height === height) return JSON.parse(JSON.stringify(recipe.base));
  // a custom recipe at another size: re-anchor its layout rather than stretching it
  return JSON.parse(JSON.stringify({ ...recipe.base, canvas: { ...recipe.base.canvas, width, height } }));
}

export function withToggles(d: Design, t?: LayerToggles): Design {
  if (!t) return d;
  const map: Record<string, boolean> = { background: t.background, gradient: t.gradient, logo: t.logo, headline: t.headline, subheading: t.subheading };
  return { ...d, layers: d.layers.map((l) => (l.id in map ? { ...l, visible: map[l.id] } : l)) };
}

export async function createProject(ctx: Ctx, body: CreateProjectBody) {
  const recipe = await getRecipe(ctx, body.recipeId);
  if (!recipe) throw invalid('That template does not exist.');
  const t = nowIso();
  const id = newId('prj');
  const recipeBase = recipeAtSize(recipe, body.width, body.height);
  const base = withToggles(recipeBase, body.layers);
  const rev: DefaultsRevision = { id: newId('rev'), projectId: id, base, reason: 'Project created', createdAt: t };
  const project: Project = {
    id, workspaceId: ctx.ws, name: body.name.trim(), slug: slugify(body.name), description: body.description ?? '',
    recipeId: recipe.id, brief: body.brief ?? recipe.brief ?? '', negativeConstraints: recipe.negativeConstraints ?? [],
    rules: [], defaults: diffOverrides(recipeBase, base), defaultsRev: rev.id, width: body.width, height: body.height,
    status: 'active', provider: body.provider, namingTemplate: DEFAULT_NAMING, stats: { ...ZERO_STATS }, coverThumbs: [],
    exportStatus: 'none', lastExportAt: null, inputType: body.inputType, createdAt: t, updatedAt: t, lastEditedAt: t,
  };
  await ctx.db.commit([
    { kind: 'create', path: P.project(id), data: project },
    { kind: 'create', path: P.revision(id, rev.id), data: rev },
  ]);
  await audit(ctx, 'project.created', 'project', id, { name: project.name, recipe: recipe.id, size: `${body.width}x${body.height}` });
  return project;
}

export async function getProject(ctx: Ctx, id: string) {
  const p = await ctx.db.get<Project>(P.project(id));
  if (!p) throw notFound('project');
  return p;
}

export async function listProjects(ctx: Ctx, includeArchived = false) {
  const all = await ctx.db.query<Project>(P.projects, { orderBy: [['lastEditedAt', 'desc']] });
  return includeArchived ? all : all.filter((p) => p.status !== 'archived');
}

export async function updateProject(ctx: Ctx, id: string, patch: Partial<Project>) {
  const p = await getProject(ctx, id);
  const t = nowIso();
  const next: Partial<Project> = { ...patch, updatedAt: t, lastEditedAt: t };
  if (patch.name) next.slug = slugify(patch.name);
  await ctx.db.update(P.project(id), next);
  if (patch.status === 'archived' && p.status !== 'archived') await audit(ctx, 'project.archived', 'project', id, { name: p.name });
  return { ...p, ...next } as Project;
}

export async function getRevision(ctx: Ctx, projectId: string, revId: string) {
  const r = await ctx.db.get<DefaultsRevision>(P.revision(projectId, revId));
  if (!r) throw notFound('project defaults');
  return r;
}

/** "Project default" scope (PRD §32, §40): a new immutable base revision. */
export async function setProjectBase(ctx: Ctx, project: Project, base: Design, reason: string) {
  const recipe = await getRecipe(ctx, project.recipeId);
  const recipeBase = recipe ? recipeAtSize(recipe, project.width, project.height) : base;
  const rev: DefaultsRevision = { id: newId('rev'), projectId: project.id, base, reason, createdAt: nowIso() };
  await ctx.db.commit([
    { kind: 'create', path: P.revision(project.id, rev.id), data: rev },
    { kind: 'update', path: P.project(project.id), data: { defaultsRev: rev.id, defaults: diffOverrides(recipeBase, base), width: base.canvas.width, height: base.canvas.height, updatedAt: rev.createdAt } },
  ]);
  await audit(ctx, 'defaults.changed', 'project', project.id, { reason, rev: rev.id });
  return rev;
}

export function statsOf(cards: Card[]): ProjectStats {
  const s = { ...ZERO_STATS };
  for (const c of cards) {
    if (c.status === 'archived') continue;
    s.total++;
    if (c.status === 'approved') s.approved++;
    else if (c.status === 'exported') { s.exported++; s.approved++; }
    else if (c.status === 'needs_review') s.review++;
    else if (c.status === 'needs_image') s.needsImage++;
    else if (c.status === 'needs_copy') s.needsCopy++;
    else if (c.status === 'rejected') s.rejected++;
    else s.draft++;
    if (c.warnings?.some((w) => w.severity === 'error')) s.errors++;
  }
  return s;
}

export async function recomputeStats(ctx: Ctx, projectId: string) {
  const cards = await ctx.db.query<Card>(P.cards(projectId), { orderBy: [['order', 'asc']] });
  const stats = statsOf(cards);
  const coverThumbs = cards.filter((c) => c.thumbKey && c.status !== 'archived').slice(0, 4).map((c) => c.thumbKey!);
  await ctx.db.update(P.project(projectId), { stats, coverThumbs, updatedAt: nowIso() });
  return stats;
}

/** Duplicate: same brief, defaults, pages and cards; every card starts again at V1. */
export async function duplicateProject(ctx: Ctx, id: string, name?: string) {
  const src = await getProject(ctx, id);
  const rev = await getRevision(ctx, id, src.defaultsRev);
  const t = nowIso();
  const pid = newId('prj');
  const revId = newId('rev');
  const project: Project = { ...src, id: pid, name: name ?? `${src.name} (copy)`, slug: slugify(name ?? `${src.name} copy`), defaultsRev: revId,
    stats: { ...src.stats }, exportStatus: 'none', lastExportAt: null, createdAt: t, updatedAt: t, lastEditedAt: t };
  const ops: WriteOp[] = [
    { kind: 'create', path: P.project(pid), data: project },
    { kind: 'create', path: P.revision(pid, revId), data: { ...rev, id: revId, projectId: pid, reason: `Duplicated from ${src.name}`, createdAt: t } },
  ];
  const pages = await ctx.db.query<Record<string, unknown> & { id: string }>(P.pages(id));
  for (const pg of pages) ops.push({ kind: 'create', path: P.page(pid, pg.id), data: { ...pg, projectId: pid } });
  const cards = await ctx.db.query<Card>(P.cards(id), { orderBy: [['order', 'asc']] });
  const { cardCopyOps } = await import('./cards');
  for (const c of cards) {
    if (c.status === 'archived') continue;
    ops.push(...(await cardCopyOps(ctx, src, c, project, revId, `Duplicated from ${src.name}`)));
  }
  for (let i = 0; i < ops.length; i += 450) await ctx.db.commit(ops.slice(i, i + 450));
  await audit(ctx, 'project.duplicated', 'project', pid, { from: id });
  return project;
}

export function resolveBase(rev: DefaultsRevision, overrides?: Overrides | null) {
  return applyOverrides(rev.base, overrides);
}
