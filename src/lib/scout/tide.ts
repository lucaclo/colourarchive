/**
 * Tide state, joined against the sun/moon timeline Scout already draws —
 * issue #71.
 *
 * None of the apps Scout was benchmarked against do this, and the gap is real
 * for seascape and long-exposure work: golden hour alone cannot predict
 * whether the rock and sand compositions a low tide reveals will actually be
 * out of the water when the light is good. So this file answers one question
 * — "when today is the tide worth planning around" — from a day of measured
 * high/low extremes, the same way `daylight.ts` turns a day of sun samples
 * into bands and event rows.
 *
 * ## Why WorldTides, and not another keyless source
 *
 * Weather got to be keyless (Open-Meteo) because a forecast is bulk numerical
 * output anyone can mirror. Tide predictions are not: they come from harmonic
 * constituents fitted to years of gauge measurement at a *specific station*,
 * and nobody publishes that fitting for free the way Open-Meteo mirrors a
 * weather model. WorldTides (`worldtides.info`) is a keyed, paid API for
 * exactly that reason — see `tide-client.ts`'s header for the request/response
 * shape and what is and is not verified against a live response.
 *
 * ## The coastal gate — why a station's existence is the evidence
 *
 * "Flagged only for spots close enough to open water to matter" needs a way to
 * tell a seafront from an inland pin, and this repo has no coastline dataset —
 * checked, there is nothing under "coast"/"coastline"/"water" beyond the
 * atmospheric sea-fraction sampling in `atmosphere.ts`, which answers "how
 * much of the horizon is sea" for aerosol colour, not "is this near a tide".
 * Computing that from scratch (a vector coastline, a raster mask) is exactly
 * the kind of invented precision this project refuses — Scout draws real cast
 * shadows from a real DEM and declines to draw one from a guessed building
 * height for the same reason.
 *
 * What is *not* invented: a harmonic tide station is only findable where
 * there is tidal water to have measured. Asking WorldTides for the nearest
 * station and getting a real answer back within a plausible driving/walking
 * distance is itself the evidence — the same move `light-pollution.ts` makes
 * treating a bundled atlas cell as the "measurement" rather than trying to
 * compute skyglow from streetlight positions Scout does not have. See
 * `MAX_STATION_DISTANCE_KM` below for the number and its reasoning.
 *
 * Everything in this file is pure — no fetch, no disk, no `Date.now()`. The
 * fetching, the caching and the "no key configured" honest state live in
 * `tide-client.ts`, server-side, for the same reasons the geocoder and the
 * forecast do.
 */

import { MINUTES_PER_DAY } from './daylight';
import { distance, type LatLon } from './geo';

export type TideType = 'high' | 'low';

export interface TideExtreme {
  type: TideType;
  /** The instant of the high or low. */
  at: Date;
  /**
   * Metres, relative to WorldTides' own reported datum for the station —
   * never a fixed reference this file invents. Null when the source omitted
   * it, which is treated as "the timing is known, the height is not" rather
   * than as a reason to drop the whole extreme.
   */
  heightM: number | null;
}

export interface TideStation {
  name: string;
  lat: number;
  lon: number;
  /**
   * Computed here from the station's own coordinates via `geo.ts`'s
   * `distance`, not trusted from the API — WorldTides documents a station's
   * `lat`/`lon` in its `stations` response but no distance figure alongside
   * it, so the one number this file needs for gating is measured the same
   * way every other distance in Scout is.
   */
  distanceKm: number;
}

/**
 * How close a real tide station has to be before a spot counts as "near open
 * water that matters" — the coastal gate, in place of a coastline this repo
 * does not have.
 *
 * Not a measurement of coastline geometry — nothing here can be, without a
 * dataset Scout does not carry — but a reasoned anchor in the same shape as
 * `light-pollution.ts`'s `CORE_DARK_ENOUGH_MAX_ZONE`: harmonic tide stations
 * are gauges, typically sited in harbours and estuaries every few tens of
 * kilometres of coastline, not a dense grid. Twenty-five kilometres is close
 * enough that the *station's own* tide (not a wildly extrapolated one) is a
 * reasonable stand-in for the water nearest the pin, while being generous
 * enough that an estuary photographed from its near bank still qualifies even
 * when the nearest gauge sits at the harbour mouth. A pin that only turns up a
 * station much further off is inland enough that a tide table would not
 * change what anyone photographs there.
 */
export const MAX_STATION_DISTANCE_KM = 25;

/** Whether a station this close away is evidence of open water worth planning around. */
export const isCoastalDistance = (distanceKm: number): boolean =>
  Number.isFinite(distanceKm) && distanceKm >= 0 && distanceKm <= MAX_STATION_DISTANCE_KM;

/**
 * The nearest of a list of candidate stations to the pin, with distance
 * measured here rather than assumed from the source.
 *
 * Returns null for an empty list rather than throwing — "no stations
 * returned" is itself the honest answer to "is this spot coastal", not an
 * error condition.
 */
