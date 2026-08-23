import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sweepRange, sweepFrameCount, sweepInstants } from './sweep.ts';

describe('sweepRange', () => {
  it('a day span is exactly 1440 minutes from dayStart', () => {
    const dayStart = new Date('2026-06-01T01:19:00Z');
    const { from, to } = sweepRange('day', dayStart, dayStart);
    assert.equal(from.getTime(), dayStart.getTime());
    assert.equal(to.getTime() - from.getTime(), 1440 * 60_000);
  });

  it('a season span brackets `at` between real solstices, ~6 months apart', () => {
    const at = new Date('2026-03-15T12:00:00Z'); // between Dec solstice and June solstice
    const { from, to } = sweepRange('season', at, at);
    assert.ok(from.getTime() < to.getTime());
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    assert.ok(days > 150 && days < 210, `${days} days apart`);
    // December solstice should be before, June solstice after, for a March date.
    assert.equal(from.getUTCMonth(), 11);
    assert.equal(to.getUTCMonth(), 5);
  });

  it('the season span still brackets `at` correctly from the other side of the year', () => {
    const at = new Date('2026-09-15T12:00:00Z'); // between June and December solstice
    const { from, to } = sweepRange('season', at, at);
    assert.equal(from.getUTCMonth(), 5);
    assert.equal(to.getUTCMonth(), 11);
  });
});

describe('sweepFrameCount', () => {
  it('is the plain product of duration and rate', () => {
    assert.equal(sweepFrameCount(6, 24), 144);
  });

  it('rejects a zero or negative duration or rate', () => {
    assert.throws(() => sweepFrameCount(0, 24));
    assert.throws(() => sweepFrameCount(6, 0));
    assert.throws(() => sweepFrameCount(-1, 24));
  });

  it('never returns fewer than two frames, however short the clip', () => {
    assert.equal(sweepFrameCount(0.01, 1), 2);
  });
});

describe('sweepInstants', () => {
  it('starts and ends exactly at the given bounds', () => {
    const from = new Date('2026-06-01T00:00:00Z');
    const to = new Date('2026-06-02T00:00:00Z');
    const instants = sweepInstants(from, to, 5);
    assert.equal(instants[0].getTime(), from.getTime());
    assert.equal(instants[instants.length - 1].getTime(), to.getTime());
    assert.equal(instants.length, 5);
  });

  it('spaces frames evenly', () => {
    const from = new Date('2026-06-01T00:00:00Z');
    const to = new Date('2026-06-01T01:00:00Z');
    const instants = sweepInstants(from, to, 4);
    const gaps = instants.slice(1).map((d, i) => d.getTime() - instants[i].getTime());
    for (const gap of gaps) assert.equal(gap, 20 * 60_000);
  });

  it('rejects fewer than two frames or a non-positive span', () => {
    const from = new Date('2026-06-01T00:00:00Z');
    const to = new Date('2026-06-02T00:00:00Z');
    assert.throws(() => sweepInstants(from, to, 1));
    assert.throws(() => sweepInstants(to, from, 5));
    assert.throws(() => sweepInstants(from, from, 5));
  });
});
