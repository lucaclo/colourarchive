/**
 * Cold-load timings for /scout, the user's side of speed: how long until a
 * map shows, how long until a place is ready to read, and what it cost.
 *
 * Time scrubbing is measured separately by profile-scout.mts (dev only,
 * since it drives the page through the dev hook).
 *
 * Runs against a production build (see the performance-profile notes):
 *
 *   npx astro build --outDir node_modules/.cache/perf-build
 *   PORT=4399 HOST=127.0.0.1 node node_modules/.cache/perf-build/server/entry.mjs
 *   npx tsx tests/load-scout.mts
 *
 * SwiftShader draws WebGL on the CPU, so absolute numbers are slower than an
 * iPad. Compare runs with each other, not with a device.
 */
import { chromium } from 'playwright';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4399';
const RUNS = Number(process.env.RUNS ?? 3);
const SPOT = 'at=51.5079,-0.0877&tz=Europe/London&n=London&d=2026-08-07&t=700&r=4';

// window.scout is a dev-only hook, so a production page is read from the DOM:
// the map canvas has been drawn into, and (with a place) the sheet names it.
const CANVAS = `!!document.querySelector('.maplibregl-canvas')`;
const NAMED = `(() => { const n = document.getElementById('sheet-name'); return !!n && n.textContent.trim() !== 'Nowhere yet'; })()`;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function once(path: string, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  let bytes = 0, requests = 0, ownBytes = 0;
  cdp.on('Network.loadingFinished', (e: any) => { bytes += e.encodedDataLength; requests++; });
  page.on('response', async (r) => {
    if (!r.url().startsWith(ORIGIN)) return;
    const len = Number(r.headers()['content-length'] ?? 0);
    ownBytes += len;
  });
  await page.addInitScript(`
    window.__lt = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt += e.duration - 50; })
      .observe({ type: 'longtask', buffered: true });
  `);
  const t0 = Date.now();
  await page.goto(ORIGIN + path, { waitUntil: 'domcontentloaded' });
  const dcl = Date.now() - t0;
  await page.waitForFunction(CANVAS, null, { timeout: 120_000, polling: 50 });
  const mapReady = Date.now() - t0;
  const named = path.includes('at=')
    ? (await page.waitForFunction(NAMED, null, { timeout: 120_000, polling: 50 }), Date.now() - t0)
    : null;
  // Settled: no network for 1.5 s (tiles, DEM, buildings, trees, weather).
  let last = Date.now();
  page.on('request', () => { last = Date.now(); });
  page.on('requestfinished', () => { last = Date.now(); });
  while (Date.now() - last < 1500 && Date.now() - t0 < 60_000) await page.waitForTimeout(100);
  const settled = last - t0;
  const paint = await page.evaluate(`(() => {
    const p = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint');
    return p ? Math.round(p.startTime) : null;
  })()`);
  const longTask = await page.evaluate('Math.round(window.__lt)');
  await ctx.close();
  return { dcl, paint, mapReady, named, settled, longTask, requests, mb: +(bytes / 1e6).toFixed(2), ownMb: +(ownBytes / 1e6).toFixed(2) };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const [label, path, viewport] of [
  ['desktop, empty', '/scout', { width: 1440, height: 900 }],
  ['desktop, London', `/scout?${SPOT}`, { width: 1440, height: 900 }],
  ['phone, London', `/scout?${SPOT}`, { width: 393, height: 852 }],
] as const) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await once(path, viewport));
  const keys = ['dcl', 'paint', 'mapReady', 'named', 'settled', 'longTask', 'requests', 'mb', 'ownMb'] as const;
  const row: Record<string, unknown> = {};
  for (const k of keys) row[k] = median(runs.map((r) => (r[k] as number) ?? 0));
  console.log(label.padEnd(18), JSON.stringify(row));
}
await browser.close();
