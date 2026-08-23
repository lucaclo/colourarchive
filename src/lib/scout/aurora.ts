/**
 * Aurora visibility: Kp, Bz and the solar wind, joined with the darkness,
 * moon and cloud that already gate everything else on this page — issue #69.
 *
 * Scout already answers two versions of "is the sky doing anything worth
 * driving for": `weather.ts`'s `horizonReading` for sunset colour (cloud on
 * the horizon, cloud overhead, no score) and `galactic.ts`'s `coreNight` for
 * the Milky Way core (darkness, moon, a light-pollution threshold, no
 * score). Aurora is the same shape of question with one more input nothing
 * here has had before — real-time space weather — and the same discipline
 * applies: report the arrangement in words and refuse when a real input is
 * missing, rather than blend everything into a manufactured percentage.
 *
 * **What "the arrangement" means here.** Kp sets how far equatorward the
 * auroral oval's edge reaches tonight, by a standard, cited approximation
 * (`ovalBoundaryLat`); the pin's *geomagnetic* latitude — not its geographic
 * one — says whether that reach includes it (`ovalPositionFor`); cloud cover
 * says whether the sky is even visible; and darkness and the moon gate the
 * whole thing exactly as they do for the galactic core. Bz and the solar
 * wind speed are reported as their own named facts (a southward Bz is when
 * the field actually couples to the wind) rather than folded into the oval
 * position — there is no similarly citable formula for pulling them into a
 * single refined number, and inventing one would be exactly the
 * unreproducible constant this project refuses to publish about sunsets.
 *
 * **Why this is a "now" reading, not a slider position.** Every other join
 * on this page can be asked of any minute on the slider, because the sun and
 * the moon are geometry and the forecast covers a real span of hours. Kp,
 * Bz and the solar wind speed are not like that: NOAA's keyless feeds here
 * are observations, not a forecast, so there is no honest answer for "what
 * will the oval be doing next Tuesday evening". This module does not try —
 * it takes whatever instant its sun/moon/cloud inputs describe, and the view
 * layer's job (see `view/aurora-panel.ts`) is to always ask about *now*,
 * never about wherever the date picker happens to be sitting.
 *
 * **Refusing a failed fetch as a failed fetch.** `weather.ts` and `air.ts`
 * both treat a missing reading as a garnish going missing — the row is
 * silent, or falls back to a table. Kp is not a garnish here, it is the
 * subject: a failed NOAA fetch reported as "no aurora tonight" would be
 * indistinguishable from a real, dark, moonless, Kp-1 night, and those are
 * different facts a reader would act on differently. So a missing
 * `SpaceWeather` is refused explicitly, ahead of the darkness and moon
 * checks below it (see the ordering note on `auroraReading`).
 *
 * Pure. No map, no network, no clock of its own — the sun/moon geometry,
 * the cloud reading and the space-weather reading are all handed in, the
 * same split `lighting.ts` and `coreNight` already keep.
 */

import { SUN_ALTITUDE } from './sun';
import { MOONRISE_ALTITUDE } from './moon';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/* ── Geomagnetic latitude ─────────────────────────────────────────────────── */

/**
 * The geomagnetic north pole, epoch 2025.0 — IGRF-14's own dipole-axis
 * figure (NOAA NCEI quotes 80.65°N, 72.68°W for this epoch; BGS's figure for
 * the same epoch is 80.85°N, 72.76°W, the two agreeing to about 0.2° and 0.1°
 * respectively). The pole drifts a fraction of a degree a year — far smaller
 * than the oval's own width — so a fixed epoch is deliberately not updated
 * every session, the same trade-off `galactic.ts`'s `precess` documents for
 * the equinoxes' own slow drift.
 */
export const GEOMAGNETIC_POLE_EPOCH = 2025.0;
export const GEOMAGNETIC_NORTH_POLE = { latitude: 80.7, longitude: -72.7 } as const;

