/**
 * A MapLibre protocol that cleans the terrarium DEM tiles feeding the native
 * 3D terrain mesh before MapLibre ever sees them.
 *
 * The AWS-hosted terrarium tileset (`elevation-tiles-prod`) is otherwise
 * excellent and free, but is not curated: individual pixels — mostly over
 * water — occasionally decode to elevations hundreds or thousands of metres
 * from anything nearby (-1223 m, -547 m, -258 m, all found within one small
 * Icelandic bay's worth of tiles). MapLibre's own terrain renderer has no
 * sanity check of its own, so one bad pixel becomes a needle spiking out of
 * a calm fjord in the middle of an otherwise flat 3D scene.
 *
 * The fetch, decode, clamp and despike all live in `terrarium-tile.ts` now,
 * shared with `terrain-shadows.ts` — that pipeline used to be duplicated
 * here, which meant a tile both this protocol and the landform overlay
 * wanted got fetched and despiked twice. There is no hook to post-process a
 * `raster-dem` source's pixels before MapLibre decodes them for rendering,
 * so the tile is intercepted here instead and cleaned, entirely client-side,
 * before being handed back as this protocol's response. `TERRAIN_SOURCE`'s own tile URL template
 * points at this scheme rather than at AWS directly — see `page.ts`.
 *
 * A tile cleaning left untouched goes back as the bytes it was fetched as.
 * One it changed goes back as an ImageBitmap, which MapLibre accepts from a
 * protocol directly, so it is never re-compressed to PNG only to be decoded
 * again (that encode alone cost over half a second across one zoom).
 */

import type MapLibreGL from 'maplibre-gl';
import { getCleanedTerrariumTile, terrariumImageData } from './terrarium-tile';

/** The scheme `TERRAIN_SOURCE`'s tile URL template uses. */
export const DESPIKED_TERRAIN_PROTOCOL = 'scout-terrarium';

let registered = false;

/**
 * Registers the protocol, once per page however many times this is called.
 *
 * Takes the caller's own already-loaded `maplibregl` module rather than
 * importing it here: this file must never statically import 'maplibre-gl'
 * itself, or it would drag the library back into the eager bundle the
 * dynamic `import('maplibre-gl')` in `page.ts` exists to keep it out of.
 */
export function registerDespikedTerrainProtocol(maplibregl: typeof MapLibreGL): void {
  if (registered) return;
  registered = true;

  maplibregl.addProtocol(DESPIKED_TERRAIN_PROTOCOL, async (params) => {
    const match = /(\d+)\/(-?\d+)\/(-?\d+)\.png$/.exec(params.url);
    if (!match) throw new Error(`unrecognised terrarium tile url: ${params.url}`);
    const [, z, x, y] = match;

    const cleaned = await getCleanedTerrariumTile({ z: Number(z), x: Number(x), y: Number(y) });
    if (!cleaned) throw new Error(`terrarium tile ${z}/${x}/${y}: failed to load`);

    // The common case: nothing needed fixing, so the tile MapLibre gets is
    // exactly the tile AWS sent — no canvas draw, no re-compression.
    if (!cleaned.changed) return { data: cleaned.raw };

    // Cleaned: hand MapLibre the picture itself, which it takes directly,
    // rather than re-encoding a PNG for it to decode again. The worker made
    // one; a tile asked for again (or cleaned without a worker) builds its own.
    const ready = cleaned.bitmap;
    cleaned.bitmap = null;
    const bitmap = ready ?? (await createImageBitmap(terrariumImageData(cleaned.heights, cleaned.width, cleaned.height)));
    return { data: bitmap };
  });
}
