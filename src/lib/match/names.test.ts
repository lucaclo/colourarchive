import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoName, matchTitle } from './names.ts';

test('photoName strips the extension and the content hash', () => {
  assert.equal(photoName('DSC06160.b4490759aa4afe19.jpg'), 'DSC06160');
  assert.equal(photoName('DSC01234.ARW'), 'DSC01234');
  assert.equal(photoName('/Users/me/Pictures/Rome evening.HEIC'), 'Rome evening');
});

test('photoName returns empty for a name that is only a hash', () => {
  assert.equal(photoName('008f7d3eff93aa1f-1280.avif'), '');
  assert.equal(photoName('b4490759aa4afe19.jpg'), '');
});

test('photoName keeps ordinary words and short numbers', () => {
  assert.equal(photoName('pantheon-2.jpg'), 'pantheon-2');
  assert.equal(photoName('cafe.webp'), 'cafe');
});

test('matchTitle falls back to plain words', () => {
  assert.equal(matchTitle('008f7d3eff93aa1f-1280.avif', ['DSC06160.b4490759aa4afe19.jpg']), 'Your photo in the look of DSC06160');
  assert.equal(matchTitle('DSC1.ARW', ['a.jpg', 'b.jpg']), 'DSC1 in the look of 2 references');
  assert.equal(matchTitle('DSC1.ARW', ['0123456789abcdef.jpg']), 'DSC1 in the look of the reference');
});

test('photoName keeps a year, drops only derivative widths', () => {
  assert.equal(photoName('trip-2024.jpg'), 'trip-2024');
  assert.equal(photoName('rome-640.avif'), 'rome');
});
