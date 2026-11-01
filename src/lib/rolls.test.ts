import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileNumber, frameCaption, inferRolls, rollTitle } from './rolls';

const EZ7 = { camera: 'NORITSU KOKI EZ Controller', software: 'EZ Controller 6.70.007  (170607)' };
const EZ5 = { camera: 'NORITSU KOKI EZ Controller', software: 'EZ Controller 5.01.024  (091007)' };
const EZ6 = { camera: 'NORITSU KOKI EZ Controller', software: 'EZ Controller 6.10.011  (130930)' };
const PS = { camera: 'NORITSU KOKI EZ Controller', software: 'Adobe Photoshop CS3 Windows' };
const QSS = { camera: 'NORITSU KOKI QSS-32_33', software: 'QSS-32_33 6.00.020 2006.12.27' };

test('fileNumber reads the number and a re-scan suffix', () => {
  assert.deepEqual(fileNumber('IMG_2686.b7ff.jpg'), { n: 2686, variant: 0 });
  assert.deepEqual(fileNumber('IMG_2686-2.41cf.jpeg'), { n: 2686, variant: 1 });
  assert.equal(fileNumber('scan.abc.jpg'), null);
});

test('inferRolls splits on scanner, software version and number gaps', () => {
  const rolls = inferRolls([
    { id: 'a', filename: 'IMG_2683.x.jpg', ...EZ7 },
    { id: 'a2', filename: 'IMG_2683-2.x.jpg', ...EZ7 },
    { id: 'b', filename: 'IMG_2690.x.jpg', ...EZ7 },
    { id: 'c', filename: 'IMG_2700.x.jpg', ...EZ5 },          // other lab software: new roll
    { id: 'd', filename: 'IMG_3207.x.jpg', ...PS, capturedAt: '2025-03-31T22:15:00Z' },
    { id: 'e', filename: 'IMG_3213.x.jpg', ...EZ6 },          // Photoshop says nothing: same roll as d
    { id: 'f', filename: 'IMG_3218.x.jpg', ...EZ6 },
    { id: 'q', filename: 'IMG_3210.x.jpg', ...QSS },          // other scanner, numbers inside d–f
    { id: 'g', filename: 'IMG_4788.x.jpg', ...EZ6 },          // gap: new roll
  ]);
  assert.deepEqual(rolls.map((r) => r.ids), [['a', 'a2', 'b'], ['c'], ['d', 'e', 'f'], ['q'], ['g']]);
  assert.deepEqual(rolls[0].frames, { a: '1', a2: '1b', b: '8' });
  assert.equal(frameCaption(rolls[2], 'f'), 'Frame 12, Roll 3');
  assert.deepEqual(rolls[2].dates, ['2025-03-31', '2025-03-31']);
  assert.equal(rollTitle(rolls[2], 'Kyoto'), 'Roll 3 · Kyoto · Mar 2025');
  assert.equal(rollTitle(rolls[0]), 'Roll 1');
  assert.equal(rollTitle(rolls[0], null, ' Lofoten '), 'Lofoten');
});

test('every film scan in the archive gets a roll, and no two captions match', () => {
  const store = JSON.parse(fs.readFileSync(new URL('../data/manifest.json', import.meta.url), 'utf8'));
  const film = store.chapters.flatMap((c: { photos: { id: string; filename: string; medium: string; exif: Record<string, string> }[] }) => c.photos)
    .filter((p: { medium: string }) => p.medium === 'film')
    .map((p: { id: string; filename: string; exif: Record<string, string> }) => ({ id: p.id, filename: p.filename, camera: p.exif.camera, software: p.exif.software, capturedAt: p.exif.capturedAt }));
  const rolls = inferRolls(film);
  const captions = rolls.flatMap((r) => r.ids.map((id) => frameCaption(r, id)));
  assert.equal(captions.length, film.length);
  assert.equal(new Set(captions).size, captions.length, captions.join(' | '));
});
