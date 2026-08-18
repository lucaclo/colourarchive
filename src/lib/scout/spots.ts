/**
 * Places worth coming back to.
 *
 * Scouting is repetitive in a specific way: you find a spot, check it across a
 * few dates, go away, and come back to it next week. Until now the only way
 * back was to retype the name and hope the geocoder returned the same result,
 * or to have kept the link. Neither is a substitute for a short list of the
 * places you actually care about.
 *
 * Deliberately local. There is no account to hang these on and [[decision 2]]
 * says build local-first, so they live in `localStorage` — not `sessionStorage`,
 * where the rest of the view state lives, because the whole point is surviving
 * the tab. When accounts arrive this is the shape that gets synced.
 *
 * Everything here is pure and everything read back is **validated**. Local
 * storage is user-writable, survives across versions of this code, and a
 * malformed entry must lose itself rather than the whole list.
 */

import type { LatLon } from './geo';
import { angleDelta, type Orientation } from './frame';

/**
 * The lens, as it was set when the spot was kept.
 *
 * A place is only half the plan. "Calton Hill" tells you where to stand;
 * "Calton Hill, 24 mm, aimed 270°, tilted up 4°" is the shot. Coming back to
 * the first and having to work out the second again is most of what made
 * returning to a spot tedious.
 */
export interface SpotFrame {
  /** A key from `SENSORS` in `frame.ts`. Kept as a string so this stays pure. */
  sensor: string;
  focalLengthMm: number;
  orientation: Orientation;
  /** Where the camera points, degrees clockwise from north. */
  bearing: number;
  /** Up from level, degrees. */
  tiltDeg: number;
}

/**
 * A photograph that made the place worth going to.
 *
 * A **reference**, not a copy: the URL of someone else's picture, with the
 * credit it arrived with. Nothing is re-hosted and nothing is stored as bytes —
 * partly because `localStorage` could not hold it, and mostly because these are
 * other people's photographs and the credit is the whole point. An entry that
 * cannot say where it came from is not kept.
 */
export interface SpotPhoto {
  url: string;
  credit?: string;
  licence?: string;
  /** Which adapter found it — `wikimedia`, `flickr`, `manual`. */
  source?: string;
}

/**
 * What the sky was actually doing, logged at the moment someone chose to log
 * it — the realised half of a spot that "note" alone never captured, because
 * a note is written once, when the place is kept, and says nothing about
 * whether any given return trip was any good.
 *
 * The condition fields are a snapshot of what Scout had already computed for
 * the slider's date and hour, not a re-measurement — this is a record of what
 * the plan said at the time, which is the only version of "what it was like"
 * a tool with no sensor of its own can honestly keep.
 */
export interface SpotVisit {
  /** Epoch millis of the date and hour on the slider when this was logged. */
  at: number;
  sunAltitude: number;
  sunAzimuth: number;
  /** 0–1, when the moon calculation had run. */
  moonFraction?: number;
  /** `cloudStructure(hour).note`, verbatim — whatever the weather panel already said. */
  cloud?: string;
  /** `weatherCondition(hour.weatherCode).label`, verbatim. */
  weather?: string;
  /** What actually happened. Free text, the same budget as the spot's own note. */
  outcome?: string;
}

export interface SavedSpot {
  name: string;
  lat: number;
  lon: number;
  timeZone?: string;
  radiusKm?: number;
  /** Epoch millis, for ordering. Most recently saved first. */
  savedAt: number;
  /** Whatever you want to remember. Free text, yours alone. */
  note?: string;
  frame?: SpotFrame;
  /** The stated height of the monolith, when one was placed. */
  slabHeightM?: number;
  photos?: SpotPhoto[];
  /** Logged trips to this spot, most recent first. */
  visits?: SpotVisit[];
}

/**
 * How many to keep.
 *
 * A recall list is only useful while you can scan it. Past a couple of dozen
 * you are searching it, and search is what the place field is for.
 */
export const MAX_SPOTS = 24;

/**
 * Two spots this close are the same spot.
 *
 * 50 m: closer than the geocoder's own agreement with itself between a search
 * and a reverse lookup, so saving "Calton Hill" twice from two routes gives one
 * entry rather than two that look identical and are not.
 */
export const SAME_SPOT_M = 50;

const EARTH_R = 6_371_000;
const RAD = Math.PI / 180;

