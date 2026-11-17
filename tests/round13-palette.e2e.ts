/**
 * Round 13 brief 4b: the command palette is a dialog (R13-20). Needs the
 * throwaway server; see tests/r13.ts.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { launch, open } from './r13';

let browser: Browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

test('R13-20 the palette is a modal dialog: Tab stays inside, Escape gives focus back', async () => {
  const o = await open(browser, 'desk', '/');
  try {
    const root = o.page.locator('#cmdk');
    assert.equal(await root.getAttribute('role'), 'dialog');
    assert.equal(await root.getAttribute('aria-modal'), 'true');
    assert.ok(await root.getAttribute('aria-label'));
    assert.equal(await root.getAttribute('data-modal'), '');

    await o.page.keyboard.press('ControlOrMeta+k');
    await o.page.waitForTimeout(300);
    assert.equal(await root.isVisible(), true);
    for (let i = 0; i < 10; i++) await o.page.keyboard.press('Tab');
    assert.equal(await o.page.evaluate(() => document.getElementById('cmdk')!.contains(document.activeElement)), true, 'focus is still in the palette');
    await o.page.keyboard.press('Escape');
    assert.equal(await root.isHidden(), true);
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});
