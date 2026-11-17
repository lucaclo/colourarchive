/**
 * Shared setup for the round 13 end-to-end checks (replica/round-13/plan.md).
 * Each area has its own file, `tests/round13-<area>.e2e.ts`, so briefs that run
 * at the same time never edit the same test file. Run one against a throwaway
 * server (never the real archive):
 *
 *   E2E_ORIGIN=https://localhost:4400 E2E_DATA=<throwaway data dir> \
 *     node --import tsx --test tests/round13-book.e2e.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from 'playwright';

export const ORIGIN = process.env.E2E_ORIGIN ?? 'https://localhost:4400';
/** The throwaway server's COLOUR_ARCHIVE_DATA, so new thumbnails can be served (see known-issues). */
export const DATA = process.env.E2E_DATA ?? '';

export const SIZES: Record<'desk' | 'ipad' | 'phone', BrowserContextOptions> = {
  desk: { viewport: { width: 1440, height: 900 } },
  ipad: {
    viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  },
  phone: { ...devices['iPhone 16 Pro'] },
};

export const launch = (): Promise<Browser> =>
  chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

export type Opened = { page: Page; ctx: BrowserContext; problems: string[] };

/** A page on the throwaway server, with page errors and app 5xx collected in `problems`. */
export async function open(
  browser: Browser,
  size: keyof typeof SIZES,
  urlPath: string,
  opts: { wait?: number; context?: BrowserContextOptions } = {},
): Promise<Opened> {
  const ctx = await browser.newContext({ ...SIZES[size], ignoreHTTPSErrors: true, serviceWorkers: 'block', ...(opts.context ?? {}) });
  if (DATA) {
    await ctx.route(`${ORIGIN}/img/**`, (route) => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname.slice('/img/'.length));
      const file = path.join(DATA, '.archive', 'public', 'img', name);
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fallback();
    });
  }
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.url().startsWith(ORIGIN) && r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url().slice(ORIGIN.length)}`);
  });
  await page.goto(ORIGIN + urlPath, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForTimeout(opts.wait ?? 1200);
  await page.addStyleTag({ content: 'astro-dev-toolbar{display:none!important}' }).catch(() => {});
  return { page, ctx, problems };
}

/** True when the element's box sits wholly inside the viewport. */
export async function inViewport(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  });
}

/** Screenshots go in design-shots/round-13 (git-ignored). */
export const shot = (page: Page, name: string) => {
  fs.mkdirSync('design-shots/round-13', { recursive: true });
  return page.screenshot({ path: `design-shots/round-13/${name}.png` });
};
