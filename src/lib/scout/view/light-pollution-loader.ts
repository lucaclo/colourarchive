/**
 * Fetch and decode the bundled light-pollution raster: `light-pollution.ts`
 * on the page, the same split `terrain-shadows.ts` makes for elevation —
 * everything that needs a network and a canvas lives here, everything that
 * needs testing lives in the pure module.
 *
 * One static asset for the whole session, not a per-viewport tile set: light
 * pollution does not move with the map the way elevation does, so this is
 * fetched once and cached for the page's lifetime rather than re-requested
 * per bounds.
 */

import type { LightPollutionField } from '../light-pollution';

const ASSET_URL = '/data/light-pollution.png';

let cached: Promise<LightPollutionField | null> | null = null;

/**
 * A missing or blocked asset resolves to null rather than rejecting — the
 * caller's answer is then "no light-pollution data", the same honest gap
 * `galactic.ts` already reports when nothing at all is known about the sky,
 * not a page error over an optional refinement.
 */
export function loadLightPollution(): Promise<LightPollutionField | null> {
  if (!cached) cached = decode();
  return cached;
}

async function decode(): Promise<LightPollutionField | null> {
  try {
    const response = await fetch(ASSET_URL);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const { width, height } = bitmap;

    let context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
    if (typeof OffscreenCanvas !== 'undefined') {
      context = new OffscreenCanvas(width, height).getContext('2d');
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      context = canvas.getContext('2d');
    }
    if (!context) return null;

    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const pixels = context.getImageData(0, 0, width, height);

    // The bundled PNG is single-channel, but a canvas always hands back
    // RGBA regardless of the source depth — R, G and B are identical here,
    // so only every fourth byte is actually a class value.
    const zones = new Uint8Array(width * height);
    for (let i = 0; i < zones.length; i++) zones[i] = pixels.data[i * 4];

    return { width, height, zones };
  } catch {
    return null;
  }
}
