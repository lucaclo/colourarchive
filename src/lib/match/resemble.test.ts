/**
 * Tests for the grade comparison.
 *
 * The property that matters most is not any single number but a separation: this
 * must rank on the *edit* and be blind to the *subject*, which is the opposite
 * of what `similar.ts` does. So the fixtures below are built as pairs — the same
 * measured scene given two different grades, and two different scenes given the
 * same grade — and the test is that the second pair ranks closer than the first.
 * Getting that backwards is the only way this feature can be quietly useless,
 * and it would not show up in a test of any one component.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOSE_ENOUGH,
  LOOK_REGIONS,
  PART_LABEL,
  SCALES,
  TOO_FAR,
  WEIGHTS,
  castDistance,
  compareLooks,
  describeParts,
  rankResemblance,
  splitVector,
  toneDistance,
  trimSignature,
  type LookPart,
  type LookSignature,
} from './resemble.ts';
import type { RegionKey, RegionStats } from './types.ts';

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

interface Shape {
  /** Curve applied to the 21 percentiles: input 0..1 to output 0..1. */
  curve?: (v: number) => number;
  /** Added to every mean a/b — a cast. */
  cast?: [number, number];
  chroma?: number;
  spread?: number;
  /** Extra a/b on highlights only, and its negative on shadows — split toning. */
  split?: [number, number];
  sampled?: number;
}

const percentiles = (curve: (v: number) => number): number[] =>
  Array.from({ length: 21 }, (_, i) => curve(i / 20));

function region(key: RegionKey, base: number, shape: Shape): RegionStats {
  const curve = shape.curve ?? ((v: number) => v);
  const [ca, cb] = shape.cast ?? [0, 0];
  const [sa, sb] = shape.split ?? [0, 0];
  const end = key === 'zone.highlight' ? 1 : key === 'zone.shadow' ? -1 : 0;
  return {
    key,
    coverage: 1 / 3,
    sampled: shape.sampled ?? 50_000,
    L: { mean: curve(base), sd: shape.spread ?? 0.2 },
    C: { mean: shape.chroma ?? 0.06, sd: 0.02 },
    hue: { mean: 40, strength: 0.5 },
    ab: { a: ca + end * sa, b: cb + end * sb },
    percentiles: percentiles(curve),
  };
}

/** A whole signature built from one description of a grade. */
function look(id: string, shape: Shape = {}): LookSignature {
  const regions: Partial<Record<RegionKey, RegionStats>> = {};
  regions.global = region('global', 0.5, shape);
  regions['zone.shadow'] = region('zone.shadow', 0.15, shape);
  regions['zone.midtone'] = region('zone.midtone', 0.5, shape);
  regions['zone.highlight'] = region('zone.highlight', 0.85, shape);
  return { id, sampledAt: 1024, regions };
}

const NEUTRAL = look('neutral');
/** Same scene, lifted shadows and a cool cast — a different edit. */
const REGRADED = look('regraded', {
  curve: (v) => 0.12 + v * 0.8,
  cast: [-0.02, -0.03],
  chroma: 0.04,
});

/* ── The parts ─────────────────────────────────────────────────────────────── */

describe('toneDistance', () => {
  it('is zero between a curve and itself', () => {
    assert.equal(toneDistance(percentiles((v) => v), percentiles((v) => v)), 0);
  });

  it('is the RMS of the differences', () => {
    const a = percentiles(() => 0.5);
    const b = percentiles(() => 0.6);
    const d = toneDistance(a, b)!;
    assert.ok(Math.abs(d - 0.1) < 1e-12, `got ${d}`);
  });

  it('grows with how far the curve was moved', () => {
    const base = percentiles((v) => v);
    let previous = -1;
    for (const lift of [0, 0.02, 0.05, 0.12, 0.3]) {
      const d = toneDistance(base, percentiles((v) => v * (1 - lift) + lift))!;
      assert.ok(d > previous, `lift ${lift} did not increase the distance`);
      previous = d;
    }
  });

  it('refuses curves it cannot line up', () => {
    assert.equal(toneDistance(undefined, percentiles((v) => v)), null);
    assert.equal(toneDistance([], []), null);
    assert.equal(toneDistance([0.1, 0.2], [0.1, 0.2, 0.3]), null);
  });
});

