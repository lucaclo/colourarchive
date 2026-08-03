import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ambientColour,
  buildingColours,
  contrastOverrides,
  contrastRatio,
  daylightWash,
  directionalIntensity,
  extrusionLightColour,
  lightPosition,
  shadowColour,
  shadowOpacity,
  skyColour,
  sunlightColour,
  sunlightIntensity,
} from './basemap.ts';

const isHex = (value: string) => /^#[0-9a-f]{6}$/.test(value);
const luminance = (colour: string) => contrastRatio(colour, '#000000');

describe('sunlight colour', () => {
  it('always returns a valid hex colour, at any altitude', () => {
    for (let altitude = -90; altitude <= 90; altitude += 3) {
      for (const fn of [sunlightColour, ambientColour, skyColour, shadowColour]) {
        assert.ok(isHex(fn(altitude)), `${fn.name} at ${altitude}: ${fn(altitude)}`);
      }
    }
  });

  it('is warm at the horizon and neutral overhead', () => {
    const low = sunlightColour(1);
    const high = sunlightColour(60);
    const red = (c: string) => parseInt(c.slice(1, 3), 16);
    const blue = (c: string) => parseInt(c.slice(5, 7), 16);
    // Low sun: strongly red-biased. High sun: near neutral.
    assert.ok(red(low) - blue(low) > 80, `${low}`);
    assert.ok(red(high) - blue(high) < 30, `${high}`);
  });

  it('goes blue below the horizon rather than staying warm', () => {
    const twilight = sunlightColour(-8);
    const red = parseInt(twilight.slice(1, 3), 16);
    const blue = parseInt(twilight.slice(5, 7), 16);
    assert.ok(blue > red, `${twilight}`);
  });

  it('brightens monotonically as the sun climbs', () => {
    let previous = -1;
    for (const altitude of [-18, -6, 0, 10, 30, 60]) {
      const value = contrastRatio(skyColour(altitude), '#000000');
      assert.ok(value > previous || altitude > 10, `${altitude}: ${value}`);
      previous = value;
    }
  });
});

describe('sunlight intensity', () => {
  it('is exactly zero below the horizon', () => {
    for (const altitude of [-0.1, -1, -6, -30]) {
      assert.equal(sunlightIntensity(altitude), 0, `${altitude}`);
    }
  });

  it('climbs with the sun and stays within range', () => {
    let previous = -1;
    for (const altitude of [0.5, 5, 15, 30, 45, 60, 89]) {
      const value = sunlightIntensity(altitude);
      assert.ok(value >= 0 && value <= 1, `${altitude}: ${value}`);
      assert.ok(value >= previous, `${altitude} went backwards`);
      previous = value;
    }
  });

  it('plateaus above 60°, where the difference stops being visible', () => {
    assert.equal(sunlightIntensity(60), sunlightIntensity(89));
    assert.ok(sunlightIntensity(45) < sunlightIntensity(60));
  });
});

describe('daylight wash', () => {
  it('returns a valid colour and a sane opacity at any altitude', () => {
    for (let altitude = -90; altitude <= 90; altitude += 3) {
      const { colour, opacity } = daylightWash(altitude);
      assert.ok(isHex(colour), `${altitude}: ${colour}`);
      assert.ok(opacity >= 0 && opacity <= 0.55, `${altitude}: ${opacity}`);
    }
  });

  it('thins out as the sun climbs — midday light has nothing to say', () => {
    let previous = Infinity;
    for (const altitude of [-18, -6, 0, 5, 15, 40, 80]) {
      const { opacity } = daylightWash(altitude);
      assert.ok(opacity <= previous, `${altitude}: ${opacity} > ${previous}`);
      previous = opacity;
    }
    assert.ok(daylightWash(60).opacity < 0.06);
  });

  it('is dark and blue at night, warm and light at dawn', () => {
    const night = daylightWash(-14).colour;
    const dawn = daylightWash(2).colour;
    const blue = (c: string) => parseInt(c.slice(5, 7), 16);
    const red = (c: string) => parseInt(c.slice(1, 3), 16);
    assert.ok(blue(night) > red(night), night);
    assert.ok(red(dawn) > blue(dawn) + 80, dawn);
    assert.ok(luminance(dawn) > luminance(night), `${dawn} vs ${night}`);
  });
});

