/**
 * Round 13 batch 1b and 1d: writes only from the app itself, and plain answers
 * to bad requests (R13-02 to R13-05). Needs the throwaway server; see tests/r13.ts.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { request as pwRequest, type Browser, type APIRequestContext } from 'playwright';
import { ORIGIN, DATA, launch, open } from './r13';

let browser: Browser;
let api: APIRequestContext;
before(async () => {
  assert.ok(DATA, 'E2E_DATA must name the throwaway data folder');
  browser = await launch();
  api = await pwRequest.newContext({ ignoreHTTPSErrors: true, baseURL: ORIGIN });
});
after(async () => {
  await api?.dispose();
  await browser?.close();
});

const store = (): { id: string; filename: string }[] =>
  JSON.parse(fs.readFileSync(path.join(DATA, '.archive/src/data/photos.json'), 'utf8'));
const someId = () => store()[0].id;

test('a write from another site is refused and changes nothing', async () => {
  const id = someId();
  const res = await api.post('/api/remove', { headers: { origin: 'https://evil.example', 'content-type': 'text/plain' }, data: JSON.stringify({ id }) });
  assert.equal(res.status(), 403);
  assert.ok(store().some((p) => p.id === id), 'the photo is still in the store');
  const viaReferer = await api.post('/api/remove', { headers: { referer: 'https://evil.example/x', 'content-type': 'application/json' }, data: '{"id":"x"}' });
  assert.equal(viaReferer.status(), 403);
});

test('a write from the app itself passes the origin check', async () => {
  const res = await api.post('/api/remove', { headers: { origin: ORIGIN, 'content-type': 'application/json' }, data: '{}' });
  assert.equal(res.status(), 400, 'reaches the route, which wants an id');
});

test('bad requests get a 400 or 404 with a short reason', async () => {
  const own = { origin: ORIGIN };
  // A Buffer, because Playwright JSON-encodes a string body sent as application/json.
  const bad = await api.post('/api/remove', { headers: { ...own, 'content-type': 'application/json' }, data: Buffer.from('{"id":') });
  assert.equal(bad.status(), 400);
  assert.equal((await bad.json()).error, 'Not valid JSON');
  const badAdd = await api.post('/api/inspiration/add', { headers: { ...own, 'content-type': 'application/json' }, data: Buffer.from('nope') });
  assert.equal(badAdd.status(), 400);
  const empty = await api.post('/api/upload', { headers: own });
  assert.equal(empty.status(), 400);
  assert.equal((await empty.json()).error, 'No files');
  const note = await api.post('/api/notes', { headers: { ...own, 'content-type': 'application/json' }, data: { id: 'nope', text: 'hello' } });
  assert.equal(note.status(), 404);
  const weather = await api.get('/api/scout/weather');
  assert.equal(weather.status(), 400);
});

test('upload, remove, undo, then remove for real, in a browser', async () => {
  const name = `r13-e2e-${Date.now()}.jpg`;
  const file = path.join(DATA, '..', name);
  await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 40, g: 90, b: 160 } } }).jpeg().toFile(file);
  const o = await open(browser, 'desk', '/upload');
  try {
    const upload = o.page.waitForResponse((r) => r.url().endsWith('/api/upload'));
    await o.page.setInputFiles('#file', file);
    assert.equal((await upload).status(), 200);
    const id = store().find((p) => p.filename.startsWith(name.replace(/\.jpg$/, '')))?.id;
    assert.ok(id, 'the upload is in the store');

    await o.page.reload({ waitUntil: 'load' });
    await o.page.waitForTimeout(1000);
    const cell = o.page.locator(`figure.cell[data-id="${id}"]`);
    await cell.hover();
    await cell.locator('.cell-remove').click();
    await o.page.locator('.undo-btn').click();
    assert.equal(await cell.count(), 1, 'Undo put the cell back');

    await cell.hover();
    await cell.locator('.cell-remove').click();
    const removed = await o.page.waitForResponse((r) => r.url().endsWith('/api/remove'), { timeout: 15_000 });
    assert.equal(removed.status(), 200);
    assert.ok(!store().some((p) => p.id === id), 'gone from the store after the Undo window');
    assert.deepEqual(o.problems, []);
  } finally {
    await o.ctx.close();
    fs.rmSync(file, { force: true });
  }
});
