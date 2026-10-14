/**
 * End-to-end checks for round 5 (replica/round-5/shortlist.md). Runs against
 * `astro dev`, same as features.e2e.ts:
 *
 *   node --import tsx --test tests/round5.e2e.ts
 *
 * Every save is answered by a route mock, so nothing on disk changes.
 * `page.evaluate` takes strings for the reason features.e2e.ts gives.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const ORIGIN = process.env.E2E_ORIGIN ?? 'https://localhost:4321';
let browser: Browser;

before(async () => {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => { await browser?.close(); });

type Opened = { page: Page; ctx: BrowserContext; problems: string[]; calls: Array<{ url: string; body: string }> };

/** A page with every write mocked; the mocked calls are recorded. */
async function open(path: string, opts: { width?: number; height?: number; touch?: boolean; fail?: RegExp } = {}): Promise<Opened> {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    hasTouch: opts.touch ?? false,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  const problems: string[] = [];
  const calls: Opened['calls'] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/SSL certificate|CORS policy|Failed to load resource|overpass|tiles?\b/i.test(text)) return;
    problems.push(`console: ${text}`);
  });
  await page.route(/\/api\/(book|chapter|genre|label|notes|remove|upload|match\/keep)/, (r) => {
    if (r.request().method() === 'GET') return r.continue();
    calls.push({ url: r.request().url(), body: r.request().postData() ?? '' });
    if (opts.fail?.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"mock failure"}' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: '*{transition:none!important;animation:none!important} astro-dev-toolbar{display:none!important}' });
  return { page, ctx, problems, calls };
}
const done = async (o: Opened) => {
  await o.ctx.close();
  assert.deepEqual(o.problems, [], 'no errors on the page');
};

// ── R5-1 remove, then Undo ─────────────────────────────────────────────────

const cellCount = (page: Page) => page.evaluate(`document.querySelectorAll('#manage .cell, .grid .cell').length`) as Promise<number>;

test('R5-1-H1 removing takes the photo off at once, and Undo puts it back where it was', async () => {
  const o = await open('/upload');
  const { page } = o;
  const before = await cellCount(page);
  const third = await page.evaluate(`document.querySelectorAll('.cell')[2].dataset.id`);
  await page.locator('.cell').nth(2).locator('.cell-remove').evaluate((b) => (b as HTMLElement).click());
  assert.equal(await cellCount(page), before - 1, 'gone after one tap');
  assert.ok(await page.getByRole('button', { name: 'Undo' }).isVisible());
  assert.equal(o.calls.length, 0, 'the server has not been asked yet');
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await cellCount(page), before);
  assert.equal(await page.evaluate(`document.querySelectorAll('.cell')[2].dataset.id`), third, 'back in the same place');
  await page.waitForTimeout(6500);
  assert.equal(o.calls.length, 0, 'an undone removal is never sent');
  await done(o);
});

test('R5-1-H2 a removal is sent once the Undo window runs out', async () => {
  const o = await open('/upload');
  const id = await o.page.evaluate(`document.querySelectorAll('.cell')[0].dataset.id`);
  await o.page.locator('.cell').first().locator('.cell-remove').evaluate((b) => (b as HTMLElement).click());
  await o.page.waitForTimeout(6600);
  assert.equal(o.calls.length, 1);
  assert.match(o.calls[0].url, /\/api\/remove/);
  assert.equal(JSON.parse(o.calls[0].body).id, id);
  assert.equal(await o.page.locator('.undo-bar').isHidden(), true);
  await done(o);
});

test('R5-1-H3 a second removal sends the first straight away', async () => {
  const o = await open('/upload');
  await o.page.locator('.cell').nth(0).locator('.cell-remove').evaluate((b) => (b as HTMLElement).click());
  await o.page.locator('.cell').nth(0).locator('.cell-remove').evaluate((b) => (b as HTMLElement).click());
  await o.page.waitForTimeout(300);
  assert.equal(o.calls.length, 1, 'the first went when the second started');
  await done(o);
});

test('R5-1-E1 a removal the server refuses comes back with a note', async () => {
  const o = await open('/upload', { fail: /remove/ });
  const before = await cellCount(o.page);
  await o.page.locator('.cell').first().locator('.cell-remove').evaluate((b) => (b as HTMLElement).click());
  await o.page.waitForTimeout(6800);
  assert.equal(await cellCount(o.page), before);
  assert.match((await o.page.locator('.undo-bar').textContent()) ?? '', /Couldn’t remove/);
  o.problems.length = 0; // post() logs the refusal to the console on purpose
  await done(o);
});

test('R5-1-H4 bulk remove takes all the selected at once, with one Undo', async () => {
  const o = await open('/upload');
  const before = await cellCount(o.page);
  await o.page.locator('.cell').nth(0).click({ position: { x: 20, y: 60 } });
  await o.page.locator('.cell').nth(3).click({ position: { x: 20, y: 60 }, modifiers: ['Shift'] });
  await o.page.locator('#bulk-remove').click();
  assert.equal(await cellCount(o.page), before - 4);
  assert.match((await o.page.locator('.undo-bar').textContent()) ?? '', /Removed 4/);
  await o.page.keyboard.press('Meta+z');
  assert.equal(await cellCount(o.page), before);
  await done(o);
});

