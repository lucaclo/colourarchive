/**
 * Fetching for the spot sources.
 *
 * The search sequence is shared; only the transport differs. On the Mac this
 * runs server-side, which is where it belongs — Wikimedia asks callers to
 * identify themselves with a real User-Agent, results are worth caching across
 * visitors, and a scouting page should not be making a hundred cross-origin
 * requests of its own accord.
 *
 * The published static build has no server to run it on, so there it runs in the
 * page with an anonymous CORS request instead. That is a worse citizen and it is
 * the honest trade for the layer existing at all; `collectCommonsPhotos` is the
 * part both share, so neither can drift from the other.
 *
 * The cache is the same shape as `weather-client`'s: small, in memory, and
 * keyed on the rounded query. Commons photographs do not move.
 */

import { clusterByProximity, type Cluster } from '../cluster';
import type { LatLon } from '../geo';
import {
  assessedSearchUrl,
  byStanding,
  parsePhotoDetails,
  parseSearchTitles,
  photoDetailsUrl,
  type Accolade,
  type UrlOptions,
} from './wikimedia';
import { MAX_PHOTOS, type RawPhoto, type SpotSearch } from './types';

export class PhotoError extends Error {}

/**
 * Wikimedia's terms ask for a descriptive agent with a way to be contacted.
 * Being a good citizen of a free API is the price of not needing a key.
 */
const AGENT = 'ColourArchiveScout/1.0 (https://github.com/; personal photographic archive)';

const TIMEOUT_MS = 8_000;
/** Commons photographs do not move, and neither do their licences. */
const CACHE_MS = 30 * 60 * 1000;
/** The details call takes a batch of titles; 50 is comfortably inside the API's limit. */
const BATCH = 50;

/** Whether an accolade's own request answered, independent of what it found. */
export interface TierStatus {
  accolade: Accolade;
  ok: boolean;
}

export interface PhotoSearch {
  photos: RawPhoto[];
  tiers: TierStatus[];
}

interface Entry {
  at: number;
  result: PhotoSearch;
}
const cache = new Map<string, Entry>();

/**
 * How a JSON document is actually fetched.
 *
 * Injected rather than fixed, because the browser cannot do what the server
 * does: `user-agent` is a forbidden header name in `fetch`, so a browser that
 * reused the transport below would silently send its own and the politeness
 * above would be a comment describing something that had stopped happening.
 * The static build supplies its own transport and asks Commons for CORS; see
 * `browser/sources.ts`.
 */
export type JsonTransport = (url: string) => Promise<unknown>;

