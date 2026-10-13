/**
 * Fetches and decodes the light-pollution raster off the main thread, for
 * `light-pollution-loader.ts`. Reading back its pixels was 0.2 s of a cold
 * Scout load on the main thread. The class values are transferred, not copied.
 */
import { decodeZones } from './light-pollution-loader';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ url: string }>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

scope.onmessage = async (e) => {
  // Safari's workers gained OffscreenCanvas later than its pages did.
  if (typeof OffscreenCanvas === 'undefined') {
    scope.postMessage({ ok: false, unsupported: true });
    return;
  }
  const field = await decodeZones(e.data.url);
  if (!field) scope.postMessage({ ok: false });
  else scope.postMessage({ ok: true, field }, [field.zones.buffer as ArrayBuffer]);
};
