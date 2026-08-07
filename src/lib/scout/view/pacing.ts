/**
 * Whether an expensive redraw may run now, wait, or is not worth pacing at all.
 *
 * Scout has two of these and had them written differently. The terrain overlay
 * learned the hard way that a *debounce* is the wrong shape — one that resets on
 * every pointer event never fires during a continuous drag, so the shade sat
 * frozen through the whole scrub and jumped at the end — and settled on a
 * throttle. The building shadows had no pacing at all: every minute of a scrub
 * paid a full recast of up to four thousand buildings, about 9 ms, against a
 * frame budget of 16.7 ms that MapLibre also has to draw the map in.
 *
 * The decision is separated from the timers because it is the part with the
 * cases in it, and cases are what a test can hold. What is left at the call site
 * is a `setTimeout` and a call.
 */

export interface PacingQuestion {
  /** Whether a gesture is in progress — a scrub, or the day being played. */
  moving: boolean;
  /** How long the last run of this work took, in milliseconds. */
  lastDurationMs: number;
  /** How long ago it ran. */
  sinceLastMs: number;
  /** The fastest the work may repeat while a gesture is in progress. */
  intervalMs: number;
  /** Below this, the work is cheap enough that pacing would only cost frames. */
  cheapMs: number;
}

export type PacingAnswer =
  /** Run it now. */
  | { run: true }
  /** Too soon: run it in this many milliseconds, unless something asks again. */
  | { run: false; waitMs: number };

/**
 * Leading edge, then at most one per interval, then a trailing one.
 *
 * The trailing wait is what stops a gesture's *last* position being dropped:
 * the minute you let go on almost always arrives inside the interval, and
 * without it the map would be left showing a moment you had already left.
 */
export function pace(question: PacingQuestion): PacingAnswer {
  const { moving, lastDurationMs, sinceLastMs, intervalMs, cheapMs } = question;

  // Not a gesture — a pan, a layer toggle, the end of a drag. Nothing to pace
  // against, and delaying it would be a visible lag on a single interaction.
  if (!moving) return { run: true };

  // Cheap enough to fit in a frame. A quiet village costs a fraction of a
  // millisecond, and capping that at nine frames a second would make the
  // common case worse in order to fix the expensive one.
  if (lastDurationMs < cheapMs) return { run: true };

  if (sinceLastMs >= intervalMs) return { run: true };

  // `sinceLastMs` can be negative if a clock went backwards; waiting the whole
  // interval is the safe reading, and never a wait longer than the interval.
  const waitMs = Math.min(intervalMs, Math.max(0, intervalMs - sinceLastMs));
  return { run: false, waitMs };
}