/**
 * Geographic → geomagnetic latitude, by the standard fixed-dipole
 * approximation: treat the geomagnetic pole as a point and read off the
 * great-circle distance to it.
 *
 * `sin(latitude_m) = sin(lat)·sin(lat_pole) + cos(lat)·cos(lat_pole)·cos(lon − lon_pole)`
 *
 * This is an approximation in the same spirit as `precess` in `galactic.ts`:
 * the real geomagnetic field is not a perfect dipole (it has quadrupole and
 * higher terms, which is the entire reason IGRF exists as a many-coefficient
 * model rather than one pole), so this can be a few degrees off the
 * corrected-geomagnetic-coordinate figure a specialist tool would give. That
 * is well inside the width of the oval itself, which is the thing this
 * feeds — see `OVAL_NEAR_MARGIN_DEG` below for how that slack is handled
 * rather than hidden.
 */
export function geomagneticLatitude(latitude: number, longitude: number): number {
  const lat = latitude * RAD;
  const pole = GEOMAGNETIC_NORTH_POLE.latitude * RAD;
  const deltaLon = (longitude - GEOMAGNETIC_NORTH_POLE.longitude) * RAD;
  const sinLatM = Math.sin(lat) * Math.sin(pole) + Math.cos(lat) * Math.cos(pole) * Math.cos(deltaLon);
  return Math.asin(Math.max(-1, Math.min(1, sinLatM))) * DEG;
}

/* ── The oval's reach ─────────────────────────────────────────────────────── */

/**
 * The equatorward edge of the auroral oval, in geomagnetic latitude, at
 * Kp = 0 — and how far it moves per step of Kp.
 *
 * NOAA SWPC's own "Tips on Viewing the Aurora" states this plainly: "At Kp =
 * 0, the equatorward edge of the auroral oval is approximately 66 degrees.
 * And it moves equatorward about 2 degrees for each level of Kp" — giving 64°
 * at Kp 1, 62° at Kp 2, and on down to about 48° at Kp 9.
 * https://www.spaceweather.gov/content/tips-viewing-aurora
 *
 * The same page is explicit that this is an average, not a forecast for any
 * one night — "these relationships represent averages and may not hold
 * precisely in all instances" — which is why `ovalPositionFor` below reports
 * a `near` band rather than a hard yes/no line.
 */
export const OVAL_BOUNDARY_AT_KP0 = 66;
export const OVAL_DEG_PER_KP = 2;

/** Kp is only ever quoted 0–9; clamped so a stray out-of-range reading cannot
 *  walk the boundary past the pole or below the equator. */
export function ovalBoundaryLat(kp: number): number {
  const clamped = Math.max(0, Math.min(9, kp));
  return OVAL_BOUNDARY_AT_KP0 - OVAL_DEG_PER_KP * clamped;
}

/**
 * How far outside the line "near" still means, degrees of geomagnetic
 * latitude.
 *
 * Also cited off NOAA's own page rather than picked: it notes that from a
 * high vantage point with a clear view to the north, aurora can be seen up
 * to "1,000 km (600 miles)" equatorward of the oval's own position. Taken at
 * the conventional 111 km per degree of latitude, that is a little over 9°,
 * rounded down rather than up — this module would rather under-claim "near"
 * than over-claim it.
 */
export const OVAL_NEAR_MARGIN_DEG = 9;

export type OvalPosition = 'inside' | 'near' | 'outside';

/** `geomagLatAbs` is `Math.abs(geomagneticLatitude(...))` — the oval is
 *  symmetric about each pole, so the sign only ever says which hemisphere. */
export function ovalPositionFor(geomagLatAbs: number, boundary: number): OvalPosition {
  if (geomagLatAbs >= boundary) return 'inside';
  if (geomagLatAbs >= boundary - OVAL_NEAR_MARGIN_DEG) return 'near';
  return 'outside';
}

/* ── Cloud ─────────────────────────────────────────────────────────────────── */

export type CloudState = 'clear' | 'patchy' | 'overcast' | 'unknown';

