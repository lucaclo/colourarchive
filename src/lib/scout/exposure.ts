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

/* ── One filter, three labels (issue #155) ─────────────────────────────────── */

/** The factor printed as "ND64": how many times the light is cut. */
export const ndFactor = (stops: number): number => 2 ** stops;

/** The optical density printed as "1.8": log10 of the factor, 0.3 a stop. */
export const opticalDensity = (stops: number): number => stops * Math.log10(2);

/**
 * "6 stops · ND64 · 1.8": the same filter as stops, factor and density, the
 * three ways rings and boxes are marked. The factor keeps the makers'
 * conventional round numbers (ND1000, not ND1024) when it is within a few
 * percent of one; the density is to one decimal, as it is engraved.
 */
export function describeFilter(stops: number): string {
  const s = Math.round(stops * 10) / 10;
  const stopText = `${Number.isInteger(s) ? s : s.toFixed(1)} stop${s === 1 ? '' : 's'}`;
  return `${stopText} · ND${conventionalFactor(stops)} · ${opticalDensity(stops).toFixed(1)}`;
}

const ROUND_FACTORS = [2, 4, 8, 16, 32, 64, 100, 128, 256, 400, 500, 1000, 2000, 4000, 8000, 10_000, 32_000, 100_000];

function conventionalFactor(stops: number): string {
  const f = ndFactor(stops);
  const near = ROUND_FACTORS.find((r) => Math.abs(Math.log2(r) - stops) < 0.06);
  return String(near ?? Math.round(f));
}

/**
 * Read a filter however it's written on the ring: "ND64" or "64" (a factor),
 * "1.8" or "ND 1.8" (a density, with its decimal point), "6 stops" or "6"
 * (stops, when small). Null when it isn't a filter.
 */
export function parseFilter(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, '');
  if (!t) return null;
  let m = t.match(/^(\d+(?:\.\d+)?)\s*(?:stops?|ev|f-?stops?)$/);
  if (m) return finiteStops(Number(m[1]));
  m = t.match(/^(?:nd|od)?\s*(\d*\.\d+)$/);
  if (m) return finiteStops(Number(m[1]) / Math.log10(2));
  m = t.match(/^nd\s*(\d+)$/);
  if (m) return Number(m[1]) >= 2 ? finiteStops(Math.log2(Number(m[1]))) : null;
  m = t.match(/^(\d+)$/);
  if (m) {
    const n = Number(m[1]);
    // Nobody stacks twenty stops; a bare number past that is a factor.
    return n <= 20 ? finiteStops(n) : finiteStops(Math.log2(n));
  }
  return null;
}

const finiteStops = (s: number): number | null => (Number.isFinite(s) && s > 0 && s <= 30 ? s : null);

/** The filters offered in the list: whole stops from 1 to 10, and the big ones. */
export const FILTER_STOPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, Math.log2(1000), 12, 13, 15, Math.log2(1000) + 3];

/** Past these, a long exposure needs more than arithmetic. */
export const CAMERA_TIMED_LIMIT_S = 30;
export const LONG_EXPOSURE_WARN_S = 30 * 60;

/** Quiet notes for a very long exposure, or none. */
export function longExposureNotes(seconds: number): string[] {
  const notes: string[] = [];
  if (seconds > CAMERA_TIMED_LIMIT_S) notes.push('Past the camera’s 30 s: Bulb, with a remote.');
  if (seconds > LONG_EXPOSURE_WARN_S) {
    notes.push('Past 30 minutes the sensor warms and the battery drains: expect more noise, and a dark frame as long again if long-exposure noise reduction is on.');
  }
  return notes;
}
