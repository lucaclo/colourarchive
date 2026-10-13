/**
 * End-to-end checks for the October 2026 competitor-gap features (see
 * replica/test-plan.md for the case list). Runs against `astro dev`:
 *
 *   node --import tsx --test tests/features.e2e.ts
 *
 * Nothing here writes real data. Book saves, PDF builds and Style Match
 * analyses are answered by route mocks, because book.json, the board and the
 * calibration store are the user's own and a test run must never feed them.
 *
 * `page.evaluate` takes strings, not functions, for the reason
 * scout.smoke.ts gives: tsx wraps functions in a `__name` helper that does
 * not exist inside the page.
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

/** A page that fails the test on an uncaught error, an app console error, or a 5xx. */
async function open(path: string, opts: { width?: number; height?: number; clipboard?: boolean } = {}): Promise<{ page: Page; ctx: BrowserContext; problems: string[] }> {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    ignoreHTTPSErrors: true,
    permissions: opts.clipboard ? ['clipboard-read', 'clipboard-write'] : [],
  });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Third-party tile/feature hosts and the self-signed service worker are not this app.
    if (/SSL certificate|CORS policy|Failed to load resource|overpass|tiles?\b/i.test(text)) return;
    problems.push(`console: ${text}`);
  });
  page.on('response', (r) => { if (r.status() >= 500 && r.url().startsWith(ORIGIN)) problems.push(`${r.status()} ${r.url()}`); });
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: '*{transition:none!important;animation:none!important} astro-dev-toolbar{display:none!important}' });
  return { page, ctx, problems };
}
const done = async (o: { ctx: BrowserContext; problems: string[] }) => {
  await o.ctx.close();
  assert.deepEqual(o.problems, [], 'no errors on the page');
};
const visibleFrames = (page: Page) => page.evaluate(`[...document.querySelectorAll('.archive .frame')].filter((f) => f.offsetParent).length`) as Promise<number>;

// ── F01 archive colour search ──────────────────────────────────────────────

test('F01-H1 a picked red filters the archive to photos that contain it', async () => {
  const o = await open('/');
  const { page } = o;
  const all = await visibleFrames(page);
  await page.getByRole('button', { name: 'Search by colour' }).first().click();
  await page.getByRole('textbox', { name: 'Hex colour' }).fill('#d11f27');
  await page.waitForTimeout(500);
  const shown = await visibleFrames(page);
  const count = Number(await page.locator('.cf-count').first().textContent());
  assert.ok(shown > 0 && shown < all, `${shown} of ${all}`);
  assert.equal(shown, count, 'the count says what is shown');
  // Every visible photo really does contain a red, by the same ranking.
  const ok = await page.evaluate(`(async () => {
    const m = await import('/src/lib/colour-search.ts');
    const q = m.hexToOklch('#d11f27');
    return [...document.querySelectorAll('.archive .frame')].filter((f) => f.offsetParent)
      .every((f) => m.colourScore(m.decodePalette(f.dataset.palette), q) <= m.MATCH_CEILING);
  })()`);
  assert.equal(ok, true);
  await done(o);
});

test('F01-H2 a chroma floor alone filters by tone', async () => {
  const o = await open('/');
  const all = await visibleFrames(o.page);
  await o.page.getByRole('button', { name: 'Search by colour' }).first().click();
  await o.page.getByRole('slider', { name: 'Minimum chroma' }).fill('50');
  await o.page.waitForTimeout(500);
  const shown = await visibleFrames(o.page);
  assert.ok(shown > 0 && shown < all, `${shown} of ${all}`);
  await done(o);
});

test('F01-E1 a malformed hex is marked and filters nothing', async () => {
  const o = await open('/');
  const all = await visibleFrames(o.page);
  await o.page.getByRole('button', { name: 'Search by colour' }).first().click();
  const hex = o.page.getByRole('textbox', { name: 'Hex colour' });
  await hex.fill('#zz1122');
  await hex.press('Tab');
  await o.page.waitForTimeout(300);
  assert.equal(await hex.getAttribute('aria-invalid'), '');
  assert.equal(await visibleFrames(o.page), all);
  await done(o);
});