const serverGetJson: JsonTransport = async (url) => {
  const response = await fetch(url, {
    headers: { 'user-agent': AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new PhotoError(`Commons answered ${response.status}.`);
  return response.json();
};

/**
 * Photographs near a point that somebody vouched for.
 *
 * Only the reviewed ones — see `wikimedia.ts` for why searching by distance
 * alone returns a wall of bulk-imported grid-square documentation. This asks
 * each accolade separately rather than trying to OR them into one CirrusSearch
 * expression, which is both fragile and, when tried, silently returned nothing.
 *
 * A place with no assessed photographs comes back empty, and the page says so.
 * That is the honest answer: "nobody has made a picture worth reviewing here"
 * is a real finding, and padding it out with snapshots would bury it.
 */
export async function fetchCommonsPhotos(query: SpotSearch): Promise<PhotoSearch> {
  const key = `${query.centre.lat.toFixed(4)},${query.centre.lon.toFixed(4)},${Math.round(query.radiusM)},${query.limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  const result = await collectCommonsPhotos(query, serverGetJson);
  // A search where every tier failed is not worth caching for half an hour —
  // that would turn one bad moment for Commons into thirty minutes of it.
  if (result.tiers.some((t) => t.ok)) cache.set(key, { at: Date.now(), result });
  return result;
}

/**
 * The search itself, with the fetching left to the caller.
 *
 * Everything hard-won about this sequence lives here — the three tiers asked
 * separately because ORing them into one CirrusSearch expression returns
 * nothing, the dedupe that keeps the best standing where a file holds several,
 * the per-tier detail batches because the tier is what the response is stamped
 * with. The server and the static build must not each have their own copy of
 * that; they differ only in how a URL becomes JSON.
 */
export async function collectCommonsPhotos(
  query: SpotSearch,
  getJson: JsonTransport,
  urlOptions?: UrlOptions,
): Promise<PhotoSearch> {
  const tiers: Accolade[] = ['featured', 'quality', 'valued', 'contest'];

  // One search per tier, run together. Each is allowed to fail on its own:
  // losing a tier is a thinner answer, not a failed search. But losing one is
  // not nothing, either — `tierOk` keeps whether the tier's own request
  // answered at all, so a broken tier and an honestly empty one stop looking
  // identical to whoever called this. See `ACCOLADES` for how the valued tier
  // stayed silently broken until that distinction existed.
  const tierOk = new Map<Accolade, boolean>();

  const found = await inParallel(tiers, 4, (accolade) =>
    getJson(assessedSearchUrl(query, accolade, urlOptions)).then(
      (payload) => {
        tierOk.set(accolade, true);
        return { accolade, titles: parseSearchTitles(payload) };
      },
      () => {
        tierOk.set(accolade, false);
        return { accolade, titles: [] as string[] };
      },
    ),
  );

  const tierStatus = () => tiers.map((accolade) => ({ accolade, ok: tierOk.get(accolade) ?? false }));

  // Best standing wins where a file holds more than one — most featured
  // pictures are also quality images.
  const standing = new Map<string, Accolade>();
  for (const { accolade, titles } of found) {
    for (const title of titles) if (!standing.has(title)) standing.set(title, accolade);
  }
  if (!standing.size) return { photos: [], tiers: tierStatus() };

  const byTier = new Map<Accolade, string[]>();
  for (const [title, accolade] of standing) {
    byTier.set(accolade, [...(byTier.get(accolade) ?? []), title]);
  }

  // Details are fetched per tier, because the tier is what the response is
  // stamped with and a mixed batch would lose it. A details call that fails
  // costs that tier its answer just as losing the search would — the titles
  // were found, but nothing about them could be confirmed.
  const jobs: Array<{ accolade: Accolade; titles: string[] }> = [];
  for (const [accolade, titles] of byTier) {
    for (let i = 0; i < titles.length && i < MAX_PHOTOS; i += BATCH) {
      jobs.push({ accolade, titles: titles.slice(i, i + BATCH) });
    }
  }

  const photos = (
    await inParallel(jobs, 3, (job) =>
      getJson(photoDetailsUrl(job.titles, 320, urlOptions)).then(
        (payload) => parsePhotoDetails(payload, job.accolade),
        () => {
          tierOk.set(job.accolade, false);
          return [] as RawPhoto[];
        },
      ),
    )
  )
    .flat()
    .sort(byStanding)
    .slice(0, MAX_PHOTOS);

  return { photos, tiers: tierStatus() };
}

/** Map with a ceiling on how many are in flight. Order of results is preserved. */
async function inParallel<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await work(items[i]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface Hotspot {
  id: string;
  at: LatLon;
  /** How many photographs were taken here — the reason it is a hotspot. */
  count: number;
  /** How far across the cluster is, so a vague spot can say it is vague. */
  spanM: number;
  photos: RawPhoto[];
}

/** Photographs, grouped into the places people actually stand. */
export function toHotspots(photos: RawPhoto[]): Hotspot[] {
  return clusterByProximity(photos.map((photo) => ({ ...photo, ...photo.at }))).map(
    (cluster: Cluster<RawPhoto & LatLon>) => ({
      // Stable across refetches: the same photographs cluster to the same id.
      id: cluster.items
        .map((p) => `${p.source}:${p.id}`)
        .sort()
        .join('|')
        .slice(0, 120),
      at: { lat: cluster.lat, lon: cluster.lon },
      count: cluster.items.length,
      spanM: Math.round(cluster.spanM),
      // Clustering walks the epsilon graph and does not preserve the incoming
      // order, so the best of a spot is re-floated to the top of it here.
      photos: [...cluster.items].sort(byStanding),
    }),
  );
}
