import type { Genre } from './types';
import { GENRES } from './types';
import { clipEmbedBuffer, clipEmbedPath, clipEmbedText, warmClip } from './clip';

// Local zero-shot genre classifier, built on the *same* CLIP dual encoder as
// clip.ts's embeddings (find-similar, style-match) rather than a second copy
// of the model loaded through transformers.js's `zero-shot-image-classification`
// pipeline. That pipeline and clip.ts's `CLIPVisionModelWithProjection` both
// resolve to the identical Xenova/clip-vit-base-patch32 vision weights, so
// running both on the same photo — which ingest.ts always does, since every
// photo gets both a CLIP embedding and a genre — paid for the vision forward
// pass twice. Scoring the embedding CLIP already computed against a handful
// of cached text embeddings is arithmetic, not inference: no second model,
// no second pass.

// Several phrasings per genre, so the match is robust to how CLIP reads a
// scene. Each prompt maps back to one genre; we sum scores per genre and take
// the winner. Order/values are deterministic.
const PROMPTS: Array<{ text: string; genre: Genre }> = [
  { text: 'a candid street photograph of people in a city', genre: 'street' },
  { text: 'a documentary street scene with pedestrians', genre: 'street' },
  { text: 'a close-up portrait of a person', genre: 'portrait' },
  { text: "a portrait photograph focused on someone's face", genre: 'portrait' },
  { text: 'a scenic landscape of nature, mountains or the sea', genre: 'landscape' },
  { text: 'a wide outdoor landscape with sky and horizon', genre: 'landscape' },
  { text: 'a photograph of a building or architecture', genre: 'architecture' },
  { text: 'architectural details of a structure or facade', genre: 'architecture' },
];

let promptsP: Promise<Array<{ vec: number[]; genre: Genre }>> | null = null;
const getPrompts = () =>
  (promptsP ??= Promise.all(PROMPTS.map(async (p) => ({ vec: await clipEmbedText(p.text), genre: p.genre }))));

// CLIP's own trained temperature (its logit_scale parameter exponentiates to
// ~100 for this checkpoint) — matches what the zero-shot pipeline this
// replaces applied before summing, so swapping the implementation doesn't
// silently change which genre wins on a borderline photo.
const LOGIT_SCALE = 100;

function softmax(scores: number[]): number[] {
  const scaled = scores.map((s) => s * LOGIT_SCALE);
  const max = Math.max(...scaled);
  const exps = scaled.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** Classify genre from a CLIP image embedding already computed elsewhere
 *  (clipEmbedBuffer/clipEmbedPath) — the common case, since ingest.ts always
 *  needs both. No model call: cosine similarity against cached prompt
 *  embeddings, softmaxed and summed per genre exactly as the old pipeline did. */
export async function classifyGenreFromEmbedding(embedding: number[]): Promise<Genre> {
  const prompts = await getPrompts();
  const sims = prompts.map((p) => p.vec.reduce((s, v, i) => s + v * embedding[i], 0));
  const probs = softmax(sims);
  const totals = new Map<Genre, number>(GENRES.map((g) => [g, 0]));
  prompts.forEach((p, i) => totals.set(p.genre, (totals.get(p.genre) ?? 0) + probs[i]));
  let best: Genre = 'street';
  let bestScore = -Infinity;
  for (const g of GENRES) {
    const s = totals.get(g) ?? 0;
    if (s > bestScore) { bestScore = s; best = g; }
  }
  return best;
}

/** Convenience for callers with no embedding on hand yet (e.g. the backfill
 *  script). Prefer classifyGenreFromEmbedding when one already exists. */
export async function classifyGenreBuffer(buf: Buffer): Promise<Genre> {
  return classifyGenreFromEmbedding(await clipEmbedBuffer(buf));
}

export async function classifyGenrePath(p: string): Promise<Genre> {
  return classifyGenreFromEmbedding(await clipEmbedPath(p));
}

/** Warm the CLIP encoder + prompt embeddings up front (optional). */
export const warmGenre = () => Promise.all([warmClip(), getPrompts()]);
