import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import exifReader from 'exif-reader';
import sharp from 'sharp';
import { NotesError, writeNote, type WriteDeps } from './serve';
import { getNote, latestNote } from './store';
import { WordsError, type AskInput, type AskResult } from './words';

const KEY = 'AQ.test-key-serve-1234567890abcdef';

const good = {
  seen: 'A doorway lit from inside, a figure passing on the left.',
  priority: {
    box: [300, 0, 900, 250],
    what: 'The bright shopfront on the left pulls the eye from the doorway.',
    why: 'The doorway is the subject, and this patch is brighter and larger.',
    edit: 'Linear gradient from the left edge, Exposure −0.7.',
    next_time: 'Step two paces right so the shopfront falls out of frame.',
  },
  works: { box: [200, 400, 800, 650], what: 'The doorway’s warm light against the blue street.' },
  others: [],
  nothing_stands_out: false,
};

/** An archive of one photo, with camera EXIF and GPS that must never leave the Mac. */
async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-words-serve-'));
  const photo = path.join(dir, 'DSC01234.jpg');
  await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 120, g: 90, b: 60 } } })
    .withMetadata({
      exif: {
        IFD0: { Make: 'SONY', Model: 'ILCE-7CM2', ImageDescription: 'DSC01234.ARW' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 1234/100', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 3912/100' },
      },
    })
    .jpeg()
    .toFile(photo);
  const calls: AskInput[] = [];
  const deps: WriteDeps = {
    key: () => KEY,
    model: () => 'gemini-test',
    file: path.join(dir, 'notes-words.json'),
    photoFile: async (id) => (id === 'p1' ? photo : id === 'gone' ? path.join(dir, 'missing.jpg') : null),
    ask: async (input): Promise<AskResult> => {
      calls.push(input);
      return { raw: good, usage: { input: 1, output: 1, thinking: 0 } };
    },
  };
  return { dir, photo, calls, deps };
}

const rejectsWith = (p: Promise<unknown>, reason: string) =>
  assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof NotesError || err instanceof WordsError, String(err));
    assert.equal(err.reason, reason);
    assert.ok(!err.message.includes(KEY), `key in "${err.message}"`);
    return true;
  });

test('the fixture photo carries EXIF with GPS', async () => {
  const { photo } = await setup();
  const meta = await sharp(photo).metadata();
  assert.ok(meta.exif);
  assert.deepEqual(exifReader(meta.exif).GPSInfo?.GPSLatitude, [51, 30, 12.34]);
});

test('no key: no-key, and nothing is asked', async () => {
  const { deps, calls } = await setup();
  await rejectsWith(writeNote({ id: 'p1', intent: 'the lit doorway' }, { ...deps, key: () => '' }), 'no-key');
  assert.equal(calls.length, 0);
});

test('bad input and unknown photos are refused before anything is asked', async () => {
  const { deps, calls } = await setup();
  await rejectsWith(writeNote({ id: 'p1', intent: '   ' }, deps), 'bad-input');
  await rejectsWith(writeNote({ id: 'p1', intent: 'x'.repeat(301) }, deps), 'bad-input');
  await rejectsWith(writeNote({ id: 'nope', intent: 'the lit doorway' }, deps), 'no-photo');
  await rejectsWith(writeNote({ id: '', intent: 'the lit doorway' }, deps), 'no-photo');
  await rejectsWith(writeNote({ id: 'gone', intent: 'the lit doorway' }, deps), 'no-photo');
  assert.equal(calls.length, 0);
});

test('only the stripped frame and the intent are sent, and the frame has no EXIF or GPS', async () => {
  const { deps, calls } = await setup();
  const stored = await writeNote({ id: 'p1', intent: '  the lit doorway  ' }, deps);
  assert.equal(calls.length, 1);
  const sent = calls[0];
  assert.deepEqual(Object.keys(sent).sort(), ['frame', 'intent', 'key', 'model']);
  assert.equal(sent.intent, 'the lit doorway');
  const meta = await sharp(sent.frame).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.icc, undefined);
  assert.equal(meta.xmp, undefined);
  assert.equal(Math.max(meta.width!, meta.height!), 1568);
  const text = sent.frame.toString('latin1');
  for (const s of ['DSC01234', 'ILCE-7CM2', 'SONY', 'GPS', 'p1']) assert.ok(!text.includes(s), s);

  assert.equal(stored.id, 'p1');
  assert.equal(stored.intent, 'the lit doorway');
  assert.equal(stored.model, 'gemini-test');
  assert.equal(stored.mark, null);
  assert.ok(stored.note.priority, 'the note went through the validator');
  assert.deepEqual(stored.note.priority.box, [0, 0.3, 0.25, 0.6]);
  assert.ok(!Number.isNaN(Date.parse(stored.at)));
});

test('one request per frame per intent: the same intent is kept, fresh and a new intent ask again', async () => {
  const { deps, calls } = await setup();
  const first = await writeNote({ id: 'p1', intent: 'the lit doorway' }, deps);
  const again = await writeNote({ id: 'p1', intent: 'the lit doorway' }, deps);
  assert.equal(calls.length, 1, 'the second call is served from the store');
  assert.deepEqual(again, first);

  const fresh = await writeNote({ id: 'p1', intent: 'the lit doorway', fresh: true }, deps);
  assert.equal(calls.length, 2, 'fresh asks again');
  assert.equal(fresh.key, first.key);

  const other = await writeNote({ id: 'p1', intent: 'the figure on the left' }, deps);
  assert.equal(calls.length, 3, 'a different intent asks again');
  assert.notEqual(other.key, first.key);
  assert.equal((await latestNote('p1', deps.file))?.key, other.key);

  // Shown again from the store, the first note is the photo's latest once more.
  await writeNote({ id: 'p1', intent: 'the lit doorway' }, deps);
  assert.equal(calls.length, 3);
  assert.equal((await latestNote('p1', deps.file))?.key, first.key);
  assert.ok(await getNote(other.key, deps.file));
});

test('the key never reaches the stored file, a thrown message or the log', async (t) => {
  const { deps } = await setup();
  const logged: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logged.push(args.map(String).join(' ')));

  const stored = await writeNote({ id: 'p1', intent: 'the lit doorway' }, deps);
  assert.ok(!JSON.stringify(stored).includes(KEY));

  const failing = (err: Error): WriteDeps => ({ ...deps, ask: async () => Promise.reject(err) });
  await rejectsWith(writeNote({ id: 'p1', intent: 'a', fresh: true }, failing(new WordsError('key', `API key not valid: ${KEY}`))), 'key');
  await rejectsWith(writeNote({ id: 'p1', intent: 'b', fresh: true }, failing(new WordsError('limit', `quota for ${KEY}`))), 'limit');
  await rejectsWith(writeNote({ id: 'p1', intent: 'c', fresh: true }, failing(new TypeError(`fetch failed for ${KEY}`))), 'service');

  assert.equal(logged.length, 3);
  for (const line of logged) {
    assert.ok(!line.includes(KEY), `key in "${line}"`);
    assert.match(line, /\[key\]/, 'the detail is logged, scrubbed');
  }
  const onDisk = await fs.readFile(deps.file!, 'utf8');
  assert.ok(!onDisk.includes(KEY));
  assert.equal(Object.keys(JSON.parse(onDisk).notes).length, 1, 'a failed ask keeps nothing');
});
