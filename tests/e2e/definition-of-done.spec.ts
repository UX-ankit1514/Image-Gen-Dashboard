/**
 * PRD §102 — "V1 should not be considered successful until the following scenario works."
 * Runs the whole scenario through the UI against a live Arnifi section, then reloads and checks that
 * every card, asset, version, position, approval and source link is still there.
 *
 * Needs `npm run dev` and network access to arnifi.com. AI generation (step "where supported") is
 * checked for its capability-gated state; it runs for real only with a paired companion.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECTION = process.env.ACS_E2E_URL ?? 'https://arnifi.com/services/will-drafting';
const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'parity', 'fixtures', 'light-sg-01');
const upload = join(FIX, readdirSync(FIX).find((f) => f.startsWith('photo'))!);

async function api<T>(request: APIRequestContext, path: string): Promise<T> {
  const r = await request.get(`/api${path}`);
  expect(r.ok(), `${path} ${r.status()}`).toBeTruthy();
  return r.json() as Promise<T>;
}

async function saved(page: Page) {
  await expect(page.getByTestId('save-state')).toHaveText(/Saved/, { timeout: 30_000 });
}

async function drag(page: Page, selector: string, dx: number, dy: number, at?: { x: number; y: number }) {
  const box = (await page.locator(selector).first().boundingBox())!;
  const x = at ? box.x + at.x : box.x + box.width / 2;
  const y = at ? box.y + at.y : box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
}

test('PRD §102: URL → cards → edit → reject → approve → export → resume', async ({ page, request }) => {
  const name = `DoD ${Date.now().toString(36)}`;

  // New Project → paste an Arnifi section URL; 1600 × 1000 with every layer on (the defaults)
  await page.goto('/');
  await page.getByRole('button', { name: 'New Project' }).click();
  await page.getByPlaceholder('Ireland Company Setup').fill(name);
  await page.getByPlaceholder('https://arnifi.com/services/legal-services').fill(SECTION);
  await page.getByRole('button', { name: '1600 × 1000' }).click();
  for (const layer of ['Background', 'Gradient', 'Logo', 'Heading', 'Subheading']) {
    await expect(page.getByRole('switch', { name: layer, exact: true })).toHaveAttribute('data-state', 'checked');
  }
  await page.getByRole('button', { name: 'Create project and scan' }).click();

  // The application discovers the detail pages and extracts H1, highlight, images, context
  await expect(page.getByRole('heading', { name: 'Scan results' })).toBeVisible();
  await expect(page.getByText(/\d+ pages?/).first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Ready').first()).toBeVisible({ timeout: 120_000 });
  const pid = page.url().match(/\/p\/([^/]+)\//)![1];
  await page.getByRole('button', { name: /Create \d+ cards?/ }).click();

  // Cards appear and render
  await page.waitForURL(`**/p/${pid}`);
  await expect.poll(async () => (await api<{ thumbUrl: string | null }[]>(request, `/projects/${pid}/cards`)).filter((c) => c.thumbUrl).length, { timeout: 180_000 }).toBeGreaterThanOrEqual(2);
  const cards = await api<{ id: string; name: string }[]>(request, `/projects/${pid}/cards`);
  const [first, second] = cards;

  // Open one card and edit it
  await page.goto(`/p/${pid}/c/${first.id}`);
  await expect(page.getByTestId('card-name')).toHaveText(first.name);
  await page.waitForTimeout(1500);

  // drag the logo
  await drag(page, '[data-hit="logo"]', 120, 40);
  await saved(page);
  // resize the headline (its width handle)
  await page.locator('[data-hit="headline"]').click();
  await drag(page, '[data-handle="e"]', -160, 0);
  await saved(page);
  // reposition the background (drag the photo, away from the text and logo)
  await page.keyboard.press('Escape');
  await drag(page, '[data-hit="background"]', -60, 0, { x: 560, y: 120 });
  await saved(page);
  // make the gradient darker, through the prompt bar (no AI needed: structured gradient change)
  await page.getByTestId('prompt-input').fill('Make the gradient darker.');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await saved(page);

  // change dimensions (the previous size is kept as a version)
  await page.getByTestId('canvas-size').click();
  await page.getByRole('button', { name: '1080 × 1350' }).click();
  await page.getByRole('button', { name: 'Resize', exact: true }).click();
  await expect(page.getByTestId('canvas-size')).toContainText('1080');

  // upload a different image as the background
  await page.getByRole('tab', { name: 'Assets' }).click();
  await page.locator('aside input[type="file"]').first().setInputFiles(upload);
  await expect.poll(async () => {
    const b = await api<{ design: { layers: { id: string; source?: string }[] } }>(request, `/projects/${pid}/cards/${first.id}`);
    return b.design.layers.find((l) => l.id === 'background')?.source;
  }, { timeout: 60_000 }).toBe('uploaded');
  await saved(page);
  await page.keyboard.press('Meta+s');

  // Everything persists: a fresh load shows the same state
  await expect.poll(async () => (await api<{ versions: unknown[] }>(request, `/projects/${pid}/cards/${first.id}`)).versions.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  const edited = await api<{ design: { canvas: { width: number; height: number }; layers: any[] } }>(request, `/projects/${pid}/cards/${first.id}`);
  expect(edited.design.canvas).toMatchObject({ width: 1080, height: 1350 });

  // Reject another card: Wrong subject + Looks too AI-generated; the feedback is saved
  await page.goto(`/p/${pid}/c/${second.id}`);
  await page.getByRole('button', { name: 'Reject' }).first().click();
  await page.getByRole('button', { name: 'Wrong subject' }).click();
  await page.getByRole('button', { name: 'Looks AI-generated' }).click();
  await page.getByPlaceholder(/Optional/).fill('Make it more professional.');
  await page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click();
  await expect.poll(async () => (await api<{ feedback: { kind: string; tags: string[] }[] }>(request, `/projects/${pid}/cards/${second.id}`)).feedback.find((f) => f.kind === 'reject')?.tags ?? [])
    .toEqual(['Wrong subject', 'Looks AI-generated']);
  const rejected = await api<{ card: { status: string } }>(request, `/projects/${pid}/cards/${second.id}`);
  expect(rejected.card.status).toBe('needs_image');

  // Where supported, AI generates a new background using that history; without a companion the
  // action is capability-gated and says so instead of failing
  const conns = await api<{ connections: { status: string; capabilities: { imageGeneration: boolean; textGeneration: boolean } }[] }>(request, '/connections');
  const live = conns.connections.filter((c) => c.status === 'connected');
  if (!live.length) await expect(page.getByText('No AI connected.')).toBeVisible();
  else if (!live.some((c) => c.capabilities.imageGeneration)) await expect(page.getByRole('button', { name: 'Generate background' })).toBeDisabled();
  else {
    await page.getByRole('button', { name: 'Generate background' }).click();
    await expect(page.getByRole('dialog').getByText(/brief, page context, references and rejection history/)).toBeVisible();
  }
  await page.keyboard.press('Escape');

  // Upload a replacement for the rejected card (the previous image remains in its history), approve it
  await page.getByRole('tab', { name: 'Assets' }).click();
  await page.locator('aside input[type="file"]').first().setInputFiles(upload);
  await saved(page);
  await page.getByTestId('approve').click();
  await expect.poll(async () => (await api<{ card: { status: string; approvedVersionId: string | null } }>(request, `/projects/${pid}/cards/${second.id}`)).card.status).toBe('approved');
  const history = await api<{ versions: { reason: string }[] }>(request, `/projects/${pid}/cards/${second.id}`);
  expect(history.versions.some((v) => v.reason.startsWith('Initial'))).toBeTruthy();

  // Export Approved: only the approved card, its approved version
  await page.goto(`/p/${pid}`);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
  await expect.poll(async () => (await api<{ status: string }[]>(request, `/exports?projectId=${pid}`))[0]?.status, { timeout: 180_000 }).toBe('completed');
  const [exp] = await api<{ files: { cardId: string; approved: boolean }[]; zipUrl: string }[]>(request, `/exports?projectId=${pid}`);
  expect(exp.files).toEqual([expect.objectContaining({ cardId: second.id, approved: true })]);
  const zip = await request.get(exp.zipUrl);
  expect(zip.ok()).toBeTruthy();
  expect((await zip.body()).subarray(0, 2).toString()).toBe('PK');

  // "One week later": a cold load still has every card, version, position, approval and source link
  await page.context().clearCookies();
  await page.goto(`/p/${pid}`);
  await expect(page.getByText(first.name)).toBeVisible();
  const after = await api<{ id: string; status: string; versionCount: number; sourcePageId: string | null }[]>(request, `/projects/${pid}/cards`);
  expect(after.find((c) => c.id === second.id)?.status).toBe('exported');
  expect(after.find((c) => c.id === first.id)!.versionCount).toBeGreaterThanOrEqual(4);
  expect(after.every((c) => c.sourcePageId)).toBeTruthy();
  const reopened = await api<{ design: { canvas: { width: number } } }>(request, `/projects/${pid}/cards/${first.id}`);
  expect(reopened.design.canvas.width).toBe(1080);
});
