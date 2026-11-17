/**
 * Round 13 brief 1a: a book save can never empty book.json, and a stale tab is
 * told rather than overwriting a newer save (R13-01, R13-31, R13-40). Needs the
 * throwaway server; see tests/r13.ts. The book file is copied aside first and
 * put back afterwards, byte for byte.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { DATA, launch, open, shot } from './r13';

const BOOK = path.join(DATA, '.archive', 'src', 'data', 'book.json');
const BAK = `${BOOK}.bak`;
let original: Buffer | null = null;
let hadBak = false;
let browser: Browser;

before(async () => {
  assert.ok(DATA, 'E2E_DATA must name the throwaway data folder');
  original = fs.existsSync(BOOK) ? fs.readFileSync(BOOK) : null;
  hadBak = fs.existsSync(BAK);
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (original) fs.writeFileSync(BOOK, original);
  else fs.rmSync(BOOK, { force: true });
  if (!hadBak) fs.rmSync(BAK, { force: true });
});

const book = (): { chapters?: Record<string, string[]>; excluded?: string[] } => JSON.parse(fs.readFileSync(BOOK, 'utf8'));
const barText = (page: Page) => page.locator('#book-savebar-text').textContent();
const firstGridIds = (page: Page) =>
  page.locator('.book-grid').first().locator('.book-cell').evaluateAll((cells) => cells.map((c) => (c as HTMLElement).dataset.id!));

/** The arrow-key flow: focus the first photo of the first chapter, one place right. */
async function nudgeFirstPhoto(page: Page) {
  await page.locator('.book-grid').first().locator('.book-cell').first().focus();
  await page.keyboard.press('ArrowRight');
}

test('two tabs: the stale one is told, and the newer save stays on disk', async () => {
  const a = await open(browser, 'desk', '/book');
  const b = await open(browser, 'desk', '/book');
  try {
    const key = await a.page.locator('.book-grid').first().getAttribute('data-chapter-list');
    const before = await firstGridIds(a.page);
    assert.ok(key && before.length >= 3, 'the first chapter has photos to move');

    // A: move the first photo one place, and wait for the autosave.
    await nudgeFirstPhoto(a.page);
    assert.deepEqual((await firstGridIds(a.page)).slice(0, 2), [before[1], before[0]]);
    await a.page.waitForFunction(() => document.getElementById('book-savebar-text')?.textContent === 'Saved', null, { timeout: 15_000 });
    assert.deepEqual(book().chapters?.[key!]?.slice(0, 2), [before[1], before[0]], "A's move is on disk");
    assert.ok(fs.existsSync(BAK), 'the save kept a backup');

    // B (still showing the old order): leave a photo out.
    const cell = b.page.locator('.book-grid').first().locator('.book-cell').nth(2);
    const leftOut = await cell.getAttribute('data-id');
    await cell.hover();
    await cell.locator('.book-exclude').click();
    await b.page.waitForFunction(() => document.getElementById('book-savebar-text')?.textContent === 'Changed elsewhere', null, { timeout: 15_000 });
    assert.equal(await b.page.locator('#book-save').textContent(), 'Reload');
    assert.ok(await b.page.locator('#book-savebar').isVisible());
    await shot(b.page, 'book-changed-elsewhere');

    const after = book();
    assert.deepEqual(after.chapters?.[key!]?.slice(0, 2), [before[1], before[0]], "A's move is still on disk");
    assert.ok(!(after.excluded ?? []).includes(leftOut!), "B's change was not written");

    // Another edit in B doesn't bring the save back over the newer book.
    await nudgeFirstPhoto(b.page);
    await b.page.waitForTimeout(2600);
    assert.equal(await barText(b.page), 'Changed elsewhere');
    assert.deepEqual(book().chapters?.[key!]?.slice(0, 2), [before[1], before[0]]);

    // Reload shows A's order.
    await Promise.all([b.page.waitForEvent('load'), b.page.locator('#book-save').click()]);
    await b.page.waitForTimeout(800);
    assert.deepEqual((await firstGridIds(b.page)).slice(0, 2), [before[1], before[0]]);
    assert.deepEqual([...a.problems, ...b.problems], []);
  } finally {
    await a.ctx.close();
    await b.ctx.close();
  }
});