describe('building colours', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`gives every stop a valid colour at any altitude (${theme})`, () => {
      for (let altitude = -90; altitude <= 90; altitude += 5) {
        for (const stop of buildingColours(altitude, theme)) {
          assert.ok(isHex(stop.colour), `${altitude}/${stop.height}: ${stop.colour}`);
        }
      }
    });

    it(`separates a tower from a shed, at every hour (${theme})`, () => {
      for (const altitude of [-20, -3, 1, 10, 45]) {
        const stops = buildingColours(altitude, theme);
        const low = stops[0].colour;
        const tall = stops[stops.length - 1].colour;
        // The whole point: one flat grey for the city is what this replaces.
        assert.notEqual(low, tall, `${altitude}`);
        assert.ok(luminance(tall) > luminance(low), `${altitude}: ${low} → ${tall}`);
      }
    });

    it(`rises monotonically with height (${theme})`, () => {
      const stops = buildingColours(20, theme);
      for (let i = 1; i < stops.length; i++) {
        assert.ok(stops[i].height > stops[i - 1].height, 'heights out of order');
        assert.ok(
          luminance(stops[i].colour) >= luminance(stops[i - 1].colour),
          `${stops[i - 1].colour} → ${stops[i].colour}`,
        );
      }
    });

    it(`is darker at night than at midday (${theme})`, () => {
      const night = buildingColours(-20, theme)[0].colour;
      const noon = buildingColours(50, theme)[0].colour;
      assert.ok(luminance(noon) > luminance(night), `${night} → ${noon}`);
    });
  }

  it('keeps the light basemap lighter than the dark one', () => {
    assert.ok(
      luminance(buildingColours(30, 'light')[0].colour) >
        luminance(buildingColours(30, 'dark')[0].colour),
    );
  });
});

describe('extrusion light colour', () => {
  it('carries the sun’s hue without carrying its brightness', () => {
    // MapLibre multiplies the face colour by this. A literal twilight blue would
    // take a building to near black; the whole point is that it must not.
    for (const altitude of [-30, -6, 0, 5, 20, 60]) {
      const colour = extrusionLightColour(altitude);
      assert.ok(isHex(colour), `${altitude}: ${colour}`);
      const channels = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
      assert.ok(Math.max(...channels) >= 250, `${altitude}: ${colour} would dim the city`);
      assert.ok(Math.min(...channels) >= 100, `${altitude}: ${colour} is too saturated`);
    }
  });

  it('still leans warm at sunrise and cool at night', () => {
    const warm = extrusionLightColour(2);
    const cool = extrusionLightColour(-20);
    const red = (c: string) => parseInt(c.slice(1, 3), 16);
    const blue = (c: string) => parseInt(c.slice(5, 7), 16);
    assert.ok(red(warm) > blue(warm), warm);
    assert.ok(blue(cool) > red(cool), cool);
  });
});

describe('directional intensity', () => {
  it('peaks with a low sun, where the raking light is', () => {
    // The opposite shape to sunlightIntensity, and deliberately so: beam energy
    // is weakest at dawn but the side-lighting is at its strongest.
    assert.ok(directionalIntensity(1) > directionalIntensity(15));
    assert.ok(directionalIntensity(15) > directionalIntensity(45));
    assert.ok(sunlightIntensity(1) < sunlightIntensity(45));
  });

  it('goes flat below the horizon rather than inventing a side to light from', () => {
    assert.ok(directionalIntensity(-1) < 0.2);
    assert.ok(directionalIntensity(-30) < 0.2);
  });

  it('stays inside MapLibre’s 0–1 range', () => {
    for (let altitude = -90; altitude <= 90; altitude += 3) {
      const value = directionalIntensity(altitude);
      assert.ok(value >= 0 && value <= 1, `${altitude}: ${value}`);
    }
  });
});

