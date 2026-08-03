import { pipeline, env, RawImage } from '@xenova/transformers';
import type { Genre } from './types';
import { GENRES } from './types';

// Local zero-shot genre classifier (CLIP). Given a photo, score it against a
// small set of natural-language prompts and pick the best-matching genre.
// Runs entirely on this machine, offline after the first model download —
// same footprint as the DINOv2 embedder used for "find similar".
env.allowLocalModels = false;

let clfP: Promise<any> | null = null;
const getClassifier = () =>
  (clfP ??= pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32'));

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
const LABELS = PROMPTS.map((p) => p.text);

function pickGenre(results: Array<{ label: string; score: number }>): Genre {
  const totals = new Map<Genre, number>(GENRES.map((g) => [g, 0]));
  for (const r of results) {
    const hit = PROMPTS.find((p) => p.text === r.label);
    if (hit) totals.set(hit.genre, (totals.get(hit.genre) ?? 0) + r.score);
  }
  let best: Genre = 'street';
  let bestScore = -Infinity;
  for (const g of GENRES) {
    const s = totals.get(g) ?? 0;
    if (s > bestScore) { bestScore = s; best = g; }
  }
  return best;
}

export async function classifyGenreBuffer(buf: Buffer): Promise<Genre> {
  const clf = await getClassifier();
  const img = await RawImage.fromBlob(new Blob([new Uint8Array(buf)]));
  const out = await clf(img, LABELS);
  return pickGenre(out as Array<{ label: string; score: number }>);
}

export async function classifyGenrePath(p: string): Promise<Genre> {
  const clf = await getClassifier();
  const out = await clf(p, LABELS);
  return pickGenre(out as Array<{ label: string; score: number }>);
}

/** Warm the model up front (optional). */
export const warmGenre = () => getClassifier();
