/**
 * Cross-checks the hand-transcribed OKLab matrices against culori — an
 * independently written colour library, not just a second copy of the same
 * numbers.
 *
 * `stats-core.test.ts` already uses `srgb255ToOklch` (color.ts) as an oracle
 * for `measureRegionsFromPixels` (stats-core.ts), which catches the two
 * files drifting from EACH OTHER. It can't catch both hand-transcribing the
 * Ottosson matrices with the same typo, since both were typed from the same
 * source. culori's OKLab implementation was written independently, so
 * agreeing with it rules out a shared transcription error in either file —
 * see issue #40.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { converter } from 'culori';

import { srgb255ToOklch } from '../color.ts';
import { measureRegionsFromPixels } from './stats-core.ts';
import { NO_MASKS, type RgbImage } from './types.ts';

const toOklab = converter('oklab');

/** A spread of colours: greys, primaries, secondaries, and mid-saturation
 *  tones — enough to exercise every sign combination the matrices produce. */
const SAMPLES: [number, number, number][] = [
  [0, 0, 0],
  [255, 255, 255],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
  [180, 90, 40],
  [40, 90, 180],
  [90, 180, 40],
  [225, 70, 45],
  [60, 140, 200],
  [99, 99, 99],
  [12, 200, 130],
];

const EPS = 1e-3;

function solidImage(rgb: [number, number, number]): RgbImage {
  const data = new Uint8Array(4 * 3);
  for (let i = 0; i < 4; i++) {
    data[i * 3] = rgb[0];
    data[i * 3 + 1] = rgb[1];
    data[i * 3 + 2] = rgb[2];
  }
  return { data, width: 2, height: 2, channels: 3 };
}

function culoriOklch(rgb: [number, number, number]): { L: number; C: number; H: number } {
  const lab = toOklab({ mode: 'rgb', r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 });
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let H = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L: lab.l, C, H };
}

const hueDiff = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe('OKLab matrices vs culori (independent implementation)', () => {
  for (const rgb of SAMPLES) {
    const label = `rgb(${rgb.join(',')})`;

    it(`color.ts srgb255ToOklch agrees with culori for ${label}`, () => {
      const ours = srgb255ToOklch(...rgb);
      const theirs = culoriOklch(rgb);
      assert.ok(Math.abs(ours.L - theirs.L) < EPS, `L: ours ${ours.L} vs culori ${theirs.L}`);
      assert.ok(Math.abs(ours.C - theirs.C) < EPS, `C: ours ${ours.C} vs culori ${theirs.C}`);
      if (theirs.C > 1e-4) {
        assert.ok(hueDiff(ours.H, theirs.H) < 0.5, `H: ours ${ours.H} vs culori ${theirs.H}`);
      }
    });

    it(`stats-core.ts measureRegionsFromPixels agrees with culori for ${label}`, () => {
      const { regions } = measureRegionsFromPixels(solidImage(rgb), NO_MASKS());
      const g = regions.global!;
      const theirs = culoriOklch(rgb);
      assert.ok(Math.abs(g.L.mean - theirs.L) < EPS, `L: ours ${g.L.mean} vs culori ${theirs.L}`);
      assert.ok(Math.abs(g.C.mean - theirs.C) < EPS, `C: ours ${g.C.mean} vs culori ${theirs.C}`);
      if (theirs.C > 1e-4) {
        assert.ok(hueDiff(g.hue.mean, theirs.H) < 0.5, `H: ours ${g.hue.mean} vs culori ${theirs.H}`);
      }
    });
  }
});
