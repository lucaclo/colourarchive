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
 * `despikeHeights` (`terrain.ts`) already exists for exactly this — it is
 * what `terrain-shadows.ts` runs its own decoded tiles through — but that
 * pipeline feeds a private canvas this app draws itself, never MapLibre's
 * own terrain mesh. There is no hook to post-process a `raster-dem` source's
 * pixels before MapLibre decodes them for rendering, so the tile is
 * intercepted here instead: fetched, decoded, despiked and re-encoded back
 * into a real terrarium PNG, entirely client-side, before being handed back
 * as this protocol's response. `TERRAIN_SOURCE`'s own tile URL template
 * points at this scheme rather than at AWS directly — see `page.ts`.
 */

import type MapLibreGL from 'maplibre-gl';
import { clampImplausibleElevation, decodeTerrarium, despikeHeights, encodeTerrarium } from '../terrain';

/** The scheme `TERRAIN_SOURCE`'s tile URL template uses. */
export const DESPIKED_TERRAIN_PROTOCOL = 'scout-terrarium';

const REAL_TILE_URL = (z: string, x: string, y: string) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

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

  maplibregl.addProtocol(DESPIKED_TERRAIN_PROTOCOL, async (params, abortController) => {
    const match = /(\d+)\/(-?\d+)\/(-?\d+)\.png$/.exec(params.url);
    if (!match) throw new Error(`unrecognised terrarium tile url: ${params.url}`);
    const [, z, x, y] = match;

    const response = await fetch(REAL_TILE_URL(z, x, y), { signal: abortController.signal });
    if (!response.ok) throw new Error(`terrarium tile ${z}/${x}/${y}: HTTP ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    const { width, height } = bitmap;

    // `OffscreenCanvas` where it exists, a detached DOM canvas where it does
    // not — the same split `terrain-shadows.ts`'s own tile decode already
    // makes, for the same Safari reason.
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(width, height);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!context) throw new Error('no 2d canvas context available to clean a terrain tile');

    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    const image = context.getImageData(0, 0, width, height);
    const heights = new Float32Array(width * height);
    for (let i = 0; i < heights.length; i++) {
      const p = i * 4;
      heights[i] = decodeTerrarium(image.data[p], image.data[p + 1], image.data[p + 2]);
    }
    // The absolute clamp runs first — see `clampImplausibleElevation` — so a
    // wide, smoothly-interpolated bad region collapses toward sea level
    // before the local despike has to reason about what is left of it.
    const cleaned = despikeHeights(clampImplausibleElevation(heights), width);
    for (let i = 0; i < cleaned.length; i++) {
      const [r, g, b] = encodeTerrarium(cleaned[i]);
      const p = i * 4;
      image.data[p] = r;
      image.data[p + 1] = g;
      image.data[p + 2] = b;
      // Alpha (p + 3) is untouched — terrarium tiles are opaque, and MapLibre
      // never reads it for a raster-dem source.
    }
    context.putImageData(image, 0, 0);

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
