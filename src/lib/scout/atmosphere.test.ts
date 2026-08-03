import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AEROSOL,
  airMass,
  betaFromAod550,
  birdClearSky,
  coastalAerosol,
  pressureRatio,
  readLight,
  spectralLight,
} from './atmosphere.ts';

/** Sea-level continental air, sun overhead — the reference case. */
const REFERENCE = { altitudeDeg: 90, elevationM: 0, aerosol: AEROSOL.continental };

describe('airMass', () => {
  it('matches the published Kasten–Young values', () => {
    // Zenith is 1 by definition; the others are the standard table.
    assert.ok(Math.abs(airMass(90) - 1) < 0.001, `${airMass(90)}`);
    assert.ok(Math.abs(airMass(30) - 2) < 0.01, `${airMass(30)}`);
    assert.ok(Math.abs(airMass(10) - 5.6) < 0.1, `${airMass(10)}`);
    // At the horizon the empirical tail is what keeps this finite at all.
    assert.ok(airMass(0) > 30 && airMass(0) < 40, `${airMass(0)}`);
  });

  it('rises monotonically as the sun drops', () => {
    const path = [90, 60, 30, 20, 10, 5, 2, 0].map(airMass);
    for (let i = 1; i < path.length; i++) assert.ok(path[i] > path[i - 1], path.join(' '));
  });
});

describe('pressureRatio', () => {
  it('thins the way the barometer says', () => {
    assert.equal(pressureRatio(0), 1);
    // ~30% less air at 3,000 m is the number the mountain case turns on.
    assert.ok(Math.abs(pressureRatio(3000) - 0.7) < 0.02, `${pressureRatio(3000)}`);
    assert.ok(pressureRatio(8848) < 0.36, 'Everest');
  });
});

describe('the colour of sunlight', () => {
  it('is daylight-white with the sun overhead', () => {
    // The *direct beam*, which is warmer than the 6500 K of D65 — that figure
    // describes global daylight, sun and sky together, and the sky is the blue
    // half of it. Beam-only at air mass 1 through ordinary continental haze
    // measures around 5200–5500 K.
    const { sun } = spectralLight(REFERENCE);
    assert.ok(sun.cct > 5000 && sun.cct < 6000, `${sun.cct} K`);
  });

  it('is cleaner and bluer through mountain air than through continental haze', () => {
    const clean = spectralLight({ ...REFERENCE, aerosol: AEROSOL.mountain }).sun.cct;
    const hazy = spectralLight({ ...REFERENCE, aerosol: AEROSOL.urban }).sun.cct;
    assert.ok(clean > hazy + 100, `${clean} K clean vs ${hazy} K hazy`);
  });

  it('warms as the sun drops, monotonically', () => {
    const temps = [90, 40, 20, 10, 5, 2].map(
      (altitudeDeg) => spectralLight({ ...REFERENCE, altitudeDeg }).sun.cct,
    );
    for (let i = 1; i < temps.length; i++) {
      assert.ok(temps[i] < temps[i - 1], `not monotonic: ${temps.map(Math.round).join(' ')}`);
    }
  });

  it('reaches golden and then red at the altitudes photographers know', () => {
    const at = (altitudeDeg: number) => spectralLight({ ...REFERENCE, altitudeDeg }).sun.cct;
    // Golden hour proper: a few degrees up is warm but not yet fire.
    assert.ok(at(10) > 3000 && at(10) < 4600, `10°: ${at(10)} K`);
    // On the horizon it is deep orange-red.
    assert.ok(at(2) > 1800 && at(2) < 3200, `2°: ${at(2)} K`);
  });

  it('is bluer on a mountain than at sea level, for the same sun', () => {
    // Less air ⇒ less selective scattering out of the blue end.
    const low = spectralLight({ ...REFERENCE, altitudeDeg: 20, elevationM: 0 }).sun.cct;
    const high = spectralLight({ ...REFERENCE, altitudeDeg: 20, elevationM: 3000 }).sun.cct;
    assert.ok(high > low, `${high} K at 3000 m vs ${low} K at sea level`);
  });

  it('gives a deep blue sky in thin dry air and a white one in sea haze', () => {
    const mountain = spectralLight({ altitudeDeg: 40, elevationM: 3000, aerosol: AEROSOL.mountain });
    const coast = spectralLight({ altitudeDeg: 40, elevationM: 0, aerosol: AEROSOL.maritime });
    // A whiter sky sits nearer the neutral point, so its CCT is far lower than
    // the 15–25 kK of a clean high-altitude sky.
    assert.ok(mountain.sky.cct > coast.sky.cct, `${mountain.sky.cct} vs ${coast.sky.cct}`);
  });
});

