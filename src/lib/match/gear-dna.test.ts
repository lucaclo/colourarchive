import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { groupPhotosByLens, gearPresets } from './gear-dna.ts';
import { chapterDna } from './chapter-dna.ts';
import type { LookSignature } from './resemble.ts';
import type { Photo, Exif } from '../types.ts';
import type { OKLCH } from '../color.ts';
import type { RegionKey, RegionStats } from './types.ts';

/* ── Photo fixtures, for groupPhotosByLens ────────────────────────────────── */

const oklch: OKLCH = { L: 0.5, C: 0.1, H: 30 };

function photo(id: string, exif: Exif): Photo {
  return {
    id, filename: `${id}.jpg`, ext: 'jpg', width: 1, height: 1, bytes: 1, oklch,
    autoChapter: 'x', chapter: 'x', autoMedium: 'digital', medium: 'digital',
    placeholder: '', derivatives: [], exif, addedAt: new Date().toISOString(),
  };
}

describe('groupPhotosByLens', () => {
  it('groups by the EXIF lens string, trimmed so padding does not split a lens in two', () => {
    const photos = [
      photo('a', { lens: 'FE 35mm F1.4 GM ' }),
      photo('b', { lens: 'FE 35mm F1.4 GM' }),
      photo('c', { lens: 'FE 85mm F1.8' }),
    ];
    const groups = groupPhotosByLens(photos);
    assert.equal(groups.size, 2);
    assert.equal(groups.get('FE 35mm F1.4 GM')?.length, 2);
    assert.equal(groups.get('FE 85mm F1.8')?.length, 1);
  });

  it('drops photos with no lens rather than bucketing them as unknown', () => {
    const photos = [photo('a', {}), photo('b', { lens: '   ' })];
    const groups = groupPhotosByLens(photos);
    assert.equal(groups.size, 0);
  });
});

/* ── Signature fixtures, for gearPresets ──────────────────────────────────── */

interface Shape {
  curve?: (v: number) => number;
  cast?: [number, number];
  chroma?: number;
  spread?: number;
}

const percentiles = (curve: (v: number) => number): number[] =>
  Array.from({ length: 21 }, (_, i) => curve(i / 20));

function region(key: RegionKey, base: number, shape: Shape): RegionStats {
  const curve = shape.curve ?? ((v: number) => v);
  const [ca, cb] = shape.cast ?? [0, 0];
  return {
    key, coverage: 1 / 3, sampled: 50_000,
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

describe('gearPresets', () => {
  const wide = [look('w1', { cast: [0.02, 0.06], chroma: 0.09 }), look('w2', { cast: [0.018, 0.058], chroma: 0.088 }), look('w3', { cast: [0.022, 0.062], chroma: 0.092 })];
  const portrait = [look('p1', { cast: [-0.01, -0.02], chroma: 0.03 }), look('p2', { cast: [-0.012, -0.018], chroma: 0.028 }), look('p3', { cast: [-0.008, -0.022], chroma: 0.032 })];
  const all = [...wide, ...portrait];

  it('skips a lens with fewer than the minimum photos', () => {
    const archiveDna = chapterDna(all)!;
    const byLens = new Map([['35mm', wide], ['200mm', [look('one')]]]);
    const presets = gearPresets(archiveDna, byLens);
    assert.equal(presets.length, 1);
    assert.equal(presets[0].lens, '35mm');
  });

  it('describes a warmer, more saturated lens as warmer and more saturated', () => {
    const archiveDna = chapterDna(all)!;
    const byLens = new Map([['35mm', wide], ['85mm', portrait]]);
    const presets = gearPresets(archiveDna, byLens);
    const wideePreset = presets.find((p) => p.lens === '35mm')!;
    assert.match(wideePreset.note, /warmer/);
    assert.match(wideePreset.note, /more saturated/);
  });

  it('orders presets by count, most-shot lens first', () => {
    const archiveDna = chapterDna(all)!;
    const byLens = new Map([
      ['35mm', wide],
      ['85mm', [...portrait, look('p4', { cast: [-0.01, -0.02], chroma: 0.03 })]],
    ]);
    const presets = gearPresets(archiveDna, byLens);
    assert.equal(presets[0].lens, '85mm');
  });

  it('reads close-to-archive when a lens does not deviate', () => {
    const archiveDna = chapterDna(wide)!;
    const byLens = new Map([['35mm', wide]]);
    const presets = gearPresets(archiveDna, byLens);
    assert.match(presets[0].note, /close to your digital work/);
  });
});
