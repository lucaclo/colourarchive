/**
 * Tests for the shadow-recovery headroom diagnostic — issue #70.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { shadowHeadroom } from './shadow-headroom.ts';

describe('shadowHeadroom', () => {
  it('gives a sane EV number at base ISO', () => {
    const result = shadowHeadroom(100);
    assert.ok(result);
    assert.ok(result!.ev > 0 && result!.ev <= 6.5, `expected a modest EV figure, got ${result!.ev}`);
    assert.match(result!.sentence, /^\+\d+\.\d EV of shadow lift before read noise is visible at 100%\.$/);
    assert.equal(result!.estimated, true);
  });

  it('gives less headroom at a moderately raised ISO than at base', () => {
    const base = shadowHeadroom(100)!;
    const raised = shadowHeadroom(800)!;
    assert.ok(raised.ev < base.ev, `expected ISO 800 headroom (${raised.ev}) < ISO 100 headroom (${base.ev})`);
  });

  it('gives less headroom still at very high ISO', () => {
    const moderate = shadowHeadroom(800)!;
    const high = shadowHeadroom(12800)!;
    assert.ok(high.ev <= moderate.ev, `expected very-high-ISO headroom (${high.ev}) <= ISO 800 headroom (${moderate.ev})`);
    assert.ok(high.ev >= 0, 'headroom should never go negative');
  });

  it('flattens past the invariance point rather than continuing to fall', () => {
    const atInvariance = shadowHeadroom(800)!; // generic curve's invariance point
    const wellPast = shadowHeadroom(102400)!;
    assert.equal(atInvariance.ev, wellPast.ev);
  });

  it('does not project extra headroom for ISO below base', () => {
    const base = shadowHeadroom(100)!;
    const pulled = shadowHeadroom(50)!;
    assert.equal(pulled.ev, base.ev);
  });

  it('refuses cleanly when ISO is missing', () => {
    assert.equal(shadowHeadroom(undefined), null);
    assert.equal(shadowHeadroom(null), null);
  });

  it('refuses cleanly on a nonsensical ISO', () => {
    assert.equal(shadowHeadroom(0), null);
    assert.equal(shadowHeadroom(-200), null);
    assert.equal(shadowHeadroom(NaN), null);
  });

  it('uses the generic fallback curve when the camera is missing or unrecognised', () => {
    const noCamera = shadowHeadroom(400);
    assert.ok(noCamera);
    assert.equal(noCamera!.cameraMatched, false);
    assert.match(noCamera!.curve, /generic/);

    const unknownCamera = shadowHeadroom(400, 'Pentax K-1');
    assert.ok(unknownCamera);
    assert.equal(unknownCamera!.cameraMatched, false);
  });

  it('uses the Sony per-body curve when the camera EXIF says so', () => {
    const sony = shadowHeadroom(400, 'SONY ILCE-7M3');
    assert.ok(sony);
    assert.equal(sony!.cameraMatched, true);
    assert.match(sony!.curve, /Sony/);
  });

  it('the Sony curve and the generic curve disagree in the transition zone between their invariance points', () => {
    // Sony's invariance point (640) sits below the generic one (800), so at
    // an ISO between them the Sony curve should already have flattened while
    // the generic curve is still falling — Sony reports MORE headroom left.
    const sony = shadowHeadroom(700, 'SONY ILCE-7M3')!;
    const generic = shadowHeadroom(700, 'Some Unknown Camera')!;
    assert.ok(sony.ev > generic.ev, `expected Sony (${sony.ev}) > generic (${generic.ev}) at ISO 700`);
  });

  it('is monotonically non-increasing as ISO rises', () => {
    const isos = [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200];
    let prev = Infinity;
    for (const iso of isos) {
      const { ev } = shadowHeadroom(iso)!;
      assert.ok(ev <= prev + 1e-9, `expected non-increasing EV, but ISO ${iso} gave ${ev} after ${prev}`);
      prev = ev;
    }
  });
});
