import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trashName, shownName } from './removed';

test('a removed photo is named by one plain file name', () => {
  assert.equal(trashName('DSC00001.0123456789abcdef.jpg'), 'DSC00001.0123456789abcdef.jpg');
  assert.equal(trashName('café été.0123456789abcdef.jpeg'), 'café été.0123456789abcdef.jpeg');
});

test('anything that could reach outside the trash is refused', () => {
  for (const bad of [
    '../photos.json', 'a/b.jpg', '/etc/passwd', '..', '.', '..\\photos.json', 'a\\b.jpg',
    '.DS_Store', '.trash', 'x\u0000.jpg', 'x\n.jpg', '', 'a'.repeat(256), null, undefined, 42, ['a.jpg'], { name: 'a.jpg' },
  ]) {
    assert.equal(trashName(bad), null, `refused: ${JSON.stringify(bad)}`);
  }
});

test('the shown name drops the hash the store adds', () => {
  assert.equal(shownName('DSC06549.3fa2b1c4d5e6f708.jpg'), 'DSC06549.jpg');
  assert.equal(shownName('IMG_3390.007e0e843a0308c5.jpeg'), 'IMG_3390.jpeg');
  assert.equal(shownName('holiday.2024.jpg'), 'holiday.2024.jpg', 'no hash, left alone');
});
