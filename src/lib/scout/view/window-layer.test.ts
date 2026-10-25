import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Ring } from '../shadows.ts';
import { windowStyle } from './shading.ts';
import { WINDOW_STRIDE, WindowGeometry, footprintSeed } from './window-layer.ts';

/** Degrees in, metres out, so the vertices are easy to read back. */
const project = (lon: number, lat: number, elevationM: number): [number, number, number] => [lon, lat, elevationM];

/** A 20 m × 10 m box at the equator, closed. */
const box: Ring = [
  [0, 0],
  [20 / 111_320, 0],
  [20 / 111_320, 10 / 110_540],
  [0, 10 / 110_540],
  [0, 0],
];

function vertices(ring: Ring, groundM: number, baseM: number, topM: number) {
  const g = new WindowGeometry(project);
  g.addBuilding(ring, groundM, baseM, topM, 0.5);
  const flat = g.vertices();
  const out = [];
  for (let i = 0; i < flat.length; i += WINDOW_STRIDE) {
    const [x, y, z, u, h, len, seed, kind, top] = flat.slice(i, i + WINDOW_STRIDE);
    out.push({ x, y, z, u, h, len, seed, kind, top });
  }
  return out;
}

describe('window geometry', () => {
  it('gives every wall two triangles and the roof a triangulation of its own', () => {
    const v = vertices(box, 0, 0, 30);
    const walls = v.filter((p) => p.kind === 1);
    const roof = v.filter((p) => p.kind === 0);
    assert.equal(walls.length, 4 * 6);
    assert.equal(roof.length, 2 * 3);
    assert.ok(roof.every((p) => p.z === 30 && p.h === 30));
  });

  it('measures each wall in metres, along it and up it', () => {
    const v = vertices(box, 0, 0, 30).filter((p) => p.kind === 1);
    const lengths = [...new Set(v.map((p) => Math.round(p.len)))].sort((a, b) => a - b);
    assert.deepEqual(lengths, [10, 20]);
    for (const p of v) {
      assert.ok(p.u === 0 || Math.abs(p.u - p.len) < 1e-9, `u runs 0..len, got ${p.u}`);
      assert.ok(p.h === 0 || p.h === 30);
    }
  });

  it('stands a part on its base and counts its storeys from the ground', () => {
    const v = vertices(box, 100, 330, 444).filter((p) => p.kind === 1);
    // Positioned on the terrain at 100 m…
    assert.deepEqual([...new Set(v.map((p) => p.z))].sort((a, b) => a - b), [430, 544]);
    // …but the grid reads heights above that ground, so the setback's floors
    // continue the ones below it.
    assert.deepEqual([...new Set(v.map((p) => p.h))].sort((a, b) => a - b), [330, 444]);
    assert.ok(v.every((p) => p.top === 444));
  });

  it('adds nothing for a building with no height', () => {
    assert.equal(vertices(box, 0, 10, 10).length, 0);
  });

  it('triangulates a concave roof without covering its notch', () => {
    const m = 1 / 111_320;
    const l: Ring = [
      [0, 0],
      [20 * m, 0],
      [20 * m, 10 * m],
      [10 * m, 10 * m],
      [10 * m, 20 * m],
      [0, 20 * m],
      [0, 0],
    ];
    const roof = vertices(l, 0, 0, 12).filter((p) => p.kind === 0);
    // An L of six corners is four triangles; a hull fan would cover the notch.
    assert.equal(roof.length, 4 * 3);
    let area = 0;
    for (let i = 0; i < roof.length; i += 3) {
      const [a, b, c] = roof.slice(i, i + 3);
      area += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    }
    // Float32 vertices: a few square millimetres of rounding.
    assert.ok(Math.abs(area / (m * m) - 300) < 1e-3, `roof area ${area / (m * m)} m², expected 300`);
  });
});

describe('footprint seeds', () => {
  it('are stable per building and differ between neighbours', () => {
    const a = footprintSeed(box);
    assert.equal(a, footprintSeed(box));
    const shifted = box.map(([lon, lat]) => [lon + 0.0001, lat]) as Ring;
    assert.notEqual(a, footprintSeed(shifted));
    assert.ok(a >= 0 && a < 1);
  });
});

describe('window style', () => {
  it('has no lights by day and all of them by night, on both maps', () => {
    for (const theme of ['light', 'dark'] as const) {
      assert.equal(windowStyle(30, theme).night, 0);
      assert.equal(windowStyle(-12, theme).night, 1);
    }
  });

  it('turns the lights on across civil twilight, not at the horizon', () => {
    assert.ok(Math.abs(windowStyle(0, 'light').night - 0.5) < 1e-9);
    assert.ok(windowStyle(3, 'light').night > 0 && windowStyle(-3, 'light').night < 1);
  });

  it('gives unlit glass at night the same dark on either map', () => {
    const light = windowStyle(-20, 'light').glass;
    const dark = windowStyle(-20, 'dark').glass;
    light.forEach((c, i) => assert.ok(Math.abs(c - dark[i]) < 1e-9, `${light} vs ${dark}`));
  });
});
