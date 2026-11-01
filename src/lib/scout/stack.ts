/**
 * A focus stack, planned (issue #152).
 *
 * When one frame can't hold the nearest rock and the far ridge sharp at once,
 * you shoot several focused at different distances and merge them. This
 * works out the fewest frames that cover the range: the first focused so its
 * near limit falls on the nearest point, each next one so its near limit sits
 * a little inside the last one's far limit, and the last, when the range runs
 * to infinity, at the hyperfocal distance.
 *
 * Exact under the same thin-lens model as `frame.ts depthOfField`, by solving
 * that model's near-limit equation for the focus distance rather than
 * searching for it: near = s·f² / (f² + N·c·(s − f)) gives
 * s = n·(f² − N·c·f) / (f² − N·c·n).
 *
 * The nearest point can come from the ground: where the bottom edge of the
 * frame meets the terrain, for a camera at a given height and tilt
 * (`groundNearPoint`), which is the near point that matters for a landscape.
 */

import { depthOfField, hyperfocalDistanceMm } from './frame';
import { formatLength } from './units';

export interface StackInput {
  focalLengthMm: number;
  aperture: number;
  circleOfConfusionMm: number;
  /** Nearest distance that must be sharp, metres. */
  nearM: number;
  /** Farthest, metres; `Infinity` for the horizon. */
  farM: number;
  /**
   * How much each zone's near limit tucks inside the previous one's far
   * limit, as a share of the previous zone's depth. A little overlap is what keeps a
   * merge seamless; a stack judged at 100% wants it.
   */
  overlap?: number;
  /** Stop planning past this many frames, and say so. */
  maxFrames?: number;
}

export interface StackFrame {
  focusM: number;
  nearM: number;
  farM: number;
}

export interface StackPlan {
  frames: StackFrame[];
  /** The frames reach the far point (or infinity). False only when capped. */
  complete: boolean;
  /** Where one frame focused at the hyperfocal distance would already be sharp from. */
  hyperfocalNearM: number;
  /** One frame is enough: the whole range already fits. */
  single: boolean;
}

export const DEFAULT_OVERLAP = 0.12;
/** Macro stacks run to dozens of frames; past this the plan says it is short. */
export const DEFAULT_MAX_FRAMES = 40;

/** The focus distance whose near limit is `nearM`, or null past the hyperfocal reach. */
export function focusForNear(focalLengthMm: number, aperture: number, cocMm: number, nearM: number): number | null {
  const f = focalLengthMm;
  const nc = aperture * cocMm;
  const n = nearM * 1000;
  const denom = f * f - nc * n;
  if (denom <= 0) return null;
  const s = (n * (f * f - nc * f)) / denom;
  return s > f ? s / 1000 : null;
}

export function planStack(input: StackInput): StackPlan {
  const { focalLengthMm: f, aperture: N, circleOfConfusionMm: c } = input;
  const overlap = Math.min(0.5, Math.max(0, input.overlap ?? DEFAULT_OVERLAP));
  const max = input.maxFrames ?? DEFAULT_MAX_FRAMES;
  const nearM = Math.max(0.01, Math.min(input.nearM, input.farM));
  const farM = input.farM;
  const hyperM = hyperfocalDistanceMm(f, N, c) / 1000;
  const zone = (s: number): StackFrame => {
    const d = depthOfField(f, N, c, s);
    return { focusM: s, nearM: d.nearM, farM: d.farM };
  };

  const frames: StackFrame[] = [];
  let want = nearM;
  while (frames.length < max) {
    const s = focusForNear(f, N, c, want);
    // Past the hyperfocal reach: the hyperfocal distance itself covers
    // everything from about half of it to infinity, so it ends the stack.
    const frame = s == null || s >= hyperM ? zone(hyperM) : zone(s);
    frames.push(frame);
    if (frame.farM >= farM) break;
    want = frame.farM - overlap * (frame.farM - frame.nearM);
  }
  const last = frames[frames.length - 1];
  return {
    frames,
    complete: last.farM >= farM,
    hyperfocalNearM: zone(hyperM).nearM,
    single: frames.length === 1,
  };
}

/**
 * What the shot list can't say for itself: that no stack is needed, or that
 * the cap was reached short of the far point. Empty for a complete stack,
 * whose list says everything.
 */
export function describeStack(plan: StackPlan): string {
  const n = plan.frames.length;
  if (plan.single) return `No stack needed: one frame at ${formatLength(plan.frames[0].focusM)} covers it.`;
  return plan.complete ? '' : `${n} frames and still short of the far point: stop down, or start further back.`;
}

/** The plan as text to paste into a note: one line per frame, a head line, and the settings. */
export function stackText(plan: StackPlan, settings: string, place?: string): string {
  const lines = [`Focus stack${place ? ` · ${place}` : ''}`, settings];
  plan.frames.forEach((fr, i) => {
    const far = Number.isFinite(fr.farM) ? formatLength(fr.farM) : '∞';
    lines.push(`${i + 1}. Focus ${formatLength(fr.focusM)} (sharp ${formatLength(fr.nearM)}–${far})`);
  });
  return lines.join('\n');
}

/* ── The near point from the ground ────────────────────────────────────────── */

export type GroundNear =
  | { kind: 'ground'; distanceM: number }
  /** The bottom edge points at or above level: it never meets the ground. */
  | { kind: 'sky' }
  /** The ground falls away faster than the edge drops, within the search. */
  | { kind: 'none' };

/**
 * Where the bottom edge of the frame meets the ground.
 *
 * The camera stands `cameraHeightM` above the ground under it, tilted
 * `tiltDeg` (up positive), with a vertical field of view `verticalFovDeg`, so
 * the bottom edge dips `verticalFovDeg / 2 − tiltDeg` below level. Walking
 * out along the aim, the ray's height above the camera's ground falls by the
 * tangent of that dip per metre; the first distance where it meets the
 * terrain (`groundAt(d)`, height relative to the ground under the camera, or
 * null off the map) is the answer, refined between the two samples it falls
 * between. On flat ground this is exactly height / tan(dip).
 */
export function groundNearPoint(
  cameraHeightM: number,
  tiltDeg: number,
  verticalFovDeg: number,
  groundAt: (distanceM: number) => number | null,
  maxM = 3000,
): GroundNear {
  const dip = verticalFovDeg / 2 - tiltDeg;
  if (dip <= 0.05) return { kind: 'sky' };
  const slope = Math.tan((dip * Math.PI) / 180);
  const above = (d: number) => {
    const g = groundAt(d) ?? 0;
    return cameraHeightM - d * slope - g;
  };
  let prevD = 0;
  let prev = above(0);
  if (prev <= 0) return { kind: 'ground', distanceM: 0.1 };
  // Fine steps close by, where a stack's near point usually is; coarser out.
  for (let d = 0.1; d <= maxM; d = d < 10 ? d + 0.1 : d < 200 ? d + 1 : d + 10) {
    const h = above(d);
    if (h <= 0) {
      const t = prev / (prev - h);
      return { kind: 'ground', distanceM: prevD + t * (d - prevD) };
    }
    prevD = d;
    prev = h;
  }
  return { kind: 'none' };
}
