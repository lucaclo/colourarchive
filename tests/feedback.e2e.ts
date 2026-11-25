/**
 * End-to-end checks for the feedback sheet (components/Feedback.astro), on a
 * page the Mac serves. Run against `astro dev` on a throwaway archive:
 *
 *   E2E_ORIGIN=http://localhost:4460 E2E_DATA=<throwaway data dir> \
 *     node --import tsx --test tests/feedback.e2e.ts
 *
 * One test sends for real to the throwaway server and reads what it kept in
 * E2E_DATA (skipped without it); the rest answer /api/feedback here. The
 * published site's GitHub path runs when E2E_STATIC_ORIGIN points at a
 * server started with PUBLIC_STATIC=true; GitHub is always answered here.
 *
 * Strings, not functions, for anything run in the page (tsx's `__name`).
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices, type Browser, type BrowserContextOptions, type Page } from 'playwright';
import sharp from 'sharp';

const ORIGIN = process.env.E2E_ORIGIN ?? 'https://localhost:4400';
const DATA = process.env.E2E_DATA ?? '';
const STATIC_ORIGIN = process.env.E2E_STATIC_ORIGIN ?? '';
let browser: Browser;

// Small real pictures, made once (sharp is already a dependency).
let PNG: Buffer;
let JPEG: Buffer;
const png = (name = 'shot.png') => ({ name, mimeType: 'image/png', buffer: PNG });

before(async () => {
  const swatch = sharp({ create: { width: 48, height: 32, channels: 3, background: '#c4572e' } });
  PNG = await swatch.clone().png().toBuffer();
  JPEG = await swatch.clone().jpeg().toBuffer();
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });
afterEach(async () => {
  for (const c of browser?.contexts() ?? []) await c.close().catch(() => {});
});

interface Opened {
  page: Page;
  posts: { path: string; form: string }[];
  problems: string[];
}

/** A page, with /api/feedback answered by `answer` (or sent through when 'real'). */
async function open(
  urlPath: string,
  opts: {
    origin?: string;
    context?: BrowserContextOptions;
    answer?: number | 'real';
    github?: (url: string, method: string) => number;
    /** Run in the page before its own scripts (a token already saved). */
    init?: string;
  } = {},
): Promise<Opened> {
  const origin = opts.origin ?? ORIGIN;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, serviceWorkers: 'block', ...opts.context });
  if (opts.init) await ctx.addInitScript(opts.init);
  const posts: Opened['posts'] = [];
  await ctx.route(`${origin}/api/**`, async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
    posts.push({ path: p, form: req.postDataBuffer()?.toString('latin1') ?? '' });
    if (p === '/api/feedback' && opts.answer === 'real') return route.continue();
    if (p === '/api/feedback') {
      const status = typeof opts.answer === 'number' ? opts.answer : 201;
      return route.fulfill({ status, json: status < 300 ? { ok: true, id: '2026-11-25-0900-abcd' } : { ok: false, error: 'Couldn’t save' } });
    }
    if (p === '/api/feedback/capture') return route.fulfill({ status: 409, body: '' });
    // Nothing else may write (the device beacon, the updater).
    return route.fulfill({ status: 204, body: '' });
  });
  await ctx.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    posts.push({ path: `${req.method()} ${new URL(req.url()).pathname}`, form: req.postData() ?? '' });
    const status = opts.github?.(req.url(), req.method()) ?? 200;
    const isIssue = req.method() === 'POST' && req.url().endsWith('/issues');
    return route.fulfill({
      status,
      headers: { 'access-control-allow-origin': '*' },
      json: isIssue ? { number: 9, html_url: 'https://github.com/o/r/issues/9' } : {},
    });
  });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ServiceWorker|status of 4\d\d|status of 5\d\d/i.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  await page.goto(origin + urlPath, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important} astro-dev-toolbar{display:none!important}' });
  return { page, posts, problems };
}

const sheetOpen = (page: Page) => page.evaluate("document.getElementById('feedback').open");

