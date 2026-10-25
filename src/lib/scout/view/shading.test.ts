import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createExpression } from '@maplibre/maplibre-gl-style-spec';

import { shadowOpacity } from '../basemap.ts';
import { buildingFill, buildingRamp, DRAWN_IN_3D, shadowDarkness, shadowFade } from './shading.ts';

/**
 * Evaluate the interpolation MapLibre would evaluate.
 *
 * Deliberately a separate implementation from `shadowDarkness`. The whole point
 * of the comparison below is that two independent encodings of one curve agree,
 * and reusing the arithmetic under test would make it agree with itself.
 */
function readFade(expression: unknown, lengthM: number): number {
  const parts = expression as unknown[];
  assert.equal(parts[0], 'interpolate', 'not an interpolate expression');
  assert.deepEqual(parts[1], ['linear'], 'the fade is meant to be linear');
  assert.deepEqual(parts[2], ['coalesce', ['get', 'lengthM'], 0], 'fades on the wrong property');

  const stops: Array<[number, number]> = [];
  for (let i = 3; i < parts.length; i += 2) {
    stops.push([parts[i] as number, parts[i + 1] as number]);
  }
  assert.ok(stops.length >= 2, 'an interpolation needs at least two stops');

  const first = stops[0];
  const last = stops[stops.length - 1];
  if (lengthM <= first[0]) return first[1];
  if (lengthM >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [x0, y0] = stops[i - 1];
    const [x1, y1] = stops[i];
    if (lengthM > x1) continue;
    // Two stops at the same input is legal and means a step; MapLibre takes the
    // later one, and dividing by the gap here would be a division by zero.
    if (x1 === x0) return y1;
    return y0 + ((y1 - y0) * (lengthM - x0)) / (x1 - x0);
  }
  return last[1];
}

describe('the two ways a shadow is faded', () => {
  // Below, at, and either side of both anchors, plus the far end.
  const lengths = [0, 1, 100, 250, 251, 400, 725, 900, 1199, 1200, 1201, 5000];
  // Overhead, raking, and at the horizon, where `shadowOpacity` is doing the
  // most work.
  const altitudes = [90, 45, 20, 8, 3, 0.5];

  it('agrees with the style expression at every length', () => {
    for (const altitude of altitudes) {
      for (const lengthM of lengths) {
        const fromStyle = readFade(shadowFade(altitude, 1), lengthM);
        const fromLayer = shadowDarkness(lengthM, altitude);
        assert.ok(
          Math.abs(fromStyle - fromLayer) < 1e-12,
          `at ${altitude}° and ${lengthM} m the style says ${fromStyle} and the layer says ${fromLayer}`,
        );
      }
    }
  });

  it('scales the whole curve by the cloud, and only the style half', () => {
    // The custom layer applies cloud as a uniform after resolving overlaps, so
    // its own arithmetic must stay cloudless — multiplying it here as well is
    // how the two renderers end up a factor apart under a forecast.
    const cloud = 0.4;
    for (const lengthM of lengths) {
      const clouded = readFade(shadowFade(20, cloud), lengthM);
      const clear = readFade(shadowFade(20, 1), lengthM);
      assert.ok(Math.abs(clouded - clear * cloud) < 1e-12, `cloud not applied at ${lengthM} m`);
      assert.equal(shadowDarkness(lengthM, 20), clear, 'the layer half must not be clouded');
    }
  });

  it('starts at the full opacity for the altitude and never rises with length', () => {
    for (const altitude of altitudes) {
      assert.equal(shadowDarkness(0, altitude), shadowOpacity(altitude));
      let previous = Infinity;
      for (const lengthM of lengths) {
        const value = shadowDarkness(lengthM, altitude);
        assert.ok(value <= previous + 1e-12, `${lengthM} m is darker than the length before it`);
        previous = value;
      }
    }
  });

  it('leaves four tenths of the shadow at the far end', () => {
    for (const altitude of altitudes) {
      assert.ok(
        Math.abs(shadowDarkness(5000, altitude) - shadowOpacity(altitude) * 0.4) < 1e-12,
        `the floor is wrong at ${altitude}°`,
      );
    }
  });
});

