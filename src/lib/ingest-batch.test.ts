import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

// A private data root, so originals never land in the repo's photos/.
// paths.ts fixes PHOTOS_DIR when it loads, so this comes before the imports.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-batch-'));
process.env.COLOUR_ARCHIVE_DATA = root;
const { ingestBatch, plainReason, sizeNote } = await import('./ingest-batch');
const { slugName, hashBuffer } = await import('./ingest');
const { PHOTOS_DIR } = await import('./paths');

after(() => fs.rm(root, { recursive: true, force: true }));

const originals = async () => (await fs.readdir(PHOTOS_DIR)).filter((n) => !n.startsWith('.')).sort();
// The error sharp gives for these bytes (an empty buffer throws in its constructor).
const sharpError = async (buf: Buffer): Promise<unknown> => {
  try {
    await sharp(buf, { failOn: 'none' }).metadata();
    return null;
  } catch (e) {
    return e;
  }
};

test('a file that fails to decode leaves no original behind, and says why in plain words', async () => {
  const results = await ingestBatch([
    { name: 'notes.jpg', read: async () => Buffer.from('not a picture at all') },
    { name: 'zero.jpg', read: async () => Buffer.alloc(0) },
  ]);
  assert.deepEqual(results.map((r) => [r.status, r.error]), [
    ['error', 'Not a picture we can read'],
    ['error', 'Empty file'],
  ]);
  assert.deepEqual(await originals(), []);
});

test('an original that was already on disk is never removed when the import fails', async () => {
  const buf = Buffer.from('an earlier copy, still not a picture');
  const name = `kept.${hashBuffer(buf)}.jpg`;
  await fs.mkdir(PHOTOS_DIR, { recursive: true });
  await fs.writeFile(path.join(PHOTOS_DIR, name), buf);
  const [r] = await ingestBatch([{ name: 'kept.jpg', read: async () => buf }]);
  assert.equal(r.status, 'error');
  assert.deepEqual(await originals(), [name]);
});

test('plainReason: the image library’s words, put plainly', async () => {
  assert.equal(plainReason(await sharpError(Buffer.from('hello'))), 'Not a picture we can read');
  assert.equal(plainReason(await sharpError(Buffer.alloc(0))), 'Empty file');
  assert.equal(plainReason(new Error('EACCES: permission denied')), "Couldn't add this one");
});

test('slugName: accents fold instead of being dropped; plain names are unchanged', () => {
  assert.equal(slugName('café été'), 'cafe-ete');
  assert.equal(slugName('DSC06420-2'), 'DSC06420-2');
  assert.equal(slugName('IMG_4414'), 'IMG_4414');
  assert.equal(slugName('my photo (1)'), 'my-photo-1-');
});

test('sizeNote: a 30 × 30 picture is noted with its real size; ordinary ones are not', async () => {
  const tiny = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#c33' } }).jpeg().toBuffer();
  const meta = await sharp(tiny).metadata();
  assert.equal(sizeNote(meta.width!, meta.height!), 'Very small (30 × 30)');
  assert.equal(sizeNote(200, 30), undefined);
  assert.equal(sizeNote(6000, 4000), undefined);
});