describe('splitVector', () => {
  it('reads the pull between the two ends of the scale', () => {
    const split = splitVector(look('s', { split: [0.03, 0.05] }))!;
    // Highlights get +split, shadows −split, so the gap is twice it.
    assert.ok(Math.abs(split.a - 0.06) < 1e-12);
    assert.ok(Math.abs(split.b - 0.1) < 1e-12);
  });

  it('is blind to a cast applied to the whole frame', () => {
    const plain = splitVector(look('a'))!;
    const cast = splitVector(look('b', { cast: [0.05, -0.04] }))!;
    assert.deepEqual(plain, cast);
  });

  it('refuses a zone too thin to have a colour', () => {
    assert.equal(splitVector(look('sparse', { sampled: 10 })), null);
    const noZones: LookSignature = { id: 'x', sampledAt: 1, regions: { global: look('g').regions.global } };
    assert.equal(splitVector(noZones), null);
  });
});

describe('castDistance', () => {
  it('is a plain distance in the a/b plane', () => {
    assert.equal(castDistance({ a: 0, b: 0 }, { a: 3, b: 4 }), 5);
    assert.equal(castDistance({ a: 1, b: -1 }, { a: 1, b: -1 }), 0);
  });
});

/* ── The comparison ────────────────────────────────────────────────────────── */

describe('compareLooks', () => {
  it('puts a photograph at zero distance from itself', () => {
    const self = compareLooks(NEUTRAL, look('copy'));
    assert.equal(self.distance, 0);
    assert.deepEqual(self.missing, []);
    assert.match(self.note, /same treatment/);
  });

  it('never claims two photographs were edited the same way', () => {
    const self = compareLooks(NEUTRAL, look('copy'));
    assert.match(self.note, /not a claim about how either was edited/);
  });

  it('separates the grade from the scene', () => {
    // Two different scenes — different mean lightness and chroma — given the
    // same grade must land closer than one scene given two grades. This is the
    // whole difference between this file and similar.ts.
    const sceneA = look('a', { curve: (v) => 0.1 + v * 0.85, cast: [0.01, 0.02] });
    const sceneB = look('b', { curve: (v) => 0.1 + v * 0.85, cast: [0.011, 0.019] });
    const sameGrade = compareLooks(sceneA, sceneB).distance;
    const sameScene = compareLooks(NEUTRAL, REGRADED).distance;
    assert.ok(sameGrade < sameScene, `${sameGrade} was not closer than ${sameScene}`);
    assert.ok(sameGrade < CLOSE_ENOUGH);
  });

  it('reports every part in the same currency', () => {
    const compared = compareLooks(NEUTRAL, REGRADED);
    for (const part of Object.keys(SCALES) as LookPart[]) {
      assert.ok(Number.isFinite(compared.parts[part]), `${part} was not measured`);
      assert.ok(compared.parts[part] >= 0);
    }
    // A part of 1 means one scale's worth, by construction.
    const shifted = compareLooks(NEUTRAL, look('cast', { cast: [SCALES.cast, 0] }));
    assert.ok(Math.abs(shifted.parts.cast - 1) < 1e-9, `got ${shifted.parts.cast}`);
  });

  it('names what agrees and what does not', () => {
    const compared = compareLooks(NEUTRAL, look('flat', { spread: 0.2 + SCALES.contrast * 4 }));
    assert.equal(compared.furthest, 'contrast');
    assert.match(compared.note, new RegExp(PART_LABEL.contrast));
  });

  it('drops an unmeasurable part rather than scoring it as agreement', () => {
    // A frame with almost no shadow pixels: split toning cannot be read, and
    // must not be counted as a perfect match.
    const sparse = look('sparse', { sampled: 10 });
    const compared = compareLooks(NEUTRAL, sparse);
    assert.deepEqual(compared.missing, ['split']);
    assert.ok(!('split' in compared.parts));
    assert.match(compared.note, /split toning could not be compared/);
  });

  it('keeps the scale when a part is dropped', () => {
    // Two candidates identical except that one cannot report split toning. The
    // remaining parts agree exactly, so both must read as identical rather than
    // the incomplete one being penalised or flattered.
    const full = compareLooks(NEUTRAL, look('full'));
    const partial = compareLooks(NEUTRAL, look('partial', { sampled: 10 }));
    assert.equal(full.distance, 0);
    assert.equal(partial.distance, 0);
  });

  it('refuses a photograph with nothing measured at all', () => {
    const empty: LookSignature = { id: 'empty', sampledAt: 0, regions: {} };
    const compared = compareLooks(NEUTRAL, empty);
    assert.equal(compared.distance, Infinity);
    assert.match(compared.note, /Nothing comparable/);
  });

  it('is symmetric', () => {
    const there = compareLooks(NEUTRAL, REGRADED).distance;
    const back = compareLooks(REGRADED, NEUTRAL).distance;
    assert.ok(Math.abs(there - back) < 1e-12);
  });

  it('grows monotonically as one part is pushed further', () => {
    let previous = -1;
    for (const step of [0, 1, 2, 4, 8]) {
      const d = compareLooks(NEUTRAL, look(`c${step}`, { cast: [SCALES.cast * step, 0] })).distance;
      assert.ok(d > previous, `step ${step} did not increase the distance`);
      previous = d;
    }
  });

  it('weights tone above every other part', () => {
    const parts = Object.keys(WEIGHTS) as LookPart[];
    for (const part of parts) {
      if (part !== 'tone') assert.ok(WEIGHTS.tone > WEIGHTS[part], `tone not above ${part}`);
    }
    const total = parts.reduce((sum, p) => sum + WEIGHTS[p], 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `weights summed to ${total}`);
  });
});

