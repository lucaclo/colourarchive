/**
 * Hand-placed photo locations — the file behind Scout's "your photos" layer.
 *
 * Its own git-ignored file for the reason `LOCATIONS_PATH` gives: where
 * someone shoots is private, and the overrides and manifest are committed to
 * a public repository. Same read-modify-write posture as `notes.ts`.
 */
import fs from 'node:fs/promises';
import { GPS_PATH, LOCATIONS_PATH, PLACE_DISMISSED_PATH } from './paths';
import { parsePlacedLocations, type PlacedLocations } from './scout/mine';
import type { LatLon } from './scout/geo';

export async function readPlacedLocations(): Promise<PlacedLocations> {
  try {
    return parsePlacedLocations(JSON.parse(await fs.readFile(LOCATIONS_PATH, 'utf8')));
  } catch {
    return {};
  }
}

async function writeTo(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}
const write = (placed: PlacedLocations) => writeTo(LOCATIONS_PATH, placed);

let writeChain: Promise<unknown> = Promise.resolve();
function serialized(fn: () => Promise<void>): Promise<void> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

/** Place one photo, or (with `null`) forget its placement — it then falls
 *  back to its GPS, if it has any. */
export function setPlacedLocation(id: string, at: LatLon | null, via?: 'phone'): Promise<void> {
  return serialized(async () => {
    const placed = await readPlacedLocations();
    if (at) placed[id] = { lat: at.lat, lon: at.lon, ...(via ? { via } : {}) };
    else delete placed[id];
    await write(placed);
  });
}

/** GPS from the photos' own EXIF, by id (issue #139). */
export async function readGpsLocations(): Promise<PlacedLocations> {
  try {
    return parsePlacedLocations(JSON.parse(await fs.readFile(GPS_PATH, 'utf8')));
  } catch {
    return {};
  }
}

/** Record GPS read at ingest. */
export function addGpsLocations(found: Record<string, LatLon>): Promise<void> {
  if (Object.keys(found).length === 0) return Promise.resolve();
  return serialized(async () => {
    const gps = await readGpsLocations();
    for (const [id, at] of Object.entries(found)) gps[id] = { lat: at.lat, lon: at.lon };
    await writeTo(GPS_PATH, gps);
  });
}

/** Ids whose place suggestion was turned down. */
export async function readDismissedPlaces(): Promise<Set<string>> {
  try {
    const raw = JSON.parse(await fs.readFile(PLACE_DISMISSED_PATH, 'utf8'));
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function dismissPlace(id: string): Promise<void> {
  return serialized(async () => {
    const ids = await readDismissedPlaces();
    ids.add(id);
    await writeTo(PLACE_DISMISSED_PATH, [...ids]);
  });
}
