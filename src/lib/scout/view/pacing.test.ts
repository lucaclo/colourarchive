import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pace, type PacingQuestion } from './pacing.ts';

/** A scrub over a city: expensive work, a gesture in progress. */
const expensive = (over: Partial<PacingQuestion> = {}): PacingQuestion => ({
  moving: true,
  lastDurationMs: 9,
  sinceLastMs: 0,
  intervalMs: 110,
  cheapMs: 3,
  ...over,
});

describe('pacing an expensive redraw', () => {
  it('runs immediately when nothing is being dragged', () => {
    // A pan or a layer toggle is one interaction, and delaying it by a tenth of
    // a second is a lag you can feel.
    assert.deepEqual(pace(expensive({ moving: false })), { run: true });
    assert.deepEqual(pace(expensive({ moving: false, sinceLastMs: 0 })), { run: true });
  });

  it('holds off a second run inside the interval', () => {
    assert.deepEqual(pace(expensive({ sinceLastMs: 16 })), { run: false, waitMs: 94 });
    assert.deepEqual(pace(expensive({ sinceLastMs: 109 })), { run: false, waitMs: 1 });
  });

  it('runs again once the interval has passed', () => {
    assert.deepEqual(pace(expensive({ sinceLastMs: 110 })), { run: true });
    assert.deepEqual(pace(expensive({ sinceLastMs: 400 })), { run: true });
  });

  it('does not pace work that fits inside a frame', () => {
    // The village case. Capping this would make the common scene worse in order
    // to fix the expensive one.
    assert.deepEqual(pace(expensive({ lastDurationMs: 0 })), { run: true });
    assert.deepEqual(pace(expensive({ lastDurationMs: 2.9 })), { run: true });
    // And the boundary is the expensive side, so 3 ms is paced.
    assert.equal(pace(expensive({ lastDurationMs: 3 })).run, false);
  });

  it('always leaves a trailing run to be scheduled', () => {
    // The whole reason this is a throttle and not a debounce: a gesture's last
    // position arrives inside the interval, and must still be drawn.
    const answer = pace(expensive({ sinceLastMs: 1 }));
    assert.equal(answer.run, false);
    assert.ok(answer.run === false && answer.waitMs > 0, 'a wait of zero would drop the frame');
  });

  it('never asks for a wait longer than the interval', () => {
    // A clock that jumped backwards — a suspended tab, a machine sleeping —
    // must not park the shadows for a minute and a half.
    for (const sinceLastMs of [-1, -5000, -1e9]) {
      const answer = pace(expensive({ sinceLastMs }));
      assert.equal(answer.run, false);
      assert.ok(answer.run === false && answer.waitMs === 110, `wrong wait at ${sinceLastMs}`);
    }
  });

  it('never asks for a negative wait', () => {
    for (const sinceLastMs of [0, 1, 55, 109]) {
      const answer = pace(expensive({ sinceLastMs }));
      if (answer.run === false) assert.ok(answer.waitMs >= 0, `negative wait at ${sinceLastMs}`);
    }
  });

  it('paces on the interval it is given, not a built-in one', () => {
    assert.deepEqual(pace(expensive({ intervalMs: 40, sinceLastMs: 10 })), { run: false, waitMs: 30 });
    assert.deepEqual(pace(expensive({ intervalMs: 40, sinceLastMs: 40 })), { run: true });
  });
});
