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

export interface SavedSpot {
  name: string;
  lat: number;
  lon: number;
  timeZone?: string;
  radiusKm?: number;
  /** Epoch millis, for ordering. Most recently saved first. */
  savedAt: number;
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
  return [spot, ...rest].slice(0, MAX_SPOTS);
}

export function removeSpot(spots: SavedSpot[], at: LatLon): SavedSpot[] {
  const existing = indexOfSpot(spots, at);
  if (existing === -1) return spots;
  return [...spots.slice(0, existing), ...spots.slice(existing + 1)];
}
