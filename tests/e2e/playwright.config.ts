import { defineConfig } from '@playwright/test';

/** Runs against the local stack (`npm run dev`) with the system Chrome — nothing to download. */
export default defineConfig({
  testDir: '.',
  timeout: 6 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.ACS_BASE ?? 'http://localhost:5173',
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: '../../test-results',
});
