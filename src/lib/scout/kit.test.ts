import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kitFocalLengths, kitFromPhotos, parseLens, readKit, type KitPhoto } from './kit';

const d = (camera: string, lens: string, focalLength: string, n = 1): KitPhoto[] =>
  Array.from({ length: n }, () => ({ medium: 'digital', camera, lens, focalLength }));

test('lens names give a focal length or range and the widest aperture', () => {
  assert.deepEqual(parseLens('FE 24-50mm F2.8 G'), { min: 24, max: 50, aperture: 2.8 });
  assert.deepEqual(parseLens('FE 90mm F2.8 Macro G OSS'), { min: 90, max: 90, aperture: 2.8 });
  assert.deepEqual(parseLens('E PZ 16-50mm F3.5-5.6 OSS'), { min: 16, max: 50, aperture: 3.5 });
  assert.deepEqual(parseLens('Viltrox 28mm F4.5 FE'), { min: 28, max: 28, aperture: 4.5 });
  assert.equal(parseLens('----'), null);
});

test('the archive’s own pairings, most-used first, with sensor and megapixels', () => {
  const kit = kitFromPhotos([
    ...d('SONY ILCE-7CM2', 'FE 35mm F2.8 ZA', '35mm', 3),
    ...d('SONY ILCE-7CM2', 'FE 24-50mm F2.8 G', '50mm', 4),
    ...d('SONY ILCE-7CM2', 'FE 24-50mm F2.8 G', '24mm', 1),
    ...d('SONY ILCE-6400', 'E PZ 16-50mm F3.5-5.6 OSS', '16mm'),
    ...d('SONY ILCE-6400', 'Sony E PZ 16-50mm F3.5-5.6 OSS', '16mm'),
    ...d('RICOH IMAGING COMPANY, LTD. RICOH GR IIIx', 'GR LENS 26mm F2.8', '26mm'),
    { medium: 'film', camera: 'NORITSU KOKI EZ Controller' },
  ]);
  assert.deepEqual(kit.map((k) => k.label), ['a7C II · 24–50mm', 'a7C II · 35mm', 'a6400 · 16–50mm', 'GR IIIx']);
  const zoom = kit[0];
  assert.equal(zoom.sensor, 'ff');
  assert.equal(zoom.megapixels, 33);
  assert.equal(zoom.focalUsual, 50);
  assert.equal(zoom.maxAperture, 2.8);
  // "Sony E PZ…" and "E PZ…" are the same lens.
  assert.equal(kit[2].count, 2);
  assert.equal(kit[2].sensor, 'apsc');
});

test('an unknown body takes its format from the mount and its resolution from its files', () => {
  const [k] = kitFromPhotos([{ medium: 'digital', camera: 'SONY ILCE-1', lens: 'FE 20mm F1.8 G', focalLength: '20mm', width: 8640, height: 5760 }]);
  assert.equal(k.sensor, 'ff');
  assert.equal(k.megapixels, 50);
});

test('a zoom offers its ends and the usual stops between', () => {
  assert.deepEqual(kitFocalLengths({ focalMin: 24, focalMax: 50, focalUsual: 50 }), [24, 28, 35, 40, 50]);
  assert.deepEqual(kitFocalLengths({ focalMin: 35, focalMax: 35, focalUsual: 35 }), [35]);
});

test('a baked list is checked, not trusted', () => {
  assert.equal(readKit([{ id: 'x', label: 'x', sensor: 'ff', megapixels: 0, focalMin: 1, focalMax: 1, focalUsual: 1, maxAperture: 1 }]).length, 0);
  assert.deepEqual(readKit('nope'), []);
});
