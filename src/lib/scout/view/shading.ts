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
import type { WindowStyle } from './window-layer';

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

/**
 * How much of a building's own mapped colour shows through, by basemap.
 *
 * OSM `building:colour` is on most of a city centre's footprints (1,298 of
 * 1,488 in a midtown Manhattan tile) and it is the difference between a
 * skyline of identical grey blocks and one where the glass tower reads as
 * glass. But mappers write "red" for brick and "#5a81a0" for glass, and taken
 * literally that is a toy town. So only the colour's *hue* is borrowed — its
 * chroma, with its lightness taken back out — and only a fraction of it: the
 * ramp still decides how light every building is, which keeps the rule in
 * `extrusionLightColour` that the light carries hue and the building value.
 */
export const BUILDING_TINT: Record<'light' | 'dark', number> = { light: 0.16, dark: 0.12 };

/**
 * `buildingRamp`, tinted by each building's mapped colour.
 *
 * The tint is the mapped colour minus its own luma (Rec. 601), so black,
 * white and every grey add nothing at all, and a building with no colour or
 * one MapLibre cannot parse falls back to black and is left as the ramp drew
 * it.
 */
export function buildingFill(altitude: number, theme: 'light' | 'dark'): unknown {
  const k = BUILDING_TINT[theme];
  const channel = (i: number) => [
    'max',
    0,
    [
      'min',
      255,
      [
        '+',
        ['at', i, ['var', 'base']],
        ['*', k, ['-', ['at', i, ['var', 'tint']], ['var', 'luma']]],
      ],
    ],
  ];
  return [
    'let',
    'base',
    ['to-rgba', buildingRamp(altitude, theme)],
    'tint',
    ['to-rgba', ['to-color', ['coalesce', ['get', 'colour'], '#000000'], '#000000']],
    [
      'let',
      'luma',
      [
        '+',
        ['*', 0.299, ['at', 0, ['var', 'tint']]],
        ['*', 0.587, ['at', 1, ['var', 'tint']]],
        ['*', 0.114, ['at', 2, ['var', 'tint']]],
      ],
      ['rgba', channel(0), channel(1), channel(2), 1],
    ],
  ];
}

/**
 * Leaves out the outline of a building that is mapped in parts.
 *
 * OpenMapTiles carries both: the whole footprint at the full height, marked
 * `hide_3d`, and each `building:part` with its own base and roof. Extruding
 * the outline as well buries the parts in one solid block — the Empire State
 * Building's outline is 444 m tall, so its setbacks and spire vanished into a
 * 444 m box. The shadows read the same features and need the same filter.
 */
export const DRAWN_IN_3D = ['!=', ['get', 'hide_3d'], true];

/** Window glass by day on each basemap, and unlit at night on either. */
const GLASS = {
  light: { colour: [0.6, 0.66, 0.74], alpha: 0.34 },
  dark: { colour: [0.08, 0.1, 0.14], alpha: 0.45 },
  night: { colour: [0.06, 0.07, 0.1], alpha: 0.3 },
} as const;

/**
 * The window glass and the lights behind it, for the sun and the basemap.
 *
 * By day the glass is a cool step darker than the wall it sits in — on the
 * paper map a pale blue-grey, on the dark map nearly black. Lights come up
 * across civil twilight, the same span the buildings themselves darken over,
 * so the city switches on as it goes dark rather than at a stroke.
 */
export function windowStyle(altitude: number, theme: 'light' | 'dark'): WindowStyle {
  const night = 1 - Math.max(0, Math.min(1, (altitude + 6) / 12));
  // Unlit glass at night is darker than the wall, not bluer: the room behind
  // it is dark. Mixed here so the shader only ever sees one glass.
  const day = theme === 'light' ? GLASS.light : GLASS.dark;
  const glass = day.colour.map((c, i) => c + (GLASS.night.colour[i] - c) * night) as [number, number, number];
  const glassAlpha = day.alpha + (GLASS.night.alpha - day.alpha) * night;
  return { glass, glassAlpha, lit: [1, 0.8, 0.52], night };
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
