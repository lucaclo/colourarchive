import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meanTone, pageTone, pickRhymes, spreadJumps } from './book-rhythm';

test('meanTone averages in Lab: opposite hues go grey', () => {
  const t = meanTone([{ L: 0.5, C: 0.1, H: 0 }, { L: 0.7, C: 0.1, H: 180 }])!;
  assert.ok(Math.abs(t.L - 0.6) < 1e-9);
  assert.ok(t.C < 1e-9);
  assert.equal(meanTone([]), null);
});

test('pageTone: photos, openers, and paper', () => {
  const tones: Record<string, { L: number; C: number; H: number }> = { a: { L: 0.2, C: 0, H: 0 } };
  const photo = pageTone({ kind: 'photo', chapterKey: 'red', photos: [{ id: 'a', width: 3, height: 2 }], treatment: 'border' }, (id) => tones[id], () => undefined);
  assert.equal(photo!.L, 0.2);
  assert.equal(pageTone({ kind: 'blank', reason: 'even' }, () => undefined, () => undefined), null);
  assert.equal(pageTone({ kind: 'colophon' }, () => undefined, () => undefined), null);
});

test('spreadJumps: lightness and hue, but not into a chapter opener', () => {
  const dark = { L: 0.2, C: 0.02, H: 0 }, light = { L: 0.8, C: 0.02, H: 0 };
  const red = { L: 0.5, C: 0.12, H: 30 }, teal = { L: 0.5, C: 0.12, H: 200 };
  assert.deepEqual(spreadJumps([dark, light, light, dark]).map((j) => [j.after, j.reason]), [[0, 'Jumps from dark to light'], [2, 'Drops from light to dark']]);
  assert.equal(spreadJumps([red, teal])[0].reason, 'The colour swings across the hue');
  assert.deepEqual(spreadJumps([red, teal], [false, true]), []);
  assert.deepEqual(spreadJumps([dark, null, light]), []);
});

test('pickRhymes: same shape, different colour', () => {
  const rows = [
    { id: 'twin', comp: 0.05, col: 0.05 }, // same picture, same colour: not a rhyme
    { id: 'echo', comp: 0.1, col: 0.8 },
    { id: 'near', comp: 0.2, col: 0.5 },
    { id: 'far', comp: 0.9, col: 0.9 },
    { id: 'also', comp: 0.3, col: 0.6 },
  ];
  assert.deepEqual(pickRhymes(rows).map((r) => r.id), ['echo', 'near', 'also']);
});
