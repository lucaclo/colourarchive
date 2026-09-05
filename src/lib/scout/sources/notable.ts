/**
 * The curated notable-photographer list — `src/data/notable-photographers.json`.
 *
 * `wikimedia.ts` and `flickr.ts` answer "is this a good photograph" (peer
 * review) and "is this a widely-viewed one" (interestingness). Neither can
 * answer "did a photographer whose name means something shoot here" — that is
 * an identity claim, not a popularity score, and this codebase's whole
 * position on provenance (`sources/types.ts`'s header) is that a claim like
 * that has to be an explicit, checkable fact, never a computed guess. So this
 * is a hand-curated list, not a "prolific photographer" heuristic.
 *
 * Hand-edited, like `notes.ts`'s notebook — read fresh on every call rather
 * than cached at module load, so an edit shows up without a server restart.
 *
 * ## The starter list, and what has and hasn't been verified
 *
 * Seeded with FSA/Library-of-Congress photographers (Dorothea Lange, Walker
 * Evans, and colleagues) plus Alice Austen. Library of Congress bulk uploads
 * to Commons are public domain and consistently categorised, so `Photographs
 * by <name>` is a reasonable guess for this specific group — but it is a
 * guess, not something checked name-by-name against Commons. A wrong guess is
 * cheap: CirrusSearch returns zero results for a category that does not
 * exist, which reads identically to "nobody notable has shot here," already
 * an honest, existing outcome in this codebase (see `wikimedia.ts`'s header).
 *
 * No `flickrNsid` is seeded for anyone. A Flickr user id is opaque and cannot
 * be guessed from a name the way a Commons category can — a wrong guess would
 * pull a stranger's photos and credit them to the wrong person, which is
 * exactly the failure the provenance rule above exists to prevent. Adding one
 * needs the actual id, resolved via `flickr.people.findByUsername` for a
 * specific photographer someone names, not invented here.
 */

import fs from 'node:fs/promises';
import { NOTABLE_PHOTOGRAPHERS_PATH } from '../../paths';
import { categorySearchUrl, type UrlOptions } from './wikimedia';
import { flickrSearchUrl } from './flickr';
import type { RawPhoto, SpotSearch } from './types';

export interface NotablePhotographer {
  name: string;
  years?: string;
  wikipediaUrl?: string;
  /** Defaults to `Photographs by ${name}` when unset — see this file's header. */
  commonsCategory?: string;
  /** Opaque Flickr user id, e.g. "12345678@N00". Unset = not searched on Flickr. */
  flickrNsid?: string;
}

function isPhotographer(value: unknown): value is NotablePhotographer {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    (value as { name: string }).name.trim().length > 0
  );
}

/** Malformed or missing entries are dropped, not thrown on — user-editable
 *  JSON on disk, same posture `notes.ts`/`book.ts` already take with theirs. */
export async function readNotablePhotographers(): Promise<NotablePhotographer[]> {
  try {
    const raw = JSON.parse(await fs.readFile(NOTABLE_PHOTOGRAPHERS_PATH, 'utf8'));
    return Array.isArray(raw) ? raw.filter(isPhotographer) : [];
  } catch {
    return [];
  }
}

const commonsCategoryFor = (p: NotablePhotographer): string =>
  p.commonsCategory ?? `Photographs by ${p.name}`;

/**
 * A named photographer's own category, near the point — same
 * `nearcoord:`+category shape `assessedSearchUrl` uses for the accolade
 * tiers, via the shared `categorySearchUrl`. Always walks subcategories
 * (`deep: true`): a prolific photographer's category is often split by year
 * or subject, and — unlike the accolade tiers, where `ACCOLADES` records
 * which convention each one actually uses — nobody has verified per name
 * here which convention applies, so the superset is the safe default. See
 * `wikimedia.ts`'s `ACCOLADES.valued` for the failure mode of guessing wrong.
 */
export function notableCommonsSearchUrl(
  query: SpotSearch,
  photographer: NotablePhotographer,
  options?: UrlOptions,
): string {
  return categorySearchUrl(query, commonsCategoryFor(photographer), true, options);
}

/** `null` when the photographer has no known Flickr identity — nothing to ask for. */
export function notableFlickrSearchUrl(
  query: SpotSearch,
  photographer: NotablePhotographer,
  key: string,
): string | null {
  if (!photographer.flickrNsid) return null;
  return flickrSearchUrl(query, key, { userId: photographer.flickrNsid });
}

/** Stamps every photograph in a dedicated per-photographer search with who it
 *  was searched for — the confident path, since the search itself was scoped
 *  to that person's own identity. */
export function tagNotable(photos: RawPhoto[], photographer: NotablePhotographer): RawPhoto[] {
  const notable = { name: photographer.name, wikipediaUrl: photographer.wikipediaUrl };
  return photos.map((p) => ({ ...p, notable }));
}

/**
 * The incidental path: a photograph found by a *general* search (an accolade
 * tier, or the plain interestingness-sorted Flickr search) whose credited
 * author happens to match a name on the list. Cheap and worth doing — a
 * listed photographer's photograph does not stop being theirs just because it
 * was also, say, a Commons featured picture — but a plain string match, so it
 * is exact and case-insensitive rather than fuzzy: a near-miss must not
 * borrow somebody else's name.
 */
export function attachNotableByAuthor(
  photos: RawPhoto[],
  photographers: NotablePhotographer[],
): RawPhoto[] {
  if (!photographers.length) return photos;
  const byName = new Map(photographers.map((p) => [p.name.trim().toLowerCase(), p]));
  return photos.map((photo) => {
    if (photo.notable) return photo;
    const match = byName.get(photo.author.trim().toLowerCase());
    if (!match) return photo;
    return { ...photo, notable: { name: match.name, wikipediaUrl: match.wikipediaUrl } };
  });
}
