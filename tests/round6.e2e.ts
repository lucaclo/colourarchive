/**
 * End-to-end checks for round 6 (replica/round-6/shortlist.md): Style Match
 * accuracy. Runs against `astro dev`, like round5.e2e.ts:
 *
 *   node --import tsx --test tests/round6.e2e.ts
 *
 * A real match runs (the Mac measures and solves), so each test takes ~20 s.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';

const ORIGIN = process.env.E2E_ORIGIN ?? 'https://localhost:4321';
let browser: Browser;

before(async () => {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => { await browser?.close(); });

type Opened = { page: Page; ctx: BrowserContext; problems: string[] };

const SAMPLE = 'public/img/' + readdirSync('public/img').find((f) => f.endsWith('-1280.avif'));

async function matchResult(width = 1180, height = 820): Promise<Opened> {
  const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/SSL certificate|Failed to load resource/i.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  await page.route(/\/api\/match\/keep/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.goto(ORIGIN + '/inspiration', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: '*{transition:none!important;animation:none!important} astro-dev-toolbar{display:none!important}' });
  await page.locator('.cell-match').first().evaluate((e) => (e as HTMLElement).click());
  await page.waitForTimeout(1000);
  await page.setInputFiles('#mx-file', SAMPLE);
  await page.waitForSelector('#mx-result:not([hidden])', { timeout: 180_000 });
  await page.waitForTimeout(1500);
  return { page, ctx, problems };
}

const done = async (o: Opened) => {
  await o.ctx.close();
  assert.deepEqual(o.problems, [], 'no errors on the page');
};

test('R6-H1 the result says how close Lightroom should get, checked on your photo', async () => {
  const o = await matchResult();
  const badges = (await o.page.locator('#mx-badges').textContent()) ?? '';
  assert.match(badges, /of the difference closed in Lightroom/);
  assert.match(badges, /Checked on your photo through Lightroom’s own model, counting colour and contrast: about [\d.]+ from the reference at Full/);
  assert.equal(await o.page.locator('#mx-preview-partial').isHidden(), true, 'the colour tables loaded');
  await done(o);
});

test('R6-H2 the live preview renders what the Lightroom model renders', async () => {
  const o = await matchResult();
  const { page } = o;
  // The mask weights, decoded here rather than in the page: a 2D canvas
  // premultiplies alpha, and the fourth mask lives in alpha — where it is 0,
  // the other three weights would read as 0 too. WebGL reads them unmultiplied.
  const maskUrl = (await page.evaluate('window.__match.maskTexture()')) as string | null;
  let masks: { data: number[]; width: number; height: number } | null = null;
  if (maskUrl) {
    const res = await page.request.get(new URL(maskUrl, ORIGIN).href);
    const { data, info } = await sharp(await res.body()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    masks = { data: [...data], width: info.width, height: info.height };
  }
  for (const strength of ['100', '50']) {
    await page.locator('#mx-strength').fill(strength);
    await page.locator('#mx-strength').dispatchEvent('input');
    await page.waitForTimeout(400);
    // Grade a grid of the photo's own pixels through the CPU model and
    // compare with what the shader drew at the same places.
    const result = await page.evaluate(`(async (masks) => {
      const m = await import('/src/lib/match/lr-model.ts');
      const tb = await import('/src/lib/match/lr-tables-browser.ts');
      const tables = await tb.lrTablesInBrowser();
      const hook = window.__match;
      const adj = hook.adjustments();
      const prep = m.prepareLr(adj, tables, hook.maskChannels());
      const img = new Image();
      img.src = hook.photo();
      await img.decode();
      const W = img.naturalWidth, H = img.naturalHeight;
      const src = document.createElement('canvas'); src.width = W; src.height = H;
      const sctx = src.getContext('2d', { willReadFrequently: true }); sctx.drawImage(img, 0, 0);
      const dst = document.createElement('canvas'); dst.width = W; dst.height = H;
      const dctx = dst.getContext('2d', { willReadFrequently: true }); dctx.drawImage(document.getElementById('mx-canvas'), 0, 0, W, H);
      const dec = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      let sum = 0, n = 0, worst = 0;
      for (let gy = 1; gy < 12; gy++) for (let gx = 1; gx < 12; gx++) {
        const x = Math.floor(W * gx / 12), y = Math.floor(H * gy / 12);
        const s = sctx.getImageData(x, y, 1, 1).data;
        const d = dctx.getImageData(x, y, 1, 1).data;
        let w = null;
        if (masks) {
          const i = (Math.floor(y * masks.height / H) * masks.width + Math.floor(x * masks.width / W)) * 4;
          w = [masks.data[i] / 255, masks.data[i + 1] / 255, masks.data[i + 2] / 255, masks.data[i + 3] / 255];
        }
        const out = m.renderLinear(prep, dec(s[0]), dec(s[1]), dec(s[2]), w);
        for (let c = 0; c < 3; c++) {
          const e = Math.abs(m.srgbEncode(out[c]) * 255 - d[c]);
          sum += e; n++; worst = Math.max(worst, e);
        }
      }
      return { mean: sum / n, worst, masks: adj.masks.length };
    })(${JSON.stringify(masks)})`) as { mean: number; worst: number; masks: number };
    // Dither (±½ level), grain, texture, and mask edges sampled at slightly
    // different spots account for the rest.
    assert.ok(result.mean < 2, `strength ${strength}: mean ${result.mean.toFixed(2)} levels, worst ${result.worst.toFixed(1)} (${result.masks} masks)`);
  }
  await done(o);
});

test('R6-H3 the strength slider still blends: nothing at None', async () => {
  const o = await matchResult();
  const { page } = o;
  await page.locator('#mx-strength').fill('0');
  await page.locator('#mx-strength').dispatchEvent('input');
  await page.waitForTimeout(300);
  const adj = await page.evaluate('window.__match.adjustments()') as { exposure: number; saturation: number; curve: Array<{ x: number; y: number }> };
  assert.equal(adj.exposure, 0);
  assert.equal(adj.saturation, 0);
  assert.ok(adj.curve.every((p) => p.x === p.y));
  await done(o);
});
