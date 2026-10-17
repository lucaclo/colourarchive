/**
 * End-to-end checks for getting the app (/get and its two ways in). Runs
 * against `astro dev`, like the other e2e files:
 *
 *   node --import tsx --test tests/get.e2e.ts
 *
 * Chrome's real install prompt cannot be raised headless, so the one-tap path
 * is driven with a stand-in `beforeinstallprompt` carrying the same two
 * members the page uses. An app window is stood in for by a popup with no
 * toolbar, which is the property the page actually reads.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContextOptions, type Page } from 'playwright';

const ORIGIN = process.env.E2E_ORIGIN ?? 'https://localhost:4321';
let browser: Browser;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

const UA = {
  iphone26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphone18: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0',
};

// Strings, not functions, for anything run in the page: see the note in
// tests/scout.smoke.ts about tsx's `__name` helper.
const READ = `({
  state: document.getElementById('get').dataset.state,
  label: document.getElementById('get-btn-label').textContent,
  forLine: document.getElementById('get-for').textContent,
  steps: [...document.querySelectorAll('#get-steps li')].map((li) => li.textContent.trim()),
  stepsShown: !document.getElementById('get-steps').hidden,
  arrow: document.getElementById('get-arrow').hidden ? null : document.getElementById('get-arrow').dataset.at,
})`;
type Read = { state: string; label: string; forLine: string; steps: string[]; stepsShown: boolean; arrow: string | null };

async function open(path: string, opts: BrowserContextOptions = {}) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block', ...opts });
  const page = await ctx.newPage();
  const problems: string[] = [];
  watch(page, problems);
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.addStyleTag({ content: 'astro-dev-toolbar{display:none!important}' });
  return { page, ctx, problems };
}
function watch(page: Page, problems: string[]) {
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/SSL certificate|Failed to load resource/i.test(m.text())) problems.push(`console: ${m.text()}`);
  });
}
const read = (page: Page) => page.evaluate(READ) as Promise<Read>;

test('a Chrome tab with no prompt shows the Chrome steps', async () => {
  const { page, ctx, problems } = await open('/get');
  let r = await read(page);
  assert.equal(r.label, 'Install');
  assert.equal(r.forLine, 'For this computer');
  assert.equal(r.stepsShown, false, 'nothing below the button until it is pressed');
  await page.click('#get-btn');
  r = await read(page);
  assert.equal(r.steps.length, 3);
  assert.match(r.steps[0], /install icon in the address bar, or Open in app/);
  assert.equal(r.arrow, null, 'no arrow on a computer');
  await ctx.close();
  assert.deepEqual(problems, []);
});

for (const outcome of ['accepted', 'dismissed'] as const) {
  test(`one tap when Chrome offers to install (${outcome})`, async () => {
    const { page, ctx, problems } = await open('/get');
    await page.evaluate(`(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = async () => { window.__prompted = (window.__prompted || 0) + 1; };
      e.userChoice = Promise.resolve({ outcome: '${outcome}' });
      dispatchEvent(e);
    })()`);
    await page.click('#get-btn');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate('window.__prompted'), 1, 'the browser prompt was raised once');
    const r = await read(page);
    assert.equal(r.stepsShown, false, 'no steps when the browser did the work');
    if (outcome === 'accepted') {
      assert.equal(r.state, 'installed');
      assert.equal(r.label, 'Open in app', 'still in the tab, so it offers the app window');
      assert.equal(r.forLine, 'Installed');
    } else {
      assert.equal(r.label, 'Install');
    }
    await ctx.close();
    assert.deepEqual(problems, []);
  });
}

test('inside the app window it says so, even after a reload', async () => {
  // A real Chrome app window: Google Chrome in `--app` mode, which is what the
  // Desktop launcher opens and what an installed app's window reports itself
  // as. A popup is not a stand-in: Chromium forgets it is one on reload.
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ca-app-')), {
    channel: 'chrome', ignoreHTTPSErrors: true, serviceWorkers: 'block',
    args: [`--app=${ORIGIN}/get`, '--window-size=900,700'],
  });
  const problems: string[] = [];
  const win = ctx.pages()[0] ?? (await ctx.waitForEvent('page'));
  watch(win, problems);
  for (let i = 0; i < 2; i++) {
    if (i) await win.reload();
    await win.waitForLoadState('load');
    await win.waitForTimeout(600);
    const r = await read(win);
    assert.equal(r.state, 'installed');
    assert.equal(r.label, 'Open the archive');
    assert.equal(r.forLine, 'Installed');
  }
  await win.click('#get-btn');
  await win.waitForURL(ORIGIN + '/');
  await win.waitForTimeout(600);
  assert.equal(await win.locator('#get-app').count(), 0, 'no "Get the app" inside the app');
  await ctx.close();
  assert.deepEqual(problems, []);
});

test('the archive top bar and ⌘K both lead to /get', async () => {
  const { page, ctx, problems } = await open('/', { viewport: { width: 1280, height: 800 } });
  const link = page.locator('#get-app');
  assert.equal(await link.isVisible(), true);
  assert.equal(await link.getAttribute('href'), '/get');
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('install');
  await page.waitForTimeout(200);
  assert.match((await page.locator('#cmdk-list').textContent()) ?? '', /Get the app/);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await link.click();
  await page.waitForURL(ORIGIN + '/get');
  await ctx.close();
  assert.deepEqual(problems, []);
});

const PHONES: [string, BrowserContextOptions, Partial<Read>][] = [
  ['iPhone, Safari 26', { userAgent: UA.iphone26, viewport: { width: 393, height: 760 }, hasTouch: true, isMobile: true }, { forLine: 'For iPhone', arrow: 'bottom-right' }],
  ['iPhone, older Safari', { userAgent: UA.iphone18, viewport: { width: 393, height: 760 }, hasTouch: true, isMobile: true }, { forLine: 'For iPhone', arrow: 'bottom' }],
  ['iPad', { userAgent: UA.ipad, viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true }, { forLine: 'For iPad', arrow: 'top-right' }],
];
for (const [name, opts, want] of PHONES) {
  test(`${name}: three steps and an arrow at Share`, async () => {
    const { page, ctx, problems } = await open('/get', opts);
    await page.click('#get-btn');
    const r = await read(page);
    assert.equal(r.forLine, want.forLine);
    assert.equal(r.arrow, want.arrow);
    assert.match(r.steps.join(' | '), /Share.*Add to Home Screen.*Add/);
    await ctx.close();
    assert.deepEqual(problems, []);
  });
}

test('desktop Firefox is told where it can install, and gets the link', async () => {
  const { page, ctx, problems } = await open('/get', { userAgent: UA.firefox, permissions: ['clipboard-read', 'clipboard-write'] });
  assert.equal((await read(page)).label, 'Copy link');
  await page.click('#get-btn');
  await page.waitForFunction(`document.getElementById('get-btn-label').textContent !== 'Copy link'`, null, { timeout: 3000 });
  assert.equal((await read(page)).label, 'Link copied');
  assert.equal(await page.evaluate('navigator.clipboard.readText()'), ORIGIN + '/get');
  await ctx.close();
  assert.deepEqual(problems, []);
});

test('another device shows that device’s steps, without an arrow', async () => {
  const { page, ctx, problems } = await open('/get');
  await page.click('.get-other-list [data-path="mac-safari"]');
  const r = await read(page);
  assert.match(r.steps[0], /In Safari, open the File menu/);
  assert.equal(r.arrow, null);
  await ctx.close();
  assert.deepEqual(problems, []);
});

test('the manifest is valid and can open the app from a tab', async () => {
  const { page, ctx } = await open('/get');
  const res = await page.request.get(ORIGIN + '/site.webmanifest');
  const m = await res.json();
  assert.equal(m.display, 'standalone');
  assert.deepEqual(m.protocol_handlers, [{ protocol: 'web+colour', url: '/?open=%s' }]);
  assert.ok(m.icons.some((i: { sizes: string }) => i.sizes === '512x512'));
  await ctx.close();
});
