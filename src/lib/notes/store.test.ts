import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getNote, latestNote, putNote, readNotesWords, setLatest, setMark, type StoredNote } from './store';

async function tempFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-words-store-'));
  return path.join(dir, '.archive', 'notes-words.json');
}

const note = (key: string, id: string, intent = 'the lit doorway'): StoredNote => ({
  key,
  id,
  intent,
  model: 'gemini-test',
  at: '2026-11-25T10:00:00.000Z',
  note: { seen: 'A doorway.', priority: null, works: null, others: [], nothing_stands_out: true },
  dropped: [],
  mark: null,
});

test('a missing file is an empty store', async () => {
  const file = await tempFile();
  assert.deepEqual(await readNotesWords(file), { version: 1, notes: {}, latest: {} });
  assert.equal(await latestNote('p1', file), null);
  assert.equal(await getNote('k1', file), null);
  assert.equal(await setMark('p1', 'k1', 'useful', file), false);
});

test('put, latest, get and mark round trip; latest follows the newest put per photo', async () => {
  const file = await tempFile();
  await putNote(note('k1', 'p1'), file);
  assert.equal((await latestNote('p1', file))?.key, 'k1');
  assert.deepEqual(await getNote('k1', file), note('k1', 'p1'));

  await putNote(note('k2', 'p1', 'the figure'), file);
  await putNote(note('k3', 'p2'), file);
  assert.equal((await latestNote('p1', file))?.key, 'k2');
  assert.equal((await latestNote('p2', file))?.key, 'k3');
  assert.equal((await getNote('k1', file))?.intent, 'the lit doorway', 'the older note is still kept');

  assert.equal(await setMark('p1', 'k1', 'useful', file), true);
  assert.equal((await getNote('k1', file))?.mark, 'useful');
  assert.equal(await setMark('p1', 'k1', 'not-useful', file), true);
  assert.equal((await getNote('k1', file))?.mark, 'not-useful');
  assert.equal(await setMark('p1', 'k1', null, file), true);
  assert.equal((await getNote('k1', file))?.mark, null);
  assert.equal(await setMark('p1', 'nope', 'useful', file), false, 'no such note');
  assert.equal(await setMark('p2', 'k1', 'useful', file), false, 'not that photo’s note');

  assert.equal(await setLatest('p1', 'k1', file), true);
  assert.equal((await latestNote('p1', file))?.key, 'k1');
  assert.equal(await setLatest('p1', 'nope', file), false);
  assert.equal((await latestNote('p1', file))?.key, 'k1');

  const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.deepEqual(Object.keys(onDisk.notes).sort(), ['k1', 'k2', 'k3']);
  assert.deepEqual(onDisk.latest, { p1: 'k1', p2: 'k3' });
  assert.deepEqual(await fs.readdir(path.dirname(file)), ['notes-words.json'], 'no temp file left behind');
});

test('writes at the same moment all land', async () => {
  const file = await tempFile();
  await Promise.all(Array.from({ length: 12 }, (_, i) => putNote(note(`k${i}`, `p${i % 3}`), file)));
  const s = await readNotesWords(file);
  assert.equal(Object.keys(s.notes).length, 12);
  assert.deepEqual(s.latest, { p0: 'k9', p1: 'k10', p2: 'k11' });
});

test('a file that no longer parses fails the read instead of being saved over', async () => {
  const file = await tempFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '{ "version": 1, "notes": {');
  await assert.rejects(latestNote('p1', file));
  await assert.rejects(putNote(note('k1', 'p1'), file));
  assert.equal(await fs.readFile(file, 'utf8'), '{ "version": 1, "notes": {');
});
