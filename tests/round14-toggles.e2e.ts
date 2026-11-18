/**
 * Round 14: two space-savers on a phone. The Archive's top bar and tab bar
 * slide away while you scroll down; Scout's sheet gets a smallest height, min,
 * that is only its head row. Needs the throwaway server; see tests/r13.ts.
 *
 *   E2E_ORIGIN=https://localhost:4400 node --import tsx --test tests/round14-toggles.e2e.ts
 */
import fs from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { devices, type Browser, type Page } from 'playwright';
import { launch, open } from './r13';

const LONDON = '/scout?at=51.5079,-0.0877&tz=Europe/London&n=London&d=2026-11-12&t=700&r=4';
const IPHONE_13 = { ...devices['iPhone 13'] };
const DESK = { viewport: { width: 1400, height: 900 } };

let browser: Browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

/** Screenshots go in design-shots/round-14 (git-ignored). */
const shot = (page: Page, name: string) => {
  fs.mkdirSync('design-shots/round-14', { recursive: true });
  return page.screenshot({ path: `design-shots/round-14/${name}.png` });
};

type Bars = {
  y: number; vh: number;
  top: { top: number; bottom: number; hidden: boolean };
  tab: { top: number; bottom: number; away: boolean; opacity: number; pointer: string; ariaHidden: string | null };
};
/** Where the two bars are. A string, for the tsx __name trap (known-issues). */
const bars = (page: Page) => page.evaluate(`(() => {
  const t = document.getElementById('topbar'), b = document.getElementById('tabbar');
  const tr = t.getBoundingClientRect(), br = b.getBoundingClientRect(), bs = getComputedStyle(b);
  return {
    y: scrollY, vh: innerHeight,
    top: { top: tr.top, bottom: tr.bottom, hidden: t.classList.contains('hidden') },
    tab: { top: br.top, bottom: br.bottom, away: b.classList.contains('away'), opacity: Number(bs.opacity), pointer: bs.pointerEvents, ariaHidden: b.getAttribute('aria-hidden') },
  };
})()`) as Promise<Bars>;

