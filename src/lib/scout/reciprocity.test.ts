import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILM_STOCKS, correctExposure, filmStock, formatStops } from './reciprocity';
import { describeFilter, longExposureNotes, ndFactor, opticalDensity, parseFilter } from './exposure';

test('Ilford: metered ^ P, the sheet’s own worked example', () => {
  const hp5 = filmStock('hp5')!;
  const c = correctExposure(hp5, 10);
  assert.ok(Math.abs(c.seconds - 20.4) < 0.05);
  assert.equal(correctExposure(hp5, 1).seconds, 1);
  assert.equal(correctExposure(hp5, 0.5).stops, 0);
});

test('Tri-X: exactly the printed table at its points, smooth between, said when past it', () => {
  const trix = filmStock('trix400')!;
  assert.ok(Math.abs(correctExposure(trix, 1).seconds - 2) < 1e-9);
  assert.ok(Math.abs(correctExposure(trix, 10).seconds - 50) < 1e-9);
  assert.ok(Math.abs(correctExposure(trix, 100).seconds - 1200) < 1e-6);
  const mid = correctExposure(trix, 4).seconds;
  assert.ok(mid > 8 && mid < 50);
  assert.equal(correctExposure(trix, 0.05).seconds, 0.05);
  assert.equal(correctExposure(trix, 100).extrapolated, false);
  assert.equal(correctExposure(trix, 300).extrapolated, true);
});

test('Portra past a second, and Velvia past a minute, refuse rather than guess', () => {
  assert.equal(correctExposure(filmStock('portra400')!, 0.5).refusal, undefined);
  assert.match(correctExposure(filmStock('portra400')!, 4).refusal!, /no correction past 1 s/);
  const v = filmStock('velvia50')!;
  const at8 = correctExposure(v, 8);
  assert.ok(Math.abs(at8.stops - 0.5) < 1e-9);
  assert.equal(at8.filter, '7.5M');
  assert.equal(correctExposure(v, 2).filter, undefined);
  assert.match(correctExposure(v, 64).refusal!, /doesn't recommend exposures of 64 s or longer/);
});

test('every stock names its source', () => {
  for (const s of FILM_STOCKS) assert.ok(s.source.length > 10, s.id);
});

test('stops read the way they are written', () => {
  assert.equal(formatStops(0), '0');
  assert.equal(formatStops(1 / 3), '+⅓');
  assert.equal(formatStops(0.5), '+½');
  assert.equal(formatStops(1.03), '+1');
  assert.equal(formatStops(5 / 3), '+1⅔');
});

test('one filter, three labels, read back any way', () => {
  assert.equal(ndFactor(6), 64);
  assert.ok(Math.abs(opticalDensity(6) - 1.806) < 0.001);
  assert.equal(describeFilter(6), '6 stops · ND64 · 1.8');
  assert.equal(describeFilter(Math.log2(1000)), '10 stops · ND1000 · 3.0');
  assert.equal(describeFilter(1), '1 stop · ND2 · 0.3');
  assert.ok(Math.abs(parseFilter('ND64')! - 6) < 1e-9);
  assert.ok(Math.abs(parseFilter('64')! - 6) < 1e-9);
  assert.ok(Math.abs(parseFilter('1.8')! - 5.98) < 0.01);
  assert.ok(Math.abs(parseFilter('ND 0.9')! - 2.99) < 0.01);
  assert.equal(parseFilter('6 stops'), 6);
  assert.equal(parseFilter('10'), 10);
  assert.ok(Math.abs(parseFilter('ND400')! - Math.log2(400)) < 1e-9);
  assert.equal(parseFilter('purple'), null);
});

test('long exposures get quiet notes past 30 s and 30 min', () => {
  assert.deepEqual(longExposureNotes(20), []);
  assert.equal(longExposureNotes(60).length, 1);
  assert.equal(longExposureNotes(3600).length, 2);
});
