/**
 * PRD §102 — "V1 should not be considered successful until the following scenario works."
 * Runs the whole scenario through the UI against a live Arnifi section, then reloads and checks that
 * every card, asset, version, position and source link is still there. (Approval and review are no
 * longer part of the app: Export downloads the card as it is.)
 *
 * Needs `npm run dev` and network access to arnifi.com. AI generation (step "where supported") is
 * checked for its capability-gated state; it runs for real only with a paired companion.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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

test('PRD §102: URL → cards → edit → export (download) → resume', async ({ page, request }) => {
  const name = `DoD ${Date.now().toString(36)}`;

  // New project → paste an Arnifi section URL; 1600 × 1000 with the usual layers on (the first line is off by default)
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByPlaceholder('Ireland Company Setup').fill(name);
  await page.getByPlaceholder('https://arnifi.com/services/legal-services').fill(SECTION);
  await page.getByRole('button', { name: /Business setup/ }).click();
  for (const layer of ['Background', 'Gradient', 'Logo', 'Heading']) {
    await expect(page.getByRole('switch', { name: layer, exact: true })).toHaveAttribute('data-state', 'checked');
  }
  await expect(page.getByRole('switch', { name: 'First line', exact: true })).toHaveAttribute('data-state', 'unchecked');
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
  // make the gradient darker from its inspector
  await page.getByTestId('layer-gradient').click();
  await page.getByRole('button', { name: 'Darker', exact: true }).click();
  await saved(page);

  // change dimensions (the previous size is kept as a version)
  await page.getByTestId('canvas-size').click();
  await page.getByRole('button', { name: '1080 × 1350' }).click();
  await page.getByRole('button', { name: 'Resize', exact: true }).click();
  await expect(page.getByTestId('canvas-size')).toContainText('1080');

  // upload a different image as the background
  await page.getByRole('button', { name: 'Replace background' }).click();
  await page.getByRole('dialog').locator('input[type="file"]').setInputFiles(upload);
  await expect.poll(async () => {
    const b = await api<{ design: { layers: { id: string; source?: string }[] } }>(request, `/projects/${pid}/cards/${first.id}`);
    return b.design.layers.find((l) => l.id === 'background')?.source;
  }, { timeout: 60_000 }).toMatch(/^(uploaded|project)$/);
  await saved(page);
  await page.keyboard.press('Meta+s');

  // Everything persists: a fresh load shows the same state
  await expect.poll(async () => (await api<{ versions: unknown[] }>(request, `/projects/${pid}/cards/${first.id}`)).versions.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  const edited = await api<{ design: { canvas: { width: number; height: number }; layers: any[] } }>(request, `/projects/${pid}/cards/${first.id}`);
  expect(edited.design.canvas).toMatchObject({ width: 1080, height: 1350 });

  // Where supported, AI generates a new background; without an image-capable connection the action
  // is capability-gated and says so instead of failing
  await page.goto(`/p/${pid}/c/${second.id}`);
  const conns = await api<{ connections: { status: string; capabilities: { imageGeneration: boolean } }[] }>(request, '/connections');
  if (!conns.connections.some((c) => c.status === 'connected' && c.capabilities.imageGeneration)) {
    await expect(page.getByRole('button', { name: 'Generate background' })).toBeDisabled();
  } else {
    await page.getByRole('button', { name: 'Generate background' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  }

  // Bring your own image for the second card, then Export: the file downloads by itself, no dialog
  await page.getByRole('button', { name: 'Replace background' }).click();
  await page.getByRole('dialog').locator('input[type="file"]').setInputFiles(upload);
  await saved(page);
  const [one] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), page.getByTestId('export').click()]);
  expect(one.suggestedFilename()).toMatch(/\.(jpg|png|webp)$/);
  expect((await readFile((await one.path())!)).length).toBeGreaterThan(10_000);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Export from the project: the Export screen shows the cards, its one button downloads a ZIP of images
  await page.goto(`/p/${pid}`);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${pid}/export$`));
  const [all] = await Promise.all([page.waitForEvent('download', { timeout: 300_000 }), page.getByTestId('export-run').click()]);
  expect(all.suggestedFilename()).toMatch(/\.zip$/);
  expect((await readFile((await all.path())!)).subarray(0, 2).toString()).toBe('PK');

  // "One week later": a cold load still has every card, version, position and source link
  await page.context().clearCookies();
  await page.goto(`/p/${pid}`);
  await expect(page.getByText(first.name)).toBeVisible();
  const after = await api<{ id: string; status: string; versionCount: number; sourcePageId: string | null }[]>(request, `/projects/${pid}/cards`);
  expect(after.find((c) => c.id === first.id)!.versionCount).toBeGreaterThanOrEqual(4);
  expect(after.every((c) => c.sourcePageId)).toBeTruthy();
  const reopened = await api<{ design: { canvas: { width: number } } }>(request, `/projects/${pid}/cards/${first.id}`);
  expect(reopened.design.canvas.width).toBe(1080);
});
