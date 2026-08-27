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
 */

import {
  clampImplausibleElevation,
  decodeTerrariumTile,
  despikeHeights,
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
 */
export function terrariumCanvasContext(
  width: number,
  height: number,
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height).getContext('2d');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
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

async function fetchAndClean(tile: TileAddress): Promise<CleanedTerrariumTile | null> {
  try {
    const response = await fetch(terrariumTileUrl(tile));
    if (!response.ok) return null;
    const raw = await response.arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([raw]));
    const { width, height } = bitmap;

    const context = terrariumCanvasContext(width, height);
    if (!context) return null;
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
    return { width, height, heights: cleaned, raw, changed };
  } catch {
    // A tile that will not load is a patch of unknown ground, which
    // `loadHeightField` counts and reports. It is not a page error.
    return null;
  }
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
