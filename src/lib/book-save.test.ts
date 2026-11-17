import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { EMPTY_BOOK_VERSION, bookVersionOf, mergeBookCuration, parseBookPatch, readBookState, saveBookCuration } from './book.ts';

// Every test writes to its own temporary book file, never src/data/book.json.
const SAVED = {
  chapters: { a: ['1', '2', '3'], b: ['4'] },
  excluded: ['2'],
  moved: { '3': 'b' },
  layout: { '1': 'pair' },
  blankBefore: ['4'],
  trim: 'a4-port',
};

function bookFile(content: unknown = SAVED): { file: string; bytes: () => Buffer; version: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'book-save-test-'));
  const file = path.join(dir, 'book.json');
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
  return { file, bytes: () => fs.readFileSync(file), version: bookVersionOf(fs.readFileSync(file)) };
}

const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('saveBookCuration', () => {
  it('refuses to write over a book file that no longer parses, and keeps no backup of it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'book-save-test-'));
    const file = path.join(dir, 'book.json');
    const broken = '{"chapters": {"a": ["1", "2"],}, "trim": "a4-port"}';
    fs.writeFileSync(file, broken);
    const version = bookVersionOf(fs.readFileSync(file));
    await assert.rejects(saveBookCuration({ version, excluded: ['1'] }, file));
    assert.equal(fs.readFileSync(file, 'utf8'), broken);
    assert.equal(fs.existsSync(`${file}.bak`), false);
  });

  it('treats an empty chapters object as nothing to change, not as forgetting every order', async () => {
    const book = bookFile();
    const result = await saveBookCuration({ version: book.version, chapters: {} }, book.file);
    assert.equal(result.status, 200);
    assert.deepEqual(read(book.file).chapters, SAVED.chapters);
  });

  it('leaves the file byte for byte as it was on {} with the right version', async () => {
    const book = bookFile();
    const before = book.bytes();
    const result = await saveBookCuration({ version: book.version }, book.file);
    assert.deepEqual(result, { status: 200, version: book.version });
    assert.ok(book.bytes().equals(before));
    assert.equal(fs.existsSync(`${book.file}.bak`), false);
  });

  it('refuses an unknown trim with a 400 and writes nothing', async () => {
    const book = bookFile();
    const before = book.bytes();
    const result = await saveBookCuration({ version: book.version, trim: 'banana' }, book.file);
    assert.equal(result.status, 400);
    assert.ok(book.bytes().equals(before));
    // Without a version too, and for a key that only the prototype has.
    assert.equal((await saveBookCuration({ trim: 'banana' }, book.file)).status, 400);
    assert.equal((await saveBookCuration({ version: book.version, trim: 'toString' }, book.file)).status, 400);
    assert.ok(book.bytes().equals(before));
  });

  it('refuses a body that is not a JSON object', async () => {
    const book = bookFile();
    const before = book.bytes();
    for (const body of [null, [], 'x', 3]) assert.equal((await saveBookCuration(body, book.file)).status, 400);
    assert.ok(book.bytes().equals(before));
  });

  it('keeps every field a save leaves out', async () => {
    const book = bookFile();
    const result = await saveBookCuration({ version: book.version, excluded: ['1'] }, book.file);
    assert.equal(result.status, 200);
    assert.deepEqual(read(book.file), { ...SAVED, excluded: ['1'] });
  });

  it('clears moves when moved is sent empty, and the other emptied fields likewise', async () => {
    const book = bookFile();
    const result = await saveBookCuration({ version: book.version, moved: {} }, book.file);
    assert.equal(result.status, 200);
    const after = read(book.file);
    assert.equal(after.moved, undefined);
    assert.deepEqual(after.chapters, SAVED.chapters);

    const again = await saveBookCuration({ version: (result as { version: string }).version, excluded: [], layout: {}, blankBefore: [] }, book.file);
    assert.equal(again.status, 200);
    assert.deepEqual(read(book.file), { chapters: SAVED.chapters, trim: SAVED.trim });
  });

  it('answers 409 with the current version when the file changed since, and changes nothing', async () => {
    const book = bookFile();
    const before = book.bytes();
    const stale = bookVersionOf(Buffer.from('{}'));
    const result = await saveBookCuration({ version: stale, excluded: [] }, book.file);
    assert.deepEqual(result, { status: 409, version: book.version });
    assert.ok(book.bytes().equals(before));
  });

  it('answers 409 to a save with no version at all', async () => {
    const book = bookFile();
    const before = book.bytes();
    const result = await saveBookCuration({ excluded: [] }, book.file);
    assert.deepEqual(result, { status: 409, version: book.version });
    assert.ok(book.bytes().equals(before));
  });

  it('keeps the previous file as book.json.bak and returns the new version', async () => {
    const book = bookFile();
    const before = book.bytes();
    const result = await saveBookCuration({ version: book.version, trim: 'a5-port' }, book.file);
    assert.equal(result.status, 200);
    assert.ok(fs.readFileSync(`${book.file}.bak`).equals(before));
    assert.equal((result as { version: string }).version, bookVersionOf(book.bytes()));
    assert.notEqual((result as { version: string }).version, book.version);
    assert.equal(read(book.file).trim, 'a5-port');
  });

  it('lets only one of two saves based on the same version through', async () => {
    const book = bookFile();
    const [first, second] = await Promise.all([
      saveBookCuration({ version: book.version, excluded: ['1'] }, book.file),
      saveBookCuration({ version: book.version, excluded: ['3'] }, book.file),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 409);
    assert.deepEqual(read(book.file).excluded, ['1']);
  });

  it('creates the file on a first save naming the empty version', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'book-save-test-'));
    const file = path.join(dir, 'book.json');
    assert.equal((await readBookState(file)).version, EMPTY_BOOK_VERSION);
    const result = await saveBookCuration({ version: EMPTY_BOOK_VERSION, trim: 'a4-land' }, file);
    assert.equal(result.status, 200);
    assert.deepEqual(read(file), { trim: 'a4-land' });
    assert.equal(fs.existsSync(`${file}.bak`), false);
  });
});

describe('parseBookPatch and mergeBookCuration', () => {
  it('refuses a present field of the wrong shape', () => {
    for (const body of [{ chapters: [] }, { chapters: { a: [1] } }, { excluded: 'x' }, { moved: { a: 1 } }, { layout: { a: 'nonsense' } }, { blankBefore: [1] }, { trim: null }]) {
      assert.equal(parseBookPatch(body).ok, false, JSON.stringify(body));
    }
  });

  it('drops the default border and dedupes blank pages', () => {
    const parsed = parseBookPatch({ layout: { a: 'border', b: 'bleed' }, blankBefore: ['x', 'x'] });
    assert.deepEqual(parsed, { ok: true, patch: { layout: { b: 'bleed' }, blankBefore: ['x'] } });
  });

  it('replaces present fields, clears null ones and keeps absent ones', () => {
    assert.deepEqual(
      mergeBookCuration({ excluded: ['1'], moved: { '2': 'b' }, trim: 'a4-port' }, { excluded: ['3'], moved: null }),
      { excluded: ['3'], trim: 'a4-port' },
    );
  });
});