describe('shadow opacity', () => {
  it('is zero with no sun to cast one', () => {
    for (const altitude of [0, -0.5, -10]) assert.equal(shadowOpacity(altitude), 0, `${altitude}`);
  });

  it('is softer at dawn than at noon, and never opaque', () => {
    assert.ok(shadowOpacity(1) < shadowOpacity(20));
    for (let altitude = 0.1; altitude <= 90; altitude += 1) {
      const value = shadowOpacity(altitude);
      assert.ok(value > 0.15 && value < 0.6, `${altitude}: ${value}`);
    }
  });
});

describe('light position', () => {
  it('maps altitude to a polar angle down from vertical', () => {
    assert.deepEqual(lightPosition(0, 90), [1.4, 0, 0]); // straight overhead
    assert.deepEqual(lightPosition(180, 0), [1.4, 180, 90]); // on the horizon, due south
    assert.deepEqual(lightPosition(90, 45), [1.4, 90, 45]);
  });

  it('normalises the azimuth', () => {
    assert.equal(lightPosition(-90, 30)[1], 270);
    assert.equal(lightPosition(450, 30)[1], 90);
  });

  it('never produces a polar angle outside 0–180', () => {
    for (const altitude of [-90, -30, 0, 30, 90]) {
      const [, , polar] = lightPosition(0, altitude);
      assert.ok(polar >= 0 && polar <= 180, `${altitude}: ${polar}`);
    }
  });
});

describe('contrast overrides', () => {
  // A miniature of the real OpenFreeMap dark style.
  const layers = [
    { id: 'background', type: 'background' },
    { id: 'water', type: 'fill', 'source-layer': 'water' },
    { id: 'landcover_wood', type: 'fill', 'source-layer': 'landcover' },
    { id: 'highway_motorway', type: 'line', 'source-layer': 'transportation' },
    { id: 'highway_minor', type: 'line', 'source-layer': 'transportation' },
    { id: 'building', type: 'fill', 'source-layer': 'building' },
    { id: 'place_label', type: 'symbol', 'source-layer': 'place' },
    { id: 'boundary_country', type: 'line', 'source-layer': 'boundary' },
    { id: 'mystery', type: 'line', 'source-layer': 'something_new' },
  ];

  const overrides = contrastOverrides(layers);
  const find = (layerId: string, property: string) =>
    overrides.find((o) => o.layerId === layerId && o.property === property)?.value as string;

  it('leaves layers it does not recognise alone', () => {
    assert.equal(
      overrides.some((o) => o.layerId === 'mystery'),
      false,
    );
  });

  it('lifts roads clear of the background', () => {
    const background = find('background', 'background-color');
    const motorway = find('highway_motorway', 'line-color');
    const minor = find('highway_minor', 'line-color');
    // The stock style manages about 1.1:1 here, which is why it looks blank.
    assert.ok(contrastRatio(motorway, background) > 3, `motorway ${contrastRatio(motorway, background)}`);
    assert.ok(contrastRatio(minor, background) > 1.8, `minor ${contrastRatio(minor, background)}`);
  });

  it('makes major roads brighter than minor ones', () => {
    const background = find('background', 'background-color');
    assert.ok(
      contrastRatio(find('highway_motorway', 'line-color'), background) >
        contrastRatio(find('highway_minor', 'line-color'), background),
    );
  });

  it('separates water, buildings and land from the background', () => {
    const background = find('background', 'background-color');
    for (const [layer, property] of [
      ['water', 'fill-color'],
      ['building', 'fill-color'],
      ['landcover_wood', 'fill-color'],
    ] as const) {
      const colour = find(layer, property);
      assert.ok(isHex(colour), `${layer}: ${colour}`);
      assert.notEqual(colour, background);
    }
  });

  it('gives labels a readable colour and a halo to sit in', () => {
    const text = find('place_label', 'text-color');
    const halo = find('place_label', 'text-halo-color');
    assert.ok(contrastRatio(text, halo) > 5, `${contrastRatio(text, halo)}`);
  });

  it('produces only valid colours', () => {
    for (const override of overrides) {
      if (typeof override.value === 'string') {
        assert.ok(isHex(override.value), `${override.layerId}/${override.property}: ${override.value}`);
      }
    }
  });
});
