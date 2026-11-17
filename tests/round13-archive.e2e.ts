/**
 * Round 13 briefs 3b and 4a: the Archive on a phone, and keeping your place
 * (R13-17, R13-18, R13-19, R13-21, R13-22). Needs the throwaway server; see
 * tests/r13.ts.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import { launch, open, shot, ORIGIN } from './r13';

let browser: Browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

const shownFrames = (page: Page) =>
  page.evaluate(`[...document.querySelectorAll('.frame')].filter((f) => f.offsetParent !== null).length`) as Promise<number>;

/** Every visible lightbox tool's box, and whether it sits wholly on screen. */
const toolsOnScreen = (page: Page) =>
  page.evaluate(`[...document.querySelectorAll('#lightbox .lb-tools > .lb-tool')]
    .filter((b) => b.offsetParent !== null || getComputedStyle(b).position === 'fixed')
    .filter((b) => getComputedStyle(b).display !== 'none')
    .map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; })`) as Promise<{ id: string; inside: boolean }[]>;

test('R13-19 phone: every lightbox tool is on screen, with More opening the rest', async () => {
  const o = await open(browser, 'phone', '/');
  try {
    await o.page.locator('.frame').first().tap();
    await o.page.waitForTimeout(800);
    const first = await toolsOnScreen(o.page);
    assert.ok(first.length >= 4, `tools shown: ${JSON.stringify(first)}`);
    assert.deepEqual(first.filter((t) => !t.inside), [], 'nothing off the edge');
    assert.equal(await o.page.locator('#lb-more').isVisible(), true);
    await shot(o.page, 'archive-phone-lightbox');
    await o.page.locator('#lb-more').tap();
    await o.page.waitForTimeout(300);
    const all = await toolsOnScreen(o.page);
    assert.ok(all.some((t) => t.id === 'lb-chapter') && all.some((t) => t.id === 'lb-share'), `More shows Share and Chapter: ${JSON.stringify(all)}`);
    assert.deepEqual(all.filter((t) => !t.inside), [], 'nothing off the edge with More open');
    await shot(o.page, 'archive-phone-lightbox-more');
    await o.page.keyboard.press('Escape');
    assert.equal(await o.page.locator('#lb-more').getAttribute('aria-expanded'), 'false', 'Escape closes More first');
    assert.equal(await o.page.locator('#lightbox').isVisible(), true);
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

test('R13-17 open → × → Back leaves the page', async () => {
  const o = await open(browser, 'desk', '/book');
  try {
    await o.page.goto(ORIGIN + '/', { waitUntil: 'load' });
    await o.page.waitForTimeout(1200);
    await o.page.locator('.frame').first().click();
    await o.page.waitForTimeout(600);
    await o.page.locator('#lb-close').click();
    await o.page.waitForTimeout(600);
    assert.equal(new URL(o.page.url()).pathname, '/');
    await o.page.goBack({ waitUntil: 'load' });
    assert.equal(new URL(o.page.url()).pathname, '/book', 'one Back after × leaves the Archive');
  } finally {
    await o.ctx.close();
  }
});

test('R13-18 Film, genre and search survive a reload', async () => {
  const o = await open(browser, 'desk', '/');
  try {
    const all = await shownFrames(o.page);
    await o.page.locator('#view-toggle [data-view="film"]').click();
    await o.page.waitForTimeout(800);
    const film = await shownFrames(o.page);
    assert.ok(film > 0 && film < all, `film ${film} of ${all}`);
    assert.equal(new URL(o.page.url()).searchParams.get('view'), 'film');
    await o.page.reload({ waitUntil: 'load' });
    await o.page.waitForTimeout(1500);
    assert.equal(await shownFrames(o.page), film, 'Film kept after reload');

    // Search, by description: the address carries it and a reload runs it again.
    await o.page.locator('#genre-btn').click();
    await o.page.locator('#search-input').fill('sea');
    await o.page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'sea', null, { timeout: 10_000 });
    await o.page.waitForTimeout(3000);
    const found = await shownFrames(o.page);
    await o.page.reload({ waitUntil: 'load' });
    await o.page.waitForTimeout(4000);
    assert.equal(new URL(o.page.url()).searchParams.get('view'), 'film');
    assert.equal(await o.page.locator('#search-input').inputValue(), 'sea');
    assert.equal(await shownFrames(o.page), found, 'the same results after reload');

    // Opening a photo keeps the filters in the address.
    await o.page.locator('.frame:visible').first().click();
    await o.page.waitForTimeout(600);
    const u = new URL(o.page.url());
    assert.equal(u.searchParams.get('view'), 'film');
    assert.equal(u.searchParams.get('q'), 'sea');
    assert.match(u.hash, /photo=/);
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

test('R13-21 Escape from Details closes Details, not the photo', async () => {
  const o = await open(browser, 'desk', '/');
  try {
    await o.page.locator('.frame').first().click();
    await o.page.waitForTimeout(600);
    await o.page.locator('#lb-info').click();
    assert.equal(await o.page.locator('#lightbox').evaluate((l) => l.classList.contains('details')), true);
    await o.page.keyboard.press('Escape');
    await o.page.waitForTimeout(300);
    assert.equal(await o.page.locator('#lightbox').evaluate((l) => l.classList.contains('details')), false);
    assert.equal(await o.page.locator('#lightbox').isVisible(), true, 'the photo is still open');
    await o.page.keyboard.press('Escape');
    await o.page.waitForTimeout(400);
    assert.equal(await o.page.locator('#lightbox').isHidden(), true, 'a second Escape closes it');
  } finally {
    await o.ctx.close();
  }
});

test('R13-22 after scrolling down, the first Tab lands on a control you can see', async () => {
  const o = await open(browser, 'desk', '/');
  try {
    for (let i = 0; i < 6; i++) { await o.page.mouse.wheel(0, 600); await o.page.waitForTimeout(150); }
    await o.page.waitForTimeout(600);
    assert.equal(await o.page.locator('#topbar').evaluate((b) => b.classList.contains('hidden')), true, 'the bar slid away');
    await o.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await o.page.keyboard.press('Tab');
    await o.page.waitForTimeout(600);
    const seen = await o.page.evaluate(`(() => {
      const e = document.activeElement; const r = e.getBoundingClientRect();
      const bar = document.getElementById('topbar');
      return { id: e.id, onScreen: r.bottom > 0 && r.top < innerHeight && r.width > 0, barHidden: bar.classList.contains('hidden') };
    })()`) as { id: string; onScreen: boolean; barHidden: boolean };
    assert.ok(seen.onScreen && !seen.barHidden, JSON.stringify(seen));
  } finally {
    await o.ctx.close();
  }
});