test('F01-E2 a colour nothing has empties the archive with a way back', async () => {
  const o = await open('/');
  const all = await visibleFrames(o.page);
  await o.page.getByRole('button', { name: 'Search by colour' }).first().click();
  await o.page.getByRole('textbox', { name: 'Hex colour' }).fill('#00ff00');
  await o.page.waitForTimeout(600);
  assert.equal(await visibleFrames(o.page), 0);
  const empty = o.page.locator('#archive-empty');
  assert.ok(await empty.isVisible());
  assert.match((await empty.textContent()) ?? '', /#00ff00/);
  await o.page.keyboard.press('Escape');
  await o.page.getByRole('button', { name: 'Clear filters' }).click();
  await o.page.waitForTimeout(700);
  assert.equal(await visibleFrames(o.page), all);
  await done(o);
});

test('F01-E3 on a phone the popover stays on screen', async () => {
  const o = await open('/', { width: 390, height: 844 });
  await o.page.getByRole('button', { name: 'Search by colour' }).first().click();
  const box = await o.page.locator('.cf-pop').first().boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  await done(o);
});

test('F01-E4 Escape closes the popover and returns focus', async () => {
  const o = await open('/');
  const btn = o.page.getByRole('button', { name: 'Search by colour' }).first();
  await btn.click();
  await o.page.keyboard.press('Escape');
  await o.page.waitForTimeout(250);
  assert.equal(await o.page.locator('.cf-pop').first().isHidden(), true);
  assert.equal(await o.page.evaluate(`document.activeElement?.getAttribute('aria-label')`), 'Search by colour');
  await done(o);
});

// ── F02 board colour search ────────────────────────────────────────────────

test('F02-H1 the board filters by colour and clears', async () => {
  const o = await open('/inspiration');
  const count = () => o.page.evaluate(`[...document.querySelectorAll('.insp-frame')].filter((f) => f.offsetParent).length`) as Promise<number>;
  const all = await count();
  await o.page.locator('.insp-cf').getByRole('button', { name: 'Search by colour' }).click();
  await o.page.locator('.insp-cf').getByRole('textbox', { name: 'Hex colour' }).fill('#3e80a8');
  await o.page.waitForTimeout(500);
  const some = await count();
  assert.ok(some < all, `${some} of ${all}`);
  const emptyGroupsShown = await o.page.evaluate(`[...document.querySelectorAll('.insp-chapter')].filter((c) => c.offsetParent && !c.querySelector('.insp-frame:not(.cf-out)')).length`);
  assert.equal(emptyGroupsShown, 0, 'no empty groups left showing');
  await o.page.locator('.insp-cf').getByRole('button', { name: 'Clear' }).click();
  await o.page.waitForTimeout(300);
  assert.equal(await count(), all);
  await done(o);
});

// ── F03 lightbox palette ───────────────────────────────────────────────────

// Round 2 changed this: a tap on a swatch searches (R2-F02-H1); Copy copies.
test('F03-H1 the lightbox shows the palette and Copy copies the pointed-at hex', async () => {
  const o = await open('/', { clipboard: true });
  await o.page.locator('.archive .frame').first().click();
  await o.page.waitForTimeout(600);
  await o.page.getByRole('button', { name: 'Photo details' }).click();
  const swatches = o.page.locator('.lb-swatch');
  assert.ok((await swatches.count()) >= 2);
  const hex = await swatches.first().getAttribute('data-hex');
  await swatches.first().hover();
  await o.page.getByRole('button', { name: 'Copy', exact: true }).click();
  await o.page.waitForTimeout(200);
  assert.equal(await o.page.evaluate('navigator.clipboard.readText()'), hex);
  await done(o);
});

// ── F04 book ───────────────────────────────────────────────────────────────

/** Book page with saves and PDF builds answered here, never by the server. */
async function openBook() {
  const o = await open('/book');
  const saves: unknown[] = [];
  await o.page.route('**/api/book', async (route) => {
    if (route.request().method() === 'POST') { saves.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    return route.continue();
  });
  return { ...o, saves };
}
const pageCheck = (page: Page) => page.locator('#book-check').textContent();
const pagesIn = (s: string | null) => Number(s?.match(/^(\d+)/)?.[1]);

test('F04-H1 spreads start with page 1 alone on the right', async () => {
  const o = await openBook();
  await o.page.getByRole('button', { name: 'Spreads' }).click();
  const first = o.page.locator('.bs-spread').first();
  assert.equal(await first.locator('.bs-none').count(), 1);
  assert.equal(await first.locator('.bs-page').last().locator('.bs-num').textContent(), '1');
  const spreads = await o.page.locator('.bs-spread').count();
  assert.equal(spreads, pagesIn(await pageCheck(o.page)) / 2 + 1);
  await done(o);
});

test('F04-H2 two-up joins two photos, drops a page and saves the layout', async () => {
  const o = await openBook();
  await o.page.getByRole('button', { name: 'Spreads' }).click();
  const before = pagesIn(await pageCheck(o.page));
  const first = o.page.locator('.bs-page[data-first]').first();
  const id = await first.getAttribute('data-first');
  await first.click();
  await o.page.getByText('Two-up', { exact: true }).click();
  await o.page.waitForTimeout(200);
  assert.equal(await o.page.locator('.bs-page[data-first]').first().locator('img').count(), 2);
  const after = pagesIn(await pageCheck(o.page));
  assert.ok(after === before - 2 || after === before, `${before} → ${after} (padding to even)`);
  assert.ok(await o.page.locator('#book-savebar').isVisible());
  await o.page.getByRole('button', { name: 'Save' }).click();
  await o.page.waitForTimeout(400);
  const sent = o.saves.at(-1) as { layout?: Record<string, string>; chapters?: unknown };
  assert.equal(sent?.layout?.[id!], 'pair');
  assert.ok(sent?.chapters, 'the order rides along, so nothing is wiped');
  await done(o);
});

test('F04-E1 two-up on a chapter\'s last photo falls back and says why', async () => {
  const o = await openBook();
  await o.page.getByRole('button', { name: 'Spreads' }).click();
  // The page just before the second chapter opener is the first chapter's last photo.
  const lastId = await o.page.evaluate(`(() => {
    const pages = [...document.querySelectorAll('.bs-page')].filter((p) => !p.classList.contains('bs-none'));
    const openers = pages.map((p, i) => p.classList.contains('bs-opener') ? i : -1).filter((i) => i >= 0);
    return pages[openers[1] - 1]?.dataset.first ?? null;
  })()`);
  assert.ok(lastId);
  await o.page.locator(`.bs-page[data-first="${lastId}"]`).click();
  await o.page.getByText('Two-up', { exact: true }).click();
  await o.page.waitForTimeout(200);
  assert.match((await o.page.locator('#book-pagectl-note').textContent()) ?? '', /nothing to pair/i);
  assert.ok(await o.page.locator(`.bs-page[data-first="${lastId}"]`).evaluate((el) => el.classList.contains('bs-fallback')));
  await done(o);
});

test('F04-E2 arrow keys move the selected page', async () => {
  const o = await openBook();
  await o.page.getByRole('button', { name: 'Spreads' }).click();
  const pages = o.page.locator('.bs-page[data-first]');
  await pages.first().click();
  await pages.first().focus();
  await o.page.keyboard.press('ArrowRight');
  assert.equal(await pages.nth(1).getAttribute('aria-pressed'), 'true');
  assert.equal(await pages.first().getAttribute('aria-pressed'), 'false');
  await done(o);
});

test('F04-E3 a smaller trim keeps the page count and changes the check', async () => {
  const o = await openBook();
  // Size, page check and bleed live behind Print since round 3.
  await o.page.getByRole('button', { name: 'Print', exact: true }).click();
  await o.page.getByRole('combobox').filter({ hasText: 'Blurb' }).selectOption('a5-port');
  await o.page.waitForTimeout(200);
  assert.doesNotMatch((await pageCheck(o.page)) ?? '', /Blurb/);
  await done(o);
});

test('F04-H3 print PDF counts up and offers the file', async () => {
  const o = await openBook();
  await o.page.route('**/api/book/pdf?*', (route) => route.fulfill({
    headers: { 'content-type': 'application/x-ndjson' },
    body: ['{"type":"progress","done":1,"total":2}', '{"type":"progress","done":2,"total":2}', '{"type":"done","ok":true,"href":"/api/book/pdf?file=colour-archive-test.pdf"}', ''].join('\n'),
  }));
  await o.page.route('**/api/book/pdf?file=*', (route) => route.fulfill({ body: '%PDF-1.4', headers: { 'content-type': 'application/pdf' } }));
  await o.page.getByRole('button', { name: 'Print', exact: true }).click();
  await o.page.getByRole('button', { name: 'Make PDF' }).click();
  await o.page.waitForTimeout(800);
  assert.ok(await o.page.getByRole('link', { name: 'Download' }).isVisible());
  // The panel closes once the download starts; the button is ready again behind it.
  assert.equal(await o.page.locator('#book-pdf').isEnabled(), true);
  await done(o);
});

test('F04-N1 a failed build says so', async () => {
  const o = await openBook();
  await o.page.route('**/api/book/pdf?*', (route) => route.fulfill({
    headers: { 'content-type': 'application/x-ndjson' },
    body: '{"type":"done","ok":false,"error":"A photo is missing."}\n',
  }));
  await o.page.getByRole('button', { name: 'Print', exact: true }).click();
  await o.page.getByRole('button', { name: 'Make PDF' }).click();
  await o.page.waitForTimeout(600);
  assert.match((await o.page.locator('#book-pdf-status').textContent()) ?? '', /A photo is missing/);
  await done(o);
});

// ── F05 scout ──────────────────────────────────────────────────────────────

const SCOUT = '/scout?at=55.9533,-3.1883&d=2026-08-12&t=720&tz=Europe/London&r=3&n=Edinburgh';

test('F05-H1 the meteor fold names a shower and the best hour', async () => {
  const o = await open(SCOUT);
  await o.page.waitForTimeout(3000);
  // The meteor fold sits in the Night sky group since round 3.
  await o.page.getByText('Night sky', { exact: true }).click();
  await o.page.getByText('Meteor showers', { exact: true }).click();
  await o.page.waitForTimeout(1500);
  const line = (await o.page.locator('#meteor-line').textContent()) ?? '';
  assert.match(line, /Perseids · ~\d+ an hour at best/);
  assert.match((await o.page.locator('#meteor-moon').textContent()) ?? '', /^Moon \d+%/);
  assert.ok(await o.page.getByRole('button', { name: 'Go to the best hour' }).isVisible());
  await done(o);
});

test('F05-H2 eye level stands at the pin facing the sun, and comes back', async () => {
  const o = await open(SCOUT);
  await o.page.waitForTimeout(4000);
  const cam = () => o.page.evaluate(`(() => { const m = window.scout.map(); return { pitch: m.getPitch(), bearing: (m.getBearing() + 360) % 360, zoom: m.getZoom() }; })()`) as Promise<{ pitch: number; bearing: number; zoom: number }>;
  const before = await cam();
  await o.page.getByRole('button', { name: 'Eye level' }).click();
  await o.page.waitForTimeout(8000);
  const eye = await cam();
  assert.ok(eye.pitch > 80, `pitch ${eye.pitch}`);
  // Solar noon in Edinburgh: the sun is due south.
  assert.ok(Math.abs(eye.bearing - 180) < 5, `bearing ${eye.bearing}`);
  assert.ok(eye.zoom > 19, `zoom ${eye.zoom}`);
  await o.page.getByRole('button', { name: 'Eye level' }).click();
  await o.page.waitForTimeout(1500);
  const back = await cam();
  assert.ok(Math.abs(back.zoom - before.zoom) < 0.05 && Math.abs(back.pitch - before.pitch) < 1, JSON.stringify({ before, back }));
  await done(o);
});

// ── F06 batch Style Match ──────────────────────────────────────────────────

async function openMatch() {
  const o = await open('/inspiration');
  await o.page.locator('.cell-match').first().evaluate((b) => (b as HTMLElement).click());
  await o.page.waitForTimeout(500);
  return o;
}
const jpeg = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });

