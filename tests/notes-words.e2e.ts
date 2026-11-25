/**
 * Notes in words, in the Archive's lightbox: the Notes button, the panel, the
 * numbered boxes over the photo, marks, and the quiet note when a write fails.
 * The notes API is mocked here (GET status, POST words, POST mark), and so is
 * every other non-GET /api request. Run against a throwaway server:
 *
 *   E2E_ORIGIN=http://localhost:4410 E2E_DATA=<throwaway data dir> \
 *     caffeinate -i node --import tsx --test tests/notes-words.e2e.ts
 *
 * NOTES_SHOTS=1 adds screenshots at desk, iPad and phone, in both colour
 * schemes, to node_modules/.cache/notes-words/shots/.
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright';
import { launch, open, ORIGIN, SIZES, type Opened } from './r13';

let browser: Browser;
let current: Opened | null = null;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });
afterEach(async () => {
  await current?.ctx.close().catch(() => {});
  current = null;
});

type Box = [number, number, number, number];
const storedNote = (id: string, intent: string, mark: string | null = null) => ({
  key: 'note-key-1',
  id,
  intent,
  model: 'model-under-test',
  at: '2026-11-25T10:00:00.000Z',
  note: {
    seen: 'SEEN-TEXT a street corner in low sun',
    priority: {
      box: [0.08, 0.12, 0.3, 0.28] as Box,
      what: 'The bright sign pulls the eye off the walker',
      why: 'It is the lightest patch in the frame and sits on a third.',
      edit: 'Masking: brush over the sign, Exposure −0.7.',
      next_time: 'Step left so the post hides the sign.',
    },
    works: { box: [0.5, 0.42, 0.22, 0.4] as Box, what: 'The walker’s long shadow leads in from the kerb' },
    others: [{ box: [0.72, 0.06, 0.24, 0.2] as Box, what: 'The kerb runs out of the corner' }],
    nothing_stands_out: false,
  },
  dropped: [{ where: 'others', what: 'DROPPED-TEXT', reason: 'box missing' }],
  mark,
});

type Posted = { path: string; body: Record<string, unknown> };
type Mock = {
  ready: boolean;
  /** A stored note for every photo the page asks about. */
  storedIntent?: string;
  /** What a Write answers, when not a note. */
  writeError?: { status: number; body: unknown };
  /** Holds a Write's answer this long. */
  writeDelay?: number;
  /** Replaces the stored note's words. */
  words?: Record<string, unknown>;
  /** Replaces a written note's words. */
  writeWords?: Record<string, unknown>;
  /** What a mark answers, when not ok. */
  markError?: { status: number; body: unknown };
};

