/**
 * Shared plumbing for the terrarium elevation tiles (Mapterhorn's, since
 * November 2026; AWS's `elevation-tiles-prod` before that).
 *
 * Two consumers need the same real elevation, cleaned the same way: the 3D
 * terrain mesh (`terrain-protocol.ts`) and the landform shadow overlay
 * (`terrain-shadows.ts`). Before this existed they each fetched, decoded,
 * clamped and despiked their own copy of every tile — twice the network,
 * twice the despike pass, on any view where both happened to want the same
 * tile — and each hand-rolled the same tile URL and the same
 * `OffscreenCanvas`-or-detached-canvas fallback (Safari only gained the
 * former recently, and this has to work on the iPad it was built for).
 *
 * `getCleanedTerrariumTile` is the single place that fetch now happens: a
 * promise-cache keyed by tile address, so the second caller for a tile —
 * whether that is the other consumer or a re-request of a tile still in
 * view — gets the first caller's decode and despike for free rather than
 * paying for its own.
 *
 * Mapterhorn stops at a depth that depends on the place — z17 over the
 * Matterhorn, z16 over the Lake District, z12 over Patagonia — and answers
 * 404 below it. A tile it does not have is cut from the nearest ancestor it
 * does: that ancestor's cleaned heights, cropped to the quadrant and
 * resampled in metres, then encoded as terrarium again. So the map never has
 * a hole where the survey runs out, only ground as sharp as the survey is.
 *
 * The work itself runs in a worker (`terrarium.worker.ts`) wherever the
 * browser can draw to an OffscreenCanvas there. Profiling a zoom on the globe
 * put the decode's pixel readback at most of a second and a half of main-
 * thread time, the frames the map should have been drawing. Where a worker
 * can't do it, it runs here as before, on a canvas created for reading back,
 * which keeps its pixels in memory instead of on the GPU.
 */

import {
  ancestorTile,
  clampImplausibleElevation,
  decodeTerrariumTile,
  despikeHeights,
  encodeTerrariumTile,
  quadrantIn,
  upsampleHeights,
  type TileAddress,
} from '../terrain';

/**
 * Mapterhorn's open elevation: terrarium tiles built from national surveys
 * where they are open (lidar to z17 over the Alps) and Copernicus 30 m
 * everywhere else (to z12). Free and keyless; credited in `page.ts`.
 */
export const terrariumTileUrl = (t: TileAddress): string =>
  `https://tiles.mapterhorn.com/${t.z}/${t.x}/${t.y}.webp`;

/**
 * Mapterhorn's tile size, from its tilejson. Decoding reads each tile's own
 * size off the image; this is for planning a grid before any has arrived.
 */
export const TERRARIUM_TILE_SIZE = 512;

/**
 * A 2D drawing context for a tile-sized canvas, without caring which kind of
 * canvas it came from.
 *
 * `OffscreenCanvas` where it exists, a detached DOM canvas where it does
 * not — Safari only gained the former recently and this has to work on the
 * iPad it was built for.
 *
 * `readBack` asks for a canvas kept in memory rather than on the GPU, for
 * one whose pixels are read with getImageData: reading a GPU canvas back
 * stalls the GPU for every tile.
 */
export function terrariumCanvasContext(
  width: number,
  height: number,
  readBack = false,
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: readBack });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d', { willReadFrequently: readBack });
}

export interface CleanedTerrariumTile {
  width: number;
  height: number;
  /** Clamped and despiked heights, metres — see `terrain.ts`. */
  heights: Float32Array;
  /**
   * The tile exactly as fetched, before any decoding. Empty for a tile cut
   * from an ancestor, which was never fetched.
   */
  raw: ArrayBuffer;
  /**
   * False when cleaning left every pixel exactly as it decoded — true for
   * the overwhelming majority of real tiles, since bad pixels are rare. The
   * 3D terrain protocol uses this to skip re-encoding a tile it did not
   * actually change (see that file's own comment on why that matters).
   * Always true for a tile cut from an ancestor.
   */
  changed: boolean;
  /**
   * The cleaned tile as a picture, for the 3D terrain to take instead of a
   * re-encoded PNG. Only when cleaning changed something, and only once:
   * whoever takes it sets this to null. Later requests build their own.
   */
  bitmap?: ImageBitmap | null;
}