/**
 * Where sunset colour asks about one distant sample on the horizon
 * (`weather.ts`'s `horizonReading`), aurora fills the whole sky dome, so the
 * question is simply how much of the *overhead* sky is clear — the total
 * cover, not a deck split. The two bands are a stated convention, not a
 * measurement, the same honesty `CANVAS_BARE_PCT` in `weather.ts` states for
 * its own thresholds.
 */
export const AURORA_CLEAR_MAX_PCT = 25;
export const AURORA_OVERCAST_MIN_PCT = 85;

export function cloudStateFor(cloudCoverPct: number | null | undefined): CloudState {
  if (cloudCoverPct == null || !Number.isFinite(cloudCoverPct)) return 'unknown';
  const cover = Math.min(100, Math.max(0, cloudCoverPct));
  if (cover <= AURORA_CLEAR_MAX_PCT) return 'clear';
  if (cover >= AURORA_OVERCAST_MIN_PCT) return 'overcast';
  return 'patchy';
}

/* ── Space weather ─────────────────────────────────────────────────────────── */

/**
 * One real-time reading, as `aurora-client.ts` assembles it from NOAA's
 * three feeds. `kp` is load-bearing — it is what `ovalBoundaryLat` needs —
 * and is guaranteed present whenever a `SpaceWeather` exists at all; `bzNt`
 * and `windSpeedKmS` are reported when their own feed answered and are
 * individually nullable, the same optionality `weather.ts`'s cloud decks
 * allow for a model domain that only carries some of them.
 */
export interface SpaceWeather {
  kp: number;
  /** When this Kp reading was itself observed, ms epoch. NOAA's own feed
   *  posts every three hours, so this can honestly trail "now" by up to a
   *  few hours — `auroraStalenessNote` below is what says so. */
  kpAtMs: number;
  bzNt: number | null;
  windSpeedKmS: number | null;
  /** When the wind/Bz sample was taken, ms epoch — null only if both of
   *  their feeds failed while Kp's still answered. */
  measuredAtMs: number | null;
  /** When this whole reading was fetched, for the panel's own staleness note. */
  fetchedAt: number;
}

/* ── Parsing NOAA's feeds ─────────────────────────────────────────────────── */

/**
 * NOAA's timestamps arrive as naive strings — `"2026-08-23T21:17:00"`, no
 * zone marker — and are UTC. Appending `Z` is what makes `Date.parse` read
 * them as the instants they are rather than as the server's local time; the
 * same trap `weather.ts`'s own `parseUtc` exists to close.
 */
function parseNoaaTimeMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value.endsWith('Z') ? value : `${value}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The most recent entry off NOAA's planetary K-index feed
 * (`noaa-planetary-k-index.json`).
 *
 * Despite living beside genuinely predictive SWPC products, this one is an
 * **observed** series at three-hour cadence, going back several days — there
 * is no future entry in it to read as a forecast, which is why this reads
 * only the latest and `auroraStalenessNote` is what tells a reader how old
 * "latest" actually is. Written defensively, like `weather.ts`'s
 * `parseForecast`: one malformed entry costs that entry, not the reading.
 */
export function parseKpIndex(body: unknown): { kp: number; atMs: number } | null {
  if (!Array.isArray(body)) return null;
  let latest: { kp: number; atMs: number } | null = null;
  for (const raw of body) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as { time_tag?: unknown; Kp?: unknown };
    const kp = Number(entry.Kp);
    const atMs = parseNoaaTimeMs(entry.time_tag);
    if (!Number.isFinite(kp) || atMs == null) continue;
    if (!latest || atMs > latest.atMs) latest = { kp, atMs };
  }
  return latest;
}

/**
 * The newest currently-authoritative reading off one of NOAA's real-time
 * solar-wind feeds — `rtsw_wind_1m.json` for speed, `rtsw_mag_1m.json` for
 * Bz, same shape, one field name apart, so one reader serves both rather
 * than two near-identical copies.
 *
 * Each feed interleaves two spacecraft (primarily DSCOVR, with ACE as
 * backup) at the same one-minute cadence, and marks which one is live right
 * now with `active: true`. That flag is read rather than trusted array
 * order: the live feed was observed newest-first when this was written, but
 * NOAA's docs make no promise of that, and an inactive entry can sort ahead
 * of an active one during a source handover.
 */
export function parseRealtimeReading(body: unknown, field: string): { value: number; atMs: number } | null {
  if (!Array.isArray(body)) return null;
  let best: { value: number; atMs: number } | null = null;
  for (const raw of body) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as { time_tag?: unknown; active?: unknown; [key: string]: unknown };
    if (entry.active !== true) continue;
    const value = Number(entry[field]);
    const atMs = parseNoaaTimeMs(entry.time_tag);
    if (!Number.isFinite(value) || atMs == null) continue;
    if (!best || atMs > best.atMs) best = { value, atMs };
  }
  return best;
}

/** How old the Kp reading is, in words, or empty while it is still fresh —
 *  the same shape as `weather.ts`'s `stalenessNote`, kept separate because
 *  the two feeds go stale on entirely different clocks (three hours here,
 *  never more than an hour there). */
export function auroraStalenessNote(kpAtMs: number, now: number): string {
  const minutes = Math.floor((now - kpAtMs) / 60_000);
  if (minutes < 30) return '';
  if (minutes < 60 * 24) return `Kp reading ${Math.round(minutes / 60)} h old`;
  return `Kp reading ${Math.round(minutes / (60 * 24))} d old`;
}

/* ── The join ─────────────────────────────────────────────────────────────── */

/** Why there is no arrangement to report. Ordered as they are checked, not
 *  by permanence — see the note on `auroraReading`. */
export type NoAurora = 'data-unavailable' | 'not-dark' | 'moon-up';

export interface AuroraArrangement {
  kp: number;
  kpAtMs: number;
  bzNt: number | null;
  windSpeedKmS: number | null;
  measuredAtMs: number | null;
  /** The pin's own latitude, converted — see `geomagneticLatitude`. */
  geomagneticLatitude: number;
  /** The oval's equatorward reach for this Kp — see `ovalBoundaryLat`. */
  ovalBoundaryLat: number;
  position: OvalPosition;
  cloud: CloudState;
  cloudCoverPct: number | null;
  /** The atlas zone at the pin, or null when it was never supplied — an
   *  optional refinement, exactly as `coreNight` treats it, never a gate on
   *  its own: aurora is a large-scale glow that (unlike the galactic core)
   *  has no citable atlas-zone threshold of its own, so this is reported
   *  alongside the arrangement rather than used to refuse one. */
  lightPollutionZone: number | null;
  /** The oval position and cloud, as one sentence. */
  note: string;
  /** Bz and the solar wind speed, as one sentence — empty when both are
   *  unavailable, which a Kp-only reading from a partial NOAA outage can
   *  still be. */
  spaceWeatherNote: string;
}

export interface AuroraReading {
  arrangement: AuroraArrangement | null;
  absence: NoAurora | null;
  note: string;
}

export interface AuroraInput {
  latitude: number;
  longitude: number;
  /** Geometric sun altitude at the instant in question, degrees. */
  sunAltitudeDeg: number;
  /** Geometric moon altitude at the same instant, degrees. */
  moonAltitudeDeg: number;
  /** Total sky cloud cover, 0–100, or null when unknown. */
  cloudCoverPct: number | null;
  lightPollutionZone: number | null;
  /** Null when NOAA's feeds did not answer — see the module note on why
   *  that is refused rather than read as "no aurora". */
  spaceWeather: SpaceWeather | null;
}

const round1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

function positionNote(position: OvalPosition, geomagLatAbs: number, boundary: number, kp: number): string {
  const here = round1(geomagLatAbs);
  const reach = round1(boundary);
  if (position === 'inside') {
    return `This spot sits at ${here}° geomagnetic latitude, inside the oval's reach at Kp ${round1(kp)} (≈${reach}°).`;
  }
  if (position === 'near') {
    return `This spot sits at ${here}° geomagnetic latitude, just outside the oval's reach at Kp ${round1(kp)} (≈${reach}°) — NOAA's own guidance allows visibility up to about 1,000 km further out from a clear northern horizon, so low on the horizon is the more honest expectation than overhead.`;
  }
  return `This spot sits at ${here}° geomagnetic latitude, well outside the oval's reach at Kp ${round1(kp)} (≈${reach}°).`;
}

