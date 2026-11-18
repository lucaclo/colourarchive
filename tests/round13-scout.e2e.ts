/**
 * Round 13 batch 2: Scout. Needs the throwaway server (tests/r13.ts) and the
 * network (map tiles and one place search per case, normal-user traffic).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import { launch, open, shot, inViewport } from './r13';

const LONDON = '/scout?at=51.5079,-0.0877&tz=Europe/London&n=London&d=2026-11-12&t=700&r=4';

let browser: Browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

/** Where the pin's coordinate lands on screen, and the top of the sheet below it. */
async function pinOnScreen(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { scout?: { map?: () => { getCenter(): { lat: number; lng: number }; project(ll: [number, number]): { x: number; y: number } } } };
    const at = new URL(location.href).searchParams.get('at')?.split(',').map(Number) ?? [0, 0];
    const map = w.scout?.map?.();
    const p = map?.project([at[1], at[0]]);
    const sheet = document.getElementById('dock')?.getBoundingClientRect();
    return { x: p?.x ?? -1, y: p?.y ?? -1, sheetTop: sheet ? sheet.top : innerHeight, width: innerWidth, height: innerHeight };
  });
}

async function searchBrighton(size: 'phone' | 'desk') {
  const o = await open(browser, size, LONDON, { wait: 6500 });
  const { page } = o;
  const weather: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/scout/weather')) weather.push(r.url()); });
  if (size === 'phone') await page.locator('#search-button').tap();
  else if (!(await page.locator('#place').isVisible())) await page.locator('#search-button').click();
  await page.locator('#place').fill('Brighton pier');
  await page.locator('#place-results [role=option]').first().waitFor({ timeout: 15_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('n') === 'Brighton Pier', null, { timeout: 15_000 });
  await page.waitForTimeout(2500); // the fly-in
  return { ...o, weather };
}

test('R13-30 phone: a search result moves the map, the address and the weather', async () => {
  const o = await searchBrighton('phone');
  const at = new URL(o.page.url()).searchParams.get('at') ?? '';
  assert.match(at, /^50\.8/, 'the address points at Brighton');
  const pin = await pinOnScreen(o.page);
  assert.ok(pin.x > 0 && pin.x < pin.width && pin.y > 0 && pin.y < pin.sheetTop, `the pin is on the map above the sheet: ${JSON.stringify(pin)}`);
  assert.ok(o.weather.some((u) => u.includes('lat=50.8')), 'the weather was asked for Brighton');
  await shot(o.page, 'scout-phone-search');
  assert.deepEqual(o.problems, []);
  await o.ctx.close();
});

/** A point where the map canvas itself is on top: no panel, button, marker or photo spot. */
async function bareMapPoint(page: Page) {
  const point = await page.evaluate(() => {
    const w = window as unknown as { scout?: { map?: () => { queryRenderedFeatures(p: [number, number]): Array<{ layer: { id: string } }> } } };
    const map = w.scout?.map?.();
    for (const fy of [0.7, 0.6, 0.8, 0.5]) {
      for (const fx of [0.62, 0.7, 0.55, 0.78, 0.45]) {
        const x = Math.round(innerWidth * fx);
        const y = Math.round(innerHeight * fy);
        const el = document.elementFromPoint(x, y);
        if (!el?.classList.contains('maplibregl-canvas')) continue;
        if (map?.queryRenderedFeatures([x, y]).some((f) => f.layer.id.startsWith('scout-photos'))) continue;
        return { x, y };
      }
    }
    return null;
  });
  assert.ok(point, 'found a bare stretch of map to click');
  return point;
}

const atParam = (page: Page) => new URL(page.url()).searchParams.get('at');
const activeId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '');

test('R13-32 desk: a map click that closes Layers leaves the pin where it was', async () => {
  const o = await open(browser, 'desk', LONDON, { wait: 6500 });
  const { page } = o;
  // The control click below names its new spot; answer locally rather than asking Nominatim.
  await page.route('**/api/scout/reverse**', (route) => {
    const u = new URL(route.request().url());
    return route.fulfill({ json: { ok: true, place: { name: 'Test spot', detail: '', lat: Number(u.searchParams.get('lat')), lon: Number(u.searchParams.get('lon')), kind: '', timeZone: 'Europe/London' } } });
  });
  const before = atParam(page);
  await page.locator('#layers-button').click();
  await page.locator('#layers').waitFor({ state: 'visible' });
  const at = await bareMapPoint(page);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#layers').isVisible(), false, 'Layers closed');
  assert.equal(await page.locator('#layers-button').getAttribute('aria-expanded'), 'false');
  assert.equal(atParam(page), before, 'the address still points at the loaded spot');
  assert.notEqual(await page.locator('#sheet-name').textContent(), 'Test spot');
  await shot(page, 'scout-layers-closed-after-map-click');

  // With nothing open, the same click still puts the pin there, and says nothing.
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => document.getElementById('sheet-name')?.textContent === 'Test spot', null, { timeout: 5000 });
  assert.equal(await page.locator('#toast').isVisible(), false, 'no note for a moved pin');
  assert.deepEqual(o.problems, []);
  await o.ctx.close();
});