/** The cleaned heights as a terrarium picture, without a PNG round trip. */
export function terrariumImageData(heights: Float32Array, width: number, height: number): ImageData {
  return new ImageData(encodeTerrariumTile(heights), width, height);
}

/**
 * Decode and clean one fetched tile. Runs in the worker, or here when there
 * is none. Throws on a tile it can't decode.
 */
export async function cleanTerrariumBytes(raw: ArrayBuffer, withBitmap: boolean): Promise<CleanedTerrariumTile> {
  const bitmap = await createImageBitmap(new Blob([raw]));
  const { width, height } = bitmap;
  const context = terrariumCanvasContext(width, height, true);
  if (!context) throw new Error('no 2d canvas context to decode a terrain tile');
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const image = context.getImageData(0, 0, width, height);
  // The validating decoder, not a hand-rolled loop — a tile of the wrong
  // size is a corrupt or unexpected response, not silent garbage.
  const decoded = decodeTerrariumTile(image.data, width);
  // The absolute clamp runs first — see `clampImplausibleElevation` — so a
  // wide, smoothly-interpolated bad region collapses toward sea level
  // before the local despike has to reason about what is left of it.
  //
  // Kept for Mapterhorn's survey tiles too: measured on z12–z17 tiles over
  // the Matterhorn, Brighton and Patagonia, it changed no pixel at all, so
  // it costs time in the worker and never sands down real relief.
  const cleaned = despikeHeights(clampImplausibleElevation(decoded), width);

  let changed = false;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] !== decoded[i]) {
      changed = true;
      break;
    }
  }
  const out: CleanedTerrariumTile = { width, height, heights: cleaned, raw, changed };
  if (changed && withBitmap) out.bitmap = await createImageBitmap(terrariumImageData(cleaned, width, height));
  return out;
}

/**
 * A tile Mapterhorn does not have, cut from the cleaned heights of the
 * ancestor `levels` up that it does: the quadrant cropped and resampled in
 * metres (`upsampleHeights`), at the ancestor's own size.
 */
export async function terrariumFromAncestor(
  heights: Float32Array,
  size: number,
  tile: TileAddress,
  levels: number,
  withBitmap: boolean,
): Promise<CleanedTerrariumTile> {
  const cut = upsampleHeights(heights, size, quadrantIn(tile, levels, size));
  const out: CleanedTerrariumTile = { width: size, height: size, heights: cut, raw: new ArrayBuffer(0), changed: true };
  if (withBitmap) out.bitmap = await createImageBitmap(terrariumImageData(cut, size, size));
  return out;
}

/* ── One job, wherever it runs ───────────────────────────────────────────── */

/** Fetch and clean the tile at `url`, or cut `tile` from an ancestor's heights. */
export type TerrariumJob =
  | { url: string }
  | { from: { heights: Float32Array; size: number }; tile: TileAddress; levels: number };

/** Mapterhorn's answer for an address deeper than it holds there: a 404. */
export const MISSING = 'missing';

/** A tile, word that there is none at that address, or a failure (null). */
export type TerrariumResult = CleanedTerrariumTile | typeof MISSING | null;

/** Runs in the worker, or here when there is none. Never throws. */
export async function runTerrariumJob(job: TerrariumJob): Promise<TerrariumResult> {
  try {
    if ('from' in job) {
      return await terrariumFromAncestor(job.from.heights, job.from.size, job.tile, job.levels, true);
    }
    const response = await fetch(job.url);
    // Below the deepest zoom it holds for a place. Not a failure: the tile
    // is cut from an ancestor instead.
    if (response.status === 404) return MISSING;
    if (!response.ok) return null;
    return await cleanTerrariumBytes(await response.arrayBuffer(), true);
  } catch {
    // A tile that will not load is a patch of unknown ground, which
    // `loadHeightField` counts and reports. It is not a page error.
    return null;
  }
}

/**
 * How many tiles each cache may hold at once.
 *
 * The same memory as before the tiles grew from 256 to 512 px: 128 tiles of
 * 512² heights is the 128 MB that 512 tiles of 256² were. Still several
 * field-loads' worth — the landform overlay asks for a quarter as many tiles
 * as it did (see `terrain-shadows.ts`) — so revisiting a spot you just left
 * is still free, without pinning every place scouted this session.
 */