/* ── Ranking ───────────────────────────────────────────────────────────────── */

describe('rankResemblance', () => {
  const archive = [
    look('far', { curve: (v) => 0.4 + v * 0.3, cast: [0.09, -0.08], chroma: 0.005, spread: 0.4 }),
    look('near', { cast: [0.001, 0.001] }),
    look('middle', { cast: [0.02, 0.01], chroma: 0.05 }),
  ];

  it('sorts closest first', () => {
    const ranked = rankResemblance(NEUTRAL, archive);
    assert.deepEqual(ranked.map((r) => r.id), ['near', 'middle', 'far']);
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(ranked[i].distance >= ranked[i - 1].distance);
    }
  });

  it('never returns the reference itself', () => {
    const ranked = rankResemblance(NEUTRAL, [...archive, { ...NEUTRAL }]);
    assert.ok(!ranked.some((r) => r.id === NEUTRAL.id));
  });

  it('drops what it cannot compare instead of ranking it last', () => {
    const ranked = rankResemblance(NEUTRAL, [...archive, { id: 'blank', sampledAt: 0, regions: {} }]);
    assert.ok(!ranked.some((r) => r.id === 'blank'));
  });

  it('honours a cut-off rather than showing the bottom of the list', () => {
    const ranked = rankResemblance(NEUTRAL, archive, { maxDistance: TOO_FAR });
    assert.ok(ranked.every((r) => r.distance <= TOO_FAR));
    assert.ok(!ranked.some((r) => r.id === 'far'), 'the unrelated photograph survived the cut');
  });

  it('honours a limit', () => {
    assert.equal(rankResemblance(NEUTRAL, archive, { limit: 2 }).length, 2);
    assert.equal(rankResemblance(NEUTRAL, archive, { limit: 0 }).length, 0);
  });

  it('copes with an empty archive', () => {
    assert.deepEqual(rankResemblance(NEUTRAL, []), []);
  });
});

/* ── Presentation and storage ──────────────────────────────────────────────── */

describe('describeParts', () => {
  it('lists the parts best first', () => {
    const text = describeParts(compareLooks(NEUTRAL, REGRADED));
    const numbers = [...text.matchAll(/([\d.]+)(?: ·|$)/g)].map((m) => Number(m[1]));
    for (let i = 1; i < numbers.length; i++) assert.ok(numbers[i] >= numbers[i - 1], text);
    assert.match(text, /tone curve/);
  });
});

describe('trimSignature', () => {
  it('keeps only the regions the comparison reads', () => {
    const full = {
      ...look('x').regions,
      'people.skin': look('y').regions.global,
      'scene.sky': look('z').regions.global,
    } as Partial<Record<RegionKey, RegionStats>>;
    const trimmed = trimSignature('x', 1024, full);
    assert.deepEqual(Object.keys(trimmed.regions).sort(), [...LOOK_REGIONS].sort());
  });

  it('carries no region it was not given', () => {
    const trimmed = trimSignature('x', 1024, { global: look('g').regions.global });
    assert.deepEqual(Object.keys(trimmed.regions), ['global']);
  });
});
