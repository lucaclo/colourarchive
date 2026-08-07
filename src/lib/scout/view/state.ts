/**
 * The shapes the scout view keeps, and what they start as.
 *
 * These four objects are the whole of what a session is: which layers are up,
 * where the monolith stands, what lens is on the camera, and what the sightline
 * points at. They were declared inline in the page, which was fine while nothing
 * else needed to name them — but the session reader has to describe the same
 * shapes in order to validate what comes back out of storage, and two
 * descriptions of one shape is one too many.
 *
 * Every default is returned from a function rather than exported as a constant.
 * The page mutates these objects in place — `Object.assign(shown, saved.shown)`
 * is how a restore works — and a shared constant would be quietly rewritten by
 * the first page that restored a session, which in a test run means the second
 * test inherits the first one's monolith.
 */

import type { Orientation } from '../frame';

/** The basemap, which is a style plus — for satellite — imagery underneath it. */
export type Basemap = 'light' | 'dark' | 'satellite';

/** Flat or pitched. Not a basemap: both bases can be drawn either way. */
export type ViewMode = '2d' | '3d';

/**
 * Which ink to draw furniture in.
 *
 * Satellite counts as light because it *is* the light vector style with imagery
 * slid under it — but see `palette.ts`, where several marks deliberately do not
 * use this, because imagery is far darker than paper and dark ink disappears
 * into it.
 */
export const themeOf = (basemap: Basemap): 'light' | 'dark' =>
  basemap === 'dark' ? 'dark' : 'light';

/** Which of the optional layers are up. */
export interface Shown {
  buildings: boolean;
  landform: boolean;
  hillshade: boolean;
  sunPath: boolean;
  moonPath: boolean;
  corePath: boolean;
  solstice: boolean;
  monolith: boolean;
  photos: boolean;
  frame: boolean;
  sight: boolean;
}

export const defaultShown = (): Shown => ({
  buildings: true,
  landform: true,
  hillshade: true,
  sunPath: true,
  moonPath: false,
  corePath: false,
  solstice: false,
  monolith: false,
  photos: true,
  frame: false,
  sight: false,
});

/**
 * The checkbox behind each layer.
 *
 * One table, because the page reads it twice — once to wire the handlers up and
 * once to tick the boxes on a restore — and the two lists had been written out
 * separately. A layer added to one and not the other gets a toggle that works
 * and does not survive a reload, or a box that comes back ticked and controls
 * nothing.
 */
export const LAYER_TOGGLES: ReadonlyArray<readonly [id: string, key: keyof Shown]> = [
  ['t-buildings', 'buildings'],
  ['t-landform', 'landform'],
  ['t-hillshade', 'hillshade'],
  ['t-sunpath', 'sunPath'],
  ['t-moonpath', 'moonPath'],
  ['t-core', 'corePath'],
  ['t-solstice', 'solstice'],
  ['t-monolith', 'monolith'],
  ['t-photos', 'photos'],
  ['t-frame', 'frame'],
  ['t-sight', 'sight'],
] as const;

/** The monolith: a stated height, to check a shadow against a known one. */
export interface Slab {
  lat: number;
  lon: number;
  heightM: number;
  sizeM: number;
}

export const defaultSlab = (): Slab => ({ lat: 0, lon: 0, heightM: 10, sizeM: 6 });

/**
 * The lens, and where it points.
 *
 * `bearing` is where the camera is aimed and `tiltDeg` how far up from level,
 * both of which the sun test needs and neither of which the map knows. They
 * live here rather than being read off the map's own bearing because the map is
 * usually north-up and the camera usually is not.
 */
export interface Lens {
  sensor: string;
  focalLengthMm: number;
  orientation: Orientation;
  bearing: number;
  tiltDeg: number;
}

export const defaultLens = (): Lens => ({
  sensor: 'ff',
  focalLengthMm: 24,
  orientation: 'landscape',
  bearing: 270,
  tiltDeg: 0,
});

/** The far end of the sightline. Dragged on the map, like the monolith. */
export interface SightTarget {
  lat: number;
  lon: number;
  heightM: number;
}

export const defaultTarget = (): SightTarget => ({ lat: 0, lon: 0, heightM: 0 });

/** What the panel calls the place. */
export interface PlaceLabel {
  name: string;
  detail: string;
}
