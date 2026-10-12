/**
 * Every record on an arnifi.com/services/<type> listing (port of new images/_system/services.mjs).
 *
 * The page server-renders a first slice; "Load More" pages through prodapi.arnifi.com with a buggy
 * skip=11 that repeats some cards and never reaches others, and the API answers 502 to requests
 * from outside the site. So: open the page in headless Chrome and ask the API for the whole list
 * from inside it. The API name is known for the services seen so far; otherwise it is learnt by
 * clicking "Load More" once and watching the request.
 */
import puppeteer from 'puppeteer-core';

export const SERVICE_APIS: Record<string, string> = {
  funds: 'Funds',
  liquidation: 'Liquidation',
  'post-setup-compliance': 'Post-Setup Compliance',
  'legal-services': 'Legal Service',
  'visa-service': 'Visa Services',
  attestations: 'Attestation',
  accounting: 'Accounting & Bookkeeping',
};

export interface ExpandResult { records: Record<string, unknown>[]; total: number | null; api: string }

export async function expandServices(listingUrl: string, serviceType: string, opts: { executablePath: string; args?: string[] }): Promise<ExpandResult> {
  const browser = await puppeteer.launch({ executablePath: opts.executablePath, headless: true, args: ['--disable-gpu', ...(opts.args ?? [])] });
  try {
    const page = await browser.newPage();
    let learnt: string | null = null;
    page.on('request', (req) => {
      const m = req.url().match(/prodapi\.arnifi\.com\/api\/micro-services\/([^?]+)/);
      if (m) learnt = decodeURIComponent(m[1]);
    });
    await page.goto(listingUrl, { waitUntil: 'networkidle2', timeout: 90_000 });
    let api: string | null = SERVICE_APIS[serviceType] ?? null;
    if (!api) {
      const clicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /load more/i.test(x.textContent ?? ''));
        if (b) (b as HTMLButtonElement).click();
        return !!b;
      });
      if (clicked) await new Promise((r) => setTimeout(r, 4000));
      api = learnt as string | null;
    }
    if (!api) throw new Error(`could not find the services API for ${serviceType}`);
    const body = await page.evaluate(async (path: string) => {
      const r = await fetch(`https://prodapi.arnifi.com/api/micro-services/${encodeURIComponent(path)}?page=1&pageSize=100`);
      return r.text();
    }, api);
    const json = JSON.parse(body) as { data?: Record<string, unknown>[]; meta?: { total?: number } };
    return { records: json.data ?? [], total: json.meta?.total ?? null, api };
  } finally {
    await browser.close().catch(() => {});
  }
}
