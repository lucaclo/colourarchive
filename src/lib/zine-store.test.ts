import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readZine, saveZine, savePhoto, readPhoto, localPhotoKeys, isPhotoKey, EMPTY_ZINE_VERSION, MAX_ZINE_BYTES } from './zine-store';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function place() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zine-store-'));
  return { file: path.join(root, 'zine.json'), dir: path.join(root, 'zine') };
}

const doc = (title: string, local: string[] = []) => ({
  cover: { title },
  pages: local.map((id) => ({ photo: { kind: 'local', id, thumb: '', full: '' } })),
});

test('before the first save there is no zine', async () => {
  const { file, dir } = await place();
  assert.deepEqual(await readZine(file, dir), { doc: null, version: EMPTY_ZINE_VERSION, photos: [] });
});

test('a save based on the version on disk is written and read back', async () => {
  const { file, dir } = await place();
  const first = await saveZine({ version: EMPTY_ZINE_VERSION, doc: doc('One') }, file, dir);
  assert.equal(first.status, 200);
  const read = await readZine(file, dir);
  assert.deepEqual(read.doc, doc('One'));
  assert.equal(read.version, (first as { version: string }).version);

  const second = await saveZine({ version: read.version, doc: doc('Two') }, file, dir);
  assert.equal(second.status, 200);
  assert.deepEqual(JSON.parse(await fs.readFile(`${file}.bak`, 'utf8')), doc('One'), 'the replaced zine is kept as .bak');
});

test('a stale or missing version is refused and nothing is written', async () => {
  const { file, dir } = await place();
  const first = (await saveZine({ version: EMPTY_ZINE_VERSION, doc: doc('Mine') }, file, dir)) as { version: string };
  const stale = await saveZine({ version: EMPTY_ZINE_VERSION, doc: doc('Other tab') }, file, dir);
  assert.deepEqual(stale, { status: 409, version: first.version });
  assert.equal((await saveZine({ doc: doc('No version') }, file, dir)).status, 409);
  assert.deepEqual((await readZine(file, dir)).doc, doc('Mine'));
});

test('two saves from the same version at once: one wins, one is refused', async () => {
  const { file, dir } = await place();
  const [a, b] = await Promise.all([
    saveZine({ version: EMPTY_ZINE_VERSION, doc: doc('A') }, file, dir),
    saveZine({ version: EMPTY_ZINE_VERSION, doc: doc('B') }, file, dir),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
});

test('anything but an object of a sane size is a bad request', async () => {
  const { file, dir } = await place();
  assert.equal((await saveZine(null, file, dir)).status, 400);
  assert.equal((await saveZine({ version: EMPTY_ZINE_VERSION, doc: 'x' }, file, dir)).status, 400);
  assert.equal((await saveZine({ version: EMPTY_ZINE_VERSION, doc: [1] }, file, dir)).status, 400);
  assert.equal((await saveZine({ version: EMPTY_ZINE_VERSION, doc: { t: 'x'.repeat(MAX_ZINE_BYTES) } }, file, dir)).status, 400);
  await assert.rejects(fs.access(file), 'nothing written');
});

test('a zine file that no longer parses fails the read rather than reading as empty', async () => {
  const { file, dir } = await place();
  await fs.writeFile(file, '{"cover":');
  await assert.rejects(readZine(file, dir));
});

test('a photo folder that can’t be read fails the read rather than listing no photos', async () => {
  const { file, dir } = await place();
  await saveZine({ version: EMPTY_ZINE_VERSION, doc: doc('Kept', ['local-1-a']) }, file, dir);
  await fs.writeFile(dir, 'not a folder'); // readdir answers ENOTDIR, not ENOENT
  await assert.rejects(readZine(file, dir));
});

test('the device photos a zine uses are found wherever they sit', () => {
  const keys = localPhotoKeys({
    pages: [{ photo: { kind: 'local', id: 'local-1-a' } }, { photo: { kind: 'archive', id: 'abc' } }, { photo: null }],
    merged: { '2-3': { photo: { kind: 'local', id: 'local-2-b' } } },
    junk: { kind: 'local', id: '../etc/passwd' },
  });
  assert.deepEqual([...keys].sort(), ['local-1-a', 'local-2-b']);
});

test('photo keys are the page’s own shape and nothing that leaves the folder', () => {
  assert.equal(isPhotoKey('local-1731790000000-k3j9x2'), true);
  for (const bad of ['', '../x', 'local-../../x', 'local-A', 'local-1/2', 'other-1', 'local-' + 'a'.repeat(65)]) {
    assert.equal(isPhotoKey(bad), false, bad);
  }
});

test('a JPEG is stored by key and served back; anything else is refused', async () => {
  const { dir } = await place();
  assert.deepEqual(await savePhoto('local-1-a', JPEG, dir), { ok: true });
  assert.deepEqual(new Uint8Array((await readPhoto('local-1-a', dir))!), JPEG);
  assert.equal((await savePhoto('local-1-b', new Uint8Array([0x89, 0x50, 0x4e, 0x47]), dir)).ok, false);
  assert.equal((await savePhoto('../evil', JPEG, dir)).ok, false);
  assert.equal(await readPhoto('../evil', dir), null);
  assert.equal(await readPhoto('local-9-z', dir), null);
});

test('a save clears photos nothing uses once they are a day old, and keeps the rest', async () => {
  const { file, dir } = await place();
  for (const k of ['local-1-used', 'local-2-old', 'local-3-new']) await savePhoto(k, JPEG, dir);
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await fs.utimes(path.join(dir, 'local-2-old.jpg'), old, old);
  await fs.utimes(path.join(dir, 'local-1-used.jpg'), old, old);
  await saveZine({ version: EMPTY_ZINE_VERSION, doc: doc('Kept', ['local-1-used']) }, file, dir);
  assert.deepEqual((await readZine(file, dir)).photos.sort(), ['local-1-used', 'local-3-new']);
});