test('R13-33 desk: Escape closes Layers and gives focus back to its button', async () => {
  const o = await open(browser, 'desk', LONDON, { wait: 6500 });
  const { page } = o;
  // From the button itself, just after opening.
  // Hidden at once; the panel's fade-out then takes a moment to leave the screen.
  const closed = async () => {
    assert.equal(await page.locator('#layers').evaluate((el) => (el as HTMLElement).hidden), true);
    await page.locator('#layers').waitFor({ state: 'hidden', timeout: 2000 });
  };
  await page.locator('#layers-button').click();
  await page.locator('#layers').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await closed();
  assert.equal(await activeId(page), 'layers-button');
  // And from a control inside the panel.
  await page.locator('#layers-button').click();
  await page.locator('#layers').waitFor({ state: 'visible' });
  await page.locator('#t-buildings').focus();
  await page.keyboard.press('Escape');
  await closed();
  assert.equal(await page.locator('#layers-button').getAttribute('aria-expanded'), 'false');
  assert.equal(await activeId(page), 'layers-button');
  assert.deepEqual(o.problems, []);
  await o.ctx.close();
});

test('R13-33 desk: the month grid keeps focus inside and Escape gives it back', async () => {
  const o = await open(browser, 'desk', LONDON, { wait: 6500 });
  const { page } = o;
  await page.locator('#share-button').click();
  await page.locator('#open-month').click();
  await page.locator('#monthgrid').waitFor({ state: 'visible' });
  const inside = () => page.evaluate(() => document.getElementById('monthgrid')!.contains(document.activeElement));
  await page.waitForFunction(() => document.getElementById('monthgrid')!.contains(document.activeElement), null, { timeout: 3000 });
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    assert.ok(await inside(), `focus still inside after Tab ${i + 1}`);
  }
  await page.keyboard.press('Shift+Tab');
  assert.ok(await inside(), 'and after Shift+Tab');
  await page.keyboard.press('Escape');
  await page.locator('#monthgrid').waitFor({ state: 'hidden' });
  // "The month, hour by hour" went with the share menu it lives in, so focus
  // comes back to the share button that leads to it.
  assert.equal(await activeId(page), 'share-button');
  assert.deepEqual(o.problems, []);
  await o.ctx.close();
});

test('R13-34 phone: the share menu holds the five actions, and Layers only layers', async () => {
  const o = await open(browser, 'phone', LONDON, { wait: 6500 });
  const { page } = o;
  const actions = ['open-month', 'export', 'copy-plan', 'copy-link', 'save-offline'];
  // None of them is left inside Layers.
  const inLayers = await page.evaluate(`${JSON.stringify(actions)}.filter((id) => document.getElementById('layers').contains(document.getElementById(id)))`);
  assert.deepEqual(inLayers, []);
  await page.locator('#share-button').tap();
  await page.locator('#share-menu').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  for (const id of actions) {
    assert.ok(await inViewport(page, `#${id}`), `#${id} is on screen`);
    const h = await page.locator(`#${id}`).evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(h >= 36, `#${id} is ${h} px tall`);
  }
  assert.equal(await page.locator('#share-button').getAttribute('aria-expanded'), 'true');
  await shot(page, 'scout-share-menu-phone');
  // A tap on the map puts it away without moving the pin.
  const before = atParam(page);
  await page.touchscreen.tap(200, 200);
  await page.locator('#share-menu').waitFor({ state: 'hidden', timeout: 2000 });
  assert.equal(atParam(page), before);
  await page.locator('#layers-button').tap();
  await page.locator('#layers').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  await shot(page, 'scout-layers-phone');
  assert.deepEqual(o.problems, []);
  await o.ctx.close();
});

test('R13-35 phone: search lists Brighton Pier once, labelled Pier', async () => {
  const o = await open(browser, 'phone', LONDON, { wait: 6500 });
  const { page } = o;
  await page.locator('#search-button').tap();
  await page.locator('#place').fill('Brighton pier');
  await page.locator('#place-results [role=option]').first().waitFor({ timeout: 15_000 });
  const rows = await page.locator('#place-results [role=option]').evaluateAll((items) =>
    items.map((li) => ({ name: li.querySelector('.nm')?.textContent ?? '', kind: li.querySelector('.kd')?.textContent ?? '' })),
  );
  assert.equal(rows.filter((r) => r.name === 'Brighton Pier').length, 1, JSON.stringify(rows));
  assert.equal(rows[0].kind, 'Pier');
  assert.ok(rows.every((r) => !/man made|_/.test(r.kind)), JSON.stringify(rows));
  await shot(page, 'scout-search-list');
  await o.ctx.close();
});

