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

test('matchTitle uses titles, not frame numbers, and falls back to plain words', () => {
  assert.equal(matchTitle('DSC06549.jpg', ['DSC00424-2.4b9770dd43935280.jpg']), 'Your photo in this look');
  assert.equal(matchTitle('008f7d3eff93aa1f-1280.avif', ['DSC06160.b4490759aa4afe19.jpg']), 'Your photo in this look');
  assert.equal(matchTitle('IMG_2863.ARW', ['a.jpg', 'b.jpg']), 'Your photo in the look of 2 references');
  assert.equal(matchTitle('DSC1.ARW', ['0123456789abcdef.jpg']), 'DSC1 in this look');
  assert.equal(matchTitle('DSCF0012.jpg', ['approaching-shadow-hong-kong-by-fan-ho.9c8bbaf0eab03262.webp']), 'Your photo in the look of Approaching shadow hong kong by Fan Ho');
  assert.equal(matchTitle('harbour at dusk.jpg', ['pantheon-2.jpg']), 'harbour at dusk in the look of pantheon-2');
});

test('photoName keeps a year, drops only derivative widths', () => {
  assert.equal(photoName('trip-2024.jpg'), 'trip-2024');
  assert.equal(photoName('rome-640.avif'), 'rome');
});

test('photoName drops names a machine gave the file', () => {
  assert.equal(photoName('734846020_18006134951936155_7311644261873608517_n.7150c54bfe25f2e0.jpg'), '');
  assert.equal(photoName('temp_image_D6CA033F-9923-4044-B01C-5C3F65A0C16D.8bf353c70b064fd0.webp'), '');
  assert.equal(photoName('Screenshot-2026-08-13-at-12-16-18.5fb880c287a47b42.png'), 'Screenshot-2026-08-13-at-12-16-18');
  assert.equal(photoName('IMG_20240512_183012.jpg'), 'IMG_20240512_183012');
});

test('photoName turns a web slug back into words, with its credit', () => {
  assert.equal(photoName('approaching-shadow-hong-kong-by-fan-ho.9c8bbaf0eab03262.webp'), 'Approaching shadow hong kong by Fan Ho');
  assert.equal(photoName('illuminated-gas-station-ballyscanlon.7871b3fe5a94c54a.jpeg'), 'Illuminated gas station ballyscanlon');
  assert.equal(photoName('Fan-Ho-1.1adaf557fb6801ff.avif'), 'Fan-Ho-1');
});
