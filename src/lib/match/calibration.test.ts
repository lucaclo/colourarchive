/**
 * Tests for calibration.ts.
 *
 * There is exactly one behaviour worth proving here: `isEstimated` is a
 * genuine field-by-field, by-value comparison against `DEFAULT_CALIBRATION`
 * — not an object-identity check, and not a check of some subset of fields.
 * Get that wrong in either direction and the "estimated" badge in the UI
 * lies: it would either stay lit after a real measured calibration replaced
 * every number, or go dark for a calibration object that only looks
 * different because it's a different reference.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CALIBRATION, isEstimated, type Calibration } from './calibration.ts';

/** Every field `DEFAULT_CALIBRATION` is supposed to carry, typed out by hand
 *  so a field silently added or removed from the interface shows up as a
 *  test failure rather than passing along, unnoticed, by iterating whatever
 *  keys happen to exist. */
const FIELDS: Array<keyof Calibration> = [
  'saturationGain',
  'vibranceGain',
  'colorGradeUnit',
  'tempUnit',
  'tintUnit',
  'hslSaturationGain',
  'hslLuminanceGain',
  'hslHueDegreesAt100',
  'grainUnit',
  'sharpenUnit',
  'textureUnit',
  'noiseReductionUnit',
  'vignetteStopsAt100',
  'localTempUnit',
  'localTintUnit',
  'localSaturationGain',
];

describe('DEFAULT_CALIBRATION', () => {
  it('carries exactly the documented fields', () => {
    assert.deepEqual(Object.keys(DEFAULT_CALIBRATION).sort(), [...FIELDS].sort());
  });

  it('is finite in every field', () => {
    // isEstimated compares with strict ===, and NaN === NaN is false. If a
    // future edit ever left a field NaN, isEstimated(DEFAULT_CALIBRATION)
    // itself would report false — the shipped estimate would stop
    // recognising itself as an estimate. This test is the guard against
    // that ever landing quietly: it fails on the edit, not on the symptom.
    for (const field of FIELDS) {
      const value = DEFAULT_CALIBRATION[field];
      assert.ok(Number.isFinite(value), `${field} is not a finite number (got ${value})`);
    }
  });
});

describe('isEstimated', () => {
  it('is true for the shipped defaults', () => {
    // By construction: the defaults are the estimate until someone runs the
    // calibration script and replaces them.
    assert.equal(isEstimated(DEFAULT_CALIBRATION), true);
  });

  it('is false when exactly one field differs', () => {
    // Proves the check walks every field rather than, say, checking object
    // identity or only a handful of the "important" ones.
    for (const field of FIELDS) {
      const nudged: Calibration = { ...DEFAULT_CALIBRATION, [field]: DEFAULT_CALIBRATION[field] + 1 };
      assert.equal(isEstimated(nudged), false, `changing ${field} alone was not detected`);
    }
  });

  it('is true for a different object with identical values', () => {
    // Proves the comparison is by value per field, not by reference — a
    // calibration loaded fresh from disk with the same 16 numbers must still
    // read as "estimated", not as a stranger just because it's a new object.
    const copy: Calibration = { ...DEFAULT_CALIBRATION };
    assert.notEqual(copy, DEFAULT_CALIBRATION);
    assert.equal(isEstimated(copy), true);

    // The same again, but typed out independently rather than spread, so the
    // proof doesn't lean on the spread having copied anything correctly.
    const rebuilt: Calibration = {
      saturationGain: 1.0,
      vibranceGain: 1.6,
      colorGradeUnit: 0.06,
      tempUnit: 0.055,
      tintUnit: 0.05,
      hslSaturationGain: 1.0,
      hslLuminanceGain: 320,
      hslHueDegreesAt100: 22,
      grainUnit: 0.055,
      sharpenUnit: 0.35,
      textureUnit: 0.5,
      noiseReductionUnit: 0.45,
      vignetteStopsAt100: 2.2,
      localTempUnit: 0.05,
      localTintUnit: 0.045,
      localSaturationGain: 1.0,
    };
    assert.notEqual(rebuilt, DEFAULT_CALIBRATION);
    assert.equal(isEstimated(rebuilt), true);
  });
});
