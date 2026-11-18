/**
 * Fetches, decodes and cleans terrarium elevation tiles off the main thread,
 * for `terrarium-tile.ts`, and cuts the tiles Mapterhorn does not have from
 * an ancestor's heights. The heights and the raw bytes are transferred back,
 * not copied, as is the cleaned picture when there is one.
 */
import { MISSING, runTerrariumJob, type TerrariumJob, type WorkerReply } from './terrarium-tile';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; job: TerrariumJob }>) => void) | null;
  postMessage: (message: WorkerReply, transfer?: Transferable[]) => void;
};

scope.onmessage = async (e) => {
  const { id, job } = e.data;
  // Safari's workers gained OffscreenCanvas later than its pages did.
  if (typeof OffscreenCanvas === 'undefined') {
    scope.postMessage({ id, ok: false, unsupported: true });
    return;
  }
  const tile = await runTerrariumJob(job);
  if (tile === MISSING) {
    scope.postMessage({ id, ok: false, missing: true });
    return;
  }
  if (!tile) {
    scope.postMessage({ id, ok: false });
    return;
  }
  const transfer: Transferable[] = [tile.heights.buffer as ArrayBuffer, tile.raw];
  if (tile.bitmap) transfer.push(tile.bitmap);
  scope.postMessage({ id, ok: true, tile }, transfer);
};
