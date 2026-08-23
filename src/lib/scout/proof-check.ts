/**
 * What Scout's own geometry says about a proof photo's moment — issue #66.
 *
 * A `LightProof` is a claim: this photo, taken at this instant, shows what
 * the light was doing here. Nothing on this page can confirm that — there
 * is no metadata check, no reverse image search, nothing that verifies a
 * photograph actually was taken when and where it says. What Scout *can*
 * honestly do is compute its own answer for that same instant and put it
 * next to the claim, so a reader judges the two against each other instead
 * of taking either alone on faith. That is a cross-reference, not a
 * verification, and the name of every export here says so.
 *
 * Pure. No map, no DOM, no fetch — the same discipline as the sun engine
 * this is built directly on.
 */

import { SUN_ALTITUDE, sunPosition } from './sun';
import type { LatLon } from './geo';
import type { LightProof } from './spots';

export interface ProofCrossCheck {
  /** Apparent sun altitude Scout computes for the claimed instant, degrees. */
  sunAltitude: number;
  /** Apparent sun azimuth, degrees clockwise from north. */
  sunAzimuth: number;
  /** Whether Scout's own geometry has the sun up at all, at that instant. */
  sunUp: boolean;
  /** One sentence, always starting from what Scout computed, never from the claim. */
  note: string;
}

const round1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/**
 * Scout's own reading for the instant a proof claims — to sit beside the
 * photo and the claim, not in place of either.
 */
export function crossCheckProof(point: LatLon, proof: LightProof): ProofCrossCheck {
  const sun = sunPosition(point.lat, point.lon, new Date(proof.capturedAt));
  const sunUp = sun.altitudeApparent > SUN_ALTITUDE.sunrise;
  const note = sunUp
    ? `Scout's geometry for that instant: sun at ${round1(sun.azimuth)}°, ${round1(sun.altitudeApparent)}° up.`
    : `Scout's geometry for that instant: the sun was down (${round1(sun.altitudeApparent)}° below the horizon).`;
  return { sunAltitude: sun.altitudeApparent, sunAzimuth: sun.azimuth, sunUp, note };
}
