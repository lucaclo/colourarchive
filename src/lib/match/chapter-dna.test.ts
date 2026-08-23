/**
 * Tests for the chapter DNA: averaging several photos' looks into one, and
 * scoring a candidate against it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { chapterDna, scoreAgainstChapter } from './chapter-dna.ts';
import { CLOSE_ENOUGH, TOO_FAR, type LookSignature } from './resemble.ts';
import type { RegionKey, RegionStats } from './types.ts';

interface Shape {
  curve?: (v: number) => number;
  cast?: [number, number];
  chroma?: number;
  spread?: number;
  sampled?: number;
}

const percentiles = (curve: (v: number) => number): number[] =>
  Array.from({ length: 21 }, (_, i) => curve(i / 20));

function region(key: RegionKey, base: number, shape: Shape): RegionStats {
  const curve = shape.curve ?? ((v: number) => v);
  const [ca, cb] = shape.cast ?? [0, 0];
  return {
    key,
    coverage: 1 / 3,
    sampled: shape.sampled ?? 50_000,
    L: { mean: curve(base), sd: shape.spread ?? 0.2 },
    C: { mean: shape.chroma ?? 0.06, sd: 0.02 },
    hue: { mean: 40, strength: 0.5 },
    ab: { a: ca, b: cb },
    percentiles: percentiles(curve),
  };
}

function look(id: string, shape: Shape = {}): LookSignature {
  const regions: Partial<Record<RegionKey, RegionStats>> = {};
  regions.global = region('global', 0.5, shape);
  regions['zone.shadow'] = region('zone.shadow', 0.15, shape);
  regions['zone.midtone'] = region('zone.midtone', 0.5, shape);
  regions['zone.highlight'] = region('zone.highlight', 0.85, shape);
  return { id, sampledAt: 1024, regions };
}

// A settled chapter: warm, lifted-shadow edits, all close to each other.
const CHAPTER = [
  look('a', { cast: [0.02, 0.03], curve: (v) => 0.1 + v * 0.85 }),
  look('b', { cast: [0.025, 0.028], curve: (v) => 0.11 + v * 0.83 }),
  look('c', { cast: [0.018, 0.032], curve: (v) => 0.09 + v * 0.87 }),
];

describe('chapterDna', () => {
  it('is null for an empty chapter', () => {
    assert.equal(chapterDna([]), null);
  });

  it('is the same signature back for a chapter of one', () => {
    const solo = look('only', { cast: [0.05, -0.02] });
    const dna = chapterDna([solo]);
    assert.ok(dna);
    assert.equal(dna!.regions.global!.ab.a, solo.regions.global!.ab.a);
  });

  it('averages several photos toward their shared cast', () => {
    const dna = chapterDna(CHAPTER);
    assert.ok(dna);
    const meanA = CHAPTER.reduce((s, l) => s + l.regions.global!.ab.a, 0) / CHAPTER.length;
    assert.ok(Math.abs(dna!.regions.global!.ab.a - meanA) < 1e-9);
  });
});

describe('scoreAgainstChapter', () => {
  const dna = chapterDna(CHAPTER)!;

  it('reads a photo that matches the chapter as keeping its look', () => {
    const matching = look('new', { cast: [0.021, 0.03], curve: (v) => 0.1 + v * 0.85 });
    const fit = scoreAgainstChapter(matching, dna);
    assert.equal(fit.verdict, 'keeps');
    assert.ok(fit.resemblance.distance <= CLOSE_ENOUGH);
    assert.match(fit.note, /keeps the chapter/);
  });

  it('reads a very differently graded photo as starting a new look', () => {
    // Crushed shadows, cool cast, low chroma — the opposite treatment.
    const different = look('outlier', {
      cast: [-0.09, -0.11],
      curve: (v) => v ** 2.5,
      chroma: 0.01,
    });
    const fit = scoreAgainstChapter(different, dna);
    assert.equal(fit.verdict, 'new-look');
    assert.ok(fit.resemblance.distance >= TOO_FAR);
    assert.match(fit.note, /start a new look/);
  });

  it('the verdict boundaries line up exactly with CLOSE_ENOUGH and TOO_FAR', () => {
    const matching = look('borderline-test', { cast: [0.021, 0.03], curve: (v) => 0.1 + v * 0.85 });
    const fit = scoreAgainstChapter(matching, dna);
    if (fit.resemblance.distance <= CLOSE_ENOUGH) assert.equal(fit.verdict, 'keeps');
    else if (fit.resemblance.distance >= TOO_FAR) assert.equal(fit.verdict, 'new-look');
    else assert.equal(fit.verdict, 'borderline');
  });
});
