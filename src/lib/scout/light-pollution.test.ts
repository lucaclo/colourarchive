import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CORE_DARK_ENOUGH_MAX_ZONE,
  lightPollutionDarkEnough,
  lightPollutionZoneAt,
  ZONE_COUNT,
  type LightPollutionField,
} from './light-pollution.ts';

/** A 4x2 field, so each cell is 90° of longitude by 90° of latitude — easy
 *  to reason about which cell a coordinate should land in. */
const field: LightPollutionField = {
  width: 4,
  height: 2,
  // Row 0 (north, lat 0..90): 0 1 2 3
  // Row 1 (south, lat -90..0): 4 5 6 7
  zones: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
};

describe('lightPollutionZoneAt', () => {
  it('reads the north-west cell at the north-west corner', () => {
    assert.equal(lightPollutionZoneAt(field, -180, 90), 0);
  });

  it('reads the correct column for a longitude inside the second cell', () => {
    // -180..-90 -> col 0, -90..0 -> col 1, 0..90 -> col 2, 90..180 -> col 3.
    assert.equal(lightPollutionZoneAt(field, -45, 45), 1);
    assert.equal(lightPollutionZoneAt(field, 45, 45), 2);
    assert.equal(lightPollutionZoneAt(field, 135, 45), 3);
  });

  it('reads the correct row for a latitude in the southern half', () => {
    assert.equal(lightPollutionZoneAt(field, -135, -45), 4);
    assert.equal(lightPollutionZoneAt(field, -45, -45), 5);
  });

  it('wraps longitude across the antimeridian rather than reading off the grid', () => {
    // 190° and -170° are the same meridian.
    assert.equal(lightPollutionZoneAt(field, 190, 45), lightPollutionZoneAt(field, -170, 45));
    assert.equal(lightPollutionZoneAt(field, -190, 45), lightPollutionZoneAt(field, 170, 45));
  });

  it('is null for a latitude outside ±90, never a misleading nearest cell', () => {
    assert.equal(lightPollutionZoneAt(field, 0, 91), null);
    assert.equal(lightPollutionZoneAt(field, 0, -91), null);
  });

  it('is null for a non-finite longitude', () => {
    assert.equal(lightPollutionZoneAt(field, NaN, 0), null);
    assert.equal(lightPollutionZoneAt(field, Infinity, 0), null);
  });

  it('includes the south-east corner, not one cell short', () => {
    // 180° itself is ambiguous — the same meridian as -180°, which the wrap
    // above deliberately folds onto the grid's west edge — so this checks
    // just inside the corner rather than the boundary value itself.
    assert.equal(lightPollutionZoneAt(field, 179.999, -89.999), 7);
  });
});

describe('lightPollutionDarkEnough', () => {
  it('agrees with its own published threshold constant', () => {
    assert.equal(lightPollutionDarkEnough(CORE_DARK_ENOUGH_MAX_ZONE), true);
    assert.equal(lightPollutionDarkEnough(CORE_DARK_ENOUGH_MAX_ZONE + 1), false);
  });

  it('is dark enough at the darkest zone and not at the brightest', () => {
    assert.equal(lightPollutionDarkEnough(0), true);
    assert.equal(lightPollutionDarkEnough(ZONE_COUNT - 1), false);
  });

  it('is monotonic: nothing brighter than a not-dark-enough zone reads as dark enough', () => {
    let seenFalse = false;
    for (let z = 0; z < ZONE_COUNT; z++) {
      const ok = lightPollutionDarkEnough(z);
      if (seenFalse) assert.equal(ok, false, `zone ${z} read as dark enough after a brighter zone did not`);
      if (!ok) seenFalse = true;
    }
    assert.ok(seenFalse, 'no zone in range failed the threshold — test fixture assumption is wrong');
  });
});