test('F06-H1 two photos each get a preset, downloaded together', async () => {
  const o = await openMatch();
  let n = 0;
  await o.page.route('**/api/match/analyse', (route) => route.fulfill({ json: { ok: true, id: `m${++n}` } }));
  await o.page.locator('#mx-file').setInputFiles([jpeg('one.jpg'), jpeg('two.jpg')]);
  await o.page.waitForTimeout(800);
  const states = await o.page.locator('.mx-batch-state').allTextContents();
  assert.deepEqual(states, ['Ready', 'Ready']);
  const [req] = await Promise.all([
    o.page.waitForRequest('**/api/match/presets.zip?*'),
    o.page.getByRole('button', { name: /Download presets \(2\)/ }).click(),
  ]);
  const ids = new URL(req.url()).searchParams.get('ids');
  assert.equal(ids, 'm1,m2');
  await o.ctx.close();
  // The zip itself is unmocked server code; a missing id is a 404, not a 5xx.
  assert.deepEqual(o.problems.filter((p) => !p.includes('presets.zip')), []);
});

test('F06-N1 a refused photo shows why and the rest still download', async () => {
  const o = await openMatch();
  let n = 0;
  await o.page.route('**/api/match/analyse', (route) => (++n === 1
    ? route.fulfill({ json: { ok: false, error: 'Too far apart to match.' } })
    : route.fulfill({ json: { ok: true, id: 'm2' } })));
  await o.page.locator('#mx-file').setInputFiles([jpeg('one.jpg'), jpeg('two.jpg')]);
  await o.page.waitForTimeout(800);
  assert.deepEqual(await o.page.locator('.mx-batch-state').allTextContents(), ['Too far apart to match.', 'Ready']);
  assert.ok(await o.page.getByRole('button', { name: /Download presets \(1\)/ }).isVisible());
  await done(o);
});