function cloudNote(cloud: CloudState, cloudCoverPct: number | null): string {
  if (cloud === 'unknown') return ' Cloud cover unknown.';
  const pct = Math.round(cloudCoverPct ?? 0);
  if (cloud === 'clear') return ` ${pct}% cloud — the sky is open.`;
  if (cloud === 'patchy') return ` ${pct}% cloud — patchy, expect gaps rather than a clear dome.`;
  return ` ${pct}% cloud — overcast, nothing of the sky is actually visible.`;
}

function spaceWeatherNoteFor(bzNt: number | null, windSpeedKmS: number | null): string {
  const parts: string[] = [];
  if (bzNt != null) {
    const direction = bzNt < -0.5 ? 'south — favourable for the field to couple with the wind' : bzNt > 0.5 ? 'north — unfavourable, coupling stays weak while it holds' : 'near zero';
    parts.push(`Bz ${round1(bzNt)} nT, ${direction}.`);
  }
  if (windSpeedKmS != null) parts.push(`Solar wind ${Math.round(windSpeedKmS)} km/s.`);
  return parts.join(' ');
}

/**
 * The whole question, for one instant: is the aurora worth stepping outside
 * for, given where the oval reaches tonight and what stands between here and
 * the sky.
 *
 * **Checked in this order, and it is not `coreNight`'s "most permanent
 * first" order.** A missing `SpaceWeather` is checked *first*, ahead of
 * darkness and the moon, even though a dead feed is the most temporary of
 * the three (a refresh might fix it) — because unlike `coreNight`'s optional
 * light-pollution zone, Kp is not one gate among several here, it is the
 * entire subject. Checking darkness first and reporting `not-dark` while
 * the real problem is a dead NOAA feed would read as an ordinary, expected
 * refusal instead of an outage, which is exactly the paper-over this module
 * exists to refuse.
 */
export function auroraReading(input: AuroraInput): AuroraReading {
  const absent = (absence: NoAurora, note: string): AuroraReading => ({ arrangement: null, absence, note });

  if (!input.spaceWeather) {
    return absent('data-unavailable', "NOAA's space-weather feed did not answer, so there is nothing to report — not the same as a quiet night.");
  }
  if (!(input.sunAltitudeDeg <= SUN_ALTITUDE.astronomical)) {
    return absent('not-dark', 'the sky here is not astronomically dark yet.');
  }
  if (input.moonAltitudeDeg > MOONRISE_ALTITUDE) {
    return absent('moon-up', 'the moon is up, and would wash out anything but a strong display.');
  }

  const { spaceWeather } = input;
  const geomagLat = geomagneticLatitude(input.latitude, input.longitude);
  const geomagLatAbs = Math.abs(geomagLat);
  const boundary = ovalBoundaryLat(spaceWeather.kp);
  const position = ovalPositionFor(geomagLatAbs, boundary);
  const cloud = cloudStateFor(input.cloudCoverPct);

  const note = positionNote(position, geomagLatAbs, boundary, spaceWeather.kp) + cloudNote(cloud, input.cloudCoverPct);

  const arrangement: AuroraArrangement = {
    kp: spaceWeather.kp,
    kpAtMs: spaceWeather.kpAtMs,
    bzNt: spaceWeather.bzNt,
    windSpeedKmS: spaceWeather.windSpeedKmS,
    measuredAtMs: spaceWeather.measuredAtMs,
    geomagneticLatitude: geomagLat,
    ovalBoundaryLat: boundary,
    position,
    cloud,
    cloudCoverPct: input.cloudCoverPct,
    lightPollutionZone: input.lightPollutionZone,
    note,
    spaceWeatherNote: spaceWeatherNoteFor(spaceWeather.bzNt, spaceWeather.windSpeedKmS),
  };

  return { arrangement, absence: null, note };
}
