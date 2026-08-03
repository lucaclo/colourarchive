/**
 * Wikimedia Commons as a spot source — the *assessed* part of it.
 *
 * The first version of this asked `geosearch` for whatever was nearest, and the
 * answer was almost entirely geograph.org.uk: a bulk import that documents
 * every grid square in Britain with one flat snapshot apiece. Those photographs
 * are useful to a geographer and useless to a photographer. They tell you a
 * bridge exists; they do not tell you the bridge is worth standing in front of
 * at seven in the morning. Near Edinburgh the nearest **five hundred** files
 * contained not one peer-reviewed image.
 *
 * Commons has its own answer to this, which the first version ignored. Files
 * can be nominated and reviewed by other photographers, and the survivors sit
 * in three categories:
 *
 * - **Featured pictures** — the highest bar, a community vote, rare.
 * - **Quality images** — reviewed for technical quality and value.
 * - **Valued images** — the most useful illustration of its subject.
 *
 * So this searches the *intersection* of an accolade and a place, using
 * CirrusSearch's `incategory:` and `nearcoord:` together, rather than searching
 * by distance and hoping. That is a much smaller set — tens rather than
 * thousands — and every one of them is a photograph somebody chose to make and
 * somebody else thought was good.
 *
 * Positions arrive with the details here (`prop=coordinates`), so unlike the
 * geosearch route there is no second lookup to reconcile.
 */

import type { RawPhoto, SpotSearch } from './types';

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/** What Commons' reviewers said, best first. */
export type Accolade = 'featured' | 'quality' | 'valued';

export const ACCOLADES: Record<Accolade, { category: string; label: string; rank: number }> = {
  featured: {
    category: 'Featured pictures on Wikimedia Commons',
    label: 'Featured picture',
    rank: 3,
  },
  quality: { category: 'Quality images', label: 'Quality image', rank: 2 },
  valued: { category: 'Valued images', label: 'Valued image', rank: 1 },
};

/**
 * Files carrying an accolade, near a point.
 *
 * `nearcoord` takes kilometres, unlike `geosearch`, which takes metres — a
 * genuinely easy way to search a thousand times too small an area.
 *
 * It also has none of `geosearch`'s 10 km ceiling. Measured around Edinburgh,
 * quality images inside the radius: 76 at 5 km, 81 at 10, 85 at 20, 97 at 50,
 * 368 at 100. Clamping this to 10 km — as the first version did, by reusing the
 * geosearch clamp — silently threw away most of the map at wide radii.
 */
const NEARCOORD_MAX_KM = 100;

/**
 * Whether the URL is going to be fetched from a page rather than from a server.
 *
 * Commons sends no CORS header by default and answers a cross-origin request
 * with an opaque failure. Its documented opt-in is `origin=*`, which asks for an
 * *anonymous* response — no cookies, no logged-in user — which is exactly what
 * this does anyway. Without it a static build's photo layer comes back empty
 * with nothing in the console to say why.
 */
export interface UrlOptions {
  /** Add `origin=*` so a browser is allowed to read the response. */
  cors?: boolean;
}

const withCors = (params: URLSearchParams, options: UrlOptions | undefined) => {
  if (options?.cors) params.set('origin', '*');
  return params;
};

export function assessedSearchUrl(
  query: SpotSearch,
  accolade: Accolade,
  options?: UrlOptions,
): string {
  const km = Math.min(NEARCOORD_MAX_KM, Math.max(1, Math.round(query.radiusM / 1000)));
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    list: 'search',
    srsearch: `incategory:"${ACCOLADES[accolade].category}" nearcoord:${km}km,${query.centre.lat},${query.centre.lon}`,
    // Namespace 6 is `File:`; nothing else on Commons is a photograph.
    srnamespace: '6',
    srlimit: String(Math.min(100, Math.max(1, query.limit))),
  });
  return `${COMMONS_API}?${withCors(params, options)}`;
}

/**
 * Position, thumbnail and provenance for a batch of titles.
 *
 * 320 px because the sheet lays these out two to a row at about 150 CSS
 * pixels, so 480 was fetching roughly twice the bytes of every thumbnail to
 * throw the difference away on the way to the screen.
 */
export function photoDetailsUrl(
  titles: string[],
  thumbWidth = 320,
  options?: UrlOptions,
): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    titles: titles.join('|'),
    prop: 'coordinates|imageinfo',
    iiprop: 'url|extmetadata|mime|size',
    iiurlwidth: String(thumbWidth),
    colimit: 'max',
  });
  return `${COMMONS_API}?${withCors(params, options)}`;
}

