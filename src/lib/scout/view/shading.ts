/**
 * The two paint ramps the map is driven by, and the arithmetic twin of one of
 * them.
 *
 * A shadow's opacity is decided twice in this page, once for each renderer that
 * might be drawing it: MapLibre gets it as a style expression it evaluates per
 * feature, and the custom WebGL layer gets it as a number carried on the
 * vertices, because a layer that resolves overlaps itself has to know how dark
 * each one is before it can take the maximum. The two have to describe the same
 * curve. They are next to each other here, and `shading.test.ts` holds them to
 * it — whichever renderer is running, the picture should differ only in the
 * things the custom one can do better.
 */

import { buildingColours, shadowOpacity } from '../basemap';

/**
 * Buildings, coloured by how tall they are and how the sun is striking them.
 *
 * Returned as `unknown` because a MapLibre expression has no useful type: the
 * library takes it as a tagged array and validates it at runtime.
 */
export function buildingRamp(altitude: number, theme: 'light' | 'dark'): unknown {
  const stops = buildingColours(altitude, theme);
  return [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'render_height'], 0],
    ...stops.flatMap((s) => [s.height, s.colour]),
  ];
}

/** Where the fade along a shadow's length begins, and where it stops falling. */
export const SHADOW_FADE_NEAR_M = 250;
export const SHADOW_FADE_FAR_M = 1200;
/** What is left of a shadow's opacity out at the far end. */
export const SHADOW_FADE_FLOOR = 0.4;

/**
 * Shadow opacity, faded along the length of the throw and scaled by how much
 * hard light there is to cast one.
 *
 * The fade along the length is because the strip at the foot of a building is
 * certain and the far end of a kilometre-long dawn shadow has crossed
 * everything this model does not know about. The cloud scaling is the newer
 * half: under nine tenths cloud the geometry is unchanged and the photograph
 * is not, so the drawing softens while the numbers stay put.
 *
 * `cloudScale` is passed in rather than read, because it depends on a forecast
 * for an instant and this depends on nothing.
 */
export function shadowFade(altitude: number, cloudScale: number): unknown {
  const base = shadowOpacity(altitude) * cloudScale;
  return [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'lengthM'], 0],
    0,
    base,
    250,
    base,
    1200,
    base * 0.4,
  ];
}

/**
 * The same fade, evaluated here rather than by the style.
 *
 * The custom layer carries darkness on the vertices, so the curve `shadowFade`
 * hands MapLibre as an expression has to exist as arithmetic too.
 *
 * Without the cloud scaling, which the layer applies as a uniform after the
 * overlaps have been resolved. The product is the same either way.
 */
export function shadowDarkness(lengthM: number, altitude: number): number {
  const base = shadowOpacity(altitude);
  if (lengthM <= 250) return base;
  if (lengthM >= 1200) return base * 0.4;
  return base * (1 - 0.6 * ((lengthM - 250) / 950));
}
