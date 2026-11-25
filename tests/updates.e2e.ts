/**
 * End-to-end checks for the Updates panel (components/Updates.astro). Runs
 * against `astro dev` on a throwaway archive, like the other e2e files:
 *
 *   E2E_ORIGIN=http://localhost:4400 node --import tsx --test tests/updates.e2e.ts
 *
 * GET /api/updates is answered by a route mock per test (the Mac app's
 * updater exists only inside the app), and every other request to /api that
 * isn't a GET is answered here and recorded, never sent: a check or an
 * install must not reach a real Mac app, and the device beacon must not
 * write the archive's devices.json.
 *
 * The Mac app is stood in for by its user agent (desktop/main.cjs appends
 * `ColourArchiveMac/<version>`). Strings, not functions, for anything run in
 * the page: see tests/scout.smoke.ts about tsx's `__name` helper.
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices, type Browser, type BrowserContextOptions, type Page } from 'playwright';
import { whenLabel } from '../src/lib/updates';

const ORIGIN = process.env.E2E_ORIGIN ?? 'https://localhost:4321';
const TZ = 'Europe/London';
/** A date as the panel writes it in TZ ("18 Nov, 20:20"). */
const when = (iso: string) => whenLabel(iso, new Date(), TZ);
let browser: Browser;
let MAC_APP_UA = '';
/** What this server serves now (/api/build): a reply with this build is "Up to date". */
let BUILD = { version: '', builtAt: '' };

before(async () => {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  MAC_APP_UA = `${await page.evaluate('navigator.userAgent')} ColourArchiveMac/0.2.9`;
  const res = await ctx.request.get(`${ORIGIN}/api/build`);
  BUILD = await res.json();
  await ctx.close();
});
after(async () => { await browser?.close(); });
afterEach(async () => {
  for (const c of browser?.contexts() ?? []) await c.close().catch(() => {});
});

type AppState = 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error' | 'cannot-install' | 'source';
const appStatus = (state: AppState, extra: Record<string, unknown> = {}) => ({
  state,
  current: '0.2.9',
  latest: null,
  error: null,
  installedIn: '/Applications/Colour Archive.app',
  updatedAt: '2026-11-18T20:20:00Z',
  pending: false,
  ...extra,
});
const replyWith = (extra: Record<string, unknown> = {}) => ({ build: { ...BUILD }, app: null, published: null, devices: [], ...extra });

interface Opened {
  page: Page;
  posts: { path: string; body: Record<string, unknown> }[];
  gets: () => number;
  setReply: (r: object) => void;
  problems: string[];
  warnings: string[];
}

