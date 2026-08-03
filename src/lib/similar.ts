import type { Photo } from './types';
import type { OKLCH } from './color';

// Similarity, split into two independent axes so the UI slider can blend them:
//   • composition = DINOv2 embedding (subject/scene + structure) + tonal layout
//     (where light/dark sit) + aspect (orientation).
//   • colour      = colour-layout grid (where hues sit) + dominant colour.
// Both are returned min-max-normalised to [0,1] over the candidate set (0 =
// closest), so the client can compute final = (1-w)·comp + w·colour and re-rank
// live as the slider moves.

const dot = (a: number[], b: number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const toLab = (o: OKLCH): [number, number, number] => {
  const r = (o.H * Math.PI) / 180;
  return [o.L, o.C * Math.cos(r), o.C * Math.sin(r)];
};

export interface SimRow { photo: Photo; comp: number; col: number; }

export function rankSimilar(ref: Photo, candidates: Photo[]): SimRow[] {
  const raw = candidates.map((c) => {
    // Embedding distance (0 identical … 2 opposite); large if either missing.
    let embDist = 2;
    if (ref.embedding && c.embedding && ref.embedding.length === c.embedding.length) {
      embDist = 1 - dot(ref.embedding, c.embedding);
    }
    // Tonal + colour layout from the 4x4 OKLab grid.
    let toneDist = 0, colLayout = 0;
    if (ref.colourGrid && c.colourGrid && ref.colourGrid.length === c.colourGrid.length) {
      for (let i = 0; i < 16; i++) {
        const dL = ref.colourGrid[i * 3] - c.colourGrid[i * 3];
        const da = ref.colourGrid[i * 3 + 1] - c.colourGrid[i * 3 + 1];
        const db = ref.colourGrid[i * 3 + 2] - c.colourGrid[i * 3 + 2];
        toneDist += dL * dL;
        colLayout += da * da + db * db;
      }
      toneDist = Math.sqrt(toneDist);
      colLayout = Math.sqrt(colLayout);
    }
    // Orientation.
    const arRef = ref.height / (ref.width || 1);
    const arC = c.height / (c.width || 1);
    const aspectDist = Math.abs(Math.log((arC || 1) / (arRef || 1)));
    // Dominant colour.
    const dr = toLab(ref.oklch), dc = toLab(c.oklch);
    const domDist = Math.hypot(dr[0] - dc[0], dr[1] - dc[1], dr[2] - dc[2]);

    return {
      photo: c,
      compRaw: 0.6 * embDist + 0.25 * toneDist + 0.15 * aspectDist,
      colRaw: 0.65 * colLayout + 0.35 * domDist,
    };
  });

  const norm = (vals: number[]) => {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const d = hi - lo || 1;
    return (v: number) => (v - lo) / d;
  };
  const nc = norm(raw.map((r) => r.compRaw));
  const nk = norm(raw.map((r) => r.colRaw));
  return raw.map((r) => ({ photo: r.photo, comp: nc(r.compRaw), col: nk(r.colRaw) }));
}
