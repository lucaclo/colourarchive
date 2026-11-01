/**
 * Depth of field, drawn (issue #150): a side view of the camera, the focus
 * point and the stretch either side of it that is sharp, out to infinity at
 * the right-hand edge.
 *
 * Distance runs on a log scale, so half a metre and two kilometres both fit
 * and both read: a focus scale on a lens is logarithmic for the same reason.
 * Everything past `FAR_M` is drawn at the infinity mark, which is what a
 * sharp zone reaching infinity actually means.
 *
 * Pure geometry in, numbers out, like `profileGeometry`; the page only turns
 * them into SVG attributes. The focus stack (issue #152) draws its frames'
 * zones on the same axis with `zoneX`.
 */

import type { DepthOfField } from './frame';
import { FEET_PER_METRE, type DistanceUnits } from './units';

/** Nearest distance on the axis, metres. Closer than most lenses focus. */
export const NEAR_M = 0.25;
/** Farthest drawn distance before the infinity mark, metres. */
export const FAR_M = 3000;
/**
 * Focus "at infinity": the end of the focus slider. A large finite number
 * rather than `Infinity`, which JSON (the saved session) turns into null.
 */
export const FOCUS_INFINITY_M = 1e6;

export interface Axis {
  /** Left end of the log scale (at `NEAR_M`). */
  x0: number;
  /** Right end of the log scale (at `FAR_M`). */
  x1: number;
  /** Where infinity is drawn. */
  xInf: number;
}

export const DEFAULT_AXIS: Axis = { x0: 30, x1: 292, xInf: 310 };

const L0 = Math.log10(NEAR_M);
const L1 = Math.log10(FAR_M);

/** Screen x for a distance in metres. Infinity, and anything past `FAR_M`, sits on the infinity mark. */
export function distanceX(metres: number, axis: Axis = DEFAULT_AXIS): number {
  if (!(metres < FAR_M * 1.0001)) return axis.xInf;
  const t = (Math.log10(Math.max(NEAR_M, metres)) - L0) / (L1 - L0);
  return axis.x0 + t * (axis.x1 - axis.x0);
}

/** The sharp zone as two x positions. */
export function zoneX(nearM: number, farM: number, axis: Axis = DEFAULT_AXIS): { x: number; width: number } {
  const a = distanceX(nearM, axis);
  const b = distanceX(farM, axis);
  return { x: a, width: Math.max(1, b - a) };
}

export interface Tick {
  x: number;
  /** Text under the tick, or empty for a minor one. */
  label: string;
}

/**
 * Scale ticks in the page's own units: 1, 10, 100 m and 1 km, or 3, 30 and
 * 300 ft and a mile (whose labels fall where a lens's own feet scale has them).
 */
export function axisTicks(units: DistanceUnits, axis: Axis = DEFAULT_AXIS): Tick[] {
  const majors: [number, string][] =
    units === 'ft'
      ? [
          [3 / FEET_PER_METRE, '3 ft'],
          [30 / FEET_PER_METRE, '30 ft'],
          [300 / FEET_PER_METRE, '300 ft'],
          [1609.344, '1 mi'],
        ]
      : [
          [1, '1 m'],
          [10, '10 m'],
          [100, '100 m'],
          [1000, '1 km'],
        ];
  const minors = units === 'ft' ? [1, 10, 100, 1000, 3000].map((f) => f / FEET_PER_METRE) : [0.5, 2, 5, 20, 50, 200, 500, 2000];
  return [
    ...majors.map(([m, label]) => ({ x: distanceX(m, axis), label })),
    ...minors.filter((m) => m > NEAR_M && m < FAR_M).map((m) => ({ x: distanceX(m, axis), label: '' })),
    { x: axis.xInf, label: '∞' },
  ].sort((a, b) => a.x - b.x);
}

/* ── The focus slider ──────────────────────────────────────────────────────── */

/** Steps on the slider, its last one being infinity. */
export const SLIDER_STEPS = 1000;

/** Slider position (0–SLIDER_STEPS) to a focus distance, metres. */
export function sliderToFocus(position: number): number {
  if (position >= SLIDER_STEPS) return FOCUS_INFINITY_M;
  const t = Math.max(0, position) / (SLIDER_STEPS - 1);
  return roundFocus(10 ** (L0 + t * (L1 - L0)));
}

/** A focus distance to its slider position. */
export function focusToSlider(metres: number): number {
  if (metres >= FAR_M) return SLIDER_STEPS;
  const t = (Math.log10(Math.max(NEAR_M, metres)) - L0) / (L1 - L0);
  return Math.round(t * (SLIDER_STEPS - 1));
}

/** Two significant figures: 0.42 m, 3.4 m, 27 m, 450 m. A focus ring has no finer marks. */
export function roundFocus(metres: number): number {
  if (!(metres > 0)) return NEAR_M;
  const p = 10 ** (Math.floor(Math.log10(metres)) - 1);
  return Math.round(metres / p) * p;
}

/* ── The answer in words ───────────────────────────────────────────────────── */

export type DofSituation = 'at-hyperfocal' | 'past-hyperfocal' | 'short-of-hyperfocal';

export interface DofSplit {
  situation: DofSituation;
  /** Share of the sharp zone in front of the focus point, 0–1. Null when the zone runs to infinity. */
  frontShare: number | null;
}

/** How near the hyperfocal distance counts as on it: 3%, finer than a focus ring can be set. */
const AT_HYPERFOCAL = 0.03;

/**
 * Where this focus sits against the hyperfocal distance, and the real split
 * of the sharp zone in front of and behind it. The one-third rule ("a third
 * in front, two behind") holds at exactly one distance; this says the true
 * figure at the one you chose.
 */
export function dofSplit(dof: DepthOfField, focusM: number): DofSplit {
  const ratio = focusM / dof.hyperfocalM;
  if (Math.abs(ratio - 1) <= AT_HYPERFOCAL) return { situation: 'at-hyperfocal', frontShare: null };
  if (!Number.isFinite(dof.farM)) return { situation: 'past-hyperfocal', frontShare: null };
  const front = focusM - dof.nearM;
  return { situation: 'short-of-hyperfocal', frontShare: front / (dof.farM - dof.nearM) };
}

/** "38% in front, 62% behind", "At the hyperfocal distance", or the cost of focusing past it. */
export function describeSplit(split: DofSplit): string {
  switch (split.situation) {
    case 'at-hyperfocal':
      return 'At the hyperfocal distance: as deep as this lens and aperture go.';
    case 'past-hyperfocal':
      return 'Past the hyperfocal distance, so the near limit is further than it needs to be.';
    case 'short-of-hyperfocal': {
      const front = Math.round((split.frontShare ?? 0) * 100);
      return `${front}% of it in front of the focus, ${100 - front}% behind.`;
    }
  }
}
