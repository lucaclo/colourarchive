/**
 * Fetches, decodes and cleans terrarium elevation tiles off the main thread,
 * for `terrarium-tile.ts`. The heights and the raw bytes are transferred
 * back, not copied, as is the cleaned picture when there is one.
 */
import { cleanTerrariumBytes, type WorkerReply } from './terrarium-tile';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; url: string }>) => void) | null;
  postMessage: (message: WorkerReply, transfer?: Transferable[]) => void;
};

scope.onmessage = async (e) => {
  const { id, url } = e.data;
  // Safari's workers gained OffscreenCanvas later than its pages did.
  if (typeof OffscreenCanvas === 'undefined') {
    scope.postMessage({ id, ok: false, unsupported: true });
    return;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const tile = await cleanTerrariumBytes(await response.arrayBuffer(), true);
    const transfer: Transferable[] = [tile.heights.buffer as ArrayBuffer, tile.raw];
    if (tile.bitmap) transfer.push(tile.bitmap);
    scope.postMessage({ id, ok: true, tile }, transfer);
  } catch {
    scope.postMessage({ id, ok: false });
  }
};