test('the bubble opens the sheet; a picture and a note send to the Mac', async () => {
  const { page, posts, problems } = await open('/scout?at=51.5,-0.08');
  const bubble = page.locator('#tabbar [data-feedback-open]');
  assert.ok(await bubble.isVisible(), 'bubble in the tab bar');
  await bubble.click();
  assert.equal(await sheetOpen(page), true);
  assert.equal(await page.locator('#fb-where').textContent(), 'Scout');
  assert.ok(await page.locator('#fb-send').isDisabled(), 'nothing to send yet');
  await page.locator('#fb-file').setInputFiles(png());
  await page.locator('.fb-pic img').waitFor();
  await page.locator('#fb-note').fill('The sun ring is hard to grab');
  await page.locator('#fb-send').click();
  await page.waitForFunction("!document.getElementById('feedback').open");
  await page.locator('.offline-pill', { hasText: 'Sent' }).waitFor();
  const sent = posts.find((p) => p.path === '/api/feedback');
  assert.ok(sent, 'posted');
  assert.match(sent.form, /name="note"\r\n\r\nThe sun ring is hard to grab/);
  // Scout writes its own state into the address; the page is sent as it stands.
  assert.match(sent.form, /name="page"\r\n\r\n\/scout\?at=51\.5%2C-0\.08/);
  assert.match(sent.form, /name="device"\r\n\r\nMac/);
  assert.match(sent.form, /name="image"; filename="1\.png"/);
  // Sent means cleared: opening again starts blank.
  await bubble.click();
  assert.equal(await page.locator('#fb-note').inputValue(), '');
  assert.equal(await page.locator('.fb-pic').count(), 0);
  assert.deepEqual(problems, []);
});

test('sends for real and the Mac keeps the note beside its picture', { skip: !DATA && 'needs E2E_DATA' }, async () => {
  const dir = path.join(DATA, '.archive', 'feedback');
  const before = new Set(await fs.readdir(dir).catch(() => []));
  const { page } = await open('/inspiration', { answer: 'real' });
  await page.locator('#tabbar [data-feedback-open]').click();
  await page.locator('#fb-file').setInputFiles([png('a.png'), { name: 'b.jpg', mimeType: 'image/jpeg', buffer: JPEG }]);
  await page.locator('.fb-pic:nth-of-type(2) img').waitFor();
  await page.locator('#fb-note').fill('Board titles overlap\non the iPad');
  await page.keyboard.press('Meta+Enter');
  await page.locator('.offline-pill', { hasText: 'Sent' }).waitFor();
  const added = (await fs.readdir(dir)).filter((n) => !before.has(n) && n !== 'done');
  assert.equal(added.length, 1);
  const folder = path.join(dir, added[0]);
  assert.deepEqual((await fs.readdir(folder)).sort(), ['1.png', '2.jpg', 'note.md']);
  const md = await fs.readFile(path.join(folder, 'note.md'), 'utf8');
  assert.match(md, /^page: \/inspiration$/m);
  assert.match(md, /^viewport: 1440×900 @1x$/m);
  assert.match(md, /\n\nBoard titles overlap\non the iPad\n$/);
  await fs.rm(folder, { recursive: true });
});

test('⌘K and #feedback open it; the hash goes', async () => {
  const { page } = await open('/');
  await page.keyboard.press('Meta+k');
  await page.locator('#cmdk-input').fill('feedback');
  await page.keyboard.press('Enter');
  await page.waitForFunction("document.getElementById('feedback').open");
  assert.equal(await page.locator('#fb-where').textContent(), 'Archive');
  await page.keyboard.press('Escape');
  assert.equal(await sheetOpen(page), false);
  await page.evaluate("location.hash = 'feedback'");
  await page.waitForFunction("document.getElementById('feedback').open");
  assert.equal(await page.evaluate('location.hash'), '');
});

test('paste adds a picture, × removes it, and four is the most', async () => {
  const { page } = await open('/');
  await page.locator('#tabbar [data-feedback-open]').click();
  await page.evaluate(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(PNG.toString('base64'))}), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'clip.png', { type: 'image/png' }));
    document.getElementById('fb-note').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  await page.locator('.fb-pic img').waitFor();
  assert.ok(await page.locator('#fb-send').isEnabled(), 'a picture alone can be sent');
  await page.locator('.fb-pic-x').click();
  assert.equal(await page.locator('.fb-pic').count(), 0);
  assert.ok(await page.locator('#fb-send').isDisabled());
  await page.locator('#fb-file').setInputFiles([png('1.png'), png('2.png'), png('3.png'), png('4.png'), png('5.png')]);
  await page.waitForFunction("document.querySelectorAll('.fb-pic').length === 4");
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.fb-pic').count(), 4);
  assert.equal(await page.locator('#fb-add').isVisible(), false, 'no Add once there are four');
});

