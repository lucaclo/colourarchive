/**
 * Fetch the bundled star catalogue: `stars.ts` on the page, the same split
 * `light-pollution-loader.ts` makes for the atlas raster — everything that
 * needs a network lives here, everything that needs testing lives in the
 * pure module.
 *
 * One static asset for the whole session: a star's motion across a human
 * lifetime is unmeasurable without a telescope, so this is fetched once and
 * cached for the page's lifetime rather than re-requested per bounds.
 */

import type { Star } from '../stars';

const ASSET_URL = '/data/bright-stars.json';

let cached: Promise<Star[] | null> | null = null;

/**
 * A missing or blocked asset resolves to null rather than rejecting — the
 * caller's answer is then "no catalogue", not a page error over an optional
 * layer.
 */
export function loadStars(): Promise<Star[] | null> {
  if (!cached) cached = fetchStars();
  return cached;
}

async function fetchStars(): Promise<Star[] | null> {
  try {
    const response = await fetch(ASSET_URL);
    if (!response.ok) return null;
    return (await response.json()) as Star[];
  } catch {
    return null;
  }
}
