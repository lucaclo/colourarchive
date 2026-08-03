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
import type { Orientation } from './frame';

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
const SAME_SPOT_M = 50;

const EARTH_R = 6_371_000;
const RAD = Math.PI / 180;

/** Flat-earth distance, fine at the scale that decides "same spot". */
function metresBetween(a: LatLon, b: LatLon): number {
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
