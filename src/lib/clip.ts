import { AutoTokenizer, AutoProcessor, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage, env } from '@xenova/transformers';

// Local CLIP dual encoder — the same Xenova/clip-vit-base-patch32 weights
// genre.ts already downloads for zero-shot genre classification, used here
// for what CLIP is actually for: an image embedding and a text embedding in
// one shared 512-d space, L2-normalised, comparable by dot product.
//
// genre.ts's `zero-shot-image-classification` pipeline only scores an image
// against a fixed list of candidate label strings — there's no way to get a
// general-purpose embedding out of it for an arbitrary image, let alone
// embed an arbitrary text query into the same space. That needs the actual
// dual encoders (`CLIPTextModelWithProjection` / `CLIPVisionModelWithProjection`,
// the `text_model`/`vision_model` ONNX weights in the same HF repo) called
// directly instead of through `pipeline()`. Verified against real photos and
// plausible/implausible captions before trusting this file — see the issue.
env.allowLocalModels = false;

const MODEL_ID = 'Xenova/clip-vit-base-patch32';

let tokenizerP: Promise<any> | null = null;
let processorP: Promise<any> | null = null;
let textModelP: Promise<any> | null = null;
let visionModelP: Promise<any> | null = null;
const getTokenizer = () => (tokenizerP ??= AutoTokenizer.from_pretrained(MODEL_ID));
const getProcessor = () => (processorP ??= AutoProcessor.from_pretrained(MODEL_ID));
const getTextModel = () => (textModelP ??= CLIPTextModelWithProjection.from_pretrained(MODEL_ID));
const getVisionModel = () => (visionModelP ??= CLIPVisionModelWithProjection.from_pretrained(MODEL_ID));

/** L2-normalise, 5dp — same rounding as embed.ts, for the same reason (keeps
 *  photos.json small; only the direction of the vector carries the signal,
 *  and it's already unit length). */
function normalize(data: Float32Array | number[]): number[] {
  let n = 0;
  for (const x of data) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(data, (x) => Math.round((x / n) * 1e5) / 1e5);
}

export async function clipEmbedBuffer(buf: Buffer): Promise<number[]> {
  const [processor, visionModel] = await Promise.all([getProcessor(), getVisionModel()]);
  const img = await RawImage.fromBlob(new Blob([new Uint8Array(buf)]));
  const inputs = await processor(img);
  const { image_embeds } = await visionModel(inputs);
  return normalize(image_embeds.data as Float32Array);
}

export async function clipEmbedPath(p: string): Promise<number[]> {
  const [processor, visionModel] = await Promise.all([getProcessor(), getVisionModel()]);
  const img = await RawImage.read(p);
  const inputs = await processor(img);
  const { image_embeds } = await visionModel(inputs);
  return normalize(image_embeds.data as Float32Array);
}

/** Embed a free-text query into the same space as clipEmbedBuffer/clipEmbedPath. */
export async function clipEmbedText(query: string): Promise<number[]> {
  const [tokenizer, textModel] = await Promise.all([getTokenizer(), getTextModel()]);
  const inputs = tokenizer([query], { padding: true, truncation: true });
  const { text_embeds } = await textModel(inputs);
  return normalize(text_embeds.data as Float32Array);
}

/** Warm the whole pipeline up front (optional). */
export const warmClip = () => Promise.all([getTokenizer(), getProcessor(), getTextModel(), getVisionModel()]);
