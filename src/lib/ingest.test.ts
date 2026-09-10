/**
 * Tests for guessMedium — the only pure, easily-isolated piece of the ingest
 * pipeline (the rest touches sharp, the filesystem, and the ML models).
 *
 * The one thing worth protecting here: the no-EXIF fallback to 'film' is a
 * guess with no evidence behind it, not a confident read of a scanner scan.
 * `uncertain` exists so the UI can tell the two apart — a photo with a real
 * scanner signature and a paste from another app both currently resolve to
 * the same Medium, but only one of them is actually known.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { guessMedium } from './ingest.ts';
import type { Exif } from './types.ts';

describe('guessMedium', () => {
  it('reads a scanner signature as a confident film guess', () => {
    const exif: Exif = { camera: 'NORITSU KOKI QSS-32_33' };
    const r = guessMedium(exif);
    assert.equal(r.medium, 'film');
    assert.equal(r.uncertain, false);
  });

  it('reads a scanner signature in software (not just camera) too', () => {
    const exif: Exif = { software: 'VueScan 9.7' };
    const r = guessMedium(exif);
    assert.equal(r.medium, 'film');
    assert.equal(r.uncertain, false);
  });

  it('reads a camera model plus exposure metadata as a confident digital guess', () => {
    const exif: Exif = { camera: 'SONY ILCE-7CM2', iso: 400, aperture: 'f/2.8' };
    const r = guessMedium(exif);
    assert.equal(r.medium, 'digital');
    assert.equal(r.uncertain, false);
  });

  it('does not call a camera model alone digital without any exposure metadata', () => {
    // A camera string with no iso/shutter/aperture isn't the "real digital
    // camera signature" the function looks for — it falls through to the
    // uncertain film default, same as no EXIF at all.
    const exif: Exif = { camera: 'Some Camera' };
    const r = guessMedium(exif);
    assert.equal(r.medium, 'film');
    assert.equal(r.uncertain, true);
  });

  it('flags completely empty EXIF (a paste/screenshot) as an uncertain film default', () => {
    const r = guessMedium({});
    assert.equal(r.medium, 'film');
    assert.equal(r.uncertain, true, 'a guess with no evidence behind it must say so');
  });
});