/** Flat-earth distance, fine at the scale that decides "same spot". Exported so anything else keyed on spot identity — the DEM upload store, for one — agrees with `indexOfSpot` on what "the same place" means. */
export function metresBetween(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD * Math.cos(((a.lat + b.lat) / 2) * RAD);
  return Math.hypot(dLat, dLon) * EARTH_R;
}

/** Longest note kept. A notebook entry, not a document. */
export const MAX_NOTE = 600;

/**
 * How many reference photographs one spot may carry.
 *
 * They are URLs, so the cost is the quota rather than the bandwidth, but a
 * strip you have to scroll is no longer a glance.
 */
export const MAX_PHOTOS = 6;

/**
 * How many visits one spot may carry.
 *
 * A log you have to scroll past to find the last entry stops being a quick
 * "what was it like here" check, which is the whole point of keeping it.
 */
export const MAX_VISITS = 12;

/** Longest outcome kept — the same budget as the spot's own note. */
export const MAX_OUTCOME = MAX_NOTE;

/**
 * A URL safe to put in an `href` or an `img src`.
 *
 * These come out of local storage, which anything on this origin can write, and
 * they end up in the DOM. `javascript:` and `data:` in an attribute are the
 * whole of that attack, so the protocol is checked against a list of two rather
 * than against a list of what is forbidden.
 */
function readUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Short free text, or undefined. Never a number, never an object. */
function readText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
}

/**
 * The lens, or nothing.
 *
 * All or nothing on purpose: a frame missing its bearing is not a frame with a
 * default bearing, it is a frame that would aim the wedge somewhere you never
 * pointed. Better to come back with no lens set than with the wrong one.
 */
export function readFrame(value: unknown): SpotFrame | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  const sensor = readText(raw.sensor, 24);
  if (!sensor) return null;

  const focal = Number(raw.focalLengthMm);
  if (!Number.isFinite(focal) || focal < 1 || focal > 2000) return null;

  if (raw.orientation !== 'landscape' && raw.orientation !== 'portrait') return null;

  const bearing = Number(raw.bearing);
  if (!Number.isFinite(bearing)) return null;

  const tilt = Number(raw.tiltDeg);
  if (!Number.isFinite(tilt) || Math.abs(tilt) > 90) return null;

  return {
    sensor,
    focalLengthMm: focal,
    orientation: raw.orientation,
    // Normalised rather than rejected: a bearing of 370° is a bearing of 10°,
    // and refusing it would lose a frame over arithmetic.
    bearing: ((bearing % 360) + 360) % 360,
    tiltDeg: tilt,
  };
}

/** One reference photograph, or null when it is not one. */
export function readPhoto(value: unknown): SpotPhoto | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const url = readUrl(raw.url);
  if (!url) return null;

  const photo: SpotPhoto = { url };
  const credit = readText(raw.credit, 200);
  if (credit) photo.credit = credit;
  const licence = readText(raw.licence, 200);
  if (licence) photo.licence = licence;
  const source = readText(raw.source, 40);
  if (source) photo.source = source;
  return photo;
}

/**
 * One logged visit, or null when it is not one.
 *
 * `at`, `sunAltitude` and `sunAzimuth` are required — a visit that cannot say
 * when it was or what the sun was doing cannot be matched against a future
 * forecast, which is the only reason to keep one. Everything else is
 * whatever Scout happened to have computed at the time, so it enriches a
 * visit and can never invalidate one, the same rule the notebook fields
 * already follow.
 */
export function readVisit(value: unknown): SpotVisit | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  const at = Number(raw.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  const sunAltitude = Number(raw.sunAltitude);
  if (!Number.isFinite(sunAltitude) || Math.abs(sunAltitude) > 90) return null;
  const sunAzimuth = Number(raw.sunAzimuth);
  if (!Number.isFinite(sunAzimuth)) return null;

  const visit: SpotVisit = { at, sunAltitude, sunAzimuth: ((sunAzimuth % 360) + 360) % 360 };

  const moonFraction = Number(raw.moonFraction);
  if (Number.isFinite(moonFraction) && moonFraction >= 0 && moonFraction <= 1) {
    visit.moonFraction = moonFraction;
  }
  const cloud = readText(raw.cloud, 200);
  if (cloud) visit.cloud = cloud;
  const weather = readText(raw.weather, 60);
  if (weather) visit.weather = weather;
  const outcome = readText(raw.outcome, MAX_OUTCOME);
  if (outcome) visit.outcome = outcome;

  return visit;
}

