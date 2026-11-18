/**
 * Esri's World Imagery, without its grey "Map data not yet available" squares.
 *
 * Esri answers HTTP 200 with a 2,521-byte grey JPEG wherever it has no imagery
 * at the zoom asked for, which is z18–19 over much of Patagonia and the
 * Sahara. That placeholder is recognised by its size and the tile is cut from
 * the nearest ancestor that has imagery, up to eight zooms up, its quadrant
 * cropped and scaled up to 256 px on a canvas: a softer patch of real ground
 * instead of a grey square with words on it. A failed fetch does the same.
 *
 * Not `blankTile=false`, though Esri then answers 404 instead: its 404 carries
 * no CORS header, so every missing tile logged a CORS error and a failed
 * request in the console (84 of them on one Patagonia view). Should Esri ever
 * change the placeholder, the worst case is the grey squares coming back.
 *
 * The source keeps its maxzoom of 19; only the tiles Esri lacks are filled.
 * Registered the way `terrain-protocol.ts` is, and for the same reason it
 * takes the caller's `maplibregl` rather than importing the library.
 */

import type MapLibreGL from 'maplibre-gl';
import { ancestorTile, quadrantIn, type PixelSquare, type TileAddress } from '../terrain';
import { terrariumCanvasContext } from './terrarium-tile';

/** The scheme the satellite source's tile URL template uses. */
export const SATELLITE_PROTOCOL = 'scout-satellite';

/** The satellite source's tile URL template — see `page.ts`. */
export const SATELLITE_TILES = `${SATELLITE_PROTOCOL}://World_Imagery/{z}/{x}/{y}`;

/** Esri's tiles are 256 px. */
const SIZE = 256;

/** How far up to look for imagery before giving up on a tile. */
const MAX_ANCESTOR_LEVELS = 8;

/** The byte length of Esri's grey placeholder, measured November 2026. */
const ESRI_PLACEHOLDER_BYTES = 2521;

/** Esri's tile. Note: row before column. */
export const esriTileUrl = (t: TileAddress): string =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${t.z}/${t.y}/${t.x}`;

/** Esri's grey "Map data not yet available" tile. */
export const isEsriPlaceholder = (bytes: ArrayBuffer): boolean => bytes.byteLength === ESRI_PLACEHOLDER_BYTES;

/** A tile's imagery as fetched, or null where there is none to be had. */
export type ImageryFetch = (tile: TileAddress) => Promise<ArrayBuffer | null>;

/** One tile from Esri. Never throws. */
export const fetchEsriTile: ImageryFetch = async (tile) => {
  try {
    const response = await fetch(esriTileUrl(tile));
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    return isEsriPlaceholder(bytes) ? null : bytes;
  } catch {
    // Offline, or Esri unreachable: an ancestor may still be in the cache.
    return null;
  }
};

export interface FoundImagery {
  bytes: ArrayBuffer;
  /** How many zooms up it was found; 0 is the tile itself. */
  levels: number;
  from: TileAddress;
}

/** The tile itself if there is imagery for it, else its nearest ancestor that has some. */
export async function findImagery(
  tile: TileAddress,
  fetchTile: ImageryFetch,
  maxLevels = MAX_ANCESTOR_LEVELS,
): Promise<FoundImagery | null> {
  for (let levels = 0; levels <= maxLevels; levels++) {
    const from = ancestorTile(tile, levels);
    if (!from) break;
    const bytes = await fetchTile(from);
    if (bytes) return { bytes, levels, from };
  }
  return null;
}

/**
 * What Esri has at each address, ancestors included, so the four tiles cut
 * from one ancestor fetch it once. JPEGs of 10–25 kB, so a few megabytes.
 */
const CACHE_LIMIT = 512;
const cache = new Map<string, Promise<ArrayBuffer | null>>();

const cachedEsriTile: ImageryFetch = (tile) => {
  const key = `${tile.z}/${tile.x}/${tile.y}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const work = fetchEsriTile(tile);
  cache.set(key, work);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return work;
};

/** An ancestor's quadrant, scaled up to a whole tile. */
async function cutFromAncestor(bytes: ArrayBuffer, square: PixelSquare): Promise<ImageBitmap> {
  const image = await createImageBitmap(new Blob([bytes]));
  const context = terrariumCanvasContext(SIZE, SIZE);
  if (!context) throw new Error('no 2d canvas context to cut a satellite tile');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, square.x, square.y, square.size, square.size, 0, 0, SIZE, SIZE);
  image.close?.();
  return createImageBitmap(context.canvas);
}

let registered = false;

/** Registers the protocol, once per page however many times this is called. */
export function registerSatelliteProtocol(maplibregl: typeof MapLibreGL): void {
  if (registered) return;
  registered = true;

  maplibregl.addProtocol(SATELLITE_PROTOCOL, async (params) => {
    const match = params.url.match(/(\d+)\/(\d+)\/(\d+)$/);
    if (!match) throw new Error(`unrecognised satellite tile url: ${params.url}`);
    const tile = { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };

    const found = await findImagery(tile, cachedEsriTile);
    if (!found) throw new Error(`satellite tile ${tile.z}/${tile.x}/${tile.y}: no imagery`);
    // Esri has it: the bytes as sent, no canvas involved.
    if (found.levels === 0) return { data: found.bytes };
    return { data: await cutFromAncestor(found.bytes, quadrantIn(tile, found.levels, SIZE)) };
  });
}
