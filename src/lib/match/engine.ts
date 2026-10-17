import type { Calibration } from './calibration';
import { composeReference } from './composition';
import type { LrTables } from './lr-model';
import { refineSolution } from './refine';
import { solveMatch, type MatchSolution, type WeightedReference } from './solve';
import { mergeReferences } from './solve';
import { REGION_LABEL, type PhotoAnalysis } from './types';

// One match, end to end: put the reference in your photo's proportions, solve,
// then check the answer through the Lightroom model and correct it.
//
// Each step degrades gracefully. Without a pixel sample (an analysis cached
// before round 6) or without segmentation, composition is left alone; without
// the measured tables (the browser couldn't fetch them), the solver's own
// answer stands. The notes say which happened.

export interface EngineOptions {
  calibration?: Calibration;
  /** The measured Lightroom tables; null skips refinement. */
  tables?: LrTables | null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const label = (k: string) => (k === 'rest' ? 'everything else' : REGION_LABEL[k as keyof typeof REGION_LABEL].toLowerCase());

export function solveAndRefine(
  refs: PhotoAnalysis | WeightedReference[],
  mine: PhotoAnalysis,
  opts: EngineOptions = {},
): MatchSolution {
  const list: WeightedReference[] = Array.isArray(refs) ? refs : [{ analysis: refs, weight: 1 }];
  // Each reference is put in your photo's proportions before blending, and —
  // as Capture One's Match Look does — counts in proportion to how alike its
  // make-up is to yours, on top of any weight you gave it.
  const composedEach = list.map((r) => composeReference(r.analysis, mine));
  const likeness = composedEach.map((c) => (c ? Math.max(0.15, 1 - c.mismatch) ** 2 : 1));
  const weighted = list.map((r, i) => ({ analysis: composedEach[i]?.reference ?? r.analysis, weight: r.weight * likeness[i] }));
  const reference = weighted.length === 1 ? weighted[0].analysis : mergeReferences(weighted);
  const composed = list.length === 1 ? composedEach[0] : null;

  let solution = solveMatch(reference, mine, { calibration: opts.calibration });
  if (opts.tables) solution = refineSolution(solution, reference, mine, opts.tables, opts.calibration);

  if (composed && composed.mismatch >= 0.2) {
    const d = composed.differences[0];
    solution.notes.unshift({
      severity: 'info',
      panel: 'Overall',
      text:
        `The two photos are made of different things (${label(d.region)}: ${pct(d.reference)} of the reference, ${pct(d.mine)} of yours). ` +
        'The reference was read in your photo’s proportions, so you get its treatment of each kind of thing, not extra brightness or colour to make up for what isn’t in your frame.',
    });
  }
  if (list.length > 1 && composedEach.some(Boolean)) {
    const total = weighted.reduce((sum, r) => sum + r.weight, 0) || 1;
    const shares = weighted.map((r) => Math.round((r.weight / total) * 100));
    if (Math.max(...shares) - Math.min(...shares) >= 10) {
      solution.notes.unshift({
        severity: 'info',
        panel: 'Overall',
        text:
          `The references count by how alike they are to your photo: ${list.map((r, i) => `${r.analysis.filename.replace(/\.[^.]+$/, '')} ${shares[i]}%`).join(', ')}. ` +
          'Each one was also read in your photo’s proportions before they were blended.',
      });
    }
  }
  return solution;
}