// ── R5-2 colours that go with it ───────────────────────────────────────────

test('R5-2-H1 a partner colour adds itself, and finds as many photos as it said', async () => {
  const o = await open('/?colour=3a7f9a');
  const { page } = o;
  await page.getByRole('button', { name: 'Search by colour' }).first().click();
  const comp = page.locator('.cf-goes-btn[data-partner="complementary"]').first();
  assert.ok(await comp.isVisible());
  const said = Number(await comp.locator('.cf-goes-n').textContent());
  assert.match((await comp.getAttribute('aria-label')) ?? '', /^Complementary, #/);
  await comp.click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.cf-chip').count(), 2, 'two colours now');
  assert.equal(Number(await page.locator('.cf-count').first().textContent()), said);
  assert.match(page.url(), /colour=3a7f9a,[0-9a-f]{6}/);
  assert.equal(await page.locator('.cf-goes').first().isHidden(), true, 'offered for one colour only');
  await done(o);
});

test('R5-2-E1 a grey has nothing to go with', async () => {
  const o = await open('/?colour=808080');
  await o.page.getByRole('button', { name: 'Search by colour' }).first().click();
  assert.equal(await o.page.locator('.cf-goes').first().isHidden(), true);
  await done(o);
});

// ── R5-3 survey a burst before keeping one ─────────────────────────────────

test('R5-3-H1 the ⧉ badge opens the group side by side, and Keep leaves the others out with Undo', async () => {
  const o = await open('/book');
  const { page } = o;
  const outBefore = await page.locator('.book-cell[data-excluded="1"]').count();
  const group = await page.locator('.book-dup').first().getAttribute('data-dup-group');
  const groupOut = await page.locator(`.book-cell[data-dup-group="${group}"][data-excluded="1"]`).count();
  assert.equal(groupOut, 0, 'the first group starts all in the book');
  const size = await page.locator(`.book-cell[data-dup-group="${group}"]`).count();
  await page.locator('.book-dup').first().evaluate((e) => (e as HTMLElement).click());
  const dialog = page.getByRole('dialog', { name: 'Similar shots' });
  assert.ok(await dialog.isVisible());
  assert.equal(await dialog.locator('.survey-item').count(), size);
  const heights = await dialog.locator('.survey-frame img').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  assert.ok(Math.max(...heights) - Math.min(...heights) <= 2, `same size side by side: ${heights}`);
  assert.equal(await page.locator('.book-cell[data-excluded="1"]').count(), outBefore, 'nothing changes on opening');
  const keepId = await dialog.locator('.survey-item').nth(1).getAttribute('data-id');
  await dialog.locator('.survey-keep').nth(1).click();
  assert.equal(await dialog.isVisible(), false);
  const out = await page.locator(`.book-cell[data-dup-group="${group}"][data-excluded="1"]`).count();
  assert.equal(out, size - 1);
  assert.equal(await page.locator(`.book-cell[data-id="${keepId}"]`).getAttribute('data-excluded'), '');
  assert.match((await page.locator('#book-undo-text').textContent()) ?? '', /^Kept .+, left out \d/);
  await page.locator('#book-undo-btn').click();
  assert.equal(await page.locator('.book-cell[data-excluded="1"]').count(), outBefore);
  await done(o);
});

test('R5-3-H2 holding a photo zooms every photo in the group to the same spot', async () => {
  const o = await open('/book');
  const { page } = o;
  await page.locator('.book-dup').first().evaluate((e) => (e as HTMLElement).click());
  const frame = page.locator('.survey-frame').first();
  const b = (await frame.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.75);
  await page.mouse.down();
  const t = await page.locator('.survey-frame img').evaluateAll((els) => els.map((e) => getComputedStyle(e).transform + ' @ ' + getComputedStyle(e).transformOrigin));
  assert.ok(t.every((x) => x.startsWith('matrix(2.5')), t.join(' | '));
  const origins = await page.locator('.survey-frame img').evaluateAll((els) => els.map((e) => {
    const [x, y] = getComputedStyle(e).transformOrigin.split(' ').map(parseFloat);
    const el = e as HTMLElement; // offset sizes are the unscaled box
    return `${Math.round((x / el.offsetWidth) * 100)},${Math.round((y / el.offsetHeight) * 100)}`;
  }));
  assert.equal(new Set(origins).size, 1, `one spot for all: ${origins}`);
  assert.equal(origins[0], '25,75');
  await page.mouse.up();
  assert.match(await page.locator('.survey-frame img').first().evaluate((e) => getComputedStyle(e).transform), /^none|matrix\(1, 0, 0, 1/);
  await done(o);
});
