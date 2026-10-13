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
  if (!cached) cached = decodeInWorker().then((field) => field ?? decodeZones(ASSET_URL));
  return cached;
}

/** The worker's answer, or undefined when the main thread has to do it. */
function decodeInWorker(): Promise<LightPollutionField | null | undefined> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./light-pollution.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(undefined);
      return;
    }
    worker.onmessage = (e: MessageEvent<{ ok: boolean; unsupported?: boolean; field?: LightPollutionField }>) => {
      worker.terminate();
      resolve(e.data.ok ? e.data.field : e.data.unsupported ? undefined : null);
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(undefined);
    };
    worker.postMessage({ url: new URL(ASSET_URL, location.href).href });
  });
}

/** Fetch and decode, wherever it runs: a worker, or this page as the fallback. */
export async function decodeZones(url: string): Promise<LightPollutionField | null> {
  try {
    const response = await fetch(url);
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