/** Mocks the notes API and every other non-GET /api request; returns what was asked. */
async function mockNotes(o: Opened, mock: Mock) {
  const posts: Posted[] = [];
  const gets: string[] = [];
  const written = new Map<string, unknown>();
  await o.ctx.route(`${ORIGIN}/api/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'GET') {
      if (url.pathname !== '/api/notes/words') return route.fallback();
      const id = url.searchParams.get('id') || '';
      gets.push(id);
      const stored = mock.storedIntent ? storedNote(id, mock.storedIntent) : null;
      if (stored && mock.words) stored.note = mock.words as typeof stored.note;
      const note = written.get(id) ?? stored;
      return route.fulfill({ json: { ready: mock.ready, note } });
    }
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch { /* not JSON */ }
    posts.push({ path: url.pathname, body });
    if (url.pathname === '/api/notes/words') {
      if (mock.writeDelay) await new Promise((r) => setTimeout(r, mock.writeDelay));
      if (mock.writeError) return route.fulfill({ status: mock.writeError.status, json: mock.writeError.body });
      const note = storedNote(String(body.id), String(body.intent));
      if (mock.writeWords) note.note = mock.writeWords as typeof note.note;
      written.set(String(body.id), note);
      return route.fulfill({ json: { note } });
    }
    if (url.pathname === '/api/notes/mark') {
      if (mock.markError) return route.fulfill({ status: mock.markError.status, json: mock.markError.body });
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  return { posts, gets };
}

const lightboxShown = (page: Page) =>
  page.waitForFunction(`(() => { const lb = document.getElementById('lightbox'); return lb && !lb.hidden && lb.classList.contains('show'); })()`);

/** The photo's drawn rect (contain-fit of its natural size in its box), and every box's rect. */
const geometry = (page: Page) =>
  page.evaluate(`(() => {
    const img = document.getElementById('lb-img');
    const r = img.getBoundingClientRect();
    const k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    const photo = { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
    const boxes = [...document.querySelectorAll('.lb-boxes .lb-box')].map((b) => {
      const br = b.getBoundingClientRect();
      return { n: b.dataset.n, kind: b.dataset.kind, badge: b.textContent, left: br.left, top: br.top, right: br.right, bottom: br.bottom };
    });
    const layer = document.querySelector('.lb-boxes');
    const cs = layer ? getComputedStyle(layer) : null;
    return { photo, boxes, layerVisible: !!cs && cs.visibility === 'visible' && Number(cs.opacity) > 0.9, vw: innerWidth, vh: innerHeight };
  })()`) as Promise<{
    photo: { left: number; top: number; width: number; height: number };
    boxes: { n: string; kind: string; badge: string; left: number; top: number; right: number; bottom: number }[];
    layerVisible: boolean; vw: number; vh: number;
  }>;

function assertBoxesInPhoto(g: Awaited<ReturnType<typeof geometry>>, count: number) {
  assert.equal(g.boxes.length, count, `boxes: ${JSON.stringify(g.boxes)}`);
  const p = g.photo, tol = 1.5;
  for (const b of g.boxes) {
    assert.ok(
      b.left >= p.left - tol && b.top >= p.top - tol && b.right <= p.left + p.width + tol && b.bottom <= p.top + p.height + tol,
      `box ${b.n} ${JSON.stringify(b)} inside photo ${JSON.stringify(p)}`,
    );
  }
}

/** Waits until the layer has finished fading in with `count` boxes. */
const boxesDrawn = (page: Page, count: number) =>
  page.waitForFunction(`(() => {
    const layer = document.querySelector('.lb-boxes');
    if (!layer || layer.children.length !== ${count}) return false;
    const cs = getComputedStyle(layer);
    return cs.visibility === 'visible' && Number(cs.opacity) > 0.99 && document.getElementById('lb-img').naturalWidth > 0;
  })()`, undefined, { timeout: 10_000 });

const appProblems = (o: Opened) => o.problems.filter((p) => !p.includes('/api/notes/'));

test('ready false and no stored note: no Notes button', async () => {
  const o = (current = await open(browser, 'desk', '/'));
  const api = await mockNotes(o, { ready: false });
  await o.page.locator('.frame').first().click();
  await lightboxShown(o.page);
  await o.page.waitForFunction(`document.getElementById('lb-notes-btn') !== null`);
  await o.page.waitForTimeout(800);
  assert.equal(api.gets.length, 1, `one status GET on open: ${JSON.stringify(api.gets)}`);
  assert.equal(await o.page.locator('#lb-notes-btn').isVisible(), false, 'Notes stays hidden');
  assert.equal(await o.page.locator('#lb-notes').isVisible(), false);
  assert.deepEqual(appProblems(o), []);
});

test('ready: Write draws three numbered boxes in the photo, the words, a mark; Escape closes', async () => {
  const o = (current = await open(browser, 'desk', '/'));
  const api = await mockNotes(o, { ready: true });
  await o.page.locator('.frame').first().click();
  await lightboxShown(o.page);
  const notes = o.page.locator('#lb-notes-btn');
  await notes.waitFor({ state: 'visible' });
  await notes.click();
  const panel = o.page.locator('#lb-notes');
  assert.equal(await panel.isVisible(), true);
  assert.equal(await notes.getAttribute('aria-pressed'), 'true');
  assert.equal(await panel.getAttribute('role'), 'region');
  const write = o.page.locator('#lbn-write');
  assert.equal(await write.isDisabled(), true, 'empty intent: Write disabled');

  const id = await o.page.evaluate(`(() => { const m = location.hash.match(/photo=([a-f0-9]+)/i); return m ? m[1] : ''; })()`) as string;
  assert.ok(id, 'the photo id is in the address');
  await o.page.locator('#lbn-intent').fill('quiet morning street');
  assert.equal(await write.isDisabled(), false);
  await o.page.locator('#lbn-intent').press('Enter');
  await boxesDrawn(o.page, 3);

  const post = api.posts.find((p) => p.path === '/api/notes/words');
  assert.deepEqual(post?.body, { id, intent: 'quiet morning street' }, 'POST body has id and intent');
  assert.equal(await write.textContent(), 'Write');

  const g = await geometry(o.page);
  assertBoxesInPhoto(g, 3);
  assert.deepEqual(g.boxes.map((b) => [b.n, b.kind, b.badge]), [['1', 'priority', '1'], ['2', 'works', '2'], ['3', 'other', '3']]);

  const words = (await panel.innerText()).replace(/\s+/g, ' ');
  for (const s of [
    'The bright sign pulls the eye off the walker', 'It is the lightest patch in the frame', 'Edit', 'Masking: brush over the sign',
    'Next time', 'Step left so the post hides the sign.', 'Works', 'The walker’s long shadow', 'The kerb runs out of the corner', 'Useful', 'Not useful',
  ]) assert.ok(words.includes(s), `panel has “${s}”: ${words}`);
  for (const s of ['SEEN-TEXT', 'model-under-test', 'DROPPED-TEXT', '2026-11-25']) assert.ok(!words.includes(s), `panel leaves out “${s}”`);
  const faces = await o.page.evaluate(`(() => {
    const what = getComputedStyle(document.querySelector('.lbn-point .lbn-what'));
    const k = getComputedStyle(document.querySelector('.lbn-line .lbn-k'));
    return { whatFamily: what.fontFamily, whatStyle: what.fontStyle, kSize: k.fontSize, kStyle: k.fontStyle };
  })()`) as { whatFamily: string; whatStyle: string; kSize: string; kStyle: string };
  assert.ok(faces.whatFamily.includes('Fraunces') && faces.whatStyle === 'italic', `note in Fraunces italic: ${JSON.stringify(faces)}`);
  assert.ok(faces.kSize === '11px' && faces.kStyle === 'normal', `labels 11px upright: ${JSON.stringify(faces)}`);

  // A line lights its box.
  await o.page.locator('.lbn-point[data-n="2"]').hover();
  assert.equal(await o.page.locator('.lb-box[data-n="2"]').getAttribute('class'), 'lb-box on');

  // A zoomed photo hides the boxes; back to fit, they return.
  const zx = g.photo.left + g.photo.width * 0.8, zy = g.photo.top + g.photo.height * 0.35;
  await o.page.mouse.dblclick(zx, zy);
  await o.page.waitForFunction(`getComputedStyle(document.querySelector('.lb-boxes')).visibility === 'hidden'`);
  await o.page.mouse.dblclick(zx, zy);
  await boxesDrawn(o.page, 3);

  // Useful sends the mark with the note's key.
  const useful = o.page.locator('.lbn-mark[data-mark="useful"]');
  await useful.click();
  await o.page.waitForTimeout(300);
  const mark = api.posts.find((p) => p.path === '/api/notes/mark');
  assert.deepEqual(mark?.body, { id, key: 'note-key-1', mark: 'useful' });
  assert.equal(await useful.getAttribute('aria-pressed'), 'true');

  // Next photo: the panel stays, its own (empty) note; back again, the note returns.
  await o.page.locator('#lb-next').click();
  await o.page.waitForFunction(`document.querySelectorAll('.lb-boxes .lb-box').length === 0`);
  assert.equal(await panel.isVisible(), true, 'panel stays open on next');
  assert.equal(await o.page.locator('#lbn-intent').inputValue(), '');
  await o.page.locator('#lb-prev').click();
  await boxesDrawn(o.page, 3);
  assert.equal(await o.page.locator('#lbn-intent').inputValue(), 'quiet morning street');

  await o.page.keyboard.press('Escape');
  assert.equal(await panel.isVisible(), false, 'Escape closes the panel');
  assert.equal(await o.page.locator('#lightbox').isVisible(), true, 'and leaves the photo open');
  assert.equal(await o.page.evaluate(`document.activeElement && document.activeElement.id`), 'lb-notes-btn', 'focus back on Notes');
  assert.equal(await notes.getAttribute('aria-pressed'), 'false');
  await o.page.waitForFunction(`getComputedStyle(document.querySelector('.lb-boxes')).visibility === 'hidden'`);
  assert.deepEqual(appProblems(o), []);
});

test('a failed Write: the quiet note “Notes not written”, the reason one tap away', async () => {
  const o = (current = await open(browser, 'desk', '/'));
  await mockNotes(o, { ready: true, writeDelay: 700, writeError: { status: 502, body: { error: { reason: 'limit', message: 'Limit reached' } } } });
  await o.page.locator('.frame').first().click();
  await lightboxShown(o.page);
  await o.page.locator('#lb-notes-btn').click();
  await o.page.locator('#lbn-intent').fill('quiet morning street');
  await o.page.locator('#lbn-write').click();
  await o.page.waitForTimeout(150);
  assert.equal(await o.page.locator('#lbn-write').textContent(), 'Writing…', 'Write says it is writing');
  assert.equal(await o.page.locator('#lbn-write').isDisabled(), true);
  const note = o.page.locator('#lb-note');
  await note.waitFor({ state: 'visible' });
  const title = o.page.locator('#lb-note-title');
  assert.equal((await title.innerText()).trim(), 'Notes not written');
  assert.equal(await o.page.locator('#lb-note-why').isVisible(), false, 'the reason waits behind a tap');
  assert.equal(await o.page.locator('.lb-boxes .lb-box').count(), 0, 'no boxes');
  assert.equal(await o.page.locator('#lbn-write').textContent(), 'Write');
  await title.click();
  assert.equal(await title.getAttribute('aria-expanded'), 'true');
  assert.equal((await o.page.locator('#lb-note-why').innerText()).trim(), 'Limit reached');
  await o.page.locator('#lb-note-close').click();
  assert.equal(await note.isVisible(), false, 'dismissed');
  assert.deepEqual(appProblems(o), []);
});

test('phone: Notes is under More; the sheet fits and the boxes sit inside the photo', async () => {
  const o = (current = await open(browser, 'phone', '/'));
  await mockNotes(o, { ready: true, storedIntent: 'quiet morning street' });
  await o.page.locator('.frame').first().tap();
  await lightboxShown(o.page);
  await o.page.waitForFunction(`document.getElementById('lb-notes-btn').hidden === false`);
  const notes = o.page.locator('#lb-notes-btn');
  assert.equal(await notes.isVisible(), false, 'Notes waits under More');
  await o.page.locator('#lb-more').tap();
  await notes.waitFor({ state: 'visible' });
  await notes.tap();
  await boxesDrawn(o.page, 3);
  assert.equal(await o.page.locator('#lbn-intent').inputValue(), 'quiet morning street', 'intent from the stored note');
  const sheet = await o.page.locator('#lb-notes').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = el.querySelector('.lbn-scroll') as HTMLElement;
    const tools = [...document.querySelectorAll('#lightbox .lb-tools > .lb-tool:not(.lb-close)')]
      .filter((b) => getComputedStyle(b).display !== 'none')
      .map((b) => b.getBoundingClientRect().top);
    return {
      left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height,
      wordsEnd: s.getBoundingClientRect().bottom, toolsTop: Math.min(...tools), overflowY: getComputedStyle(s).overflowY,
    };
  });
  assert.ok(sheet.wordsEnd <= sheet.toolsTop, `the words end above the tool bar: ${JSON.stringify(sheet)}`);
  const g = await geometry(o.page);
  assert.ok(sheet.left === 0 && Math.abs(sheet.right - g.vw) < 1, `the width of the screen: ${JSON.stringify(sheet)}`);
  assert.ok(Math.abs(sheet.bottom - g.vh) < 1 && sheet.height <= g.vh / 2 + 1, `at most the lower half: ${JSON.stringify(sheet)} in ${g.vh}`);
  assert.equal(sheet.overflowY, 'auto', 'scrolls inside');
  assert.ok(sheet.top >= g.photo.top + g.photo.height / 2 - 1, `the photo’s upper half stays clear: sheet ${sheet.top}, photo ${JSON.stringify(g.photo)}`);
  assertBoxesInPhoto(g, 3);
  // Every tool stays tappable over the sheet.
  const tools = await o.page.evaluate(`[...document.querySelectorAll('#lightbox .lb-tools > .lb-tool')]
    .filter((b) => getComputedStyle(b).display !== 'none')
    .map((b) => { const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { id: b.id, top: b === hit || b.contains(hit) }; })`) as { id: string; top: boolean }[];
  assert.deepEqual(tools.filter((t) => !t.top), [], `tools over the sheet: ${JSON.stringify(tools)}`);
  assert.deepEqual(appProblems(o), []);
});

test('nothing stands out: one line, then the other points numbered from 1', async () => {
  const o = (current = await open(browser, 'desk', '/'));
  await mockNotes(o, {
    ready: false,
    storedIntent: 'empty beach',
    words: {
      seen: 'A beach', priority: null, nothing_stands_out: true,
      works: { box: [0.2, 0.3, 0.4, 0.3], what: 'The haze holds the islands together' }, others: [],
    },
  });
  await o.page.locator('.frame').first().click();
  await lightboxShown(o.page);
  const notes = o.page.locator('#lb-notes-btn');
  await notes.waitFor({ state: 'visible' });   // not ready, but this photo has a stored note
  await notes.click();
  await boxesDrawn(o.page, 1);
  const rows = await o.page.locator('#lbn-points > li').evaluateAll((lis) => lis.map((li) => (li as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
  assert.deepEqual(rows, ['Nothing stands out', '1 Works The haze holds the islands together']);
  const g = await geometry(o.page);
  assertBoxesInPhoto(g, 1);
  assert.equal(g.boxes[0].kind, 'works');
  assert.deepEqual(appProblems(o), []);
});

test('an intent typed while Writing… is kept when the answer comes', async () => {
  const o = (current = await open(browser, 'desk', '/'));
  await mockNotes(o, { ready: true, writeDelay: 1200 });
  await o.page.locator('.frame').first().click();
  await lightboxShown(o.page);
  await o.page.locator('#lb-notes-btn').click();
  const intent = o.page.locator('#lbn-intent');
  await intent.fill('quiet morning street');
  await o.page.locator('#lbn-write').click();
  await o.page.waitForTimeout(150);
  await intent.fill('the walker, not the sign');
  await boxesDrawn(o.page, 3);
  assert.equal(await intent.inputValue(), 'the walker, not the sign', 'the edit survives the answer');
  assert.equal(await intent.getAttribute('maxlength'), '300');
  assert.deepEqual(appProblems(o), []);
});

test('a failed mark: the quiet note “Mark not saved”, the reason one tap away', async () => {
  const o = (current = await open(browser, 'desk', '/'));
  await mockNotes(o, { ready: true, storedIntent: 'quiet morning street', markError: { status: 404, body: { error: { reason: 'no-note', message: 'Note not found' } } } });
  await o.page.locator('.frame').first().click();
  await lightboxShown(o.page);
  await o.page.locator('#lb-notes-btn').click();
  await boxesDrawn(o.page, 3);
  const useful = o.page.locator('.lbn-mark[data-mark="useful"]');
  await useful.click();
  const title = o.page.locator('#lb-note-title');
  await o.page.locator('#lb-note').waitFor({ state: 'visible' });
  assert.equal((await title.innerText()).trim(), 'Mark not saved');
  await title.click();
  assert.equal((await o.page.locator('#lb-note-why').innerText()).trim(), 'Note not found');
  assert.equal(await useful.getAttribute('aria-pressed'), 'false', 'the press is taken back');
  assert.deepEqual(appProblems(o), []);
});

test('a note the checks emptied: no points, no marks, the quiet note', async () => {
  const o = (current = await open(browser, 'desk', '/'));
  await mockNotes(o, { ready: true, writeWords: { seen: 'A street', priority: null, works: null, others: [], nothing_stands_out: false } });
  await o.page.locator('.frame').first().click();
  await lightboxShown(o.page);
  await o.page.locator('#lb-notes-btn').click();
  await o.page.locator('#lbn-intent').fill('quiet morning street');
  await o.page.locator('#lbn-write').click();
  await o.page.locator('#lb-note').waitFor({ state: 'visible' });
  assert.equal((await o.page.locator('#lb-note-title').innerText()).trim(), 'Notes not written');
  await o.page.locator('#lb-note-title').click();
  assert.equal((await o.page.locator('#lb-note-why').innerText()).trim(), 'Nothing held up to the checks');
  assert.equal(await o.page.locator('#lbn-points').isVisible(), false);
  assert.equal(await o.page.locator('#lbn-marks').isVisible(), false);
  assert.equal(await o.page.locator('.lb-boxes .lb-box').count(), 0);
  assert.deepEqual(appProblems(o), []);
});

test('Details and Notes: one at a time', async () => {
  const o = (current = await open(browser, 'desk', '/'));
  await mockNotes(o, { ready: true, storedIntent: 'quiet morning street' });
  await o.page.locator('.frame').first().click();
  await lightboxShown(o.page);
  const lbClass = () => o.page.locator('#lightbox').getAttribute('class');
  await o.page.locator('#lb-info').click();
  assert.match(String(await lbClass()), /\bdetails\b/);
  await o.page.locator('#lb-notes-btn').click();
  assert.equal(await o.page.locator('#lb-notes').isVisible(), true);
  assert.doesNotMatch(String(await lbClass()), /\bdetails\b/, 'Notes turns Details off');
  await o.page.locator('#lb-info').click();
  assert.match(String(await lbClass()), /\bdetails\b/);
  assert.equal(await o.page.locator('#lb-notes').isVisible(), false, 'Details closes Notes');
  assert.equal(await o.page.locator('#lb-notes-btn').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(appProblems(o), []);
});

test('desk: the panel moves to the right when the priority box sits under it on the left', async () => {
  const o = (current = await open(browser, 'desk', '/'));
  await mockNotes(o, {
    ready: true,
    storedIntent: 'quiet morning street',
    words: {
      seen: 'A street', nothing_stands_out: false, others: [],
      priority: { box: [0.02, 0.6, 0.35, 0.38], what: 'The bin in the corner pulls the eye', why: 'It is the brightest thing low down.', edit: 'Masking: brush, Exposure −0.5.', next_time: 'Step right.' },
      works: { box: [0.6, 0.2, 0.2, 0.2], what: 'The light on the wall' },
    },
  });
  await o.page.locator('.frame').first().click();
  await lightboxShown(o.page);
  await o.page.locator('#lb-notes-btn').click();
  await boxesDrawn(o.page, 2);
  await o.page.waitForTimeout(100);
  assert.match(String(await o.page.locator('#lb-notes').getAttribute('class')), /\bright\b/);
  const overlap = await o.page.evaluate(`(() => {
    const p = document.getElementById('lb-notes').getBoundingClientRect();
    const b = document.querySelector('.lb-boxes .lb-box[data-kind="priority"]').getBoundingClientRect();
    return Math.max(0, Math.min(p.right, b.right) - Math.max(p.left, b.left)) * Math.max(0, Math.min(p.bottom, b.bottom) - Math.max(p.top, b.top));
  })()`) as number;
  assert.equal(overlap, 0, 'the priority box is clear of the panel');
  assert.deepEqual(appProblems(o), []);
});

// ---------------------------------------------------------------------------
// Screenshots (NOTES_SHOTS=1): a stored note, at desk, iPad and phone, in both
// colour schemes.
const SHOTS = process.env.NOTES_SHOTS === '1';
const SHOT_DIR = fileURLToPath(new URL('../node_modules/.cache/notes-words/shots/', import.meta.url));

for (const size of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`shot: ${size} ${scheme}`, { skip: !SHOTS }, async () => {
      const o = (current = await open(browser, size, '/', { context: { colorScheme: scheme } }));
      await mockNotes(o, { ready: true, storedIntent: 'quiet morning street' });
      const frame = o.page.locator('.frame').first();
      if (size === 'phone') await frame.tap(); else await frame.click();
      await lightboxShown(o.page);
      await o.page.waitForFunction(`document.getElementById('lb-notes-btn').hidden === false`);
      if (size === 'phone') await o.page.locator('#lb-more').tap();
      const notes = o.page.locator('#lb-notes-btn');
      await notes.waitFor({ state: 'visible' });
      if (size === 'phone') await notes.tap(); else await notes.click();
      await boxesDrawn(o.page, 3);
      if (size === 'desk') await o.page.locator('.lbn-point[data-n="1"]').hover();
      await o.page.waitForTimeout(400);
      assertBoxesInPhoto(await geometry(o.page), 3);
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      await o.page.screenshot({ path: `${SHOT_DIR}notes-${size}-${scheme}.png` });
    });
  }
}

test('shot: desk error note', { skip: !SHOTS }, async () => {
  const o = (current = await open(browser, 'desk', '/'));
  await mockNotes(o, { ready: true, writeError: { status: 502, body: { error: { reason: 'limit', message: 'Limit reached' } } } });
  await o.page.locator('.frame').first().click();
  await lightboxShown(o.page);
  await o.page.locator('#lb-notes-btn').click();
  await o.page.locator('#lbn-intent').fill('quiet morning street');
  await o.page.locator('#lbn-write').click();
  await o.page.locator('#lb-note-title').click();
  await o.page.waitForTimeout(300);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await o.page.screenshot({ path: `${SHOT_DIR}notes-desk-error.png` });
});
