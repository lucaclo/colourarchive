/**
 * Tests for the ND/exposure calculator and its countdown.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE_SHUTTER_SPEEDS_S,
  ND_FILTERS,
  countdownAfter,
  formatCountdown,
  formatExposureDuration,
  formatShutterSpeed,
  ndExposureSeconds,
  startCountdown,
} from './exposure.ts';

const close = (a: number, b: number, tol: number, what = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${what} expected ${a} ≈ ${b} (±${tol})`);

/* ── ND exposure ───────────────────────────────────────────────────────────── */

describe('ndExposureSeconds', () => {
  it('doubles once per stop', () => {
    close(ndExposureSeconds(1, 0), 1, 1e-9);
    close(ndExposureSeconds(1, 1), 2, 1e-9);
    close(ndExposureSeconds(1, 3), 8, 1e-9);
    close(ndExposureSeconds(1, 10), 1024, 1e-6);
  });

  it('scales linearly with the base speed', () => {
    close(ndExposureSeconds(1 / 125, 6), 64 / 125, 1e-9);
    close(ndExposureSeconds(1 / 250, 6), ndExposureSeconds(1 / 125, 6) / 2, 1e-9);
  });

  it('an ND8 turns a 1/8s base into a 1s exposure', () => {
    const nd8 = ND_FILTERS.find((f) => f.label === 'ND8')!;
    close(ndExposureSeconds(1 / 8, nd8.stops), 1, 1e-9);
  });

  it('an ND1000 turns a 1/30s base into roughly 30s', () => {
    const nd1000 = ND_FILTERS.find((f) => f.label === 'ND1000')!;
    close(ndExposureSeconds(1 / 30, nd1000.stops), 1000 / 30, 0.5);
  });

  it('stacked filters add stops, which multiplies exposure', () => {
    const nd8 = ND_FILTERS.find((f) => f.label === 'ND8')!;
    const nd1000 = ND_FILTERS.find((f) => f.label === 'ND1000')!;
    const stacked = ND_FILTERS.find((f) => f.label === 'ND1000 + ND8 stacked')!;
    close(stacked.stops, nd8.stops + nd1000.stops, 1e-9);
    close(
      ndExposureSeconds(1 / 60, stacked.stops),
      ndExposureSeconds(ndExposureSeconds(1 / 60, nd8.stops), nd1000.stops),
      1e-6,
      'stacking two filters in either order gives the same exposure',
    );
  });

  it('refuses a non-positive base speed or negative stops', () => {
    assert.throws(() => ndExposureSeconds(0, 3), RangeError);
    assert.throws(() => ndExposureSeconds(1, -1), RangeError);
  });
});

describe('ND_FILTERS and BASE_SHUTTER_SPEEDS_S', () => {
  it('every filter\'s stops matches its printed factor', () => {
    // ND8 removes 3 stops because 2³ = 8 — the identity the whole module
    // leans on, checked here so a hand-typed label can never drift from it.
    for (const filter of ND_FILTERS.slice(0, 4)) {
      const factor = 2 ** filter.stops;
      const printed = Number(filter.label.replace('ND', ''));
      close(factor, printed, printed * 0.01, filter.label);
    }
  });

  it('lists base speeds fast enough to still be handholdable', () => {
    for (const speed of BASE_SHUTTER_SPEEDS_S) assert.ok(speed <= 1);
  });
});

/* ── Formatting ────────────────────────────────────────────────────────────── */

describe('formatShutterSpeed', () => {
  it('reads sub-second speeds as a fraction', () => {
    assert.equal(formatShutterSpeed(1 / 125), '1/125 s');
    assert.equal(formatShutterSpeed(1 / 8), '1/8 s');
  });

  it('reads whole seconds and up without a fraction', () => {
    assert.equal(formatShutterSpeed(1), '1 s');
    assert.equal(formatShutterSpeed(8), '8 s');
  });
});

describe('formatExposureDuration', () => {
  it('reads a sub-second exposure as a fraction rather than rounding it to 0 s', () => {
    // A one-stop ND on a fast base speed lands well under a second — rounding
    // that to the nearest whole second used to print "0 s" for an exposure
    // that plainly happened.
    assert.equal(formatExposureDuration(1 / 8), '1/8 s');
  });

  it('stays in seconds under a minute', () => {
    assert.equal(formatExposureDuration(45), '45 s');
  });

  it('names minutes and seconds between a minute and an hour', () => {
    assert.equal(formatExposureDuration(192), '3 min 12 s');
    assert.equal(formatExposureDuration(180), '3 min');
  });

  it('names hours and minutes past an hour, dropping seconds', () => {
    assert.equal(formatExposureDuration(3600 + 8 * 60 + 20), '1 h 08 min');
  });
});

/* ── The countdown ─────────────────────────────────────────────────────────── */

describe('startCountdown / countdownAfter', () => {
  it('starts full and refuses a non-positive duration', () => {
    const c = startCountdown(30);
    assert.equal(c.remainingSeconds, 30);
    assert.equal(c.done, false);
    assert.throws(() => startCountdown(0), RangeError);
  });

  it('counts down by elapsed time, not by tick count', () => {
    // The whole point: a late or missed tick is not a lost second. Jumping
    // straight from 0 elapsed to 12 elapsed lands exactly where a steady
    // stream of 1-second ticks would have.
    const c = startCountdown(30);
    assert.equal(countdownAfter(c, 12).remainingSeconds, 18);
    assert.equal(countdownAfter(c, 29).remainingSeconds, 1);
  });

  it('clamps at zero and marks itself done rather than going negative', () => {
    const c = startCountdown(10);
    const finished = countdownAfter(c, 45);
    assert.equal(finished.remainingSeconds, 0);
    assert.equal(finished.done, true);
  });

  it('is not done a moment before it reaches zero', () => {
    const c = startCountdown(10);
    assert.equal(countdownAfter(c, 9.999).done, false);
  });

  it('refuses negative elapsed time', () => {
    assert.throws(() => countdownAfter(startCountdown(10), -1), RangeError);
  });
});

describe('formatCountdown', () => {
  it('reads under an hour as minutes and seconds', () => {
    assert.equal(formatCountdown(75), '1:15');
    assert.equal(formatCountdown(9), '0:09');
  });

  it('reads an hour or more with an hours field', () => {
    assert.equal(formatCountdown(3725), '1:02:05');
  });

  it('rounds up rather than down, so it never shows 0:00 with time left', () => {
    assert.equal(formatCountdown(0.4), '0:01');
  });
});
