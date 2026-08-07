/**
 * Where /scout actually spends its time, measured with V8's sampling profiler.
 *
 * Drives the slider the way a hand does and aggregates self-time by function.
 * GPU-side cost is NOT represented — headless runs on SwiftShader — so this is
 * a measurement of the JavaScript, which is where every previous win came from.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = '/Users/luca/Desktop/Colour Archive/';
const PORT = process.env.PORT ?? '41740';
const server = spawn(`${ROOT}node_modules/.bin/astro`, ['dev', '--port', PORT], { cwd: ROOT });
const origin: string = await new Promise((resolve) => {
  let log = '';
  const read = (c: Buffer) => {
    log += c.toString();
    const m = log.match(/(https?:\/\/localhost:\d+)\//);
    if (m) resolve(m[1]);
  };
  server.stdout.on('data', read);
  server.stderr.on('data', read);
});

const READY =
  '!!(window.scout && window.scout.map() && window.scout.map().isStyleLoaded() && window.scout.map().loaded())';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  ignoreHTTPSErrors: true,
  serviceWorkers: 'block',
});
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Central London at a working radius: as many buildings as this page ever sees.
const SPOT = 'at=51.5079,-0.0877&tz=Europe/London&n=London&d=2026-08-07&t=700&r=4';
await page.goto(`${origin}/scout?${SPOT}`);
await page.waitForFunction(READY, null, { timeout: 120_000 });
await page.waitForSelector('#panel:not([hidden])');
// Buildings only exist in the vector tiles from about z14, and the whole point
// of this measurement is the expensive scene. Go there explicitly.
await page.evaluate(
  `window.scout.map().jumpTo({ center: [-0.0877, 51.5079], zoom: 15.4, pitch: 0 })`,
);
await page.waitForFunction(READY, null, { timeout: 120_000 });
// Let the buildings, the DEM and the photos all arrive and settle.
await page.waitForTimeout(20_000);

const scale = await page.evaluate(
  `(() => {
     const map = window.scout.map();
     const shadows = map.querySourceFeatures('scout-shadows').length;
     const buildings = map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' }).length;
     const terrain = window.scout.terrain ? window.scout.terrain() : null;
     return {
       shadows,
       buildingFeaturesInTiles: buildings,
       zoom: map.getZoom(),
       terrainTiles: terrain && terrain.field ? terrain.field.tiles : null,
     };
   })()`,
);
console.log('=== scale of the scene ===');
console.log(JSON.stringify(scale, null, 2));

const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 100 });

// A scrub: 240 minutes, one batched frame each, the way dragging the slider goes.
const drive = `(async () => {
  const t0 = performance.now();
  for (let m = 600; m < 840; m++) {
    window.scout.setMinute(m);
    window.scout.tick();
  }
  return performance.now() - t0;
})()`;

// Warm once so the numbers are steady-state rather than first-call.
await page.evaluate(drive);

await cdp.send('Profiler.start');
const wall = (await page.evaluate(drive)) as number;
const { profile } = (await cdp.send('Profiler.stop')) as any;

console.log(`\n=== 240 slider minutes in ${wall.toFixed(0)} ms (${(wall / 240).toFixed(2)} ms each) ===`);

// Self time per node, from the sample counts.
const byId = new Map<number, any>();
for (const node of profile.nodes) byId.set(node.id, node);
const self = new Map<number, number>();
for (const id of profile.samples) self.set(id, (self.get(id) ?? 0) + 1);

const total = profile.samples.length || 1;
const rows: Array<{ name: string; url: string; pct: number; ms: number }> = [];
for (const [id, count] of self) {
  const node = byId.get(id);
  if (!node) continue;
  const frame = node.callFrame;
  rows.push({
    name: frame.functionName || '(anonymous)',
    url: (frame.url || '').replace(origin, '').split('?')[0],
    pct: (count / total) * 100,
    ms: (count / total) * wall,
  });
}
rows.sort((a, b) => b.ms - a.ms);
console.log('\n=== self time, top 25 ===');
for (const row of rows.slice(0, 25)) {
  console.log(`${row.ms.toFixed(1).padStart(7)} ms  ${row.pct.toFixed(1).padStart(5)}%  ${row.name}  ${row.url}`);
}

// And the same by file, which is what says *which subsystem* to look at.
const byFile = new Map<string, number>();
for (const row of rows) byFile.set(row.url, (byFile.get(row.url) ?? 0) + row.ms);
console.log('\n=== self time by file ===');
for (const [url, ms] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`${ms.toFixed(1).padStart(7)} ms  ${url || '(native)'}`);
}

await browser.close();
server.kill();
