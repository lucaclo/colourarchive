/**
 * Round 13 on Add & remove: the bulk bar stays reachable (3a, R13-08), photos
 * select by keyboard (4c, R13-09), and the upload results show each photo with
 * honest counts in plain words (R13-10, -12, -13, -15). Needs the throwaway
 * server; see tests/r13.ts.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { request as pwRequest, type Browser, type Page } from 'playwright';
import { ORIGIN, DATA, launch, open, inViewport, shot } from './r13';

let browser: Browser;
before(async () => {
  assert.ok(DATA, 'E2E_DATA must name the throwaway data folder');
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

const STORE = () => path.join(DATA, '.archive/src/data/photos.json');
const TRASH = () => path.join(DATA, 'Photos', '.trash');
const store = (): { id: string; filename: string }[] => JSON.parse(fs.readFileSync(STORE(), 'utf8'));
const trashed = (prefix: string) => (fs.existsSync(TRASH()) ? fs.readdirSync(TRASH()).filter((n) => n.startsWith(prefix)) : []);

/** Take out everything a test added under `prefix`: from the store, then those files (only) from the trash. */
async function cleanUp(prefix: string) {
  const api = await pwRequest.newContext({ ignoreHTTPSErrors: true, baseURL: ORIGIN });
  try {
    for (const p of store().filter((s) => s.filename.startsWith(prefix))) {
      await api.post('/api/remove', { headers: { origin: ORIGIN }, data: { id: p.id } });
    }
    const names = trashed(prefix);
    if (names.length) await api.post('/api/removed/empty', { headers: { origin: ORIGIN }, data: { names } });
  } finally {
    await api.dispose();
  }
}

/** × on a cell, then the Undo window runs out and the removal is sent. */
async function removeCell(page: Page, id: string) {
  const cell = page.locator(`figure.cell[data-id="${id}"]`);
  await cell.hover();
  await cell.locator('.cell-remove').click();
  // 6 s of Undo, then the store write, which can queue behind other work on a shared server.
  const removed = await page.waitForResponse((r) => r.url().endsWith('/api/remove'), { timeout: 30_000 });
  assert.equal(removed.status(), 200);
}

const CHECKBOX = '.cell > img[role="checkbox"]';

/** The bulk bar is on screen, on top (not under the page head or anything else), and clear of the tab bar. */
const barReach = (page: Page) =>
  page.evaluate(() => {
    const bar = document.getElementById('bulk-bar')!.getBoundingClientRect();
    const tab = document.querySelector('.tabbar')?.getBoundingClientRect();
    const hit = document.elementFromPoint(bar.left + bar.width / 2, bar.top + bar.height / 2);
    return {
      onTop: Boolean(hit?.closest('#bulk-bar')),
      clearOfTabBar: !tab || bar.bottom <= tab.top,
      gutters: [Math.round(bar.left), Math.round(innerWidth - bar.right)],
    };
  });

/** Press Tab until a cell's checkbox other than `notIn` has focus; its cell id. */
async function tabToCell(page: Page, notIn = ''): Promise<string> {
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate((sel) => {
      const el = document.activeElement;
      return el?.matches(sel) ? (el.parentElement as HTMLElement).dataset.id ?? '' : '';
    }, CHECKBOX);
    if (id && id !== notIn) return id;
  }
  throw new Error('Tab never reached another cell');
}

