/**
 * Batch editing (PRD §39) with scopes (§32): this card / selected / whole project / project default.
 * Every affected card gets its own version. Approved cards are skipped unless the user includes them.
 */
import { applyGradientPatch, applyGradientPreset, applyOverrides, applyTemplate, diffOverrides, mergeOverrides, replaceBackground, resizeDesign, toggleLayer } from '@acs/renderer';
import { invalid } from '@acs/shared';
import type { BatchAction, BatchBody, Card, Design } from '@acs/types';
import { audit } from './audit';
import { approveCard, commitVersion, designOfVersion, getCard, getVersion, listCards, rejectCard, revisionCached, setCardStatus } from './cards';
import type { Ctx } from './context';
import { getProject, getRevision, recomputeStats, recipeAtSize, setProjectBase } from './projects';
import { getRecipe } from './recipes';

const REASON: Record<BatchAction['action'], (op: any) => string> = {
  toggle_layer: (op) => `${op.layerId[0].toUpperCase()}${op.layerId.slice(1)} ${op.visible ? 'shown' : 'hidden'}`,
  apply_gradient: (op) => (op.preset ? `Gradient preset: ${op.preset}` : 'Gradient changed'),
  apply_template: (op) => `Template applied: ${op.recipeId}`,
  resize: (op) => `Resized to ${op.width} × ${op.height} (${op.mode})`,
  replace_background: () => 'Background replaced',
  patch: (op) => op.reason,
  approve: () => 'Approved',
  reject: () => 'Rejected',
  status: (op) => `Status: ${op.status}`,
};

/** The design change an action makes, as a pure function of the current design. */
export async function transformFor(ctx: Ctx, op: BatchAction, project: { width: number; height: number; recipeId: string }): Promise<((d: Design) => Design) | null> {
  switch (op.action) {
    case 'toggle_layer': return (d) => toggleLayer(d, op.layerId, op.visible);
    case 'apply_gradient': return (d) => (op.preset ? applyGradientPreset(d, op.preset) : applyGradientPatch(d, op.patch ?? {}));
    case 'resize': return (d) => resizeDesign(d, op.width, op.height, op.mode, op.fit);
    case 'replace_background': return (d) => replaceBackground(d, op.assetId, 'project');
    case 'apply_template': {
      const recipe = await getRecipe(ctx, op.recipeId);
      if (!recipe) throw invalid('That template does not exist.');
      return (d) => applyTemplate(d, recipeAtSize(recipe, d.canvas.width, d.canvas.height));
    }
    default: return null;
  }
}

export async function runBatch(ctx: Ctx, projectId: string, body: BatchBody) {
  const project = await getProject(ctx, projectId);
  const all = await listCards(ctx, projectId);
  const targets: Card[] = body.scope === 'project' || body.scope === 'project_default'
    ? all.filter((c) => c.status !== 'archived')
    : all.filter((c) => body.cardIds.includes(c.id));
  const op = body.op;
  const result = { changed: 0, skippedApproved: 0, cards: [] as string[] };

  // status-only actions
  if (op.action === 'approve' || op.action === 'reject' || op.action === 'status') {
    for (const c of targets) {
      if (op.action === 'approve') await approveCard(ctx, projectId, c.id);
      else if (op.action === 'reject') await rejectCard(ctx, projectId, c.id, op.tags, op.text);
      else await setCardStatus(ctx, projectId, c.id, op.status);
      result.changed++;
      result.cards.push(c.id);
    }
    return result;
  }

  const reason = REASON[op.action](op);

  if (body.scope === 'project_default') {
    // change the base once; every card that did not override that property follows
    const rev = await getRevision(ctx, projectId, project.defaultsRev);
    let newBase: Design;
    if (op.action === 'patch') newBase = applyOverrides(rev.base, op.overrides);
    else newBase = (await transformFor(ctx, op, project))!(rev.base);
    const nextRev = await setProjectBase(ctx, project, newBase, `Project default: ${reason}`);
    for (const c of targets) {
      if ((c.status === 'approved' || c.status === 'exported') && !body.includeApproved) { result.skippedApproved++; continue; }
      const cur = c.currentVersionId ? await getVersion(ctx, projectId, c.id, c.currentVersionId) : null;
      let overrides = c.draft ?? cur?.overrides ?? {};
      if (op.action === 'resize') {
        // the card's own geometry overrides would fight the new canvas: re-derive them
        const d = applyOverrides((await revisionCached(ctx, projectId, cur?.defaultsRev ?? project.defaultsRev)).base, overrides);
        overrides = diffOverrides(newBase, resizeDesign(d, newBase.canvas.width, newBase.canvas.height, op.mode, op.fit));
      }
      await commitVersion(ctx, projectId, c.id, { overrides, defaultsRev: nextRev.id, reason: `Project default: ${reason}`, force: true });
      result.changed++;
      result.cards.push(c.id);
    }
    await audit(ctx, 'batch.started', 'project', projectId, { action: op.action, scope: body.scope, cards: result.changed });
    return result;
  }

  const transform = op.action === 'patch' ? null : await transformFor(ctx, op, project);
  for (const c of targets) {
    if ((c.status === 'approved' || c.status === 'exported') && !body.includeApproved) { result.skippedApproved++; continue; }
    const fresh = await getCard(ctx, projectId, c.id);
    const cur = fresh.currentVersionId ? await getVersion(ctx, projectId, c.id, fresh.currentVersionId) : null;
    const revId = fresh.draftRev ?? cur?.defaultsRev ?? project.defaultsRev;
    const base = (await revisionCached(ctx, projectId, revId)).base;
    const currentOverrides = fresh.draft ?? cur?.overrides ?? {};
    let overrides;
    if (op.action === 'patch') overrides = mergeOverrides(base, currentOverrides, op.overrides);
    else overrides = diffOverrides(base, transform!(applyOverrides(base, currentOverrides)));
    const r = await commitVersion(ctx, projectId, c.id, { overrides, defaultsRev: revId, reason });
    if (r.created) { result.changed++; result.cards.push(c.id); }
  }
  await recomputeStats(ctx, projectId);
  if (targets.length > 1) await audit(ctx, 'batch.started', 'project', projectId, { action: op.action, scope: body.scope, cards: result.changed });
  return result;
}

export async function currentDesign(ctx: Ctx, projectId: string, cardId: string) {
  const card = await getCard(ctx, projectId, cardId);
  const v = card.currentVersionId ? await getVersion(ctx, projectId, cardId, card.currentVersionId) : null;
  if (card.draft && card.draftRev) return applyOverrides((await revisionCached(ctx, projectId, card.draftRev)).base, card.draft);
  return v ? designOfVersion(ctx, v) : null;
}