export function nearestStation(
  pin: LatLon,
  stations: ReadonlyArray<{ name: string; lat: number; lon: number }>,
): TideStation | null {
  let best: TideStation | null = null;
  for (const station of stations) {
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) continue;
    const distanceKm = distance(pin, { lat: station.lat, lon: station.lon }) / 1000;
    if (!best || distanceKm < best.distanceKm) {
      best = { name: station.name, lat: station.lat, lon: station.lon, distanceKm };
    }
  }
  return best;
}

/* ── Parsing ───────────────────────────────────────────────────────────────
   Written defensively, the same posture `weather.ts`'s `parseForecast` takes:
   this is the only tide data in Scout that comes from a third party at
   request time, and a response that arrives half-shaped should cost the tide
   row, not the page. See `tide-client.ts`'s header for what is verified about
   this shape against WorldTides' own documentation versus assumed from the
   issue's own fallback description. */

interface RawExtreme {
  dt?: unknown;
  height?: unknown;
  type?: unknown;
}

interface RawStation {
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * WorldTides' `extremes` array: `{ dt, date, height, type }` per documented
 * entry, `dt` a Unix *seconds* timestamp and `type` the literal string
 * `"High"` or `"Low"`. Sorted by time — the source is expected to already be
 * in order, but nothing downstream should depend on that being true.
 */
export function parseExtremes(body: unknown): TideExtreme[] {
  const raw = (body as { extremes?: unknown } | null)?.extremes;
  const list = Array.isArray(raw) ? (raw as RawExtreme[]) : [];
  const out: TideExtreme[] = [];
  for (const entry of list) {
    const type = entry?.type === 'High' ? 'high' : entry?.type === 'Low' ? 'low' : null;
    const dtSeconds = numberOrNull(entry?.dt);
    if (type == null || dtSeconds == null) continue;
    out.push({ type, at: new Date(dtSeconds * 1000), heightM: numberOrNull(entry?.height) });
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out;
}

/**
 * WorldTides' `stations` array: `{ id, name, lat, lon, timezone }` per
 * documented entry. Only the fields `nearestStation` needs are read; an
 * entry missing a name or a finite coordinate is dropped rather than kept
 * with a blank name — a station this file cannot place on the map cannot be
 * evidence of anything.
 */
export function parseStations(body: unknown): Array<{ name: string; lat: number; lon: number }> {
  const raw = (body as { stations?: unknown } | null)?.stations;
  const list = Array.isArray(raw) ? (raw as RawStation[]) : [];
  const out: Array<{ name: string; lat: number; lon: number }> = [];
  for (const entry of list) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    const lat = Number(entry?.lat);
    const lon = Number(entry?.lon);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ name, lat, lon });
  }
  return out;
}

/* ── The day, scoped ──────────────────────────────────────────────────────── */

/**
 * Extremes clamped to one solar day, the same `[dayStart, dayStart + 1440min)`
 * window `scoutDay` builds the sun track over.
 *
 * WorldTides is asked for one day but can hand back an extreme a few minutes
 * either side of the boundary — the request is `days=1` from a *date*, not
 * from `dayStart`'s own instant, and the two rarely land on the same second.
 * Scoping here rather than trusting the source to have scoped it keeps the
 * event list and the pin's date in agreement.
 */
export function extremesForDay(
  extremes: readonly TideExtreme[],
  dayStart: Date,
  totalMinutes = MINUTES_PER_DAY,
): TideExtreme[] {
  const startMs = dayStart.getTime();
  const endMs = startMs + totalMinutes * 60_000;
  return extremes.filter((e) => e.at.getTime() >= startMs && e.at.getTime() < endMs);
}

/* ── Event rows, shaped like `daylight.ts`'s ──────────────────────────────── */

export type TideEventIcon = 'tideHigh' | 'tideLow';

/**
 * Same field shape as `daylight.ts`'s `SunEventRow` — `key`/`label`/`icon`/
 * `start`/`end` — on purpose, so a tide row and a sun row can sit in the same
 * kind of list without a second rendering path. `end` stays `undefined` here:
 * a high or low tide is a moment, the way sunrise is, not a span the way
 * golden hour is. The *span worth paying attention to* around that moment is
 * a separate, explicit thing — see `tideWindows` — because conflating "the
 * tide turns at 06:12" with "the exposed rock is shootable roughly 06:12
 * ±90 min" would be printing an estimate as if it were the measurement.
 */
export interface TideEventRow {
  key: string;
  label: string;
  icon: TideEventIcon;
  start: Date;
  end?: undefined;
}