test("a failed save says Couldn't save, and keeps the server's words off the page", async () => {
  const o = await open(browser, 'desk', '/book');
  const logged: string[] = [];
  o.page.on('console', (m) => { if (m.type() === 'error') logged.push(m.text()); });
  const raw = "EACCES: permission denied, open '/x/book.json'";
  await o.page.route('**/api/book', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, json: { ok: false, error: raw } })
      : route.continue());
  try {
    const onDisk = fs.readFileSync(BOOK);
    await nudgeFirstPhoto(o.page);
    await o.page.locator('#book-save').click();
    await o.page.waitForFunction(() => /^Couldn.t save$/.test(document.getElementById('book-savebar-text')?.textContent ?? ''), null, { timeout: 10_000 });
    assert.equal(await o.page.locator('#book-save').textContent(), 'Save', 'Save stays as the retry');
    assert.equal(await o.page.locator('#book-save').isEnabled(), true);
    assert.ok(!(await o.page.locator('body').innerText()).includes('EACCES'), 'no raw error text on the page');
    assert.ok(logged.some((t) => t.includes('EACCES')), 'the raw text goes to the console');
    await shot(o.page, 'book-couldnt-save');
    assert.ok(fs.readFileSync(BOOK).equals(onDisk));
  } finally {
    await o.ctx.close();
  }
});

test('Make PDF does not build after a failed save', async () => {
  const o = await open(browser, 'desk', '/book');
  let builds = 0;
  await o.page.route('**/api/book', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 500, json: { ok: false, error: 'nope' } }) : route.continue());
  await o.page.route('**/api/book/pdf?*', (route) => { builds++; return route.fulfill({ status: 500, body: '' }); });
  try {
    await nudgeFirstPhoto(o.page);
    await o.page.getByRole('button', { name: 'Print', exact: true }).click();
    await o.page.getByRole('button', { name: 'Make PDF' }).click();
    await o.page.waitForFunction(() => document.getElementById('book-pdf')?.textContent === 'Make PDF', null, { timeout: 10_000 });
    assert.equal(builds, 0, 'no PDF was asked for');
    assert.match((await barText(o.page)) ?? '', /^Couldn.t save$/);
  } finally {
    await o.ctx.close();
  }
});

test('R13-43 phone: a tapped photo has 36 px targets for chapter and leave out, the look unchanged', async () => {
  const o = await open(browser, 'phone', '/book');
  try {
    const cell = o.page.locator('.book-grid').first().locator('.book-cell').first();
    await cell.scrollIntoViewIfNeeded();
    await cell.tap({ position: { x: 40, y: 40 } });
    await o.page.waitForTimeout(400);
    // A string, because tsx wraps named inner functions in a helper the page doesn't have.
    const id = await cell.getAttribute('data-id');
    const m = await o.page.evaluate(`(() => {
      const c = document.querySelector('.book-cell[data-id="${id}"]');
      const hits = (el, x, y) => { const at = document.elementFromPoint(x, y); return !!at && (at === el || el.contains(at)); };
      const select = c.querySelector('.book-move');
      const s = select.getBoundingClientRect();
      const pill = c.querySelector('.book-move-pill').getBoundingClientRect();
      const x = c.querySelector('.book-exclude');
      const e = x.getBoundingClientRect();
      const ex = e.left + e.width / 2, ey = e.top + e.height / 2;
      return {
        select: { w: s.width, h: s.height, corners: [hits(select, s.left + 1, s.top + 1), hits(select, s.right - 1, s.top + 1), hits(select, s.left + 1, s.bottom - 1), hits(select, s.right - 1, s.bottom - 1)] },
        pill: { w: pill.width, h: pill.height },
        exclude: [hits(x, ex - 17.5, ey), hits(x, ex + 17.5, ey), hits(x, ex, ey - 17.5), hits(x, ex, ey + 17.5)],
      };
    })()`) as { select: { w: number; h: number; corners: boolean[] }; pill: { w: number; h: number }; exclude: boolean[] };
    assert.ok(m.select.w >= 36 && m.select.h >= 36, `chapter target ${JSON.stringify(m.select)}`);
    assert.deepEqual(m.select.corners, [true, true, true, true], 'the whole chapter target takes the tap');
    assert.ok(m.pill.h < 24, `the pill itself is still small: ${JSON.stringify(m.pill)}`);
    assert.deepEqual(m.exclude, [true, true, true, true], 'leave out (a round target) answers 36 px across, both ways');
    await shot(o.page, 'book-phone-targets');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

test('R13-39 Escape closes Print, from its button too', async () => {
  const o = await open(browser, 'desk', '/book');
  try {
    await o.page.locator('#book-print-open').click();
    assert.equal(await o.page.locator('#book-printpop').isVisible(), true);
    await o.page.keyboard.press('Escape');
    assert.equal(await o.page.locator('#book-printpop').isHidden(), true);
    assert.equal(await o.page.evaluate(() => document.activeElement?.id), 'book-print-open');
  } finally {
    await o.ctx.close();
  }
});

test('R13-46 the Book has no :active scale rules', () => {
  const src = fs.readFileSync('src/pages/book.astro', 'utf8');
  assert.equal(/:active\s*\{[^}]*transform:\s*scale/.test(src), false);
});
