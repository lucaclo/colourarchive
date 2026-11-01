import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexLightness, lightPhase, nextFrame, paletteLightness, phaseFromClock, poolFor, type ClockFrame } from './colour-clock';

const frames: ClockFrame[] = [
  { id: 'b1', key: 'blue', L: 0.5 }, { id: 'b2', key: 'blue', L: 0.6 },
  { id: 't1', key: 'teal', L: 0.5 },
  { id: 'o1', key: 'orange', L: 0.6 }, { id: 'y1', key: 'yellow-deep', L: 0.7 },
  { id: 'a1', key: 'achromatic', L: 0.8 }, { id: 'a2', key: 'achromatic', L: 0.2 },
  { id: 'g1', key: 'green', L: 0.4 },
  { id: 'r1', key: 'red', L: 0.1 },
];

test('lightPhase follows the sun, and overcast only by day', () => {
  assert.equal(lightPhase(-20), 'night');
  assert.equal(lightPhase(-6), 'blue');
  assert.equal(lightPhase(2), 'golden');
  assert.equal(lightPhase(30), 'day');
  assert.equal(lightPhase(30, true), 'overcast');
  assert.equal(lightPhase(2, true), 'golden');
});

test('phaseFromClock is a rough stand-in', () => {
  assert.equal(phaseFromClock(3), 'night');
  assert.equal(phaseFromClock(19), 'golden');
  assert.equal(phaseFromClock(13), 'day');
});

test('poolFor picks the chapters for the light', () => {
  const ids = (p: ClockFrame[]) => p.map((f) => f.id).sort();
  assert.deepEqual(ids(poolFor('blue', frames)), ['b1', 'b2', 't1']);
  assert.deepEqual(ids(poolFor('golden', frames)), ['o1', 'y1']);
  assert.deepEqual(ids(poolFor('overcast', frames)), ['a1', 'a2']);
  assert.deepEqual(ids(poolFor('day', frames)), ['a1', 'g1']);
  assert.deepEqual(ids(poolFor('night', frames)), ['a2', 'b1', 'g1', 'r1'], 'the darkest fifth, at least four');
  assert.equal(poolFor('night', frames)[0].id, 'r1', 'darkest first');
  assert.deepEqual(ids(poolFor('overcast', [frames[0]])), ['b1'], 'never empty');
});

test('nextFrame never repeats the one on screen', () => {
  const pool = poolFor('golden', frames);
  for (let i = 0; i < 10; i++) assert.notEqual(nextFrame(pool, 'o1')!.id, 'o1');
});

test('paletteLightness weighs the palette by share', () => {
  assert.ok(Math.abs(hexLightness('#ffffff') - 1) < 1e-3);
  assert.ok(Math.abs(hexLightness('#000000')) < 1e-6);
  assert.ok(Math.abs(paletteLightness('#000000:0.5,#ffffff:0.5', 0.3) - 0.5) < 1e-3);
  assert.equal(paletteLightness('', 0.3), 0.3);
});
