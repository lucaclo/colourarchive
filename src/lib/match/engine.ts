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
  const merged = Array.isArray(refs) ? mergeReferences(refs) : refs;
  // Composition needs one reference's pixels; a blend of several has none.
  const composed = !Array.isArray(refs) || refs.length === 1 ? composeReference(merged, mine) : null;
  const reference = composed?.reference ?? merged;

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
  return solution;
}
