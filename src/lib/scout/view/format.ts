/**
 * The small conversions the panel makes on its way to the screen.
 *
 * Each of these turns state into the exact characters a reader sees, which is
 * why they are worth having out here: a bearing that reads 360° and a coordinate
 * that says N when it means S are wrong in a way no type can catch and no
 * rendering test would notice.
 */

import { compassPoint, type LatLon } from '../geo';

/**
 * A coordinate in the form a map or a phone will accept back.
 *
 * Four places is about eleven metres, which is finer than the pin can be
 * dragged and coarse enough to read aloud.
 */
export const formatCoords = (p: LatLon) =>
  `${Math.abs(p.lat).toFixed(4)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(4)}°${p.lon >= 0 ? 'E' : 'W'}`;

/** A bearing as it should be read: rounded, then wrapped, so noon is 0° not 360°. */
export const bearingLabel = (degrees: number) => {
  const rounded = Math.round(degrees) % 360;
  return `${rounded}° ${compassPoint(rounded)}`;
};

/** The lit part of the disc, as an SVG path. */
export function moonDiscPath(fraction: number, waxing: boolean, r = 12): string {
  const k = Math.min(1, Math.max(0, fraction));
  const rx = r * Math.abs(1 - 2 * k);
  const sweep = k > 0.5 ? 1 : 0;
  // Right-hand limb first, then the terminator back up. Mirrored for a waning
  // moon, which is lit on the other side.
  const side = waxing ? 1 : 0;
  return `M 0 ${-r} A ${r} ${r} 0 0 ${side} 0 ${r} A ${rx} ${r} 0 0 ${waxing ? sweep : 1 - sweep} 0 ${-r}`;
}

/**
 * How much of the shadow picture was inferred, in one clause.
 *
 * The plan leaves the page and loses every visual cue that these heights are
 * mostly storey-count guesses, so it has to carry that itself.
 */
export function shadowCaveat(shadows: {
  showing: boolean;
  cast: number;
  estimated: number;
}): string | undefined {
  if (!shadows.showing || !shadows.cast) return undefined;
  const { cast, estimated } = shadows;
  if (!estimated) return `${cast} buildings, all from recorded heights.`;
  return `${estimated} of ${cast} building heights are storey-count estimates.`;
}