describe('the strength of sunlight', () => {
  it('puts a bright sunlit scene at about EV 15', () => {
    // Sunny sixteen. If this drifts, the exposure advice is wrong.
    const { ev100 } = readLight(REFERENCE);
    assert.ok(ev100 > 14.3 && ev100 < 16, `EV ${ev100.toFixed(2)}`);
  });

  it('gives roughly 100 klx normal to the beam at noon', () => {
    const { directLux } = spectralLight(REFERENCE);
    assert.ok(directLux > 80_000 && directLux < 115_000, `${Math.round(directLux)} lx`);
  });

  it('falls away to nothing as the sun sets', () => {
    const lux = [90, 30, 10, 2, 0].map((a) => spectralLight({ ...REFERENCE, altitudeDeg: a }).directLux);
    for (let i = 1; i < lux.length; i++) assert.ok(lux[i] < lux[i - 1], lux.join(' '));
    assert.ok(lux[lux.length - 1] < 2000, 'almost nothing left at the horizon');
  });
});

describe('how hard the light is', () => {
  it('is harder on a dry mountain than on a hazy coast', () => {
    // The whole point of the module: same sun, different air, different picture.
    const mountain = readLight({ altitudeDeg: 45, elevationM: 3000, aerosol: AEROSOL.mountain });
    const coast = readLight({ altitudeDeg: 45, elevationM: 0, aerosol: AEROSOL.maritime });

    assert.ok(
      mountain.contrastStops > coast.contrastStops + 0.5,
      `mountain ${mountain.contrastStops.toFixed(2)} vs coast ${coast.contrastStops.toFixed(2)} stops`,
    );
    assert.ok(
      mountain.diffuseFraction < coast.diffuseFraction,
      `fill: ${mountain.diffuseFraction.toFixed(3)} vs ${coast.diffuseFraction.toFixed(3)}`,
    );
  });

  it('softens as the sun drops, because the fill outlasts the beam', () => {
    const high = readLight({ ...REFERENCE, altitudeDeg: 60 });
    const low = readLight({ ...REFERENCE, altitudeDeg: 5 });
    assert.ok(low.contrastStops < high.contrastStops, `${low.contrastStops} vs ${high.contrastStops}`);
    assert.ok(low.diffuseFraction > high.diffuseFraction);
  });

  it('is all fill once the sun is down', () => {
    const night = readLight({ ...REFERENCE, altitudeDeg: -5 });
    assert.equal(night.directNormal, 0);
    assert.equal(night.diffuseFraction, 1);
    assert.equal(night.contrastStops, 0);
  });
});

describe('Bird & Hulstrom', () => {
  it('gives a plausible clear-sky noon', () => {
    // Published clear-sky DNI at sea level, sun overhead, moderate turbidity is
    // ~900–1000 W/m²; global horizontal a little above it.
    const { directNormal, globalHorizontal, diffuseFraction } = birdClearSky(REFERENCE);
    assert.ok(directNormal > 800 && directNormal < 1050, `DNI ${Math.round(directNormal)}`);
    assert.ok(globalHorizontal > directNormal, 'global exceeds the beam alone at zenith');
    assert.ok(diffuseFraction > 0.05 && diffuseFraction < 0.25, `${diffuseFraction.toFixed(3)}`);
  });

  it('gives a stronger beam higher up', () => {
    const low = birdClearSky(REFERENCE).directNormal;
    const high = birdClearSky({ ...REFERENCE, elevationM: 3000 }).directNormal;
    assert.ok(high > low, `${Math.round(high)} vs ${Math.round(low)}`);
  });

  it('trades beam for haze as turbidity rises', () => {
    const clean = birdClearSky({ ...REFERENCE, aerosol: AEROSOL.mountain });
    const dirty = birdClearSky({ ...REFERENCE, aerosol: AEROSOL.urban });
    assert.ok(dirty.directNormal < clean.directNormal);
    assert.ok(dirty.diffuseFraction > clean.diffuseFraction);
  });
});

describe('the inputs we cannot measure', () => {
  it('converts a measured 550 nm optical depth to Ångström turbidity', () => {
    // β = τ·λ^α. A clean AOD of 0.1 at α=1.3 is a β near 0.045.
    const beta = betaFromAod550(0.1, 1.3);
    assert.ok(Math.abs(beta - 0.1 * 0.55 ** 1.3) < 1e-12);
    assert.ok(beta > 0.04 && beta < 0.05, `${beta}`);
  });

  it('blends towards sea air rather than switching to it', () => {
    // A headland is not a mid-ocean buoy.
    const inland = coastalAerosol(0);
    const headland = coastalAerosol(0.5);
    const ocean = coastalAerosol(1);
    assert.deepEqual(inland, AEROSOL.continental);
    assert.deepEqual(ocean, AEROSOL.maritime);
    assert.ok(headland.alpha < inland.alpha && headland.alpha > ocean.alpha, `${headland.alpha}`);
  });

  it('clamps a nonsense sea fraction instead of extrapolating', () => {
    assert.deepEqual(coastalAerosol(-3), AEROSOL.continental);
    assert.deepEqual(coastalAerosol(99), AEROSOL.maritime);
  });
});