test('phone: two photos picked deep in the grid, the bulk bar is on screen above the tab bar', async () => {
  const o = await open(browser, 'phone', '/upload');
  try {
    const cells = o.page.locator('figure.cell');
    const n = await cells.count();
    assert.ok(n > 20, 'the throwaway archive has a long grid');
    const a = cells.nth(Math.floor(n * 0.7));
    const b = cells.nth(Math.floor(n * 0.7) + 1);
    await a.scrollIntoViewIfNeeded();
    await o.page.waitForTimeout(400);
    assert.ok(await o.page.evaluate(() => document.getElementById('grid')!.getBoundingClientRect().top < -500), 'scrolled deep into the grid');

    await a.locator('img').tap();
    await b.locator('img').tap();
    await o.page.waitForTimeout(300);
    assert.equal(await o.page.locator('#bulk-count').textContent(), '2 selected');
    assert.ok(await inViewport(o.page, '#bulk-bar'), 'the bar is wholly inside the viewport');
    const reach = await barReach(o.page);
    assert.ok(reach.onTop, 'nothing covers the bar');
    assert.ok(reach.clearOfTabBar, 'the bar is not under the tab bar');
    assert.deepEqual(reach.gutters, [16, 16]);
    await shot(o.page, 'upload-phone-bulk-bar');

    await o.page.locator('#bulk-clear').tap();
    assert.equal(await o.page.locator('#bulk-bar').isVisible(), false, 'Clear can be reached and empties the selection');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

test('desk: Tab to a photo, Space, Tab to another, Space → "2 selected"', async () => {
  const o = await open(browser, 'desk', '/upload');
  try {
    await o.page.locator('#manage-search-input').focus();
    const first = await tabToCell(o.page);
    const ring = await o.page.locator(`figure.cell[data-id="${first}"]`).evaluate((c) => getComputedStyle(c).outlineStyle);
    assert.equal(ring, 'solid', 'the cell shows the focus ring');
    const y = await o.page.evaluate(() => scrollY);
    await o.page.keyboard.press('Space');
    assert.equal(await o.page.evaluate(() => scrollY), y, 'Space selects, it does not scroll the page');

    const second = await tabToCell(o.page, first);
    await o.page.keyboard.press('Space');
    assert.equal(await o.page.locator('#bulk-count').textContent(), '2 selected');
    for (const id of [first, second]) {
      assert.equal(await o.page.locator(`figure.cell[data-id="${id}"] > img`).getAttribute('aria-checked'), 'true');
    }
    await shot(o.page, 'upload-desk-keyboard');

    // Further down the grid the bar holds under the page head.
    await o.page.mouse.move(700, 500);
    for (let i = 0; i < 6; i++) await o.page.mouse.wheel(0, 600);
    await o.page.waitForTimeout(500);
    assert.ok(await inViewport(o.page, '#bulk-bar'), 'the bar is still on screen after scrolling');
    assert.ok((await barReach(o.page)).onTop, 'and not under the page head');

    await o.page.keyboard.press('Escape');
    assert.equal(await o.page.locator(`${CHECKBOX}[aria-checked="true"]`).count(), 0, 'Escape clears every aria-checked');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
  }
});

test('desk: one upload of a photo, its duplicate and a text file → "1 added · 2 not added"', async () => {
  const stamp = `r13-up-${Date.now()}`;
  const dir = path.join(DATA, '..');
  const photo = path.join(dir, `${stamp}-a.jpg`);
  const twin = path.join(dir, `${stamp}-b.jpg`);
  const text = path.join(dir, `${stamp}-c.jpg`);
  // Small, so it carries the size note (R13-15); the description makes its bytes unique.
  await sharp({ create: { width: 150, height: 100, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .withMetadata({ exif: { IFD0: { ImageDescription: stamp } } })
    .jpeg()
    .toFile(photo);
  fs.copyFileSync(photo, twin);
  fs.writeFileSync(text, 'not a picture');
  const ours = () => store().filter((p) => p.filename.startsWith(`${stamp}-`));

  const o = await open(browser, 'desk', '/upload');
  try {
    await o.page.setInputFiles('#file', [photo, twin, text]);
    await o.page.waitForFunction(() => {
      const t = document.getElementById('status-text')?.textContent ?? '';
      return /added/.test(t) && !/Sending|Processing/.test(t);
    }, null, { timeout: 90_000 });

    assert.equal((await o.page.locator('#status-text').textContent())?.trim(), '1 added · 2 not added');
    const notAdded = await o.page.locator('#not-added li').allTextContents();
    assert.equal(notAdded.length, 2);
    assert.ok(notAdded.some((t) => t.includes('Already in the archive')), `a duplicate says so: ${notAdded}`);
    assert.ok(notAdded.some((t) => t.includes('Not a picture we can read')), `the text file says so: ${notAdded}`);

    const added = ours();
    assert.equal(added.length, 1, 'one photo went in');
    const { id } = added[0];
    const row = o.page.locator(`#results li[data-id="${id}"]`);
    assert.ok((await row.locator('img.th').getAttribute('src'))?.includes(id), 'the row shows that photo’s own thumbnail');
    assert.equal(await row.locator('.nb').count(), 0, 'not the neighbours’ thumbnails');
    assert.match((await row.locator('.fn').textContent()) ?? '', new RegExp(`^${stamp}-[ab]\\.jpg$`), 'the name without the hash');
    assert.equal((await row.locator('.note').textContent())?.trim(), 'Very small (150 × 100)');

    const view = o.page.locator('a.btn#view-archive');
    assert.ok(await view.isVisible());
    assert.equal((await view.textContent())?.trim(), 'View in the archive');
    assert.equal(await view.getAttribute('href'), '/');
    await o.page.waitForTimeout(600);   // the rows' entrance
    await shot(o.page, 'upload-desk-results');

    // The new cell is a checkbox like the rest.
    const cellImg = o.page.locator(`figure.cell[data-id="${id}"] > img`);
    assert.equal(await cellImg.getAttribute('role'), 'checkbox');
    assert.equal(await cellImg.getAttribute('aria-checked'), 'false');

    // Take it out again.
    await removeCell(o.page, id);
    assert.equal(ours().length, 0, 'gone from the store');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
    await cleanUp(`${stamp}-`);
    for (const f of [photo, twin, text]) fs.rmSync(f, { force: true });
  }
});

test('Removed: a removed photo comes back with Restore, and the count with it', async () => {
  const stamp = `r13-rm-${Date.now()}`;
  const file = path.join(DATA, '..', `${stamp}.jpg`);
  await sharp({ create: { width: 480, height: 320, channels: 3, background: { r: 60, g: 140, b: 90 } } })
    .withMetadata({ exif: { IFD0: { ImageDescription: stamp } } })
    .jpeg()
    .toFile(file);
  const ours = () => store().filter((p) => p.filename.startsWith(`${stamp}.`));

  const o = await open(browser, 'desk', '/upload');
  try {
    const upload = o.page.waitForResponse((r) => r.url().endsWith('/api/upload'));
    await o.page.setInputFiles('#file', file);
    assert.equal((await upload).status(), 200);
    const [{ id, filename }] = ours();
    await o.page.locator(`figure.cell[data-id="${id}"]`).waitFor();
    const count = async () => Number(await o.page.locator('#manage-count').textContent());
    const before = await count();

    // Removed, and the Undo window has run out: the original is in the trash.
    await removeCell(o.page, id);
    assert.deepEqual(trashed(`${stamp}.`), [filename]);
    assert.equal(await count(), before - 1);
    const link = o.page.locator('#removed-open');
    assert.ok(await link.isVisible(), 'Removed · N shows');
    assert.match((await link.textContent())!.replace(/\s+/g, ' ').trim(), /^Removed · \d+$/);

    await link.click();
    const dlg = o.page.locator('#removed[role="dialog"][aria-modal="true"][data-modal]');
    await dlg.waitFor();
    const row = dlg.locator(`li[data-name="${filename}"]`);
    assert.equal(await row.locator('.rm-name').textContent(), `${stamp}.jpg`, 'the name without the hash');
    await row.locator('img.rm-th').evaluate((img: HTMLImageElement) => img.decode());
    assert.ok(await row.locator('img.rm-th').evaluate((img: HTMLImageElement) => img.naturalWidth > 0), 'its preview drew');
    assert.match((await dlg.locator('#removed-empty').textContent()) ?? '', /^Empty · \d+ (kB|MB|GB)$/);

    // Empty asks once more, and Keep deletes nothing.
    const inTrash = () => fs.readdirSync(TRASH()).length;
    const n0 = inTrash();
    await dlg.locator('#removed-empty').click();
    assert.match((await dlg.locator('#removed-confirm-text').textContent()) ?? '', /^Delete \d+ for good\?$/);
    assert.equal(await o.page.evaluate(() => document.activeElement?.id), 'removed-keep', 'Keep has focus, not Delete');
    await dlg.locator('#removed-keep').click();
    assert.equal(inTrash(), n0, 'Keep deletes nothing');

    // Restore: back in photos.json under the same id, in the grid, out of the trash.
    const restored = o.page.waitForResponse((r) => r.url().endsWith('/api/removed/restore'), { timeout: 60_000 });
    await row.locator('.rm-restore').click();
    assert.equal((await restored).status(), 200);
    assert.deepEqual(ours().map((p) => p.id), [id], 'back in the store with the same id');
    assert.deepEqual(trashed(`${stamp}.`), [], 'gone from the trash');
    await o.page.locator(`figure.cell[data-id="${id}"]`).waitFor();
    assert.equal(await count(), before, 'the count is back');
    assert.equal(await row.count(), 0, 'its row left the list');

    await o.page.keyboard.press('Escape');
    assert.equal(await dlg.isVisible(), false, 'Escape closes');
    await o.page.waitForTimeout(100);
    assert.equal(await o.page.evaluate(() => document.activeElement?.id), 'removed-open', 'focus goes back to the link');

    // Removed again, and left removed.
    await removeCell(o.page, id);
    assert.deepEqual(trashed(`${stamp}.`), [filename]);

    // The open list on a phone.
    const p = await open(browser, 'phone', '/upload');
    try {
      await p.page.locator('#removed-open').tap();
      await p.page.locator('#removed').waitFor();
      await p.page.waitForTimeout(450);   // the sheet's entrance
      assert.ok(await inViewport(p.page, '.removed-sheet'), 'the sheet fits the screen');
      const restoreH = await p.page.locator('.rm-restore').first().evaluate((b) => b.getBoundingClientRect().height);
      assert.ok(restoreH >= 36, `Restore is a 36 px target (${restoreH})`);
      await shot(p.page, 'upload-phone-removed');
      assert.deepEqual(p.problems, []);
    } finally {
      await p.ctx.close();
    }

    // Delete, confirmed, sends only what the list showed, then the link goes.
    // Answered here so nothing is deleted from the shared throwaway trash.
    let sent: { names?: string[] } = {};
    await o.page.route(`${ORIGIN}/api/removed/empty`, (route) => {
      sent = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true, deleted: sent.names?.length ?? 0, left: 0 } });
    });
    await link.click();
    await dlg.waitFor();
    const listed = await dlg.locator('li').evaluateAll((lis) => lis.map((li) => (li as HTMLElement).dataset.name));
    await dlg.locator('#removed-empty').click();
    await dlg.locator('#removed-delete').click();
    await o.page.waitForTimeout(200);
    assert.deepEqual(sent.names, listed);
    assert.equal(await dlg.isVisible(), false);
    assert.equal(await link.isVisible(), false, 'the link disappears');
    assert.equal(await o.page.evaluate(() => document.activeElement?.id), 'add-photos');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
    await cleanUp(`${stamp}.`);
    fs.rmSync(file, { force: true });
  }
});

test('Removed: names outside the trash are refused and nothing changes', async () => {
  const api = await pwRequest.newContext({ ignoreHTTPSErrors: true, baseURL: ORIGIN });
  const storeBefore = fs.readFileSync(STORE());
  const trashBefore = fs.readdirSync(TRASH()).sort();
  const own = { origin: ORIGIN };
  try {
    for (const name of ['../photos.json', 'a/b.jpg', '../../.archive/src/data/photos.json', '..', '.DS_Store', '', 'a\\b.jpg']) {
      const res = await api.post('/api/removed/restore', { headers: own, data: { name } });
      assert.equal(res.status(), 400, `restore ${JSON.stringify(name)}`);
    }
    const missing = await api.post('/api/removed/restore', { headers: own, data: { name: 'nope.0123456789abcdef.jpg' } });
    assert.equal(missing.status(), 404);
    const emptyBad = await api.post('/api/removed/empty', { headers: own, data: { names: [trashBefore[0] ?? 'x.jpg', '../photos.json'] } });
    assert.equal(emptyBad.status(), 400, 'one bad name refuses the whole request');
    const emptyNotList = await api.post('/api/removed/empty', { headers: own, data: { names: 'x.jpg' } });
    assert.equal(emptyNotList.status(), 400);
    // No "everything": a request without names deletes nothing.
    const emptyAll = await api.post('/api/removed/empty', { headers: own, data: {} });
    assert.equal(emptyAll.status(), 400);
    const preview = await api.get('/api/removed/preview?name=..%2Fphotos.json');
    assert.equal(preview.status(), 400);
    const elsewhere = await api.post('/api/removed/empty', { headers: { origin: 'https://evil.example' }, data: {} });
    assert.equal(elsewhere.status(), 403, 'another site cannot empty it');

    assert.ok(fs.readFileSync(STORE()).equals(storeBefore), 'photos.json untouched');
    assert.deepEqual(fs.readdirSync(TRASH()).sort(), trashBefore, 'the trash untouched');
  } finally {
    await api.dispose();
  }
});

test('Restore: a photo still listed whose only original is in the trash gets it back', async () => {
  // What a removal leaves when it moves the original and then fails to write
  // the store: the entry stays, its file is in the trash. Restore must put it
  // back, not delete it as a duplicate.
  const api = await pwRequest.newContext({ ignoreHTTPSErrors: true, baseURL: ORIGIN });
  const photo = store().find((p) => fs.existsSync(path.join(DATA, 'Photos', p.filename)))!;
  const original = path.join(DATA, 'Photos', photo.filename);
  const inTrash = path.join(TRASH(), photo.filename);
  const storeBefore = fs.readFileSync(STORE());
  fs.mkdirSync(TRASH(), { recursive: true });
  fs.renameSync(original, inTrash);
  try {
    const res = await api.post('/api/removed/restore', { headers: { origin: ORIGIN }, data: { name: photo.filename } });
    assert.equal(res.status(), 200, await res.text());
    assert.equal((await res.json()).status, 'already', 'still listed, so not added to the grid twice');
    assert.ok(fs.existsSync(original), 'the original is back');
    assert.equal(fs.existsSync(inTrash), false, 'and out of the trash');
    assert.equal(store().filter((p) => p.id === photo.id).length, 1, 'listed once');
    assert.equal(store().length, JSON.parse(storeBefore.toString()).length);
  } finally {
    if (!fs.existsSync(original) && fs.existsSync(inTrash)) fs.renameSync(inTrash, original);
    await api.dispose();
  }
});