const CACHE_LIMIT = 128;

/* ── The worker ──────────────────────────────────────────────────────────── */

/** What the worker answers with; see `terrarium.worker.ts`. */
export type WorkerReply =
  | { id: number; ok: true; tile: CleanedTerrariumTile }
  | { id: number; ok: false; missing?: boolean; unsupported?: boolean };

let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, { job: TerrariumJob; resolve: (r: TerrariumResult) => void }>();

/** Everything the worker was given, done here instead; it is not tried again. */
function abandonWorker() {
  worker?.terminate();
  worker = null;
  for (const [, pending] of waiting) void runTerrariumJob(pending.job).then(pending.resolve);
  waiting.clear();
}

/** The worker, started on first use; null once it has turned out not to work. */
function terrariumWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./terrarium.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return (worker = null);
  }
  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const reply = e.data;
    const pending = waiting.get(reply.id);
    if (!pending) return;
    waiting.delete(reply.id);
    if (reply.ok) pending.resolve(reply.tile);
    else if (reply.unsupported) {
      // No OffscreenCanvas in this browser's workers: do everything here,
      // including the jobs still queued behind this one.
      void runTerrariumJob(pending.job).then(pending.resolve);
      abandonWorker();
    } else pending.resolve(reply.missing ? MISSING : null);
  };
  // A worker that fails to start (an old browser, a blocked script) hands
  // everything it was given back to the main thread.
  worker.onerror = abandonWorker;
  return worker;
}

function run(job: TerrariumJob): Promise<TerrariumResult> {
  const w = terrariumWorker();
  if (!w) return runTerrariumJob(job);
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, { job, resolve });
    // An ancestor's heights are copied to the worker, not transferred: the
    // cache keeps its own for the next tile cut from the same ancestor.
    w.postMessage({ id, job });
  });
}

/* ── The caches ──────────────────────────────────────────────────────────── */

const keyOf = (t: TileAddress) => `${t.z}/${t.x}/${t.y}`;

/**
 * A promise-cache, least recently touched first out. A hit is moved to the
 * end, so the tiles still in use are the ones that survive eviction, not
 * just the ones fetched most recently.
 */
function cached<T>(map: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit) {
    map.delete(key);
    map.set(key, hit);
    return hit;
  }
  const work = make();
  map.set(key, work);
  if (map.size > CACHE_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  return work;
}

/** What Mapterhorn itself has at each address, ancestors included. */
const fetched = new Map<string, Promise<TerrariumResult>>();
/** What each address resolved to: the tile fetched, or one cut for it. */
const resolved = new Map<string, Promise<CleanedTerrariumTile | null>>();

const fetchTile = (tile: TileAddress) => cached(fetched, keyOf(tile), () => run({ url: terrariumTileUrl(tile) }));

async function loadTile(tile: TileAddress): Promise<CleanedTerrariumTile | null> {
  const own = await fetchTile(tile);
  if (own !== MISSING) return own;
  // As far up as it takes, not a fixed number of levels: over open ocean
  // Mapterhorn has nothing below z5, so a z14 tile there is cut from z4.
  for (let levels = 1; levels <= tile.z; levels++) {
    const up = ancestorTile(tile, levels);
    if (!up) break;
    const found = await fetchTile(up);
    if (found === MISSING) continue;
    if (!found) return null;
    const cut = await run({ from: { heights: found.heights, size: found.width }, tile, levels });
    return cut === MISSING ? null : cut;
  }
  return null;
}

/**
 * Fetch, decode, clamp and despike a terrarium tile — once per tile address,
 * however many callers ask for it — or cut it from the nearest ancestor
 * Mapterhorn has, where it has none at that depth.
 *
 * Deliberately does not thread a per-caller `AbortSignal` into the fetch:
 * the promise it returns may already be shared with another, unrelated
 * caller, and aborting it out from under that caller would be worse than
 * the bandwidth an abandoned fetch occasionally wastes.
 */
export function getCleanedTerrariumTile(tile: TileAddress): Promise<CleanedTerrariumTile | null> {
  return cached(resolved, keyOf(tile), () => loadTile(tile));
}
