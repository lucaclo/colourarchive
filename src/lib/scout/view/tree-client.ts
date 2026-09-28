/**
 * Mapped trees from OpenStreetMap, by way of Overpass.
 *
 * Straight from the page: the Overpass instances answer with
 * `access-control-allow-origin: *`, so unlike Nominatim this needs no server
 * of ours, and it works the same on the Mac and on the published site.
 *
 * Overpass is a shared volunteer service, so this is careful with it. Boxes
 * are snapped to a coarse grid and cached for the session, so panning around
 * one neighbourhood asks once; requests time out quickly and fall through to
 * a second instance; and a failure is remembered for the box rather than
 * retried on every pan. Nothing here is required — with no answer the map
 * simply shows estimated trees, and says so.
 */

import { overpassTreeQuery, parseOverpassTrees, type Tree } from '../trees';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const TIMEOUT_MS = 12_000;
/** Degrees. About 1.1 km north–south: two or four cells cover a street-level view. */
const SNAP = 0.01;

export type TreeAnswer = { status: 'ok'; trees: Tree[] } | { status: 'failed' } | { status: 'pending' };

const cache = new Map<string, TreeAnswer>();
const inflight = new Map<string, Promise<void>>();
/** When a failed cell may be asked again. Overpass answers 504 when busy,
 *  which is a "later", not a "never". */
const retryAt = new Map<string, number>();
const RETRY_MS = 60_000;

/**
 * One request at a time. Overpass allows a couple of slots per address, and a
 * street-level view spans four cells: fired together, the first came back 200
 * and the other three 504 — measured, not assumed.
 */
let queue: Promise<void> = Promise.resolve();
const enqueue = (job: () => Promise<void>) => {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
};

export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** The snapped cells a box touches, so neighbouring views share requests. */
export function cellsFor(box: Box): Box[] {
  const cells: Box[] = [];
  for (let x = Math.floor(box.west / SNAP); x * SNAP < box.east; x++) {
    for (let y = Math.floor(box.south / SNAP); y * SNAP < box.north; y++) {
      cells.push({ west: x * SNAP, south: y * SNAP, east: (x + 1) * SNAP, north: (y + 1) * SNAP });
    }
  }
  return cells;
}

const keyOf = (cell: Box) => `${cell.west.toFixed(3)},${cell.south.toFixed(3)}`;

async function fetchCell(cell: Box): Promise<void> {
  const body = new URLSearchParams({ data: overpassTreeQuery(cell) });
  for (const endpoint of ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, { method: 'POST', body, signal: controller.signal });
      if (!response.ok) continue;
      const trees = parseOverpassTrees(await response.json());
      cache.set(keyOf(cell), { status: 'ok', trees });
      return;
    } catch {
      /* timed out or refused — try the next instance */
    } finally {
      clearTimeout(timer);
    }
  }
  cache.set(keyOf(cell), { status: 'failed' });
  retryAt.set(keyOf(cell), Date.now() + RETRY_MS);
}

/**
 * What is known about the mapped trees in a box right now, synchronously —
 * and, for any cell not yet asked about, a request that calls `onArrive`
 * when it lands so the caller can redraw.
 */
export function mappedTreesIn(box: Box, onArrive: () => void): { trees: Tree[]; pending: number; failed: number } {
  const trees: Tree[] = [];
  let pending = 0;
  let failed = 0;
  const cells = cellsFor(box);
  // A pitched camera at street level can ask for a big box; past a handful of
  // cells it is not a neighbourhood any more, and the estimates will do.
  if (cells.length > 9) return { trees, pending: 0, failed: 0 };
  for (const cell of cells) {
    const key = keyOf(cell);
    const known = cache.get(key);
    if (known?.status === 'ok') {
      for (const t of known.trees) {
        if (t.lon >= box.west && t.lon <= box.east && t.lat >= box.south && t.lat <= box.north) trees.push(t);
      }
      continue;
    }
    if (known?.status === 'failed' && Date.now() < (retryAt.get(key) ?? 0)) {
      failed++;
      continue;
    }
    pending++;
    if (!inflight.has(key)) {
      cache.set(key, { status: 'pending' });
      const job = enqueue(() => fetchCell(cell)).finally(() => {
        inflight.delete(key);
        onArrive();
      });
      inflight.set(key, job);
    }
  }
  return { trees, pending, failed };
}
