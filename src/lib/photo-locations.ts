/**
 * Hand-placed photo locations — the file behind Scout's "your photos" layer.
 *
 * Its own git-ignored file for the reason `LOCATIONS_PATH` gives: where
 * someone shoots is private, and the overrides and manifest are committed to
 * a public repository. Same read-modify-write posture as `notes.ts`.
 */
import fs from 'node:fs/promises';
import { LOCATIONS_PATH } from './paths';
import { parsePlacedLocations, type PlacedLocations } from './scout/mine';
import type { LatLon } from './scout/geo';

export async function readPlacedLocations(): Promise<PlacedLocations> {
  try {
    return parsePlacedLocations(JSON.parse(await fs.readFile(LOCATIONS_PATH, 'utf8')));
  } catch {
    return {};
  }
}

async function write(placed: PlacedLocations): Promise<void> {
  const tmp = `${LOCATIONS_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(placed, null, 2));
  await fs.rename(tmp, LOCATIONS_PATH);
}

let writeChain: Promise<unknown> = Promise.resolve();
function serialized(fn: () => Promise<void>): Promise<void> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

/** Place one photo, or (with `null`) forget its placement — it then falls
 *  back to its GPS, if it has any. */
export function setPlacedLocation(id: string, at: LatLon | null): Promise<void> {
  return serialized(async () => {
    const placed = await readPlacedLocations();
    if (at) placed[id] = { lat: at.lat, lon: at.lon };
    else delete placed[id];
    await write(placed);
  });
}
