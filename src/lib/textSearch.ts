import type { Photo } from './types';

// Free-text search over the archive: rank photos by cosine similarity between
// their CLIP image embedding (`clipEmbedding`, computed once at ingest) and a
// CLIP text embedding of the query (computed per-request in the API route).
// Both are L2-normalised (see clip.ts), so cosine similarity is a plain dot
// product — same shape as `similar.ts`'s `dot()`, kept separate because this
// ranks against a single query vector, not a group of reference photos.

const dot = (a: number[], b: number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

export interface TextSearchRow {
  photo: Photo;
  score: number; // raw cosine similarity, -1..1 — NOT normalised over the candidate set (unlike similar.ts's 0..1 axes), so a query's absolute match quality stays comparable across requests
}

/**
 * Rank `candidates` by similarity to `queryEmbedding`. Candidates missing a
 * `clipEmbedding`, or carrying one of the wrong length, are left out of the
 * result entirely — there is no meaningful "distance" to report for a photo
 * that was never embedded, and silently scoring it 0 would rank it as a
 * so-so match instead of an unknown one. Sorted best-first.
 */
export function rankByTextQuery(queryEmbedding: number[], candidates: Photo[]): TextSearchRow[] {
  const rows: TextSearchRow[] = [];
  for (const photo of candidates) {
    const v = photo.clipEmbedding;
    if (!v || v.length !== queryEmbedding.length) continue;
    rows.push({ photo, score: dot(queryEmbedding, v) });
  }
  return rows.sort((a, b) => b.score - a.score);
}
