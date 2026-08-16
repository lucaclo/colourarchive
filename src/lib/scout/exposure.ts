/**
 * Long exposure, by the stop.
 *
 * An ND filter's whole job is to remove light in a stated, exact ratio — an
 * ND8 is three stops because 2³ = 8, not because eight is a nice round number
 * on a box. So the shutter speed that restores the original exposure is not
 * looked up in a table, it is the base speed doubled once per stop, and
 * doubling is the one operation this module needs: `base × 2^stops`. There is
 * no fitted constant to get wrong.
 *
 * The countdown alongside it is deliberately not a tick counter. A background
 * tab throttles `setInterval` and suspends `requestAnimationFrame` — the same
 * thing `scout.astro`'s own screenshot notes call out about CSS transitions —
 * so a countdown that trusts its own tick count runs slow the moment the
 * screen locks. This one instead takes an elapsed time and subtracts, so
 * however late a tick arrives it reports the true time remaining rather than
 * one more second gone. The caller supplies the elapsed time — from
 * `performance.now`, in the browser — so this module needs no clock of its
 * own and nothing here is untestable for it.
 *
 * What this deliberately does not do: know anything about aperture or ISO.
 * The stop that went onto the front of the lens is exactly the stop the
 * shutter needs back, whatever combination of the other two produced the
 * original exposure — that is the whole reason exposure compensation is
 * measured in stops and not in any one of its constituent settings.
 *
 * Self-contained by design: this leans on no other Scout subsystem, and
 * nothing else needs to lean on this to keep working.
 */

/* ── ND filters ────────────────────────────────────────────────────────────── */

export interface NdFilter {
  /** What is printed on the filter, or on the box it came in. */
  label: string;
  /** Stops of light removed. `log2` of the filter factor, e.g. ND8 → 3. */
  stops: number;
}

/**
 * The filters worth offering, spanning a three-stop grad through the
 * fifteen-stop glass that turns a daylight seascape into a half-hour smear.
 * Stops are computed from the printed factor (`log2(factor)`) rather than
 * hand-typed, so a filter added here cannot silently disagree with its own
 * label — ND1000 really is 9.97 stops, not the 10 everyone rounds it to.
 */
export const ND_FILTERS: NdFilter[] = [
  { label: 'ND8', stops: Math.log2(8) },
  { label: 'ND64', stops: Math.log2(64) },
  { label: 'ND1000', stops: Math.log2(1000) },
  { label: 'ND100000', stops: Math.log2(100_000) },
  { label: 'ND1000 + ND8 stacked', stops: Math.log2(1000) + Math.log2(8) },
];

/**
 * The base shutter speeds worth offering — the reading a meter gives before
 * any filter goes on the lens.
 */
export const BASE_SHUTTER_SPEEDS_S = [
  1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 125, 1 / 60, 1 / 30, 1 / 15, 1 / 8, 1 / 4, 1 / 2, 1,
];

/**
 * The shutter speed that restores the metered exposure once the filter is on.
 *
 * `base × 2^stops` — each stop of ND halves the light reaching the sensor, so
 * each one doubles the time needed to gather the same amount back. Exact by
 * definition of what a stop is, not an approximation of it.
 */
export function ndExposureSeconds(baseSeconds: number, stops: number): number {
  if (!(baseSeconds > 0)) throw new RangeError('baseSeconds must be greater than zero');
  if (stops < 0) throw new RangeError('stops must not be negative');
  return baseSeconds * 2 ** stops;
}

/** "1/125 s", "0.5 s", "8 s" — a shutter speed the way a body's dial reads it. */
export function formatShutterSpeed(seconds: number): string {
  if (!(seconds > 0)) return '—';
  if (seconds < 1) {
    const denominator = Math.round(1 / seconds);
    return `1/${denominator} s`;
  }
  return `${seconds < 10 ? Number(seconds.toFixed(1)) : Math.round(seconds)} s`;
}

/**
 * "45 s", "3 min 12 s", "1 h 08 min" — a long exposure the way a photographer
 * times it, not the way a stopwatch does. Minutes and hours are named rather
 * than left as a colon-separated clock, because a clock face implies a
 * countdown display, and this same formatter is also used to describe an
 * exposure that has not started yet.
 */
export function formatExposureDuration(seconds: number): string {
  if (!(seconds > 0)) return '0 s';
  // Under a second this is still a fast enough shutter speed that rounding to
  // the nearest whole second would print "0 s" for an exposure that plainly
  // happened — a one-stop ND on a fast base speed lands here easily.
  if (seconds < 1) return formatShutterSpeed(seconds);
  const totalSeconds = Math.round(seconds);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours === 0) return secs === 0 ? `${minutes} min` : `${minutes} min ${secs} s`;
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

/* ── The countdown ─────────────────────────────────────────────────────────── */

export interface Countdown {
  totalSeconds: number;
  remainingSeconds: number;
  done: boolean;
}

/** A fresh countdown for a shutter this long. */
export function startCountdown(totalSeconds: number): Countdown {
  if (!(totalSeconds > 0)) throw new RangeError('totalSeconds must be greater than zero');
  return { totalSeconds, remainingSeconds: totalSeconds, done: false };
}

/**
 * The countdown after `elapsedSeconds` of wall-clock time have passed since
 * it started.
 *
 * Takes the *total* elapsed time rather than the time since the last tick, so
 * a caller re-reading `performance.now() − startedAt` every interval gets a
 * countdown immune to any interval it missed — a throttled background tab
 * catches back up on the next tick instead of running perpetually behind.
 */
export function countdownAfter(countdown: Countdown, elapsedSeconds: number): Countdown {
  if (elapsedSeconds < 0) throw new RangeError('elapsedSeconds must not be negative');
  const remainingSeconds = Math.max(0, countdown.totalSeconds - elapsedSeconds);
  return { totalSeconds: countdown.totalSeconds, remainingSeconds, done: remainingSeconds <= 0 };
}

/** "12:45", "1:03:20" — a running countdown, which does read as a clock. */
export function formatCountdown(seconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, '0');
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
