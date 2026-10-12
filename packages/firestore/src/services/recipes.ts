import { buildRecipe, RECIPES } from '@acs/renderer';
import { nowIso } from '@acs/shared';
import type { Recipe } from '@acs/types';
import { P } from '../paths';
import type { Ctx } from './context';

export type RecipeDoc = Recipe & { width: number; height: number; brief?: string; negativeConstraints?: string[] };

export function builtinRecipe(id: string): RecipeDoc | null {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) return null;
  const t = nowIso();
  return { id: r.id, name: r.name, description: r.description, builtin: true, base: buildRecipe(r.id, r.width, r.height),
    width: r.width, height: r.height, brief: r.brief, negativeConstraints: r.negativeConstraints, createdAt: t, updatedAt: t };
}

/** Built-ins are written once; edits made on the Templates page are kept. */
export async function seedRecipes(ctx: Ctx) {
  const existing = await ctx.db.query<RecipeDoc>(P.recipes);
  const have = new Set(existing.map((r) => r.id));
  for (const r of RECIPES) {
    if (!have.has(r.id)) await ctx.db.set(P.recipe(r.id), builtinRecipe(r.id)!);
  }
}

export async function listRecipes(ctx: Ctx) {
  const rows = await ctx.db.query<RecipeDoc>(P.recipes);
  if (!rows.length) return RECIPES.map((r) => builtinRecipe(r.id)!);
  const order = new Map(RECIPES.map((r, i) => [r.id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99) || a.name.localeCompare(b.name));
}

export async function getRecipe(ctx: Ctx, id: string): Promise<RecipeDoc | null> {
  return (await ctx.db.get<RecipeDoc>(P.recipe(id))) ?? builtinRecipe(id);
}
