/**
 * Tests for the time-lapse calculator.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatDuration, formatStorage, timelapse } from './timelapse.ts';

const BASE = { clipLengthSeconds: 10, frameRateFps: 24, intervalSeconds: 5, fileSizeMb: 30 };

describe('timelapse', () => {
  it('multiplies clip length by frame rate for the photo count', () => {
    const t = timelapse(BASE);
    assert.equal(t.photoCount, 240);
  });

  it('rounds the photo count up, never down', () => {
    // 10s at 25fps over a 3s interval is 250 frames exactly; a clip length
    // that does not divide evenly must still get enough frames to reach it.
    const t = timelapse({ clipLengthSeconds: 10.1, frameRateFps: 24, intervalSeconds: 5, fileSizeMb: 30 });
    assert.equal(t.photoCount, Math.ceil(10.1 * 24));
  });

  it('multiplies photo count by the interval for the shoot duration', () => {
    const t = timelapse(BASE);
    assert.equal(t.shootDurationSeconds, 240 * 5);
  });

  it('multiplies photo count by file size for storage', () => {
    const t = timelapse(BASE);
    assert.equal(t.storageMb, 240 * 30);
  });

  it('reports the speedup as interval times frame rate', () => {
    const t = timelapse(BASE);
    assert.equal(t.speedupFactor, 5 * 24);
  });

  it('a longer interval means fewer real minutes of footage per hour on site, but the same photo count', () => {
    const short = timelapse({ ...BASE, intervalSeconds: 1 });
    const long = timelapse({ ...BASE, intervalSeconds: 10 });
    assert.equal(short.photoCount, long.photoCount);
    assert.ok(long.shootDurationSeconds > short.shootDurationSeconds);
    assert.ok(long.speedupFactor > short.speedupFactor);
  });

  it('refuses any input that is not a positive number', () => {
    for (const key of ['clipLengthSeconds', 'frameRateFps', 'intervalSeconds', 'fileSizeMb'] as const) {
      assert.throws(() => timelapse({ ...BASE, [key]: 0 }), RangeError, key);
      assert.throws(() => timelapse({ ...BASE, [key]: -1 }), RangeError, key);
    }
  });
});

describe('formatDuration', () => {
  it('stays in seconds under a minute', () => {
    assert.equal(formatDuration(45), '45 s');
  });

  it('names minutes under an hour', () => {
    assert.equal(formatDuration(90), '2 min');
  });

  it('names hours and minutes past an hour', () => {
    assert.equal(formatDuration(3 * 3600 + 20 * 60), '3 h 20 min');
    assert.equal(formatDuration(2 * 3600), '2 h');
  });
});

describe('formatStorage', () => {
  it('stays in megabytes under a gigabyte', () => {
    assert.equal(formatStorage(480), '480 MB');
  });

  it('moves to gigabytes at 1000 MB', () => {
    assert.equal(formatStorage(1200), '1.2 GB');
  });
});