/** The day's extremes as clickable rows, in time order. */
export function tideEventRows(extremes: readonly TideExtreme[]): TideEventRow[] {
  return extremes.map((e, i) => ({
    key: `tide-${e.type}-${e.at.getTime()}-${i}`,
    label: e.type === 'low' ? 'Low tide' : 'High tide',
    icon: e.type === 'low' ? 'tideLow' : 'tideHigh',
    start: e.at,
  }));
}

/* ── The workable window around each extreme ─────────────────────────────── */

/**
 * Half-width of the window either side of a tide extreme that is treated as
 * "worth being there for", in minutes.
 *
 * Not fitted to anything — there is no dataset in this repo of which minute a
 * rock or sand composition stops working — but a reasoned middle ground
 * between two edges that are each easy to justify and each wrong alone: too
 * narrow (say, 20 minutes) throws away most of a flood or ebb during which
 * the shoreline is still close to its extreme position, especially on a
 * gently-sloped beach; too wide (say, four hours) claims half the tidal cycle
 * is "the low", which is simply the tide doing what it always does. Ninety
 * minutes either side of a semidiurnal extreme (period ≈ 12h25m) is the
 * quarter of the cycle nearest the turn, where a sinusoidal approximation of
 * the curve has moved under 30% of its total range — the flattest quarter of
 * the curve, and the same "near the extreme, the rate of change is slowest"
 * reasoning commonly given in tide-pool and coastal-photography guidance for
 * a usable low-tide window.
 */
export const TIDE_WINDOW_HALF_WIDTH_MIN = 90;

export interface TideWindow {
  type: TideType;
  extremeAt: Date;
  heightM: number | null;
  start: Date;
  end: Date;
}

/** The workable window around each extreme, per `TIDE_WINDOW_HALF_WIDTH_MIN`. */
export function tideWindows(
  extremes: readonly TideExtreme[],
  halfWidthMin = TIDE_WINDOW_HALF_WIDTH_MIN,
): TideWindow[] {
  if (!(halfWidthMin > 0)) throw new RangeError('halfWidthMin must be greater than zero');
  const spanMs = halfWidthMin * 60_000;
  return extremes.map((e) => ({
    type: e.type,
    extremeAt: e.at,
    heightM: e.heightM,
    start: new Date(e.at.getTime() - spanMs),
    end: new Date(e.at.getTime() + spanMs),
  }));
}

/**
 * Windows as minute-of-day ranges against one solar day, clamped the way
 * `shadeOverlayGradient`'s caller clamps its own windows — a window can
 * straddle midnight, or the day boundary, and only the part actually inside
 * the visible day should paint.
 */
export interface TideOverlayRange {
  type: TideType;
  startMinute: number;
  endMinute: number;
}

export function tideOverlayMinutes(
  windows: readonly TideWindow[],
  dayStart: Date,
  totalMinutes = MINUTES_PER_DAY,
): TideOverlayRange[] {
  const startMs = dayStart.getTime();
  const out: TideOverlayRange[] = [];
  for (const w of windows) {
    const startMinute = Math.max(0, Math.floor((w.start.getTime() - startMs) / 60_000));
    const endMinute = Math.min(totalMinutes, Math.ceil((w.end.getTime() - startMs) / 60_000));
    if (startMinute >= endMinute || startMinute >= totalMinutes || endMinute <= 0) continue;
    out.push({ type: w.type, startMinute, endMinute });
  }
  return out;
}

/** Low tide: sand and rock stand the best chance of being exposed and dry. */
const LOW_TIDE_TINT = 'rgba(196,151,92,0.55)';
/** High tide: the water itself, for the same span drawn against a low. */
const HIGH_TIDE_TINT = 'rgba(45,92,138,0.5)';

/**
 * The day's tide windows as one CSS `linear-gradient(...)`, in the same shape
 * `shadeOverlayGradient` builds for the per-spot shade mask — a strip that
 * can sit over (or beside) the sun/moon track without a second kind of
 * drawing code. Ranges are assumed non-overlapping and already sorted by
 * `startMinute`, which `tideOverlayMinutes` guarantees by construction (built
 * from time-sorted extremes, each window narrower than half a tidal cycle).
 */
export function tideOverlayGradient(ranges: readonly TideOverlayRange[], totalMinutes = MINUTES_PER_DAY): string {
  if (!ranges.length) return 'linear-gradient(to right, transparent, transparent)';
  const stops: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    const from = (range.startMinute / totalMinutes) * 100;
    const to = (Math.min(range.endMinute, totalMinutes) / totalMinutes) * 100;
    const tint = range.type === 'low' ? LOW_TIDE_TINT : HIGH_TIDE_TINT;
    if (from > cursor) stops.push(`transparent ${cursor.toFixed(3)}%`, `transparent ${from.toFixed(3)}%`);
    stops.push(`${tint} ${from.toFixed(3)}%`, `${tint} ${to.toFixed(3)}%`);
    cursor = to;
  }
  if (cursor < 100) stops.push(`transparent ${cursor.toFixed(3)}%`, 'transparent 100%');
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
