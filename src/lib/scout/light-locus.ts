/**
 * Every hue Scout's own atmosphere model can put in front of a lens.
 *
 * `atmosphere.ts` already turns geometry (sun altitude), place (elevation)
 * and air (aerosol) into a real chromaticity — the colour of the beam, and
 * the colour of the sky. That is a *locus*, not a single answer: sweep
 * altitude and a handful of named environments across it and what comes out
 * is the honest ceiling of what different light, alone, can put on a subject.
 *
 * That ceiling is a narrow arc — amber through white to a cool blue-grey. It
 * is not the whole colour wheel, and that is the finding, not a bug: pure
 * daylight scattering does not manufacture green or magenta light. A green
 * photograph is a green *subject* lit by ordinary light, not a rare sky. So
 * when a gap sits outside this arc, the honest answer is "not a light
 * question", not a strained recipe for a phenomenon that does not occur.
 *
 * Sampled and cached once, at module load — the locus depends on nothing
 * but the physics in `atmosphere.ts`, so it's the same every time and never
 * worth recomputing per gap.
 */

import {
  AEROSOL,
  spectralLight,
  chromaticityToSrgb,
  type Aerosol,
  type Chromaticity,
} from './atmosphere';
import { srgb255ToOklch, ACHROMATIC_CHROMA } from '../color';

export interface LightEnvironment {
  key: string;
  /** How this reads in a sentence, lowercase — "clear mountain air". */
  label: string;
  aerosol: Aerosol;
  elevationM: number;
}

/**
 * A handful of named places, not every possible combination — `atmosphere.ts`
 * takes a continuous aerosol, but a locus point is only useful here if it can
 * be pointed at with a place a photographer recognises.
 */
export const LIGHT_ENVIRONMENTS: LightEnvironment[] = [
  { key: 'mountain', label: 'clear mountain air', aerosol: AEROSOL.mountain, elevationM: 2500 },
  { key: 'continental', label: 'ordinary inland air', aerosol: AEROSOL.continental, elevationM: 100 },
  { key: 'maritime', label: 'coastal haze', aerosol: AEROSOL.maritime, elevationM: 10 },
  { key: 'urban', label: 'city haze', aerosol: AEROSOL.urban, elevationM: 50 },
];

export type LightSource = 'beam' | 'sky';

export interface LightLocusPoint {
  altitudeDeg: number;
  environment: LightEnvironment;
  source: LightSource;
  /** OKLCH hue this light would read as, on a neutral subject. */
  hue: number;
  /** OKLCH chroma of that reading — how saturated, not just which hue. */
  chroma: number;
  cct: number;
}

// Fine near the horizon, where a degree of altitude swings the colour
// temperature by hundreds of kelvin; coarse above golden hour, where the sun
// is functionally white for the rest of the day.
const LOCUS_ALTITUDES = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 55, 70, 90];

function hexToOklch(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return srgb255ToOklch(r, g, b);
}

/**
 * A locus point from a chromaticity — or nothing, when there is no honest
 * hue to report. Two different reasons collapse to the same `null`:
 *
 * - The light has been extinguished to the point `chromaticityOf` had no
 *   power to work with (its documented `cct: 0` sentinel) — a beam
 *   swallowed whole by heavy aerosol at a low altitude, say.
 * - The light is *present* but essentially neutral — high noon through
 *   clean mountain air reads within a couple of percent of white, and its
 *   hue angle is real but meaningless, the way a compass bearing means
 *   nothing standing exactly on a pole. `ACHROMATIC_CHROMA` is the same
 *   line the archive itself draws between a colour and a grey, applied
 *   here to light instead of to a photograph.
 */
function pointFor(
  altitudeDeg: number,
  environment: LightEnvironment,
  source: LightSource,
  chroma: Chromaticity,
): LightLocusPoint | null {
  if (!(chroma.cct > 0)) return null;
  const oklch = hexToOklch(chromaticityToSrgb(chroma));
  if (oklch.C < ACHROMATIC_CHROMA) return null;
  return { altitudeDeg, environment, source, hue: oklch.H, chroma: oklch.C, cct: chroma.cct };
}

let cached: LightLocusPoint[] | null = null;

export function lightLocus(): LightLocusPoint[] {
  if (cached) return cached;
  const points: LightLocusPoint[] = [];
  for (const environment of LIGHT_ENVIRONMENTS) {
    for (const altitudeDeg of LOCUS_ALTITUDES) {
      const result = spectralLight({
        altitudeDeg,
        elevationM: environment.elevationM,
        aerosol: environment.aerosol,
      });
      const beam = pointFor(altitudeDeg, environment, 'beam', result.sun);
      if (beam) points.push(beam);
      const sky = pointFor(altitudeDeg, environment, 'sky', result.sky);
      if (sky) points.push(sky);
    }
  }
  cached = points;
  return points;
}

const circDist = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};

export interface LightMatch {
  point: LightLocusPoint;
  /** How far the closest the model gets, degrees of OKLCH hue. */
  hueDeltaDeg: number;
}

/**
 * Past this, a match is a different colour wearing the same name — not a
 * recipe worth handing anyone.
 */
export const MAX_HUE_MATCH_DEG = 18;

/**
 * The closest this model's whole locus gets to a target hue.
 *
 * `null` is not a failure of search — it is the answer for hues (green,
 * violet, magenta) that daylight scattering essentially never produces, and
 * saying so plainly is the point of building the locus in the first place.
 */
export function matchHueToLight(
  targetHue: number,
  locus: LightLocusPoint[] = lightLocus(),
): LightMatch | null {
  let best: LightLocusPoint | null = null;
  let bestDelta = Infinity;
  for (const point of locus) {
    const d = circDist(point.hue, targetHue);
    if (d < bestDelta) {
      bestDelta = d;
      best = point;
    }
  }
  if (!best || bestDelta > MAX_HUE_MATCH_DEG) return null;
  return { point: best, hueDeltaDeg: bestDelta };
}
