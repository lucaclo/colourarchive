/**
 * Round 13: the magazine (R13-42, and R13-41 / D2 in batch 6). Needs the throwaway
 * server; see tests/r13.ts.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { launch, open, shot, ORIGIN, DATA } from './r13';
import { freshDoc } from '../src/lib/zine/doc';
import { COVER_PANEL } from '../src/lib/zine/imposition';

let browser: Browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

test('R13-42 phone: the page row clears the tab bar at first view', async () => {
  const o = await open(browser, 'phone', '/book/zine', { wait: 2500 });
  try {
    const m = await o.page.evaluate(`(() => {
      const rail = document.querySelector('.zn-rail').getBoundingClientRect();
      const bar = document.getElementById('tabbar').getBoundingClientRect();
      return { railBottom: rail.bottom, barTop: bar.top };
    })()`) as { railBottom: number; barTop: number };
    assert.ok(m.railBottom <= m.barTop, `the row ends above the tab bar: ${JSON.stringify(m)}`);
    await shot(o.page, 'zine-phone-first-view');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

// ── R13-41 (D2): one zine, kept on the Mac ────────────────────────────────
// Each browser context is its own profile: its own localStorage and IndexedDB.

const zineFile = () => path.join(DATA, '.archive', 'zine.json');
const loaded = (page: Page) => page.waitForSelector('html[data-zine-loaded]', { timeout: 20_000 });
const titleField = 'input[data-text="cover.title"]';

test('R13-41 a zine from before moves to the Mac once, photo and all', async () => {
  assert.ok(DATA, 'E2E_DATA names the throwaway data folder');
  await fs.rm(zineFile(), { force: true });
  await fs.rm(`${zineFile()}.bak`, { force: true });
  await fs.rm(path.join(DATA, '.archive', 'zine'), { recursive: true, force: true });

  const old = freshDoc();
  old.cover.title = 'Moved across';
  old.pages[COVER_PANEL].photo = { kind: 'local', id: 'local-1-seed', thumb: '', full: '', w: 40, h: 30, panX: 0, panY: 0 };
  const o = await open(browser, 'desk', '/api/zine', { wait: 100 });
  try {
    // The old storage, as a browser from before round 13 has it.
    await o.page.evaluate(`(async () => {
      localStorage.setItem('zine:doc:v1', ${JSON.stringify(JSON.stringify(old))});
      const c = document.createElement('canvas'); c.width = 40; c.height = 30;
      const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 40, 30);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      await new Promise((res, rej) => {
        const req = indexedDB.open('colour-archive-zine', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('files');
        req.onerror = () => rej(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction('files', 'readwrite');
          tx.objectStore('files').put(blob, 'local-1-seed');
          tx.oncomplete = () => { req.result.close(); res(); };
          tx.onerror = () => rej(tx.error);
        };
      });
    })()`);
    await o.page.goto(ORIGIN + '/book/zine', { waitUntil: 'load' });
    await loaded(o.page);
    const saved = JSON.parse(await fs.readFile(zineFile(), 'utf8'));
    assert.equal(saved.cover.title, 'Moved across');
    assert.equal(saved.pages[COVER_PANEL].photo.id, 'local-1-seed');
    assert.equal(saved.pages[COVER_PANEL].photo.thumb, '', 'a device photo is saved by key, not by a blob URL');
    await fs.access(path.join(DATA, '.archive', 'zine', 'local-1-seed.jpg'));
    const left = await o.page.evaluate(`[localStorage.getItem('zine:doc:v1'), !!localStorage.getItem('zine:doc:v1:moved')]`);
    assert.deepEqual(left, [null, true], 'moved once: the old copy is set aside');
    assert.equal(await o.page.locator(titleField).inputValue(), 'Moved across');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

test('R13-41 a title typed in one profile shows in another after reload', async () => {
  const a = await open(browser, 'desk', '/book/zine');
  const b = await open(browser, 'ipad', '/book/zine');
  try {
    await Promise.all([loaded(a.page), loaded(b.page)]);
    assert.equal(await b.page.locator(titleField).inputValue(), 'Moved across', 'a new profile opens the Mac’s zine');
    const photo = await b.page.evaluate(`fetch('/api/zine/photo/local-1-seed').then((r) => [r.status, r.headers.get('content-type')])`);
    assert.deepEqual(photo, [200, 'image/jpeg']);

    const saved = a.page.waitForResponse((r) => r.url().endsWith('/api/zine') && r.request().method() === 'POST');
    await a.page.locator(titleField).fill('Seaside, November');
    assert.equal((await saved).status(), 200);
    await b.page.reload({ waitUntil: 'load' });
    await loaded(b.page);
    assert.equal(await b.page.locator(titleField).inputValue(), 'Seaside, November');

    // A tab that fell behind is told, and writes nothing over the newer zine.
    const refused = a.page.waitForResponse((r) => r.url().endsWith('/api/zine') && r.request().method() === 'POST');
    await b.page.locator(titleField).fill('From the iPad');
    await b.page.waitForResponse((r) => r.url().endsWith('/api/zine') && r.request().method() === 'POST');
    await a.page.locator(titleField).fill('Stale tab');
    assert.equal((await refused).status(), 409);
    await a.page.waitForSelector('#zn-savenote:not([hidden])');
    assert.match((await a.page.locator('#zn-savenote').textContent()) ?? '', /Changed elsewhere/);
    await shot(a.page, 'zine-changed-elsewhere');
    assert.equal(JSON.parse(await fs.readFile(zineFile(), 'utf8')).cover.title, 'From the iPad');
    assert.deepEqual([...a.problems, ...b.problems], []);
  } finally {
    await a.ctx.close();
    await b.ctx.close();
  }
});

/** A browser from before round 13: its zine in localStorage, and `photo` (if named) in IndexedDB. */
async function seedOldZine(page: Page, title: string, photo?: string) {
  const old = freshDoc();
  old.cover.title = title;
  if (photo) old.pages[COVER_PANEL].photo = { kind: 'local', id: photo, thumb: '', full: '', w: 40, h: 30, panX: 0, panY: 0 };
  await page.evaluate(`(async () => {
    localStorage.setItem('zine:doc:v1', ${JSON.stringify(JSON.stringify(old))});
    if (!${JSON.stringify(photo ?? '')}) return;
    const c = document.createElement('canvas'); c.width = 40; c.height = 30;
    c.getContext('2d').fillRect(0, 0, 40, 30);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    await new Promise((res, rej) => {
      const req = indexedDB.open('colour-archive-zine', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onerror = () => rej(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction('files', 'readwrite');
        tx.objectStore('files').put(blob, ${JSON.stringify(photo ?? '')});
        tx.oncomplete = () => { req.result.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
    });
  })()`);
}

