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

// Raw cosine scores can't say "no match". CLIP rates every photograph
// 0.18–0.30 against any text, nonsense included ("zzzqqq" topped out at
// 0.23, a real "temple" at 0.30, a real "people" at 0.23), so a search that
// kept every ranked row hid nothing and one with a fixed floor hid the
// wrong things. What does separate them is how much more a photo looks like
// "a photo of <query>" than like "a photo" at all: on this archive nonsense
// and absent subjects (no dogs) lift a photo by under 0.01, real subjects by
// 0.03–0.08.

/** CLIP's own prompt shape; a bare word embeds noticeably worse. */
export const queryPrompt = (q: string): string => `a photo of ${q.trim().replace(/[.\s]+$/, '')}.`;
export const BASELINE_PROMPT = 'a photo.';

/** Below this lift nothing is a match. */
export const MIN_LIFT = 0.014;
/** Within a query, keep what lifts at least half as far as the best. */
export const LIFT_SHARE = 0.5;

export interface LiftRow {
  photo: Photo;
  /** Similarity to the query prompt minus similarity to the baseline. */
  lift: number;
}

/**
 * The photos that answer `queryEmbedding`, best first, judged by lift over
 * `baselineEmbedding`. Empty when nothing stands out — the honest answer to
 * a query about something the archive doesn't hold.
 */
export function relevantByLift(queryEmbedding: number[], baselineEmbedding: number[], candidates: Photo[]): LiftRow[] {
  const rows: LiftRow[] = [];
  for (const photo of candidates) {
    const v = photo.clipEmbedding;
    if (!v || v.length !== queryEmbedding.length || v.length !== baselineEmbedding.length) continue;
    rows.push({ photo, lift: dot(queryEmbedding, v) - dot(baselineEmbedding, v) });
  }
  rows.sort((a, b) => b.lift - a.lift);
  if (!rows.length) return rows;
  const cut = Math.max(MIN_LIFT, rows[0].lift * LIFT_SHARE);
  return rows.filter((r) => r.lift >= cut);
}
