/**
 * Where an uploaded DEM actually lives — issue #50.
 *
 * `dem-upload.ts` parses a GeoTIFF into a plain `UploadedDem`; this is what
 * keeps one around between visits. `localStorage`, where kept spots
 * themselves live, tops out in the low megabytes and is synchronous — wrong
 * on both counts for a raster that can legitimately run to `MAX_UPLOAD_BYTES`
 * (25 MB). IndexedDB is the browser's actual answer to "hold a chunk of
 * binary data, off the main thread, past the tab closing."
 *
 * Browser-only by construction — `indexedDB` does not exist under the Node
 * test runner this repo otherwise uses, so this module is exercised by
 * running the app, not by a unit test, the same way `map.ts`'s MapLibre
 * wiring is. What is worth unit-testing here already is: `dem-upload.ts`'s
 * parsing and sampling.
 *
 * Kept spots are matched the same way the notebook itself matches them —
 * `metresBetween` against `SAME_SPOT_M` — rather than by an exact lat/lon
 * key, so an upload survives the small jitter a re-save or a geocoder
 * round-trip can introduce.
 */

import type { LatLon } from '../geo';
import { metresBetween, SAME_SPOT_M } from '../spots';
import type { UploadedDem } from '../dem-upload';

const DB_NAME = 'scout-dem';
const DB_VERSION = 1;
const STORE = 'uploads';

/** One upload, as stored — the parsed raster plus enough to find and describe it again. */
export interface StoredDem extends UploadedDem {
  id: string;
  lat: number;
  lon: number;
  /** The file's own name, so a spot with more than one upload can tell them apart. */
  filename: string;
  addedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open the DEM store.'));
    });
  }
  return dbPromise;
}

function runTx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('DEM store request failed.'));
      }),
  );
}

/** Every upload on record, regardless of which spot it belongs to. */
async function allUploads(): Promise<StoredDem[]> {
  return runTx('readonly', (store) => store.getAll() as IDBRequest<StoredDem[]>);
}

/** The uploads that cover this spot — same match `indexOfSpot` uses, so this agrees with the notebook about what "this spot" means. */
export async function uploadsFor(at: LatLon): Promise<StoredDem[]> {
  const all = await allUploads();
  return all
    .filter((u) => metresBetween(u, at) <= SAME_SPOT_M)
    .sort((a, b) => b.addedAt - a.addedAt);
}

/** Store a parsed DEM against a spot, tagged with the file it came from. */
export async function saveUpload(at: LatLon, filename: string, dem: UploadedDem, addedAt: number): Promise<StoredDem> {
  const record: StoredDem = {
    ...dem,
    id: `${addedAt}-${Math.round(at.lat * 1e6)}-${Math.round(at.lon * 1e6)}`,
    lat: at.lat,
    lon: at.lon,
    filename,
    addedAt,
  };
  await runTx('readwrite', (store) => store.put(record));
  return record;
}

export async function removeUpload(id: string): Promise<void> {
  await runTx('readwrite', (store) => store.delete(id));
}
