import { pipeline, env, RawImage } from '@xenova/transformers';

// Local vision-embedding model (DINOv2-small): a 384-d visual fingerprint that
// captures subject + composition. Loaded once, lazily. Fully offline after the
// first download. Used for the "find similar" feature.
env.allowLocalModels = false;

let extractorP: Promise<any> | null = null;
const getExtractor = () => (extractorP ??= pipeline('image-feature-extraction', 'Xenova/dinov2-small'));

/** Mean-pool token embeddings [T,H] -> [H], then L2-normalise. */
function poolNormalize(out: any): number[] {
  const dims = out.dims as number[];
  const data = out.data as Float32Array;
  const H = dims[dims.length - 1];
  const T = data.length / H;
  const v = new Float64Array(H);
  for (let t = 0; t < T; t++) for (let h = 0; h < H; h++) v[h] += data[t * H + h];
  let n = 0;
  for (let h = 0; h < H; h++) { v[h] /= T; n += v[h] * v[h]; }
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => Math.round((x / n) * 1e5) / 1e5); // 5-dp keeps files small
}

export async function embedBuffer(buf: Buffer): Promise<number[]> {
  const extractor = await getExtractor();
  const img = await RawImage.fromBlob(new Blob([new Uint8Array(buf)]));
  return poolNormalize(await extractor(img));
}

export async function embedPath(p: string): Promise<number[]> {
  const extractor = await getExtractor();
  return poolNormalize(await extractor(p));
}

/** Warm the model up front (optional). */
export const warmEmbed = () => getExtractor();
