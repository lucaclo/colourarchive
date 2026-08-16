/**
 * Where spot photographs come from.
 *
 * Scout can already tell you what the light does at a coordinate. What it
 * cannot tell you is whether anyone has ever found that coordinate worth
 * photographing — and that is most of what "scouting" means. This is the layer
 * that answers it: other people's pictures, pinned where they were taken.
 *
 * ## Why an adapter interface rather than one API
 *
 * The obvious sources cannot answer the question at all. Instagram's Basic
 * Display API is dead and its Graph API returns only your own media; Google's
 * Custom Search has no geographic filter. Neither can say "photographs near
 * this lat/lon". So the shape here is deliberately a *set* of adapters, each
 * answering the same narrow question, so that a source which appears later —
 * or disappears — costs one file.
 *
 * ## Provenance is not optional
 *
 * Every photograph carries who made it, under what licence, and where it came
 * from, and any adapter that cannot supply those does not get written. This is
 * a decision, not a formality: the whole archive is built on the idea that you
 * do not assert what you did not measure, and showing someone's work without
 * their name on it is the same failure wearing different clothes. `RawPhoto`
 * therefore has no optional attribution fields — an adapter that lacks them
 * must drop the photograph instead.
 */

import type { LatLon } from '../geo';

export interface Licence {
  /** Short name as the source states it, e.g. "CC BY-SA 4.0". */
  name: string;
  /** Where the licence text lives, when the source gives one. */
  url?: string;
}

export interface RawPhoto {
  /** Stable within a source; combine with `source` for a global identity. */
  id: string;
  source: string;
  /** Where the camera was, as the source records it. */
  at: LatLon;
  /** A page a human can open to see the original in context. */
  originUrl: string;
  /** A displayable image, small enough to put on a map. */
  thumbUrl: string;
  /** Longest edge of `thumbUrl`, so the UI can lay out without measuring. */
  thumbWidth: number;
  thumbHeight: number;
  title: string;
  author: string;
  licence: Licence;
  /** When it was taken, when the source knows. Never invented. */
  takenAt?: Date;
  /**
   * The direction the camera was pointing, degrees clockwise from north.
   *
   * Almost always absent — most EXIF carries no `GPSImgDirection` — and that
   * absence is the single most important thing about this field. A bearing is
   * what turns a photograph into a *shot*, and one that is guessed would make
   * every downstream claim about front- or back-light a fabrication. Undefined
   * means unknown, and unknown must be shown as unknown.
   */
  bearing?: number;
  /**
   * What the source's own reviewers made of it.
   *
   * The single most useful quality signal available, because it is a judgement
   * by other photographers rather than anything this code could compute. A
   * source without a review process leaves it undefined.
   *
   * `contest` is the odd one and is deliberately named for what it is: entered
   * in a competition, not reviewed by anybody. It ranks below the three
   * reviewed tiers and says so on the picture.
   */
  accolade?: 'featured' | 'quality' | 'valued' | 'contest';
  /** Blunt, but real: nobody shoots forty megapixels of somewhere they did not care about. */
  megapixels?: number;
}

export interface SpotSearch {
  centre: LatLon;
  radiusM: number;
  /** Upper bound on what the caller wants back. Sources may return fewer. */
  limit: number;
}

export interface SpotSource {
  id: string;
  /** Shown next to results, so a person can weigh where this came from. */
  label: string;
  /** True when the source needs a key this deployment does not have. */
  needsKey?: boolean;
  search(query: SpotSearch): Promise<RawPhoto[]>;
}

/** The most any one source may be asked for. Keeps a bad radius from being a bad citizen. */
export const MAX_PHOTOS = 200;

/**
 * How far out photographs are looked for, whatever the scouting radius is.
 *
 * Deliberately decoupled from the radius ring. That ring answers "how far might
 * I drive", and at 50 km it covers a whole county — searching it returns
 * hundreds of spots in towns you were never going to visit, costs several
 * seconds and a pile of thumbnails, and buries the ones by the pin. Two
 * kilometres is walking distance from where you are standing, which is the
 * question a photograph on a map is actually answering.
 */
export const PHOTO_SEARCH_RADIUS_M = 2_000;

/** Metres, clamped to what geo-search APIs will actually accept. */
export const clampRadius = (radiusM: number) => Math.min(10_000, Math.max(50, Math.round(radiusM)));