/** One entry, or null when it is not one. */
export function readSpot(value: unknown): SavedSpot | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 120) : '';
  if (!name) return null;

  const spot: SavedSpot = {
    name,
    lat,
    lon,
    savedAt: Number.isFinite(Number(raw.savedAt)) ? Number(raw.savedAt) : 0,
  };
  if (typeof raw.timeZone === 'string' && raw.timeZone) spot.timeZone = raw.timeZone;
  const radius = Number(raw.radiusKm);
  if (Number.isFinite(radius) && radius >= 1 && radius <= 50) spot.radiusKm = Math.round(radius);

  // Everything below is a notebook field: it enriches a spot and it can never
  // invalidate one. A note that arrives as an object, a frame with no bearing
  // or a photo with a `javascript:` URL costs itself and nothing else — the
  // place is still a place.
  const note = readText(raw.note, MAX_NOTE);
  if (note) spot.note = note;

  const frame = readFrame(raw.frame);
  if (frame) spot.frame = frame;

  const height = Number(raw.slabHeightM);
  if (Number.isFinite(height) && height > 0 && height <= 1000) {
    spot.slabHeightM = Math.round(height);
  }

  if (Array.isArray(raw.photos)) {
    const photos = raw.photos
      .map(readPhoto)
      .filter((photo): photo is SpotPhoto => photo !== null)
      .slice(0, MAX_PHOTOS);
    if (photos.length) spot.photos = photos;
  }

  if (Array.isArray(raw.visits)) {
    const visits = raw.visits
      .map(readVisit)
      .filter((visit): visit is SpotVisit => visit !== null)
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_VISITS);
    if (visits.length) spot.visits = visits;
  }

  return spot;
}

/**
 * A stored blob as a list, dropping whatever does not survive checking.
 *
 * One bad entry costs that entry. Throwing the list away for it would lose
 * every good spot alongside it, which is the worse failure by far.
 */
export function readSpots(json: string | null): SavedSpot[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(readSpot)
    .filter((spot): spot is SavedSpot => spot !== null)
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_SPOTS);
}

/** Is this spot already in the list? Returns its index, or -1. */
export function indexOfSpot(spots: SavedSpot[], at: LatLon): number {
  return spots.findIndex((spot) => metresBetween(spot, at) <= SAME_SPOT_M);
}

/**
 * Add one, or move it to the front and refresh its name if it is already there.
 *
 * Re-saving is how you rename: the newer name wins, because the only reason to
 * save a place you already have is that something about it changed.
 */
export function addSpot(spots: SavedSpot[], spot: SavedSpot): SavedSpot[] {
  const existing = indexOfSpot(spots, spot);
  const rest = existing === -1 ? spots : [...spots.slice(0, existing), ...spots.slice(existing + 1)];
  // The notebook survives a re-save. What you typed about a place is the part
  // that took effort and the part nothing else can reconstruct, so a save that
  // says nothing about the note keeps the note — while a save that carries one
  // still wins.
  const previous = existing === -1 ? null : spots[existing];
  const merged: SavedSpot = previous
    ? {
        ...spot,
        note: spot.note ?? previous.note,
        frame: spot.frame ?? previous.frame,
        slabHeightM: spot.slabHeightM ?? previous.slabHeightM,
        photos: spot.photos ?? previous.photos,
        visits: spot.visits ?? previous.visits,
      }
    : spot;
  return [merged, ...rest].slice(0, MAX_SPOTS);
}

/**
 * Edit a kept spot in place, without moving it up the list.
 *
 * Writing a note is not a reason for a spot to jump to the top: the order is
 * "most recently *kept*", and re-ordering on every keystroke would make the
 * list move under the hand editing it.
 */
export function updateSpot(
  spots: SavedSpot[],
  at: LatLon,
  patch: Partial<Omit<SavedSpot, 'lat' | 'lon'>>,
): SavedSpot[] {
  const existing = indexOfSpot(spots, at);
  if (existing === -1) return spots;
  const next = [...spots];
  next[existing] = { ...spots[existing], ...patch };
  return next;
}