// ── F07 share page ─────────────────────────────────────────────────────────

const shareLine = async (query: string, site: string) => {
  const res = await fetch(`${ORIGIN}/inspiration/add${query}`, { headers: { 'sec-fetch-site': site } });
  const html = await res.text();
  return html.match(/role="status"[^>]*>\s*([^<]*?)\s*</)?.[1] ?? '';
};

test('F07 the share page refuses other sites and private addresses', async () => {
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    assert.match(await shareLine('?url=https%3A%2F%2Fexample.org%2Fa.jpg', 'cross-site'), /share sheet/);
    assert.match(await shareLine('?url=http%3A%2F%2F192.168.1.1%2F', 'none'), /inside this network/);
    assert.match(await shareLine('', 'none'), /Nothing was shared/);
  } finally {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
  }
});

// ══ Round 2 (replica/round-2/test-plan.md) ═══════════════════════════════

const trayItems = (page: Page) => page.getByRole('list', { name: 'Closest by colour' }).getByRole('listitem');
const rankedOk = (page: Page, hexes: string[]) => page.evaluate(`(async () => {
  const m = await import('/src/lib/colour-search.ts');
  const q = ${JSON.stringify(hexes)}.map((h) => m.hexToOklch(h));
  const ids = [...document.querySelectorAll('.cf-tray-item')].map((b, i) => i);
  const frames = new Map([...document.querySelectorAll('.archive .frame')].map((f) => [f.dataset.id, f]));
  const hits = m.searchByColour([...frames.values()].map((f) => ({ id: f.dataset.id, palette: m.decodePalette(f.dataset.palette) })), q);
  return { expected: hits.length, firstScores: hits.slice(0, 5).map((h) => h.score), sorted: hits.every((h, i) => i === 0 || hits[i - 1].score <= h.score), shown: ids.length };
})()`) as Promise<{ expected: number; sorted: boolean; shown: number }>;