/** Titles from a search response, in the order Commons ranked them. */
export function parseSearchTitles(payload: unknown): string[] {
  const hits = (payload as { query?: { search?: unknown } })?.query?.search;
  if (!Array.isArray(hits)) return [];
  return hits
    .map((hit) => (hit as { title?: unknown }).title)
    .filter((title): title is string => typeof title === 'string' && title.startsWith('File:'));
}

/** Commons wraps every metadata field in `{ value }`, often with HTML in it. */
function meta(extmetadata: unknown, key: string): string {
  const field = (extmetadata as Record<string, { value?: unknown }> | undefined)?.[key];
  const value = field?.value;
  if (typeof value !== 'string') return '';
  // Artist is routinely an anchor tag. The name is wanted, not the markup.
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Commons dates are usually ISO-ish but not reliably. Undefined beats a wrong date. */
function readDate(text: string): Date | undefined {
  if (!text) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const year = parsed.getUTCFullYear();
  if (year < 1826 || year > 2200) return undefined; // older than photography itself
  return parsed;
}

const IMAGE_MIME = /^image\/(jpeg|png|webp|avif|tiff)$/;

/**
 * Turn a details response into photographs.
 *
 * **A file missing an author or a licence is dropped, not shown anonymously.**
 * So is one with no coordinates, since a spot photograph that is not anywhere
 * is not a spot photograph.
 */
export function parsePhotoDetails(payload: unknown, accolade: Accolade): RawPhoto[] {
  const pages = (payload as { query?: { pages?: unknown } })?.query?.pages;
  if (!Array.isArray(pages)) return [];

  const photos: RawPhoto[] = [];
  for (const raw of pages) {
    const page = raw as Record<string, unknown>;

    const coords = Array.isArray(page.coordinates)
      ? (page.coordinates[0] as Record<string, unknown>)
      : null;
    const lat = Number(coords?.lat);
    const lon = Number(coords?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    const info = Array.isArray(page.imageinfo)
      ? (page.imageinfo[0] as Record<string, unknown>)
      : null;
    if (!info) continue;

    // Commons holds PDFs, SVG diagrams and video under the same namespace.
    const mime = typeof info.mime === 'string' ? info.mime : '';
    if (!IMAGE_MIME.test(mime)) continue;

    const thumbUrl = typeof info.thumburl === 'string' ? info.thumburl : '';
    const originUrl = typeof info.descriptionurl === 'string' ? info.descriptionurl : '';
    if (!thumbUrl || !originUrl) continue;

    const extmetadata = info.extmetadata;
    const author = meta(extmetadata, 'Artist');
    const licenceName = meta(extmetadata, 'LicenseShortName') || meta(extmetadata, 'License');
    // The rule this whole layer is built on.
    if (!author || !licenceName) continue;

    const title = typeof page.title === 'string' ? page.title.replace(/^File:/, '') : '';
    const licenceUrl = meta(extmetadata, 'LicenseUrl');
    const width = Number(info.width) || 0;
    const height = Number(info.height) || 0;

    photos.push({
      id: String(page.pageid ?? title),
      source: 'wikimedia',
      at: { lat, lon },
      originUrl,
      thumbUrl,
      thumbWidth: Number(info.thumbwidth) || 320,
      thumbHeight: Number(info.thumbheight) || 213,
      title: title || 'Untitled',
      author,
      licence: licenceUrl ? { name: licenceName, url: licenceUrl } : { name: licenceName },
      takenAt: readDate(meta(extmetadata, 'DateTimeOriginal')),
      accolade,
      megapixels: width && height ? Math.round((width * height) / 100_000) / 10 : undefined,
      // Commons does not expose GPSImgDirection, so the bearing is genuinely
      // unknown and is left that way. See `RawPhoto`.
    });
  }
  return photos;
}

/**
 * Best first.
 *
 * Accolade decides it — a featured picture beat a field of quality images by
 * vote, and that is a better judgement than anything computable here. Within a
 * tier, resolution breaks the tie: it is blunt, but nobody shoots forty
 * megapixels of somewhere they did not care about.
 */
export function byStanding(a: RawPhoto, b: RawPhoto): number {
  const rank = (photo: RawPhoto) => (photo.accolade ? ACCOLADES[photo.accolade].rank : 0);
  return rank(b) - rank(a) || (b.megapixels ?? 0) - (a.megapixels ?? 0);
}
