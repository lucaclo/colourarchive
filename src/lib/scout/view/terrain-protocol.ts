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
 * so the tile is intercepted here instead: cleaned, then re-encoded back
 * into a real terrarium PNG, entirely client-side, before being handed back
 * as this protocol's response. `TERRAIN_SOURCE`'s own tile URL template
 * points at this scheme rather than at AWS directly — see `page.ts`.
 *
 * Re-encoding only happens when cleaning actually changed something. Bad
 * pixels are rare — most tiles decode, get checked, and are found to need no
 * repair at all — so the overwhelming majority of tiles skip straight back
 * to the bytes they were fetched as, with no canvas write-back or PNG
 * re-compression paid for a tile MapLibre would have decoded to the exact
 * same picture either way.
 */

import type MapLibreGL from 'maplibre-gl';
import { encodeTerrarium } from '../terrain';
import { getCleanedTerrariumTile, terrariumCanvasContext } from './terrarium-tile';

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

    const { width, height, heights } = cleaned;
    const context = terrariumCanvasContext(width, height);
    if (!context) throw new Error('no 2d canvas context available to clean a terrain tile');

    const image = context.createImageData(width, height);
    for (let i = 0; i < heights.length; i++) {
      const [r, g, b] = encodeTerrarium(heights[i]);
      const p = i * 4;
      image.data[p] = r;
      image.data[p + 1] = g;
      image.data[p + 2] = b;
      // `createImageData` defaults alpha to 0 (fully transparent), unlike
      // the source PNG it is standing in for. MapLibre never reads alpha for
      // a raster-dem source, but a transparent PNG is still the wrong thing
      // to write to a tile that is meant to be opaque.
      image.data[p + 3] = 255;
    }
    context.putImageData(image, 0, 0);

    const canvas = context.canvas;
    const blob =
      canvas instanceof OffscreenCanvas
        ? await canvas.convertToBlob({ type: 'image/png' })
        : await new Promise<Blob>((resolve, reject) =>
            (canvas as HTMLCanvasElement).toBlob(
              (b) => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))),
              'image/png',
            ),
          );
    return { data: await blob.arrayBuffer() };
  });
}