/** Scroll by `dy` in 100 px steps, a frame or more apart, the way a finger does. */
async function scrollBy(page: Page, dy: number) {
  const steps = Math.max(1, Math.round(Math.abs(dy) / 100));
  for (let i = 0; i < steps; i++) {
    await page.evaluate(`window.scrollBy({ top: ${dy / steps}, behavior: 'instant' })`);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(600); // var(--dur-med) and some
}

const bothShown = (b: Bars) =>
  b.top.top >= 0 && b.top.bottom <= b.vh && b.tab.top >= 0 && b.tab.bottom <= b.vh && !b.top.hidden && !b.tab.away && b.tab.opacity > 0.99;

test('R14 phone Archive: both bars go on the way down and come back on the way up', async () => {
  const o = await open(browser, 'phone', '/', { context: IPHONE_13 });
  const { page } = o;
  try {
    assert.deepEqual(page.viewportSize(), { width: 390, height: 664 });
    let b = await bars(page);
    assert.ok(bothShown(b), `shown at the top: ${JSON.stringify(b)}`);

    await scrollBy(page, 600);
    b = await bars(page);
    assert.ok(b.y >= 500, `scrolled: ${b.y}`);
    assert.ok(b.top.bottom <= 0, `the top bar is above the screen: ${JSON.stringify(b.top)}`);
    assert.ok(b.tab.top >= b.vh, `the tab bar is below the screen: ${JSON.stringify(b.tab)} vh ${b.vh}`);
    assert.equal(b.tab.pointer, 'none', 'the hidden tab bar takes no taps');
    assert.equal(b.tab.ariaHidden, null, 'still there for a screen reader');
    await shot(page, 'archive-bars-away');

    await scrollBy(page, -100);
    b = await bars(page);
    assert.ok(bothShown(b), `back after scrolling up 100 px: ${JSON.stringify(b)}`);
    await shot(page, 'archive-bars-shown');

    // Focus coming into either bar brings both back (keyboard, R13-22).
    await scrollBy(page, 400);
    assert.equal((await bars(page)).tab.away, true, 'away again');
    await page.locator('#tabbar .tab').first().focus();
    await page.waitForTimeout(600);
    b = await bars(page);
    assert.ok(bothShown(b), `focus in the tab bar shows both: ${JSON.stringify(b)}`);

    // Back at the top, whichever way you got there.
    await scrollBy(page, 400);
    assert.equal((await bars(page)).top.hidden, true, 'away again');
    await page.evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
    await page.waitForTimeout(600);
    b = await bars(page);
    assert.ok(b.y <= 80 && bothShown(b), `shown at the top: ${JSON.stringify(b)}`);
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

test('R14 phone Archive, Reduce Motion: the bars fade where they are', async () => {
  const o = await open(browser, 'phone', '/', { context: { ...IPHONE_13, reducedMotion: 'reduce' } });
  const { page } = o;
  try {
    await scrollBy(page, 600);
    const b = await bars(page);
    assert.ok(b.top.hidden && b.tab.away, `away: ${JSON.stringify(b)}`);
    assert.equal(b.tab.opacity, 0, 'faded out');
    assert.equal(b.tab.pointer, 'none');
    assert.ok(b.tab.bottom <= b.vh && b.top.top >= 0, `no slide: ${JSON.stringify(b)}`);
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

test('R14 phone Archive: an open photo changes nothing about the bars', async () => {
  const o = await open(browser, 'phone', '/', { context: IPHONE_13 });
  const { page } = o;
  try {
    await scrollBy(page, 900);
    assert.equal((await bars(page)).tab.away, true);
    // A photo on screen, opened and closed: the bars stay where they were.
    const frame = page.locator('.frame').filter({ visible: true }).nth(1);
    await frame.tap();
    await page.locator('#lightbox').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.locator('#lightbox').waitFor({ state: 'hidden' });
    await page.waitForTimeout(600);
    const b = await bars(page);
    assert.ok(b.top.hidden && b.tab.away, `still away after the photo: ${JSON.stringify(b)}`);
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

test('R14 desk Archive: the tab bar stays; the top bar keeps its desk rule', async () => {
  const o = await open(browser, 'desk', '/', { context: DESK });
  const { page } = o;
  try {
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(80); }
    await page.waitForTimeout(700);
    const b = await bars(page);
    assert.ok(b.y >= 500, `scrolled: ${b.y}`);
    assert.equal(b.tab.away, false, 'the tab bar never goes away on the desk');
    assert.ok(b.tab.top >= 0 && b.tab.bottom <= b.vh && b.tab.opacity > 0.99, `the tab bar is on screen: ${JSON.stringify(b.tab)}`);
    // The desk's own top bar rule (R13-22) is unchanged: its 420 ms slide, not the phone's.
    const dur = await page.locator('#topbar').evaluate((t) => getComputedStyle(t).transitionDuration);
    assert.equal(dur, '0.42s, 0.42s');
    await shot(page, 'archive-desk');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

type Sheet = {
  detent: string; say: string; height: number; width: number; nameVisible: boolean; nameInside: boolean;
  placeHeight: number; timeVisibility: string; shown: string[];
};
// The name on show: the short one in min, the full one otherwise.
const sheet = (page: Page) => page.evaluate(`(() => {
  const dock = document.getElementById('dock');
  const name = document.getElementById(dock.dataset.detent === 'min' ? 'sheet-short' : 'sheet-name');
  const d = dock.getBoundingClientRect(), n = name.getBoundingClientRect();
  const place = document.querySelector('#sheet .sheet-place').getBoundingClientRect();
  const shown = ['search-button', 'radius-button', 'star', 'share-button', 'sheet-name', 'sheet-zone', 'sheet-short']
    .filter((id) => { const e = document.getElementById(id); return e.checkVisibility({ visibilityProperty: true }) && e.getBoundingClientRect().width > 0; });
  return {
    detent: dock.dataset.detent, say: document.getElementById('dock-detent-say').textContent,
    height: d.height, width: d.width, shown,
    nameVisible: name.checkVisibility({ visibilityProperty: true }) && n.width > 0,
    nameInside: n.top >= d.top && n.bottom <= d.bottom && n.bottom <= innerHeight,
    placeHeight: place.height,
    timeVisibility: getComputedStyle(document.getElementById('time')).visibility,
  };
})()`) as Promise<Sheet>;

const SAY: Record<string, string> = { min: 'Minimised', peek: 'Collapsed', half: 'Half height', full: 'Full height' };

test('R14 phone Scout: the grabber cycles min, peek, half, full; the name opens peek', async () => {
  const o = await open(browser, 'phone', LONDON, { wait: 6500, context: IPHONE_13 });
  const { page } = o;
  try {
    let s = await sheet(page);
    assert.equal(s.detent, 'peek', 'opens at peek');
    await shot(page, 'scout-peek');
    const peekHeight = s.height;
    const peekWidth = s.width;

    const tapGrabber = async () => {
      await page.locator('#dock-grabber').tap();
      await page.waitForTimeout(550); // the sheet's 420 ms settle
      return sheet(page);
    };
    // peek → half → full → min → peek: every step of the cycle, min included.
    for (const want of ['half', 'full', 'min', 'peek']) {
      s = await tapGrabber();
      assert.equal(s.detent, want);
      assert.equal(s.say, SAY[want], `spoken at ${want}`);
    }
    for (let i = 0; i < 3; i++) s = await tapGrabber(); // half, full, min

    // Min: a small tab with the short name and nothing else.
    assert.equal(s.detent, 'min');
    assert.ok(s.height <= 80, `min is ${s.height} px`);
    assert.ok(s.height < peekHeight, `min (${s.height}) is under peek (${peekHeight})`);
    assert.ok(s.width < peekWidth * 0.75, `the tab (${s.width}) is narrower than the sheet (${peekWidth})`);
    assert.deepEqual(s.shown, ['sheet-short'], 'only the short name shows in min');
    assert.ok(s.nameVisible && s.nameInside, `the name shows in min: ${JSON.stringify(s)}`);
    assert.equal(s.timeVisibility, 'hidden', 'the time strip is not reachable in min');
    assert.ok(s.placeHeight >= 36, `the name is ${s.placeHeight} px to tap`);
    await shot(page, 'scout-min');

    await page.locator('#sheet-short').tap();
    await page.waitForTimeout(550);
    s = await sheet(page);
    assert.equal(s.detent, 'peek', 'tapping the name opens peek');
    assert.equal(s.say, 'Collapsed');

    // A tap on the name at peek does nothing to the sheet.
    await page.locator('#sheet-name').tap();
    await page.waitForTimeout(550);
    assert.equal((await sheet(page)).detent, 'peek');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

test('R14 phone Scout: pulled down past peek, the sheet settles at min', async () => {
  const o = await open(browser, 'phone', LONDON, { wait: 6500, context: IPHONE_13 });
  const { page } = o;
  try {
    const g = await page.locator('#dock-grabber').boundingBox();
    assert.ok(g);
    const x = g.x + g.width / 2, y = g.y + g.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(x, y + i * 6); await page.waitForTimeout(30); }
    await page.waitForTimeout(200); // let go slowly: not a flick
    await page.mouse.up();
    await page.waitForTimeout(600);
    const s = await sheet(page);
    assert.equal(s.detent, 'min');
    assert.equal(s.say, 'Minimised');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

/** A point near the top of the screen where the map canvas itself is on top. */
const bareMapPoint = (page: Page) => page.evaluate(`(() => {
  const map = window.scout?.map?.();
  for (const fy of [0.3, 0.25, 0.35, 0.4]) {
    for (const fx of [0.62, 0.7, 0.55, 0.78, 0.45, 0.3]) {
      const x = Math.round(innerWidth * fx), y = Math.round(innerHeight * fy);
      const el = document.elementFromPoint(x, y);
      if (!el || !el.classList.contains('maplibregl-canvas')) continue;
      if (map && map.queryRenderedFeatures([x, y]).some((f) => f.layer.id.startsWith('scout-photos'))) continue;
      return { x, y };
    }
  }
  return null;
})()`) as Promise<{ x: number; y: number } | null>;

test('R14 phone Scout: a map tap that moves the pin leaves the sheet where it is', async () => {
  const o = await open(browser, 'phone', LONDON, { wait: 6500, context: IPHONE_13 });
  const { page } = o;
  // The moved pin names its new spot; answer locally rather than asking Nominatim.
  await page.route('**/api/scout/reverse**', (route) => {
    const u = new URL(route.request().url());
    return route.fulfill({ json: { ok: true, place: { name: 'Test spot', detail: '', lat: Number(u.searchParams.get('lat')), lon: Number(u.searchParams.get('lon')), kind: '', timeZone: 'Europe/London' } } });
  });
  try {
    const at = await bareMapPoint(page);
    assert.ok(at, 'found a bare stretch of map to tap');
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForFunction(() => document.getElementById('sheet-name')?.textContent === 'Test spot', null, { timeout: 5000 });
    assert.equal(await page.locator('#toast').isVisible(), false, 'no note for a moved pin');
    assert.equal((await sheet(page)).detent, 'peek', 'the tap moved the pin and did nothing to the sheet');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

test('R14 desk Scout: the sidebar has no min', async () => {
  const o = await open(browser, 'desk', LONDON, { wait: 6500, context: DESK });
  const { page } = o;
  try {
    assert.equal(await page.locator('#dock-grabber').isVisible(), false, 'no grabber on the sidebar');
    const before = await sheet(page);
    assert.ok(before.height > 300, `the sidebar stands full height: ${before.height}`);
    assert.notEqual(before.detent, 'min');
    assert.equal(before.timeVisibility, 'visible');
    // The name is only a name here.
    await page.locator('#sheet-name').click();
    await page.waitForTimeout(500);
    const after = await sheet(page);
    assert.equal(after.detent, before.detent);
    assert.equal(after.height, before.height);
    await shot(page, 'scout-desk');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});