/**
 * Log a visit against a kept spot, newest first, capped at `MAX_VISITS`.
 *
 * Silently does nothing when the spot is not kept — logging a visit to a
 * place with nowhere to hold it is not an error, it is a button that should
 * not have been reachable, and the caller is what decides whether to show it.
 */
export function addVisit(spots: SavedSpot[], at: LatLon, visit: SpotVisit): SavedSpot[] {
  const existing = indexOfSpot(spots, at);
  if (existing === -1) return spots;
  const visits = [visit, ...(spots[existing].visits ?? [])].slice(0, MAX_VISITS);
  return updateSpot(spots, at, { visits });
}

/**
 * The lens as one line, for a list row.
 *
 * Reads as a camera would be set rather than as a record would be stored:
 * "24 mm · 270° · +4°". Portrait is called out because it changes the field of
 * view, and a level camera says nothing at all rather than "+0°".
 */
export function describeFrame(frame: SpotFrame): string {
  const parts = [`${Math.round(frame.focalLengthMm)} mm`];
  if (frame.orientation === 'portrait') parts.push('portrait');
  parts.push(`${Math.round(frame.bearing)}°`);
  const tilt = Math.round(frame.tiltDeg);
  if (tilt !== 0) parts.push(`${tilt > 0 ? '+' : ''}${tilt}° tilt`);
  return parts.join(' · ');
}

export function removeSpot(spots: SavedSpot[], at: LatLon): SavedSpot[] {
  const existing = indexOfSpot(spots, at);
  if (existing === -1) return spots;
  return [...spots.slice(0, existing), ...spots.slice(existing + 1)];
}

/* ── Matching a plan against what actually happened ────────────────────────── */

export interface VisitMatch {
  visit: SpotVisit;
  altitudeDiffDeg: number;
  azimuthDiffDeg: number;
  note: string;
}

/**
 * Which past visit best matches the sun position a forecast is now planning
 * around, and by how much.
 *
 * Ranked on altitude alone, not on a fused distance over altitude and
 * azimuth together. A fused score would need a weighting between two
 * different kinds of degree — how much a few degrees of *height* changes the
 * light against how much a few degrees of *bearing* does — and that
 * weighting would be a number invented for this function rather than
 * measured by it, the exact kind of unreproducible score this project
 * otherwise refuses to publish. Altitude is what actually governs how hard
 * and how warm the light is; azimuth is reported alongside the pick as
 * supporting context, not folded into the choice of which visit wins.
 */
export function closestVisit(
  visits: SpotVisit[] | undefined,
  targetAltitude: number,
  targetAzimuth: number,
): VisitMatch | null {
  if (!visits?.length) return null;
  let best = visits[0];
  let bestDiff = Math.abs(best.sunAltitude - targetAltitude);
  for (const visit of visits.slice(1)) {
    const diff = Math.abs(visit.sunAltitude - targetAltitude);
    if (diff < bestDiff) {
      best = visit;
      bestDiff = diff;
    }
  }
  const azimuthDiffDeg = Math.abs(angleDelta(best.sunAzimuth, targetAzimuth));
  return {
    visit: best,
    altitudeDiffDeg: bestDiff,
    azimuthDiffDeg,
    note: describeVisitMatch(best, bestDiff, azimuthDiffDeg),
  };
}

/** "3 Jun 2025" — a visit's own date, in the reader's locale. */
export function formatVisitDate(at: number): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(at),
  );
}

function describeVisitMatch(visit: SpotVisit, altitudeDiffDeg: number, azimuthDiffDeg: number): string {
  const closeness =
    altitudeDiffDeg < 3
      ? 'nearly the same height'
      : altitudeDiffDeg < 10
        ? `${altitudeDiffDeg.toFixed(0)}° different in height`
        : `${altitudeDiffDeg.toFixed(0)}° off in height — not that close a match`;
  const conditions = [visit.weather, visit.cloud].filter(Boolean).join(', ');
  const outcome = visit.outcome ? ` "${visit.outcome}"` : ' No outcome was logged.';
  return (
    `Closest logged visit: ${formatVisitDate(visit.at)}, sun ${closeness}, ` +
    `${azimuthDiffDeg.toFixed(0)}° round in bearing.${conditions ? ` ${conditions}.` : ''}${outcome}`
  );
}