test('a failed send keeps the note and pictures and says why on a tap', async () => {
  const { page } = await open('/', { answer: 500 });
  await page.locator('#tabbar [data-feedback-open]').click();
  await page.locator('#fb-file').setInputFiles(png());
  await page.locator('#fb-note').fill('Keep me');
  await page.locator('#fb-send').click();
  await page.locator('#fb-err-title', { hasText: 'Couldn’t send' }).waitFor();
  assert.equal(await sheetOpen(page), true);
  assert.equal(await page.locator('#fb-note').inputValue(), 'Keep me');
  assert.equal(await page.locator('.fb-pic').count(), 1);
  assert.equal(await page.locator('#fb-err-why').isVisible(), false);
  await page.locator('#fb-err-title').click();
  assert.equal(await page.locator('#fb-err-why').textContent(), 'Couldn’t save');
  // Closed without sending, the draft waits for next time.
  await page.locator('#fb-close').click();
  await page.locator('#tabbar [data-feedback-open]').click();
  assert.equal(await page.locator('#fb-note').inputValue(), 'Keep me');
});

test('while sending nothing can change, so what was sent is what clears', async () => {
  const { page } = await open('/');
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  await page.context().route(`${ORIGIN}/api/feedback`, async (route) => {
    await held;
    await route.fulfill({ status: 201, json: { ok: true, id: '2026-11-25-0900-abcd' } });
  });
  await page.locator('#tabbar [data-feedback-open]').click();
  await page.locator('#fb-file').setInputFiles(png());
  await page.locator('#fb-note').fill('Sent words');
  await page.locator('#fb-send').click();
  await page.locator('#fb-send', { hasText: 'Sending' }).waitFor();
  assert.equal(await page.locator('#fb-note').getAttribute('readonly'), '');
  assert.ok(await page.locator('#fb-add').isDisabled());
  assert.ok(await page.locator('.fb-pic-x').isDisabled());
  release();
  await page.locator('.offline-pill', { hasText: 'Sent' }).waitFor();
  assert.equal(await page.locator('#fb-note').getAttribute('readonly'), null);
});

test('in the Mac app the sheet starts with a picture of the window', async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const ua = `${await (await ctx.newPage()).evaluate('navigator.userAgent')} ColourArchiveMac/0.2.13`;
  await ctx.close();
  const { page, posts } = await open('/', { context: { userAgent: ua } });
  await page.context().route(`${ORIGIN}/api/feedback/capture`, (route) => {
    posts.push({ path: '/api/feedback/capture', form: '' });
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPEG });
  });
  await page.locator('#tabbar [data-feedback-open]').click();
  await page.waitForFunction("document.getElementById('feedback').open");
  assert.equal(await page.locator('.fb-pic').count(), 1);
  assert.ok(posts.some((p) => p.path === '/api/feedback/capture'));
  // Removed, it doesn't come back while the sheet is open; a draft with a picture isn't captured again.
  await page.locator('#fb-note').fill('x');
  await page.locator('#fb-close').click();
  await page.locator('#tabbar [data-feedback-open]').click();
  assert.equal(posts.filter((p) => p.path === '/api/feedback/capture').length, 1);
});

test('the phone: the bubble fits beside the tabs, even at 375 px, and Add opens the picker', async () => {
  for (const width of [375, 402]) {
    const { page } = await open('/', { context: { ...devices['iPhone 16 Pro'], viewport: { width, height: 800 } } });
    const bar = await page.locator('#tabbar').boundingBox();
    const bubble = await page.locator('#tabbar [data-feedback-open]').boundingBox();
    assert.ok(bar && bubble);
    assert.ok(bar.x >= 8 && bar.x + bar.width <= width - 8, `tab bar inside ${width} px (${bar.x}–${bar.x + bar.width})`);
    assert.ok(bubble.width >= 36 && bubble.height >= 36, 'bubble target');
    await page.context().close();
  }
  const { page } = await open('/', { context: { ...devices['iPhone 16 Pro'] } });
  await page.locator('#tabbar [data-feedback-open]').tap();
  await page.waitForFunction("document.getElementById('feedback').open");
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#fb-add').tap();
  const fc = await chooser;
  assert.ok(fc.isMultiple());
  // Touch: focus stays off the note, so the keyboard doesn't cover the sheet.
  assert.notEqual(await page.evaluate('document.activeElement?.id'), 'fb-note');
});

