/**
 * Shared plumbing for the AWS terrarium DEM tileset.
 *
 * Two consumers need the same real elevation, cleaned the same way: the 3D
 * terrain mesh (`terrain-protocol.ts`) and the landform shadow overlay
 * (`terrain-shadows.ts`). Before this existed they each fetched, decoded,
 * clamped and despiked their own copy of every tile — twice the network,
 * twice the despike pass, on any view where both happened to want the same
 * tile — and each hand-rolled the same AWS URL and the same
 * `OffscreenCanvas`-or-detached-canvas fallback (Safari only gained the
 * former recently, and this has to work on the iPad it was built for).
 *
 * `getCleanedTerrariumTile` is the single place that fetch now happens: a
 * promise-cache keyed by tile address, so the second caller for a tile —
 * whether that is the other consumer or a re-request of a tile still in
 * view — gets the first caller's decode and despike for free rather than
 * paying for its own.
 *
 * The work itself runs in a worker (`terrarium.worker.ts`) wherever the
 * browser can draw to an OffscreenCanvas there. Profiling a zoom on the globe
 * put the decode's pixel readback at most of a second and a half of main-
 * thread time, the frames the map should have been drawing. Where a worker
 * can't do it, it runs here as before, on a canvas created for reading back,
 * which keeps its pixels in memory instead of on the GPU.
 */

import {
  clampImplausibleElevation,
  decodeTerrariumTile,
  despikeHeights,
  encodeTerrarium,
  type TileAddress,
} from '../terrain';

/** AWS Open Data's global 30 m elevation, the same tiles the 3D terrain uses. */
export const terrariumTileUrl = (t: TileAddress): string =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${t.z}/${t.x}/${t.y}.png`;

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
  /** The tile exactly as fetched, before any decoding. */
  raw: ArrayBuffer;
  /**
   * False when cleaning left every pixel exactly as it decoded — true for
   * the overwhelming majority of real tiles, since bad pixels are rare. The
   * 3D terrain protocol uses this to skip re-encoding a tile it did not
   * actually change (see that file's own comment on why that matters).
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
  const image = new ImageData(width, height);
  for (let i = 0; i < heights.length; i++) {
    const [r, g, b] = encodeTerrarium(heights[i]);
    const p = i * 4;
    image.data[p] = r;
    image.data[p + 1] = g;
    image.data[p + 2] = b;
    image.data[p + 3] = 255;
  }
  return image;
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
 * How many cleaned tiles the cache may hold at once.
 *
 * Roughly 8 field-loads' worth at the landform overlay's own 64-tile ceiling
 * (`terrain-shadows.ts`'s `MAX_TILES`): enough that revisiting a spot you
 * just left is still free, without pinning every place scouted this session
 * in memory.
 */
const CACHE_LIMIT = 8 * 64;

const cache = new Map<string, Promise<CleanedTerrariumTile | null>>();

async function fetchAndCleanHere(tile: TileAddress): Promise<CleanedTerrariumTile | null> {
  try {
    const response = await fetch(terrariumTileUrl(tile));
    if (!response.ok) return null;
    return await cleanTerrariumBytes(await response.arrayBuffer(), true);
  } catch {
    // A tile that will not load is a patch of unknown ground, which
    // `loadHeightField` counts and reports. It is not a page error.
    return null;
  }
}

/* ── The worker ──────────────────────────────────────────────────────────── */

/** What the worker answers with; see `terrarium.worker.ts`. */
export type WorkerReply =
  | { id: number; ok: true; tile: CleanedTerrariumTile }
  | { id: number; ok: false; unsupported?: boolean };

let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, { tile: TileAddress; resolve: (t: CleanedTerrariumTile | null) => void }>();

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
    const job = waiting.get(reply.id);
    if (!job) return;
    waiting.delete(reply.id);
    if (reply.ok) job.resolve(reply.tile);
    else if (reply.unsupported) {
      // No OffscreenCanvas in this browser's workers: do everything here.
      worker?.terminate();
      worker = null;
      void fetchAndCleanHere(job.tile).then(job.resolve);
    } else job.resolve(null);
  };
  worker.onerror = () => {
    // A worker that fails to start (an old browser, a blocked script) hands
    // everything it was given back to the main thread, and is not tried again.
    worker?.terminate();
    worker = null;
    for (const [, job] of waiting) void fetchAndCleanHere(job.tile).then(job.resolve);
    waiting.clear();
  };
  return worker;
}

function fetchAndClean(tile: TileAddress): Promise<CleanedTerrariumTile | null> {
  const w = terrariumWorker();
  if (!w) return fetchAndCleanHere(tile);
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, { tile, resolve });
    w.postMessage({ id, url: terrariumTileUrl(tile) });
  });
}

/**
 * Fetch, decode, clamp and despike a terrarium tile — once per tile address,
 * however many callers ask for it.
 *
 * Deliberately does not thread a per-caller `AbortSignal` into the fetch:
 * the promise it returns may already be shared with another, unrelated
 * caller, and aborting it out from under that caller would be worse than
 * the bandwidth an abandoned fetch occasionally wastes.
 */
export function getCleanedTerrariumTile(tile: TileAddress): Promise<CleanedTerrariumTile | null> {
  const key = `${tile.z}/${tile.x}/${tile.y}`;
  const cached = cache.get(key);
  if (cached) {
    // Touch: move to the end so the tiles actually still in use are the
    // ones that survive eviction, not just the ones fetched most recently.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const work = fetchAndClean(tile);
  cache.set(key, work);
  // Insertion order is eviction order: the least recently touched tile (see
  // the `get` above) goes first once the cache is over budget.
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return work;
}