async function open(path: string, opts: { reply?: object; context?: BrowserContextOptions; sw?: boolean } = {}): Promise<Opened> {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: TZ,
    ignoreHTTPSErrors: true,
    serviceWorkers: opts.sw ? 'allow' : 'block',
    ...opts.context,
  });
  let reply: object = opts.reply ?? replyWith();
  let gets = 0;
  const posts: Opened['posts'] = [];
  await ctx.route(`${ORIGIN}/api/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'GET' && url.pathname === '/api/updates') {
      gets++;
      return route.fulfill({ json: reply, headers: { 'cache-control': 'no-store' } });
    }
    if (req.method() !== 'GET' && req.method() !== 'HEAD') {
      let body: Record<string, unknown> = {};
      try {
        body = req.postDataJSON() ?? {};
      } catch {
        /* not JSON */
      }
      posts.push({ path: url.pathname, body });
      return route.fulfill({ status: url.pathname === '/api/devices' ? 204 : 202, body: url.pathname === '/api/devices' ? '' : '{"ok":true}' });
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  const problems: string[] = [];
  const warnings: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
    // The throwaway archive has no derivatives, so its photographs 404.
    if (m.type() === 'error' && !/Failed to load resource|ServiceWorker/i.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important} astro-dev-toolbar{display:none!important}' });
  return { page, posts, gets: () => gets, setReply: (r) => { reply = r; }, problems, warnings };
}

type Panel = { open: boolean; sections: { title: string; rows: string[]; actions: string[] }[] };
const READ = `(() => {
  const d = document.getElementById('updates');
  return {
    open: d.open && !d.hidden,
    sections: [...d.querySelectorAll('.updates-sec')].map((s) => ({
      title: s.querySelector('.updates-sec-title').textContent,
      rows: [...s.querySelectorAll('.updates-row')].map((r) => [...r.children].map((c) => c.textContent).join(' | ')),
      actions: [...s.querySelectorAll('.updates-actions .btn')].map((b) => b.textContent + (b.disabled ? ' (disabled)' : '')),
    })),
  };
})()`;
const read = (page: Page) => page.evaluate(READ) as Promise<Panel>;
/** Wait until the panel's first section is titled `title`, then read it. */
async function panelWith(page: Page, title: string): Promise<Panel> {
  await page.waitForFunction(`document.querySelector('#updates .updates-sec-title')?.textContent === ${JSON.stringify(title)}`, null, { timeout: 8000 });
  return read(page);
}
const posted = (o: Opened, path: string) => o.posts.filter((p) => p.path === path);

// ── The Mac app's window ────────────────────────────────────────────────────

test('the Mac app: This Mac, up to date, with Check; opening asks the Mac to check once', async () => {
  const o = await open('/#updates', { context: { userAgent: MAC_APP_UA }, reply: replyWith({ app: appStatus('up-to-date') }) });
  const p = await panelWith(o.page, 'This Mac');
  assert.equal(p.open, true);
  assert.deepEqual(p.sections[0].rows, ['Version | 0.2.9', 'Status |  | Up to date', 'Installed in | /Applications | Show in Finder', `Updated | ${when('2026-11-18T20:20:00Z')}`]);
  assert.deepEqual(p.sections[0].actions, ['Check']);
  assert.equal(await o.page.evaluate('location.hash'), '');
  await o.page.waitForTimeout(400);
  assert.deepEqual(posted(o, '/api/updates').map((x) => x.body), [{ do: 'check' }]);
  // Show in Finder asks the Mac; the full path is the value's title.
  assert.equal(await o.page.locator('.updates-row', { hasText: 'Installed in' }).locator('.updates-value').getAttribute('title'), '/Applications/Colour Archive.app');
  await o.page.getByRole('button', { name: 'Show in Finder' }).click();
  await o.page.waitForTimeout(300);
  assert.deepEqual(posted(o, '/api/updates').map((x) => x.body), [{ do: 'check' }, { do: 'reveal' }]);
  assert.deepEqual(o.problems, []);
});

test('the Mac app: downloading shows Update now; pressing it asks to install with this page and shows Updating…', async () => {
  const o = await open('/get?via=updates', { context: { userAgent: MAC_APP_UA }, reply: replyWith({ app: appStatus('downloading', { latest: '0.2.10' }) }) });
  await o.page.evaluate(`location.hash = 'updates'`);
  const p = await panelWith(o.page, 'This Mac');
  assert.ok(p.sections[0].rows.includes('Status |  | Downloading 0.2.10…'));
  assert.deepEqual(p.sections[0].actions, ['Update now']);
  assert.equal(await o.page.locator('#updates .btn', { hasText: 'Update now' }).getAttribute('class'), 'btn btn-primary');
  assert.equal(posted(o, '/api/updates').length, 0, 'no check while downloading');
  await o.page.getByRole('button', { name: 'Update now' }).click();
  await o.page.waitForFunction(`document.querySelector('#updates .updates-actions .btn')?.textContent === 'Updating…'`);
  assert.deepEqual(posted(o, '/api/updates').map((x) => x.body), [{ do: 'install', page: '/get?via=updates' }]);
  assert.equal(await o.page.locator('#updates .btn', { hasText: 'Updating…' }).isDisabled(), true);
  // The Mac then says it is waiting for the download: still Updating….
  o.setReply(replyWith({ app: appStatus('downloading', { latest: '0.2.10', pending: true }) }));
  await o.page.waitForTimeout(1800);
  assert.deepEqual((await read(o.page)).sections[0].actions, ['Updating… (disabled)']);
  assert.deepEqual(o.problems, []);
});

test('the Mac app: pending shows Updating…, disabled', async () => {
  const o = await open('/#updates', { context: { userAgent: MAC_APP_UA }, reply: replyWith({ app: appStatus('ready', { latest: '0.2.10', pending: true }) }) });
  const p = await panelWith(o.page, 'This Mac');
  assert.ok(p.sections[0].rows.includes('Status |  | 0.2.10 ready'));
  assert.deepEqual(p.sections[0].actions, ['Updating… (disabled)']);
  assert.deepEqual(o.problems, []);
});

test('the Mac app: cannot install says Move to Applications to update, with no action', async () => {
  const o = await open('/#updates', {
    context: { userAgent: MAC_APP_UA },
    reply: replyWith({ app: appStatus('cannot-install', { installedIn: '/Users/someone/Downloads/Colour Archive.app' }) }),
  });
  const p = await panelWith(o.page, 'This Mac');
  assert.ok(p.sections[0].rows.includes('Status |  | Move to Applications to update'));
  assert.ok(p.sections[0].rows.includes('Installed in | ~/Downloads | Show in Finder'));
  assert.deepEqual(p.sections[0].actions, []);
  assert.equal(posted(o, '/api/updates').length, 0, 'nothing to check');
  assert.deepEqual(o.problems, []);
});

test('the Mac app: an error says Couldn’t check, offers Check, and keeps the reason for the console', async () => {
  const o = await open('/#updates', { context: { userAgent: MAC_APP_UA }, reply: replyWith({ app: appStatus('error', { error: 'getaddrinfo ENOTFOUND github.com' }) }) });
  const p = await panelWith(o.page, 'This Mac');
  assert.ok(p.sections[0].rows.includes('Status |  | Couldn’t check'));
  assert.deepEqual(p.sections[0].actions, ['Check']);
  assert.doesNotMatch(await o.page.locator('#updates').innerText(), /ENOTFOUND/);
  assert.ok(o.warnings.some((w) => w.includes('ENOTFOUND')), 'the raw error goes to console.warn');
  assert.deepEqual(o.problems, []);
});

test('the panel stops asking once it is closed', async () => {
  const o = await open('/#updates', { context: { userAgent: MAC_APP_UA }, reply: replyWith({ app: appStatus('downloading', { latest: '0.2.10' }) }) });
  await panelWith(o.page, 'This Mac');
  await o.page.waitForTimeout(1700);
  assert.ok(o.gets() >= 2, `polls while downloading (${o.gets()} asks)`);
  await o.page.keyboard.press('Escape');
  assert.equal((await read(o.page)).open, false);
  const after = o.gets();
  await o.page.waitForTimeout(3500);
  assert.equal(o.gets(), after, 'no asks while closed');
});

// ── Other pages the Mac serves ──────────────────────────────────────────────

test('a phone: This iPhone with its page and Reload, then the Mac, then Phones and iPads', async () => {
  const o = await open('/#updates', {
    context: { ...devices['iPhone 13'] },
    reply: replyWith({
      build: { version: BUILD.version, builtAt: '2030-01-01T00:00:00.000Z' },
      app: appStatus('ready', { latest: '0.2.10' }),
      published: { builtAt: '2026-11-18T20:20:00Z', count: 110, behind: true },
      devices: [{ name: 'iPad', standalone: true, seenAt: '2026-11-18T09:12:00Z', current: false }],
    }),
  });
  const p = await panelWith(o.page, 'This iPhone');
  assert.deepEqual(p.sections.map((s) => s.title), ['This iPhone', 'Mac', 'Phones and iPads']);
  assert.deepEqual(p.sections[0].rows, [`Page | ${BUILD.version} | Newer page`]);
  assert.deepEqual(p.sections[0].actions, ['Reload']);
  assert.ok(p.sections[1].rows.includes('Status |  | 0.2.10 ready'));
  assert.ok(!p.sections[1].rows.some((r) => r.startsWith('Installed in')), 'where the app is only shows on the Mac');
  assert.deepEqual(p.sections[1].actions, ['Update now']);
  assert.deepEqual(p.sections[2].rows, [`Published | ${when('2026-11-18T20:20:00Z')} | Behind`, `iPad | ${when('2026-11-18T09:12:00Z')} | Old page`]);
  assert.deepEqual(p.sections[2].actions, []);
  // The phone said which device it is.
  assert.equal(posted(o, '/api/devices')[0]?.body.name, 'iPhone');
  assert.deepEqual(o.problems, []);
});

test('#updates opens the panel and goes; #chapter= hashes are left alone', async () => {
  const o = await open('/#updates');
  assert.equal((await read(o.page)).open, true);
  assert.equal(await o.page.evaluate('location.hash'), '');
  await o.page.keyboard.press('Escape');
  await o.page.evaluate(`location.hash = '#chapter=Red'`);
  await o.page.waitForTimeout(400);
  assert.equal(await o.page.evaluate('location.hash'), '#chapter=Red');
  assert.equal((await read(o.page)).open, false);
  await o.page.evaluate(`location.hash = 'updates'`);
  await o.page.waitForFunction(`document.getElementById('updates').open`);
  assert.equal(await o.page.evaluate('location.hash'), '');
  assert.equal(await o.page.evaluate('location.pathname + location.search'), '/');
  assert.deepEqual(o.problems, []);
});

test('⌘K offers Updates on the Archive and on Scout', async () => {
  for (const path of ['/', '/scout?at=51.5079,-0.0877&tz=Europe/London&n=London']) {
    const o = await open(path);
    await o.page.keyboard.press('Control+k');
    await o.page.locator('#cmdk-input').fill('Updates');
    const items = await o.page.locator('#cmdk-list .cmdk-item').allTextContents();
    assert.ok(items.includes('Updates'), `${path}: ${items.join(', ')}`);
    await o.page.keyboard.press('Enter');
    await o.page.waitForFunction(`document.getElementById('updates').open`, null, { timeout: 5000 });
    await o.page.context().close();
  }
});

test('Reload drops the service worker and every saved copy, then loads the page fresh', async () => {
  const o = await open('/', { sw: true });
  const { page } = o;
  await page.evaluate(`navigator.serviceWorker.ready`);
  await page.evaluate(`caches.open('updates-probe').then((c) => c.put('/updates-probe', new Response('saved')))`);
  assert.ok(((await page.evaluate(`navigator.serviceWorker.getRegistrations().then((r) => r.length)`)) as number) >= 1);
  assert.ok(((await page.evaluate(`caches.keys()`)) as string[]).length >= 1);
  // After the reload the worker can't come back, so what is left is what Reload left.
  await page.context().route(`${ORIGIN}/sw.js`, (route) => route.fulfill({ status: 404, body: '' }));
  await page.evaluate(`window.__beforeReload = true; location.hash = 'updates'`);
  await page.getByRole('button', { name: 'Reload' }).click();
  await page.waitForFunction(`!window.__beforeReload && document.readyState === 'complete'`, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(`navigator.serviceWorker.getRegistrations().then((r) => r.length)`), 0);
  assert.equal(await page.evaluate(`navigator.serviceWorker.controller === null`), true);
  assert.deepEqual(await page.evaluate(`caches.keys()`), []);
  assert.deepEqual(o.problems.filter((m) => !/bad HTTP response code \(404\)/.test(m)), [], 'only the 404 this test serves for sw.js');
});

test('the beacon: once per load from a page the Mac serves, never from the Mac app', async () => {
  const o = await open('/');
  let beacons = posted(o, '/api/devices');
  assert.equal(beacons.length, 1);
  const first = beacons[0].body;
  assert.match(String(first.id), /^[0-9a-f]{32}$/);
  assert.deepEqual({ ...first, id: 'x' }, { id: 'x', name: 'Mac', standalone: false, builtAt: BUILD.builtAt });
  await o.page.reload({ waitUntil: 'load' });
  await o.page.waitForTimeout(800);
  beacons = posted(o, '/api/devices');
  assert.equal(beacons.length, 2);
  assert.equal(beacons[1].body.id, first.id, 'the same id across loads');

  const app = await open('/', { context: { userAgent: MAC_APP_UA } });
  await app.page.reload({ waitUntil: 'load' });
  await app.page.waitForTimeout(800);
  assert.equal(posted(app, '/api/devices').length, 0);
});

// ── Where the button is ─────────────────────────────────────────────────────

test('the Archive top bar has no Updates button: Get the app goes in the app window and stays in a tab', async () => {
  const actions = `[...document.querySelectorAll('#tb-actions > .tb-button')].map((b) => b.getAttribute('aria-label'))`;
  const app = await open('/', { context: { userAgent: MAC_APP_UA } });
  assert.deepEqual(await app.page.evaluate(actions), ['Overview', 'Insights']);
  assert.equal(await app.page.locator('#tb-actions [data-updates-open]').count(), 0);

  const tab = await open('/');
  assert.deepEqual(await tab.page.evaluate(actions), ['Overview', 'Get the app', 'Insights']);
  assert.deepEqual(app.problems, []);
  assert.deepEqual(tab.problems, []);
});

test('the Book head: Updates beside Share and Magazine opens the panel', async () => {
  const book = await open('/book', { context: { userAgent: MAC_APP_UA } });
  const labels = await book.page.evaluate(`[...document.querySelectorAll('.book-links .btn-label')].map((s) => s.textContent)`);
  assert.deepEqual(labels, ['Share', 'Magazine', 'Updates']);
  await book.page.locator('.book-links [data-updates-open]').click();
  await book.page.waitForFunction(`document.getElementById('updates').open`);
  assert.deepEqual(book.problems, []);
});