test('R13-38 phone: the first-visit note is one line', async () => {
  const o = await open(browser, 'phone', '/scout', { wait: 4000 });
  const note = o.page.locator('#first-visit p');
  const text = ((await note.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  assert.equal(text, 'Search a place or use your location');
  if (await note.isVisible()) assert.equal((await note.innerText()).trim(), 'Search a place or use your location');
  await o.ctx.close();
});

/** The Camera group's Tools fold, on one of its tabs. A string, for the tsx __name trap. */
const toolTab = (page: Page, tab: string) =>
  page.evaluate(`(async () => {
    document.getElementById('group-camera').open = true;
    document.getElementById('fold-tools').open = true;
    document.getElementById('tool-tab-${tab}').click();
    await new Promise((r) => setTimeout(r, 300));
  })()`);

/** Every visible ⓘ in the Tools fold, tapped 17.5 px out from its centre each way. */
const tipMisses = (page: Page) =>
  page.evaluate(`(async () => {
    const checked = [];
    const misses = [];
    for (const el of document.querySelectorAll('#fold-tools .infotip')) {
      if (!el.checkVisibility()) continue;
      el.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 60));
      const b = el.getBoundingClientRect();
      const x = b.left + b.width / 2;
      const y = b.top + b.height / 2;
      const name = el.id || el.getAttribute('aria-label');
      checked.push(name);
      for (const [dx, dy] of [[17.5, 0], [-17.5, 0], [0, 17.5], [0, -17.5]]) {
        if (document.elementFromPoint(x + dx, y + dy) !== el) misses.push(name + ' at ' + dx + ',' + dy);
      }
    }
    return { checked, misses };
  })()`) as Promise<{ checked: string[]; misses: string[] }>;

test('R13-37 iPad: every tool control is 36 px to hit', async () => {
  const o = await open(browser, 'ipad', LONDON, { wait: 6500 });
  const { page } = o;
  const tall = async (id: string) => {
    const h = await page.locator(`#${id}`).evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(h >= 36, `#${id} is ${h} px tall`);
  };
  const tips: string[] = [];
  const tipsHit = async () => {
    const { checked, misses } = await tipMisses(page);
    tips.push(...checked);
    assert.deepEqual(misses, []);
  };

  await toolTab(page, 'dof');
  await tall('frame-focus');
  await tipsHit();
  await toolTab(page, 'fov');
  await tall('fov-subject');
  await tall('fov-use-focus');
  await toolTab(page, 'stack');
  await tall('stack-near');
  await tall('stack-far');
  // "Clear ticks" shows once a shot is ticked off.
  await page.locator('#stack-list input[type=checkbox]').first().check();
  await tall('stack-clear');
  await toolTab(page, 'nd');
  await tipsHit();
  await toolTab(page, 'timelapse');
  await tall('tl-length');
  await tall('tl-photosize');
  assert.ok(tips.includes('dof-more') && tips.length >= 3, `tips checked: ${tips.join(', ')}`);
  assert.deepEqual(o.problems, []);
  await o.ctx.close();
});

test('R13-37 phone: the time slider is 36 px to hit', async () => {
  const o = await open(browser, 'phone', LONDON, { wait: 6500 });
  const { page } = o;
  const box = await page.locator('#time').evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { height: b.height, top: b.top, bottom: b.bottom, left: b.left, width: b.width };
  });
  assert.ok(box.height >= 36, `#time is ${box.height} px tall`);
  // The edges of that box are the slider, not what sits beside it...
  const x = Math.round(box.left + box.width * 0.25);
  const edges = await page.evaluate(`[${box.top + 1}, ${box.bottom - 1}].map((y) => document.elementFromPoint(${x}, y)?.id)`);
  assert.deepEqual(edges, ['time', 'time']);
  // ...and a tap on the clear edge above the strip moves the time.
  const before = await page.locator('#time').inputValue();
  await page.touchscreen.tap(x, Math.round(box.top + 2));
  await page.waitForTimeout(300);
  assert.notEqual(await page.locator('#time').inputValue(), before, 'the tap moved the slider');
  assert.deepEqual(o.problems, []);
  await o.ctx.close();
});

test('R13-30 desk: the same search still works', async () => {
  const o = await searchBrighton('desk');
  assert.match(new URL(o.page.url()).searchParams.get('at') ?? '', /^50\.8/);
  const pin = await pinOnScreen(o.page);
  assert.ok(pin.x > 0 && pin.x < pin.width && pin.y > 0 && pin.y < pin.height, `the pin is on screen: ${JSON.stringify(pin)}`);
  await shot(o.page, 'scout-desk-search');
  assert.deepEqual(o.problems, []);
  await o.ctx.close();
});
