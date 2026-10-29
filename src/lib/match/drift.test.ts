import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterDrift, driftReason, namedPart } from './drift';
import type { LookSignature } from './resemble';
import type { RegionStats } from './types';

const region = (key: RegionStats['key'], L: number, a: number, b: number, sd = 0.2, C = 0.05): RegionStats => ({
  key, coverage: 1, sampled: 5000, L: { mean: L, sd }, C: { mean: C, sd: 0.02 }, hue: { mean: 0, spread: 0 } as never,
  ab: { a, b }, percentiles: Array.from({ length: 21 }, (_, i) => Math.min(1, Math.max(0, L - 0.4 + i * 0.04))),
});
const sig = (id: string, o: { L?: number; a?: number; b?: number; shadowB?: number } = {}): LookSignature => ({
  id, sampledAt: 640,
  regions: {
    global: region('global', o.L ?? 0.5, o.a ?? 0, o.b ?? 0),
    'zone.shadow': region('zone.shadow', 0.2, 0, o.shadowB ?? 0),
    'zone.midtone': region('zone.midtone', 0.5, 0, 0),
    'zone.highlight': region('zone.highlight', 0.8, 0, 0),
  },
});

test('driftReason says which way', () => {
  const dna = sig('dna');
  assert.equal(driftReason(sig('x', { b: 0.04 }), dna, 'cast', 'Red'), 'Warmer than the rest of Red');
  assert.equal(driftReason(sig('x', { a: -0.04 }), dna, 'cast', 'Red'), 'Greener than the rest of Red');
  assert.equal(driftReason(sig('x', { L: 0.7 }), dna, 'tone', 'Ash'), 'Brighter than the rest of Ash');
  assert.equal(driftReason(sig('x', { shadowB: 0.03 }), dna, 'split', 'Red'), 'Warmer shadows than the rest of Red');
});

test('chapterDrift names the outlier and keeps the typical ones', () => {
  const ids = ['a', 'b', 'c', 'd', 'odd'];
  const sigs = new Map(ids.map((id) => [id, id === 'odd' ? sig(id, { b: 0.08 }) : sig(id, { b: 0.001 * ids.indexOf(id) })]));
  const [red] = chapterDrift([{ key: 'red', name: 'Red', ids }], sigs);
  assert.deepEqual(red.drifters.map((d) => [d.id, d.reason]), [['odd', 'Warmer than the rest of Red']]);
  assert.equal(red.typical.length, 3);
  assert.ok(!red.typical.includes('odd'));
});

test('too few photos: no settled look, no drift', () => {
  const sigs = new Map(['a', 'b', 'c'].map((id) => [id, sig(id)]));
  assert.deepEqual(chapterDrift([{ key: 'x', name: 'X', ids: ['a', 'b', 'c'] }], sigs), []);
});

test('namedPart prefers a colour difference over brightness', () => {
  assert.equal(namedPart({ tone: 3, cast: 1.2, saturation: 0.4 }), 'cast');
  assert.equal(namedPart({ tone: 3, cast: 0.6 }), 'tone');
  assert.equal(namedPart({ split: 2, tone: 1 }), 'split');
});
