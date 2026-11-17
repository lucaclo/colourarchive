/**
 * Round 13 brief 3c: Inspiration on a phone (R13-24, R13-25, R13-26). Needs the
 * throwaway server; see tests/r13.ts. One real Match runs (about 15 s).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import { launch, open, shot, inViewport } from './r13';

const SAMPLE = 'public/img/' + readdirSync('public/img').find((f) => f.endsWith('-1280.avif'));

let browser: Browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

/** For each control in the cell: does a tap 17.5 px either side of its centre, on both axes, still land on it? */
const targets = (page: Page, cellIndex: number) =>
  page.evaluate(`(() => {
    const cell = document.querySelectorAll('.insp-frame')[${cellIndex}];
    const hits = (el, x, y) => { const at = document.elementFromPoint(x, y); return !!at && (at === el || el.contains(at)); };
    return [...cell.querySelectorAll('.cell-remove, .cell-similar, .cell-match, .cell-group, .cell-who')]
      .filter((el) => getComputedStyle(el).pointerEvents !== 'none')
      .map((el) => {
        const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
        return { cls: el.className.split(' ')[0], ok: [hits(el, x - 17.5, y), hits(el, x + 17.5, y), hits(el, x, y - 17.5), hits(el, x, y + 17.5)].every(Boolean) };
      });
  })()`) as Promise<{ cls: string; ok: boolean }[]>;

test('R13-25 phone: every control on a tapped reference is 36 px to hit', async () => {
  const o = await open(browser, 'phone', '/inspiration');
  try {
    const i = 1; // not the first: its "Who?" can sit against the top of the board
    const frame = o.page.locator('.insp-frame').nth(i);
    await frame.scrollIntoViewIfNeeded();
    await o.page.waitForTimeout(400);
    await frame.locator('img.photo').first().tap();
    await o.page.waitForTimeout(500);
    const t = await targets(o.page, i);
    assert.ok(t.length >= 4, `controls shown: ${JSON.stringify(t)}`);
    assert.deepEqual(t.filter((c) => !c.ok), [], 'each answers 36 px across');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

test('R13-26 phone: the group tray sits inside the screen', async () => {
  const o = await open(browser, 'phone', '/inspiration');
  try {
    for (const i of [0, 1]) {
      const frame = o.page.locator('.insp-frame').nth(i);
      await frame.scrollIntoViewIfNeeded();
      await frame.locator('img.photo').first().tap();
      await o.page.waitForTimeout(300);
      await frame.locator('.cell-group').tap();
      await o.page.waitForTimeout(300);
    }
    await o.page.waitForTimeout(400);
    assert.equal(await o.page.locator('#group-tray').isVisible(), true);
    assert.equal(await inViewport(o.page, '#group-tray'), true, 'the tray is wholly on screen');
    await shot(o.page, 'inspiration-phone-tray');
    await o.page.locator('#group-tray-clear').tap();
  } finally {
    await o.ctx.close();
  }
});

test('R13-24 phone: Match’s Check tab is on screen', async () => {
  const o = await open(browser, 'phone', '/inspiration');
  try {
    await o.page.route(/\/api\/match\/keep/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    await o.page.locator('.cell-match').first().evaluate((e) => (e as HTMLElement).click());
    await o.page.waitForTimeout(800);
    await o.page.setInputFiles('#mx-file', SAMPLE);
    await o.page.waitForSelector('#mx-result:not([hidden])', { timeout: 180_000 });
    await o.page.waitForTimeout(1500);
    assert.equal(await inViewport(o.page, '#mx-tab-check'), true, 'Check is inside the screen');
    const title = (await o.page.locator('#mx-sub, .mx-sub').first().textContent().catch(() => '')) ?? '';
    assert.doesNotMatch(title, /\bin the look of\b.*\d{4}/, `no frame numbers in the heading: ${title}`);
    await shot(o.page, 'inspiration-phone-match-tabs');
  } finally {
    await o.ctx.close();
  }
});
