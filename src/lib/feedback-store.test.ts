import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkFeedback, hasFeedback, importIssue, listFeedback, markDone, saveFeedback } from './feedback-store';
import { MAX_IMAGE_BYTES } from './feedback';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
const CTX = { page: '/scout', device: 'Mac app', viewport: '1440×900 @2x', build: '0.2.13 x' };
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'feedback-store-'));
let seq = 0;
const rand = () => new Uint8Array([seq++ % 256, 0]);

test('saves a note with its pictures, named by what they are', async () => {
  const dir = await tmp();
  const now = new Date(2026, 10, 25, 9, 5);
  const r = await saveFeedback(dir, { note: 'Too dark', context: CTX, images: [PNG, JPEG] }, now, rand);
  assert.ok(r.ok);
  const folder = path.join(dir, r.entry.id);
  assert.deepEqual((await fs.readdir(folder)).sort(), ['1.png', '2.jpg', 'note.md']);
  assert.deepEqual(new Uint8Array(await fs.readFile(path.join(folder, '1.png'))), PNG);
  const [listed] = await listFeedback(dir);
  assert.equal(listed.note, 'Too dark');
  assert.equal(listed.page, '/scout');
  assert.equal(listed.source, 'mac');
  assert.deepEqual(listed.pictures, [path.join(folder, '1.png'), path.join(folder, '2.jpg')]);
  // No temp folder left behind.
  assert.deepEqual((await fs.readdir(dir)).filter((n) => n.startsWith('.')), []);
});

test('refuses empty, too many, too large, or not-a-picture', async () => {
  assert.equal(checkFeedback({ note: '', context: CTX, images: [] }), 'Add a note or a picture');
  assert.equal(checkFeedback({ note: 'x', context: CTX, images: [JPEG, JPEG, JPEG, JPEG, JPEG] }), 'At most 4 pictures');
  assert.equal(checkFeedback({ note: 'x', context: CTX, images: [new TextEncoder().encode('<svg/>')] }), 'Pictures must be JPEG, PNG or WebP');
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(JPEG);
  assert.equal(checkFeedback({ note: '', context: CTX, images: [big] }), 'A picture is too large');
  assert.equal(checkFeedback({ note: '', context: CTX, images: [JPEG] }), null);
  const dir = await tmp();
  const r = await saveFeedback(dir, { note: '', context: CTX, images: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(await fs.readdir(dir).catch(() => []), []);
});

test('two in the same minute with the same draw get different ids', async () => {
  const dir = await tmp();
  const now = new Date(2026, 10, 25, 9, 5);
  let n = 0;
  const same = () => new Uint8Array([n++ < 2 ? 1 : 2, 0]);
  const a = await saveFeedback(dir, { note: 'a', context: CTX, images: [] }, now, same);
  const b = await saveFeedback(dir, { note: 'b', context: CTX, images: [] }, now, same);
  assert.ok(a.ok && b.ok);
  assert.notEqual(a.entry.id, b.entry.id);
  assert.equal((await listFeedback(dir)).length, 2);
});

test('done moves it out of the open list, keeps it, and notes when', async () => {
  const dir = await tmp();
  const r = await saveFeedback(dir, { note: 'Fix me', context: CTX, images: [JPEG] }, new Date(2026, 10, 25, 9, 5), rand);
  assert.ok(r.ok);
  const done = await markDone(dir, r.entry.id, new Date('2026-11-26T10:00:00Z'));
  assert.equal(done?.done, '2026-11-26T10:00:00.000Z');
  assert.deepEqual(await listFeedback(dir), []);
  const [kept] = await listFeedback(dir, 'done');
  assert.equal(kept.id, r.entry.id);
  assert.equal(kept.done, '2026-11-26T10:00:00.000Z');
  assert.ok(kept.pictures[0].includes(`${path.sep}done${path.sep}`));
  assert.ok(await hasFeedback(dir, r.entry.id));
  assert.equal(await markDone(dir, r.entry.id), null, 'already done');
  assert.equal(await markDone(dir, '../escape'), null);
});

test('an issue comes in as gh-<n>, keeping only real pictures', async () => {
  const dir = await tmp();
  const entry = await importIssue(
    dir,
    { number: 12, url: 'https://github.com/o/r/issues/12', note: 'From the phone', context: CTX, created: '2026-11-25T10:00:00Z' },
    [JPEG, new TextEncoder().encode('Not Found'), PNG],
  );
  assert.equal(entry.id, 'gh-12');
  assert.deepEqual(entry.images, ['1.jpg', '2.png']);
  const [listed] = await listFeedback(dir);
  assert.equal(listed.issue, 12);
  assert.equal(listed.source, 'github');
  assert.ok(await hasFeedback(dir, 'gh-12'));
});

test('nothing is written under a name that isn’t a feedback id', async () => {
  const dir = await tmp();
  await assert.rejects(
    importIssue(dir, { number: -1, url: '', note: 'x', context: CTX, created: '' }, []),
    /Not a feedback id/,
  );
  assert.deepEqual(await fs.readdir(dir), []);
});

test('a missing folder is an empty list, and stray files are ignored', async () => {
  const dir = await tmp();
  assert.deepEqual(await listFeedback(path.join(dir, 'nope')), []);
  await fs.mkdir(path.join(dir, 'gh-3'));
  await fs.writeFile(path.join(dir, 'gh-3', 'note.md'), 'not front matter');
  await fs.writeFile(path.join(dir, '.DS_Store'), '');
  assert.deepEqual(await listFeedback(dir), []);
});