const exists = (file: string) => fs.access(file).then(() => true, () => false);

test('R13-41 a move that fails saves nothing over it, says so, and moves on the next visit', async () => {
  await fs.rm(zineFile(), { force: true });
  await fs.rm(`${zineFile()}.bak`, { force: true });
  const o = await open(browser, 'desk', '/api/zine', { wait: 100 });
  try {
    await seedOldZine(o.page, 'Old A', 'local-2-fails');
    await o.page.route('**/api/zine/photo/**', (route) => route.fulfill({ status: 500, body: '' }));
    const posts: number[] = [];
    o.page.on('request', (r) => { if (r.url().endsWith('/api/zine') && r.method() === 'POST') posts.push(1); });
    await o.page.goto(ORIGIN + '/book/zine', { waitUntil: 'load' });
    await loaded(o.page);
    assert.equal(await o.page.locator('#zn-savenote-text').textContent(), 'Not moved to the Mac');
    assert.equal(await o.page.locator(titleField).inputValue(), 'Old A', 'the old zine is shown');
    await o.page.locator(titleField).fill('Typed meanwhile');
    await o.page.waitForTimeout(1200);
    assert.deepEqual(posts, [], 'nothing saved');
    assert.equal(await exists(zineFile()), false, 'no blank zine on the Mac to block the move');
    assert.ok(await o.page.evaluate(`!!localStorage.getItem('zine:doc:v1')`), 'the old copy is still here');
    await shot(o.page, 'zine-not-moved');

    await o.page.unroute('**/api/zine/photo/**');
    await o.page.reload({ waitUntil: 'load' });
    await loaded(o.page);
    assert.equal(JSON.parse(await fs.readFile(zineFile(), 'utf8')).cover.title, 'Old A', 'moved on the next visit');
    assert.equal(await o.page.locator('#zn-savenote').isVisible(), false);
  } finally {
    await o.ctx.close();
  }
});

test('R13-41 a second browser’s own zine is offered, not dropped', async () => {
  // The Mac holds "Old A" from the test above.
  const o = await open(browser, 'ipad', '/api/zine', { wait: 100 });
  try {
    await seedOldZine(o.page, 'Old B');
    await o.page.goto(ORIGIN + '/book/zine', { waitUntil: 'load' });
    await loaded(o.page);
    assert.equal(await o.page.locator(titleField).inputValue(), 'Old A', 'the Mac’s zine opens');
    assert.equal(await o.page.locator('#zn-savenote-text').textContent(), 'This browser has its own zine');
    assert.equal(await o.page.locator('#zn-savenote-act').textContent(), 'Use it');
    await shot(o.page, 'zine-offer-own');
    await Promise.all([o.page.waitForEvent('load'), o.page.locator('#zn-savenote-act').click()]);
    await loaded(o.page);
    assert.equal(await o.page.locator(titleField).inputValue(), 'Old B');
    assert.equal(JSON.parse(await fs.readFile(zineFile(), 'utf8')).cover.title, 'Old B');
    assert.equal(JSON.parse(await fs.readFile(`${zineFile()}.bak`, 'utf8')).cover.title, 'Old A', 'the one it replaced is kept');
    assert.equal(await o.page.locator('#zn-savenote').isVisible(), false, 'asked once');

    // × instead keeps the Mac's and stops asking.
    await seedOldZine(o.page, 'Old C');
    await o.page.reload({ waitUntil: 'load' });
    await loaded(o.page);
    assert.equal(await o.page.locator('#zn-savenote-text').textContent(), 'This browser has its own zine');
    await o.page.locator('#zn-savenote-close').click();
    await o.page.reload({ waitUntil: 'load' });
    await loaded(o.page);
    assert.equal(await o.page.locator('#zn-savenote').isVisible(), false);
    assert.equal(await o.page.locator(titleField).inputValue(), 'Old B');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});
