import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { lightLocus, matchHueToLight, MAX_HUE_MATCH_DEG } from './light-locus.ts';
import { ACHROMATIC_CHROMA } from '../color.ts';

describe('lightLocus', () => {
  it('never reports a point too neutral to call a colour', () => {
    for (const point of lightLocus()) {
      assert.ok(point.chroma >= ACHROMATIC_CHROMA, `${point.environment.key} @ ${point.altitudeDeg}° = C ${point.chroma}`);
    }
  });

  it('every point has a real correlated colour temperature', () => {
    for (const point of lightLocus()) {
      assert.ok(point.cct > 1000 && point.cct < 40000, `cct ${point.cct}`);
    }
  });

  it('is cached — same array identity across calls', () => {
    assert.equal(lightLocus(), lightLocus());
  });
});

describe('matchHueToLight', () => {
  it('finds a warm match for red — low, hazy sun', () => {
    const match = matchHueToLight(28);
    assert.ok(match);
    assert.ok(match!.hueDeltaDeg <= MAX_HUE_MATCH_DEG);
    assert.ok(match!.point.altitudeDeg <= 3, `matched altitude ${match!.point.altitudeDeg}`);
  });

  it('finds a cool match for blue — high sky, clean air', () => {
    const match = matchHueToLight(255);
    assert.ok(match);
    assert.equal(match!.point.source, 'sky');
  });

  it('refuses green, violet and magenta — daylight scattering does not make them', () => {
    for (const hue of [145, 305, 350]) {
      assert.equal(matchHueToLight(hue), null, `hue ${hue} should be unreachable`);
    }
  });

  it('never returns a match past its own stated tolerance', () => {
    for (const hue of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const match = matchHueToLight(hue);
      if (match) assert.ok(match.hueDeltaDeg <= MAX_HUE_MATCH_DEG);
    }
  });

  it('an empty locus can never match anything', () => {
    assert.equal(matchHueToLight(28, []), null);
  });
});