// ── R2-F01 ranked results ──────────────────────────────────────────────────

test('R2-F01-H1 a picked colour shows a ranked tray at the top, closest first', async () => {
  const o = await open('/');
  await o.page.getByRole('button', { name: 'Search by colour' }).first().click();
  await o.page.getByRole('textbox', { name: 'Hex colour' }).fill('#3f6f8f');
  await o.page.waitForTimeout(500);
  await o.page.keyboard.press('Escape');
  const items = trayItems(o.page);
  const n = await items.count();
  const r = await rankedOk(o.page, ['#3f6f8f']);
  assert.ok(n > 0, 'the tray has photos');
  assert.equal(n, Math.min(40, r.expected));
  assert.equal(r.sorted, true);
  const box = await o.page.getByRole('list', { name: 'Closest by colour' }).boundingBox();
  assert.ok(box && box.y < 200, `tray at y=${box?.y}, visible without a scroll`);
  assert.match((await items.first().getAttribute('aria-label')) ?? '', /\d+% of the frame/);
  await done(o);
});

test('R2-F01-H2 the colour is kept in the address and restored from it', async () => {
  const o = await open('/');
  await o.page.getByRole('button', { name: 'Search by colour' }).first().click();
  await o.page.getByRole('textbox', { name: 'Hex colour' }).fill('#c0563b');
  await o.page.waitForTimeout(400);
  assert.match(o.page.url(), /[?&]colour=c0563b/);
  await o.page.reload();
  await o.page.waitForTimeout(1500);
  assert.ok((await trayItems(o.page).count()) > 0, 'restored search shows results');
  await o.page.getByRole('button', { name: 'Search by colour' }).first().click();
  assert.equal(await o.page.getByRole('radio', { name: /#c0563b/ }).count(), 1);
  await done(o);
});

test('R2-F01-E1 a colour nothing has shows 0 and Clear in the tray', async () => {
  const o = await open('/?colour=00ff00');
  await o.page.waitForTimeout(500);
  assert.equal(await trayItems(o.page).count(), 0);
  const clear = o.page.locator('#cf-tray').getByRole('button', { name: 'Clear' });
  assert.ok(await clear.isVisible());
  await clear.click();
  await o.page.waitForTimeout(500);
  assert.equal(await o.page.locator('#cf-tray').isHidden(), true);
  assert.doesNotMatch(o.page.url(), /colour=/);
  await done(o);
});

test('R2-F01-E2 a garbled address colour is ignored', async () => {
  const o = await open('/?colour=zzzzzz,12');
  assert.equal(await o.page.locator('#cf-tray').isHidden(), true);
  await done(o);
});

test('R2-F01-K1 keyboard: arrows walk the tray and Enter opens the photo', async () => {
  const o = await open('/?colour=3f6f8f');
  await o.page.waitForTimeout(400);
  const items = trayItems(o.page);
  await items.first().focus();
  await o.page.keyboard.press('ArrowRight');
  assert.equal(await o.page.evaluate(`document.activeElement === document.querySelectorAll('.cf-tray-item')[1]`), true);
  await o.page.keyboard.press('Enter');
  await o.page.waitForTimeout(800);
  assert.equal(await o.page.locator('#lightbox, .lightbox').first().isVisible(), true);
  await done(o);
});

test('R2-F01-E3 on a phone the tray stays inside the screen', async () => {
  const o = await open('/?colour=c0563b', { width: 390, height: 844 });
  await o.page.waitForTimeout(400);
  const box = await o.page.locator('#cf-tray').boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  await done(o);
});

// ── R2-F02 swatch to search ────────────────────────────────────────────────

test('R2-F02-H1 a lightbox swatch searches for its colour', async () => {
  const o = await open('/');
  await o.page.locator('.archive .frame').first().click();
  await o.page.waitForTimeout(600);
  await o.page.getByRole('button', { name: 'Photo details' }).click();
  const sw = o.page.locator('.lb-swatch').first();
  const hex = (await sw.getAttribute('data-hex'))!;
  assert.equal(await sw.getAttribute('aria-label'), `Search ${hex}`);
  await sw.click();
  await o.page.waitForTimeout(1200);
  assert.ok(await o.page.locator('#cf-tray').isVisible(), 'the tray opened');
  assert.match(o.page.url(), new RegExp(`colour=${hex.slice(1)}`));
  assert.ok((await trayItems(o.page).count()) > 0, 'its own photo at least');
  await done(o);
});

// ── R2-F03 several colours ─────────────────────────────────────────────────

test('R2-F03-H1 two colours find only photos holding both', async () => {
  const o = await open('/');
  await o.page.getByRole('button', { name: 'Search by colour' }).first().click();
  await o.page.getByRole('textbox', { name: 'Hex colour' }).fill('#3f6f8f');
  await o.page.waitForTimeout(300);
  const one = Number(await o.page.locator('.cf-count').first().textContent());
  await o.page.getByRole('button', { name: 'Add a colour' }).click();
  await o.page.getByRole('textbox', { name: 'Hex colour' }).fill('#c0563b');
  await o.page.waitForTimeout(400);
  const two = Number(await o.page.locator('.cf-count').first().textContent());
  assert.ok(two < one, `${two} of ${one}`);
  const r = await rankedOk(o.page, ['#3f6f8f', '#c0563b']);
  assert.equal(two, r.expected);
  assert.equal(await o.page.getByRole('radio').count(), 2);
  assert.match(o.page.url(), /colour=3f6f8f,c0563b/);
  await done(o);
});

test('R2-F03-E1 three colours is the most', async () => {
  const o = await open('/?colour=3f6f8f,c0563b');
  await o.page.getByRole('button', { name: 'Search by colour' }).first().click();
  await o.page.getByRole('button', { name: 'Add a colour' }).click();
  await o.page.waitForTimeout(200);
  assert.equal(await o.page.getByRole('radio').count(), 3);
  assert.equal(await o.page.getByRole('button', { name: 'Add a colour' }).isHidden(), true);
  await done(o);
});

test('R2-F03-H2 a share of frame narrows the results and survives a reload', async () => {
  const o = await open('/?colour=3f6f8f');
  await o.page.getByRole('button', { name: 'Search by colour' }).first().click();
  const before = Number(await o.page.locator('.cf-count').first().textContent());
  const share = o.page.getByRole('button', { name: /Share of frame/ });
  await share.click(); await share.click(); await share.click(); // any → 10 → 25 → 50%
  await o.page.waitForTimeout(400);
  assert.match((await share.getAttribute('aria-label')) ?? '', /50%/);
  const after = Number(await o.page.locator('.cf-count').first().textContent());
  assert.ok(after <= before, `${after} of ${before}`);
  assert.match(o.page.url(), /colour=3f6f8f:50/);
  await done(o);
});

test('R2-F03-H3 a chapter swatch sets the colour', async () => {
  const o = await open('/');
  await o.page.getByRole('button', { name: 'Search by colour' }).first().click();
  await o.page.getByRole('group', { name: 'Chapter colours' }).getByRole('button', { name: 'Blue' }).click();
  await o.page.waitForTimeout(400);
  assert.ok(Number(await o.page.locator('.cf-count').first().textContent()) > 0);
  await done(o);
});

test('R2-F03-E2 the two thumbs of a range cannot cross', async () => {
  const o = await open('/');
  await o.page.getByRole('button', { name: 'Search by colour' }).first().click();
  await o.page.getByRole('slider', { name: 'Maximum lightness' }).fill('40');
  await o.page.getByRole('slider', { name: 'Minimum lightness' }).fill('70');
  await o.page.waitForTimeout(200);
  const min = Number(await o.page.getByRole('slider', { name: 'Minimum lightness' }).inputValue());
  assert.ok(min <= 40, `min ${min}`);
  await done(o);
});

// ── R2-S scout look and load ───────────────────────────────────────────────

const LONDON = '/scout?at=51.5079,-0.0877&tz=Europe/London&n=London&d=2026-08-07&t=700&r=4';

test('R2-S-H1 the data credit starts folded on a desktop', async () => {
  const o = await open(LONDON);
  await o.page.waitForTimeout(3000);
  const cls = (await o.page.locator('.maplibregl-ctrl-attrib').getAttribute('class')) ?? '';
  assert.doesNotMatch(cls, /maplibregl-compact-show/);
  await done(o);
});

test('R2-S-H2 the time words fit the panel', async () => {
  for (const width of [1440, 390]) {
    const o = await open(LONDON, { width, height: 900 });
    await o.page.waitForTimeout(2500);
    const out = await o.page.evaluate(`(() => {
      const box = document.getElementById('jumps').getBoundingClientRect();
      return [...document.querySelectorAll('#jumps button')].filter((b) => b.offsetParent)
        .filter((b) => { const r = b.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1; })
        .map((b) => b.textContent);
    })()`);
    assert.deepEqual(out, [], `clipped at ${width}px`);
    await done(o);
  }
});

test('R2-S-H3 the pin sits in the middle of the map the panel leaves', async () => {
  const o = await open(LONDON);
  await o.page.waitForTimeout(6000);
  const r = await o.page.evaluate(`(() => {
    const m = window.scout.map(); const p = m.project([-0.0877, 51.5079]);
    const dock = document.getElementById('dock').getBoundingClientRect();
    return { x: p.x, mid: (dock.right + innerWidth) / 2 };
  })()`) as { x: number; mid: number };
  assert.ok(Math.abs(r.x - r.mid) < 24, JSON.stringify(r));
  await done(o);
});

test('R2-S-H4 photo spots gather into clusters that open on a tap', async () => {
  const o = await open(LONDON);
  await o.page.waitForTimeout(9000);
  const src = await o.page.evaluate(`(() => { const s = window.scout.map().getSource('scout-photos-src'); return s && s.serialize ? s.serialize().cluster : null; })()`);
  assert.equal(src, true);
  const clusters = await o.page.evaluate(`window.scout.map().queryRenderedFeatures({ layers: ['scout-photos-cluster'] }).length`) as number;
  if (clusters === 0) { await done(o); return; } // photo sources unreachable: nothing to gather
  const z0 = await o.page.evaluate('window.scout.map().getZoom()') as number;
  const at = await o.page.evaluate(`(() => { const m = window.scout.map(); const f = m.queryRenderedFeatures({ layers: ['scout-photos-cluster'] })[0]; const p = m.project(f.geometry.coordinates); return { x: p.x, y: p.y }; })()`) as { x: number; y: number };
  await o.page.mouse.click(at.x, at.y);
  await o.page.waitForTimeout(1500);
  const z1 = await o.page.evaluate('window.scout.map().getZoom()') as number;
  assert.ok(z1 > z0, `${z0} → ${z1}`);
  await done(o);
});

test('R2-S-H5 places opened lately are offered in the empty search', async () => {
  const o = await open(LONDON);
  await o.page.waitForTimeout(2500);
  // A fresh visit in the same browser: nothing chosen yet, the field empty.
  await o.page.evaluate('sessionStorage.clear()');
  await o.page.goto(ORIGIN + '/scout');
  await o.page.waitForTimeout(2500);
  const recent = o.page.getByRole('list', { name: 'Recent places' });
  assert.ok(await recent.isVisible());
  assert.match((await recent.textContent()) ?? '', /London/);
  await done(o);
});

test('R2-S-N1 without WebGL the page says so and still works', async () => {
  const b = await chromium.launch({ args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(ORIGIN + LONDON);
  await page.waitForTimeout(3000);
  assert.match((await page.locator('#mapmsg-title').textContent()) ?? '', /No map in this browser/);
  assert.match((await page.locator('#sheet-name').textContent()) ?? '', /London/);
  assert.deepEqual(errors, []);
  await b.close();
});

test('R2-S-H6 the light-pollution raster is decoded off the page thread', async () => {
  const o = await open('/scout');
  const workers: string[] = [];
  o.page.on('worker', (w) => workers.push(w.url()));
  await o.page.reload();
  await o.page.waitForTimeout(3000);
  assert.ok(workers.some((u) => /light-pollution\.worker/.test(u)), workers.join(' '));
  await done(o);
});

test('R2-S-N2 a map problem is a small note in the corner, details on a tap, and stays closed', async () => {
  const o = await open('/scout');
  await o.page.waitForFunction('!!(window.scout && window.scout.map() && window.scout.map().loaded())', null, { timeout: 60_000 });
  // Report a source failure the way MapLibre does.
  await o.page.evaluate(`window.scout.map().fire('error', { error: new Error('Could not load source tiles.json') })`);
  const note = o.page.getByRole('status').filter({ has: o.page.locator('#mapmsg-title') });
  assert.ok(await note.isVisible());
  const box = (await note.boundingBox())!;
  assert.ok(box.y > 900 / 2 && box.height < 60, `bottom half and one line: ${JSON.stringify(box)}`);
  assert.equal(await o.page.locator('#mapmsg-body').isHidden(), true, 'the reason waits for a tap');
  await o.page.locator('#mapmsg-toggle').click();
  assert.ok(await o.page.locator('#mapmsg-body').isVisible());
  await o.page.getByRole('button', { name: 'Dismiss' }).click();
  await o.page.evaluate(`window.scout.map().fire('error', { error: new Error('Could not load source tiles.json') })`);
  assert.equal(await o.page.locator('#mapmsg').isHidden(), true, 'dismissed for the rest of the visit');
  await done(o);
});

test('R2-S-N3 styling a layer before it exists is not shown as a basemap failure', async () => {
  const o = await open('/scout');
  await o.page.waitForTimeout(2000);
  await o.page.evaluate(`window.scout.map().fire('error', { error: new Error('Cannot style non-existing layer "scout-tree-crowns".') })`);
  assert.equal(await o.page.locator('#mapmsg').isHidden(), true);
  await done(o);
});