// --- The published site (PUBLIC_STATIC=true): GitHub, with this device's token ----------

test('published: no bubble for a visitor; #feedback asks for a token, then files an issue', { skip: !STATIC_ORIGIN && 'needs E2E_STATIC_ORIGIN' }, async () => {
  const { page, posts } = await open('/', { origin: STATIC_ORIGIN });
  assert.equal(await page.locator('#tabbar [data-feedback-open]').isVisible(), false, 'hidden from visitors');
  await page.evaluate("location.hash = 'feedback'");
  await page.waitForFunction("document.getElementById('feedback').open");
  assert.ok(await page.locator('#fb-setup').isVisible());
  assert.match((await page.locator('#fb-setup a').getAttribute('href')) ?? '', /personal-access-tokens\/new\?.*issues=write/);
  await page.locator('#fb-token').fill('github_pat_test');
  await page.locator('#fb-save').click();
  await page.locator('#fb-compose').waitFor();
  assert.ok(await page.locator('#tabbar [data-feedback-open]').isVisible(), 'bubble once the device has a token');
  await page.locator('#fb-file').setInputFiles(png());
  await page.locator('#fb-note').fill('Phone: chapter count wraps');
  await page.locator('#fb-send').click();
  await page.locator('.offline-pill', { hasText: 'Sent' }).waitFor();
  const calls = posts.filter((p) => p.path.includes('/repos/')).map((p) => p.path);
  assert.equal(calls[0], 'GET /repos/lucaclo/colourarchive-feedback');
  assert.match(calls[1], /^PUT \/repos\/lucaclo\/colourarchive-feedback\/contents\/shots\/\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}-1\.png$/);
  assert.equal(calls[2], 'POST /repos/lucaclo/colourarchive-feedback/issues');
  const issue = JSON.parse(posts.find((p) => p.path.endsWith('/issues'))!.form);
  assert.equal(issue.title, 'Phone: chapter count wraps');
  assert.ok(!posts.some((p) => p.path === '/api/feedback'), 'nothing to a server that isn’t there');
  // The token stays: a reload shows the bubble straight away.
  await page.reload();
  await page.waitForTimeout(600);
  assert.ok(await page.locator('#tabbar [data-feedback-open]').isVisible());
});

test('published: a refused token asks for a new one and keeps the draft', { skip: !STATIC_ORIGIN && 'needs E2E_STATIC_ORIGIN' }, async () => {
  const { page } = await open('/', {
    origin: STATIC_ORIGIN,
    github: (url, method) => (method === 'POST' || method === 'PUT' ? 401 : 200),
    init: "if (!sessionStorage.getItem('seeded')) { localStorage.setItem('ca-feedback-token', 'github_pat_old'); sessionStorage.setItem('seeded', '1'); }",
  });
  assert.ok(await page.locator('#tabbar [data-feedback-open]').isVisible(), 'a device with a token has the bubble');
  await page.evaluate("location.hash = 'feedback'");
  await page.waitForFunction("document.getElementById('feedback').open");
  await page.locator('#fb-note').fill('Still here');
  await page.locator('#fb-send').click();
  await page.locator('#fb-setup').waitFor();
  await page.locator('#fb-err-title').click();
  assert.equal(await page.locator('#fb-err-why').textContent(), 'GitHub didn’t accept the token');
  assert.equal(await page.evaluate("localStorage.getItem('ca-feedback-token')"), null);
  await page.locator('#fb-token').fill('github_pat_new');
  await page.locator('#fb-save').click();
  await page.locator('#fb-compose').waitFor();
  assert.equal(await page.locator('#fb-note').inputValue(), 'Still here');
});
