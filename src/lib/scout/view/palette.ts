/**
 * What colour the map's own furniture is drawn in, and how wide.
 *
 * Everything here is a decision about legibility against the basemap under it,
 * and every one of them was got wrong at least once by keying off the wrong
 * thing. They are gathered so that the *set* can be read at a glance, because
 * they only work as a set: a hierarchy of weights is only a hierarchy if the
 * weights were chosen together, and an ink that reads on paper and vanishes on
 * a photograph is not a colour, it is a bug with a hex code.
 *
 * All of it is a function of the basemap and nothing else, which is what lets
 * it sit out here away from the page and be checked.
 */

import type { Basemap } from './state';
import type { RGBA } from './dome-layer';

/**
 * Keyed off the basemap, not off the theme.
 *
 * `themeOf` calls satellite "light" because it is the light vector style, but
 * imagery is far darker than paper — so dark ink, correct on the paper map,
 * disappeared into the aerial photograph.
 */
export const inkColour = (basemap: Basemap): [number, number, number] =>
  basemap === 'light' ? [0.13, 0.14, 0.16] : [0.9, 0.9, 0.92];

/**
 * The quiet, wider stroke laid underneath a bright one.
 *
 * The day's arc is painted with the colour of the light along it, and at noon
 * that colour is very nearly white. A white line on a pale basemap is the
 * reason this was hard to see, and darkening the arc would throw away the
 * information it carries. So the contrast goes underneath instead: the same
 * path, wider and darker, doing for the arc what a drop shadow does for a
 * label. On dark and satellite bases it separates the arc from a busy image.
 *
 * The light figure was raised from 0.38 for issue #23: on the paper basemap
 * the ring was reading as one of several fine marks rather than as the
 * dominant one, and 0.38 of a near-black under a near-white arc was simply
 * not enough contrast to carry that. This is still the same mechanism, not a
 * new one — just turned up to do the job it was already meant to.
 */
export const liftColour = (basemap: Basemap): RGBA =>
  basemap === 'light' ? [0.08, 0.09, 0.11, 0.55] : [0, 0, 0, 0.5];

/**
 * The frame wedge's ink.
 *
 * The wedge covers a lot of ground and everything under it still has to be
 * readable, so it is a flat wash with a bright edge rather than a solid — which
 * only works if the edge can be seen. A pale wash is invisible over the light
 * style's own paper and a dark one disappears into the dark style, and a wedge
 * you cannot see is worse than no wedge: the toggle appears broken.
 */
export const frameInk = (basemap: Basemap): string =>
  basemap === 'light' ? '#1c2530' : '#f2efe8';

/** Same reasoning for the clear half of the sightline. */
export const clearInk = (basemap: Basemap): string =>
  basemap === 'light' ? '#2f7d4f' : '#8fd6a8';

/** A `#rrggbb` string as the three floats a shader wants. */
export const rgbOf = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

/**
 * How wide each mark on the dome is drawn, in pixels.
 *
 * Collected rather than scattered, because these are a *hierarchy* and only
 * read as one if they are chosen together: the day's own arc is the loudest
 * thing on the map, the reference marks around it are quieter, and the
 * ground furniture is quieter still.
 */
// Deliberately not `as const`: these are widths passed as `number` parameters,
// and a literal type here narrows the default of `ridePath`'s `width` to 3.8, so
// the one caller that draws the moon at 2.6 stops compiling.
export const WIDTH = {
  // Issue #23: the loudest mark on the page needed to actually read as one at
  // a glance, on the basemap that gave it the least contrast to work with.
  arc: 4.6,
  ray: 3.0,
  plumb: 1.4,
  horizon: 2.6,
  solstice: 1.8,
  moon: 2.6,
  ground: 2.2,
  /** How much wider the lift stroke is than the mark it sits under. */
  lift: 3.4,
};
