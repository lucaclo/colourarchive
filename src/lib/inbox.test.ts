import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEntry, settle, latestImport, failureKey, type Seen } from './inbox';

test('classifyEntry: images, RAW, iCloud placeholders and everything else', () => {
  assert.equal(classifyEntry('DSC01234.jpg'), 'image');
  assert.equal(classifyEntry('Kyoto.JPEG'), 'image');
  assert.equal(classifyEntry('scan.tif'), 'image');
  assert.equal(classifyEntry('DSC01234.ARW'), 'raw');
  assert.equal(classifyEntry('IMG_1.dng'), 'raw');
  assert.equal(classifyEntry('.DSC01234.jpg.icloud'), 'placeholder');
  assert.equal(classifyEntry('.DS_Store'), 'ignore');
  assert.equal(classifyEntry('notes.txt'), 'ignore');
  assert.equal(classifyEntry('DSC01234.xmp'), 'ignore');
});

test('settle: a file is only ready once it has stopped changing for long enough', () => {
  const f = { name: 'a.jpg', size: 100, mtimeMs: 1 };
  let r = settle(new Map(), [f], 0, 4000);
  assert.deepEqual(r.ready, [], 'first sight is never ready');
  r = settle(r.next, [f], 2000, 4000);
  assert.deepEqual(r.ready, [], 'unchanged but not for long enough');
  r = settle(r.next, [f], 4000, 4000);
  assert.deepEqual(r.ready, ['a.jpg']);
});

test('settle: a growing file starts its wait again', () => {
  let r = settle(new Map(), [{ name: 'a.jpg', size: 50, mtimeMs: 1 }], 0, 4000);
  r = settle(r.next, [{ name: 'a.jpg', size: 100, mtimeMs: 2 }], 5000, 4000);
  assert.deepEqual(r.ready, []);
  assert.equal(r.next.get('a.jpg')!.since, 5000);
  r = settle(r.next, [{ name: 'a.jpg', size: 100, mtimeMs: 2 }], 9000, 4000);
  assert.deepEqual(r.ready, ['a.jpg']);
});

test('settle: empty files wait, and files that left are forgotten', () => {
  const prev = new Map<string, Seen>([['gone.jpg', { size: 1, mtimeMs: 1, since: 0 }], ['empty.jpg', { size: 0, mtimeMs: 1, since: 0 }]]);
  const r = settle(prev, [{ name: 'empty.jpg', size: 0, mtimeMs: 1 }], 10_000, 4000);
  assert.deepEqual(r.ready, []);
  assert.equal(r.next.has('gone.jpg'), false);
});

test('failureKey: new bytes under the same name get another try', () => {
  assert.notEqual(failureKey({ name: 'a.jpg', size: 1, mtimeMs: 1 }), failureKey({ name: 'a.jpg', size: 2, mtimeMs: 1 }));
});

test('latestImport: groups the last export and stops at a long gap', () => {
  assert.equal(latestImport([]), null);
  const added = [
    { id: 'old', filename: 'o', at: '2026-10-01T10:00:00.000Z' },
    { id: 'a', filename: 'a', at: '2026-10-29T09:00:00.000Z' },
    { id: 'b', filename: 'b', at: '2026-10-29T09:04:00.000Z' },
    { id: 'c', filename: 'c', at: '2026-10-29T09:12:00.000Z' },
  ];
  const r = latestImport(added)!;
  assert.equal(r.count, 3);
  assert.equal(r.at, '2026-10-29T09:12:00.000Z');
  assert.deepEqual(r.ids.sort(), ['a', 'b', 'c']);
});