describe('the building ramp', () => {
  it('is an interpolation over the rendered height, with a fallback', () => {
    const ramp = buildingRamp(30, 'light') as unknown[];
    assert.equal(ramp[0], 'interpolate');
    assert.deepEqual(ramp[1], ['linear']);
    // A building with no `render_height` must colour as a zero-height one
    // rather than dropping out of the interpolation and rendering untinted.
    assert.deepEqual(ramp[2], ['coalesce', ['get', 'render_height'], 0]);
  });

  it('states its stops in ascending height, which an interpolation requires', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const altitude of [-90, 0, 10, 60]) {
        const ramp = buildingRamp(altitude, theme) as unknown[];
        const heights: number[] = [];
        for (let i = 3; i < ramp.length; i += 2) heights.push(ramp[i] as number);
        assert.ok(heights.length > 0, `no stops at ${altitude}° on ${theme}`);
        for (let i = 1; i < heights.length; i++) {
          assert.ok(
            heights[i] > heights[i - 1],
            `${theme} at ${altitude}°: ${heights[i]} does not follow ${heights[i - 1]}`,
          );
        }
      }
    }
  });

  it('gives every stop a colour', () => {
    const ramp = buildingRamp(5, 'dark') as unknown[];
    for (let i = 4; i < ramp.length; i += 2) {
      assert.match(String(ramp[i]), /^(#|rgb)/, `stop ${i} is not a colour`);
    }
  });
});

/** Run an expression through MapLibre's own evaluator, for one feature. */
function evaluate(expression: unknown, properties: Record<string, unknown>): unknown {
  const parsed = createExpression(expression);
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value));
  return parsed.value.evaluate({ zoom: 16 }, { type: 'Polygon', properties } as never);
}

const rgbOf = (colour: unknown): [number, number, number] => {
  // `to-rgba` hands back 0–255 channels; a colour expression hands back a Color.
  if (Array.isArray(colour)) return [colour[0], colour[1], colour[2]];
  const c = colour as { r: number; g: number; b: number; a: number };
  // MapLibre colours are premultiplied 0–1; every fill here is opaque.
  return [c.r * 255, c.g * 255, c.b * 255];
};
const luma = ([r, g, b]: [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b;

describe('the building fill', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`leaves an uncoloured or grey building exactly as the ramp drew it (${theme})`, () => {
      const plain = rgbOf(evaluate(['to-rgba', buildingRamp(20, theme)], { render_height: 60 }));
      for (const colour of [undefined, 'black', 'white', '#808080', 'not a colour']) {
        const filled = rgbOf(evaluate(buildingFill(20, theme), { render_height: 60, colour }));
        filled.forEach((v, i) => assert.ok(Math.abs(v - plain[i]) < 0.6, `${colour}: ${filled} vs ${plain}`));
      }
    });

    it(`takes a hue from the mapped colour but keeps the ramp's lightness (${theme})`, () => {
      const plain = rgbOf(evaluate(['to-rgba', buildingRamp(20, theme)], { render_height: 60 }));
      const glass = rgbOf(evaluate(buildingFill(20, theme), { render_height: 60, colour: '#5a81a0' }));
      assert.ok(glass[2] > glass[0] + 4, `glass should lean blue: ${glass}`);
      assert.ok(Math.abs(luma(glass) - luma(plain)) < 3, `lightness moved: ${luma(glass)} vs ${luma(plain)}`);
    });
  }

  it('stays a pale tint on the paper map, not the literal colour', () => {
    const brick = rgbOf(evaluate(buildingFill(30, 'light'), { render_height: 20, colour: 'red' }));
    const spread = Math.max(...brick) - Math.min(...brick);
    assert.ok(spread > 10 && spread < 60, `red brick tint spread ${spread}: ${brick}`);
  });
});

describe('which buildings are drawn in 3D', () => {
  it('drops the outline of a building mapped in parts, and keeps everything else', () => {
    assert.equal(evaluate(DRAWN_IN_3D, { hide_3d: true, render_height: 444 }), false);
    assert.equal(evaluate(DRAWN_IN_3D, { render_height: 444, render_min_height: 330 }), true);
    assert.equal(evaluate(DRAWN_IN_3D, { hide_3d: false, render_height: 12 }), true);
  });
});
