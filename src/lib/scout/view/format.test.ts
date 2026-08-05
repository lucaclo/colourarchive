import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { bearingLabel, formatCoords, moonDiscPath, shadowCaveat } from './format.ts';

describe('a coordinate on the panel', () => {
  it('names the hemisphere rather than signing the number', () => {
    assert.equal(formatCoords({ lat: 55.9533, lon: -3.1883 }), '55.9533°N 3.1883°W');
    assert.equal(formatCoords({ lat: -33.8688, lon: 151.2093 }), '33.8688°S 151.2093°E');
  });

  it('puts the equator north and the meridian east, rather than dropping the letter', () => {
    assert.equal(formatCoords({ lat: 0, lon: 0 }), '0.0000°N 0.0000°E');
  });

  it('keeps four places even when they are zeros', () => {
    assert.equal(formatCoords({ lat: 51.5, lon: -0.125 }), '51.5000°N 0.1250°W');
  });
});

describe('a bearing on the panel', () => {
  it('wraps a full turn back to zero', () => {
    // 359.7 rounds to 360, and "360° N" is a bearing nobody writes.
    assert.equal(bearingLabel(359.7), '0° N');
    assert.equal(bearingLabel(360), '0° N');
  });

  it('rounds before it names the point', () => {
    assert.equal(bearingLabel(90.4), '90° E');
    assert.equal(bearingLabel(179.5), '180° S');
  });

  it('keeps the compass point and the number agreeing', () => {
    for (let degrees = 0; degrees < 360; degrees += 1) {
      const [number, point] = bearingLabel(degrees).split('° ');
      assert.equal(bearingLabel(Number(number)).split('° ')[1], point, `${degrees}° disagrees`);
    }
  });
});

describe('the moon disc', () => {
  const arcs = (path: string) => path.split('A').length - 1;

  it('is always one limb and one terminator', () => {
    for (const fraction of [0, 0.1, 0.25, 0.5, 0.5001, 0.75, 1]) {
      for (const waxing of [true, false]) {
        assert.equal(arcs(moonDiscPath(fraction, waxing)), 2, `${fraction} ${waxing}`);
      }
    }
  });

  it('flattens the terminator at half and rounds it out at both ends', () => {
    // The terminator's x-radius is `r·|1 − 2k|`, so it is the full radius at
    // *both* new and full moon and zero halfway between. What separates a new
    // moon from a full one is the direction it curves: the same ellipse swept
    // back over the limb encloses nothing, swept the other way it encloses the
    // whole disc.
    assert.equal(moonDiscPath(0.5, true, 12), 'M 0 -12 A 12 12 0 0 1 0 12 A 0 12 0 0 0 0 -12');
    assert.equal(moonDiscPath(0, true, 12), 'M 0 -12 A 12 12 0 0 1 0 12 A 12 12 0 0 0 0 -12');
    assert.equal(moonDiscPath(1, true, 12), 'M 0 -12 A 12 12 0 0 1 0 12 A 12 12 0 0 1 0 -12');
  });

  it('turns the terminator over as the moon passes half', () => {
    // Just under half the terminator still curves away from the lit limb; just
    // over, it curves with it. Getting this backwards draws a gibbous moon as a
    // crescent, which is the one error in this path anyone would see.
    const sweepOf = (path: string) => path.split('A')[2].trim().split(' ')[4];
    assert.equal(sweepOf(moonDiscPath(0.49, true)), '0');
    assert.equal(sweepOf(moonDiscPath(0.51, true)), '1');
  });

  it('lights the opposite limb waxing and waning', () => {
    const waxing = moonDiscPath(0.3, true, 10);
    const waning = moonDiscPath(0.3, false, 10);
    assert.notEqual(waxing, waning);
    // The outer arc's sweep flag is the side that is lit.
    assert.match(waxing, /^M 0 -10 A 10 10 0 0 1 /);
    assert.match(waning, /^M 0 -10 A 10 10 0 0 0 /);
  });

  it('clamps a fraction that arrived outside nought to one', () => {
    assert.equal(moonDiscPath(-0.4, true), moonDiscPath(0, true));
    assert.equal(moonDiscPath(1.4, true), moonDiscPath(1, true));
  });

  it('honours the radius it is given', () => {
    assert.match(moonDiscPath(1, true, 24), /^M 0 -24 A 24 24 /);
  });
});

describe('the caveat carried out with the plan', () => {
  it('says nothing when there are no shadows to qualify', () => {
    assert.equal(shadowCaveat({ showing: true, cast: 0, estimated: 0 }), undefined);
    assert.equal(shadowCaveat({ showing: false, cast: 40, estimated: 3 }), undefined);
  });

  it('says so plainly when every height was on record', () => {
    assert.equal(
      shadowCaveat({ showing: true, cast: 12, estimated: 0 }),
      '12 buildings, all from recorded heights.',
    );
  });

  it('leads with the guessed count when any height was inferred', () => {
    assert.equal(
      shadowCaveat({ showing: true, cast: 40, estimated: 31 }),
      '31 of 40 building heights are storey-count estimates.',
    );
  });
});
