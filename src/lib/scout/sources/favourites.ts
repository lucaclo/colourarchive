/**
 * Geotagged photographs by the photographers you've favourited on the board,
 * as a Scout hotspot source. Server-only (it reads the private
 * photographers.json), so only `spot-photos.ts` imports it.
 *
 * Flickr's public photostream feed is the one keyless way to their places:
 * its RSS carries a `georss:point` for every photo they geotagged. It's only
 * their latest twenty, so this is a few pins where they've been lately, not
 * their life's work, and it's the photographers you chose, which is the point
 * (Commons, the volume source, is an off-by-default reference layer).
 */

import { readPhotographers } from '../../photographers/store';
import { distance } from '../geo';
import type { RawPhoto, SpotSearch } from './types';

const TIMEOUT_MS = 8_000;
const FEED_MS = 30 * 60 * 1000;
const feeds = new Map<string, { at: number; photos: RawPhoto[] }>();

interface Favourite { name: string; nsid: string }

async function favouritesOnFlickr(): Promise<Favourite[]> {
  const file = await readPhotographers();
  return file.photographers.flatMap((p) => {
    if (!p.favourite) return [];
    const link = p.links.find((l) => l.kind === 'flickr' && l.id);
    return link ? [{ name: p.name, nsid: link.id! }] : [];
  });
}

const unescape = (s: string): string => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');

const tag = (item: string, name: string): string | undefined =>
  item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1].trim();

/** One photostream's geotagged items. Exported for the tests. */
export function parseGeoFeed(xml: string, who: Favourite): RawPhoto[] {
  const out: RawPhoto[] = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const point = tag(item, 'georss:point')?.split(/\s+/).map(Number);
    if (!point || point.length !== 2 || !point.every(Number.isFinite)) continue;
    const [lat, lon] = point;
    if (lat === 0 && lon === 0) continue;
    const link = tag(item, 'link');
    const big = item.match(/<media:content url="([^"]+)"[\s\S]*?height="(\d+)"[\s\S]*?width="(\d+)"/);
    if (!link || !big) continue;
    const id = link.match(/\/(\d+)\/?$/)?.[1] ?? link;
    // `_n` is Flickr's 320px size; the feed only names `_b` (1024).
    const [w, h] = [Number(big[3]), Number(big[2])];
    const scale = 320 / Math.max(w, h, 1);
    const taken = tag(item, 'dc:date.Taken');
    out.push({
      id,
      source: 'flickr',
      at: { lat, lon },
      originUrl: link,
      thumbUrl: big[1].replace(/_b\.jpg$/, '_n.jpg'),
      thumbWidth: Math.round(w * scale),
      thumbHeight: Math.round(h * scale),
      title: unescape(tag(item, 'title') ?? ''),
      author: who.name,
      // The feed doesn't say; the photo page does.
      licence: { name: 'See Flickr', url: link },
      takenAt: taken && !Number.isNaN(Date.parse(taken)) ? new Date(taken) : undefined,
      notable: { name: who.name },
    });
  }
  return out;
}

async function feedFor(who: Favourite): Promise<RawPhoto[]> {
  const hit = feeds.get(who.nsid);
  if (hit && Date.now() - hit.at < FEED_MS) return hit.photos;
  const res = await fetch(
    `https://www.flickr.com/services/feeds/photos_public.gne?id=${encodeURIComponent(who.nsid)}&format=rss2`,
    { headers: { 'user-agent': 'ColourArchive/1.0' }, signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`Flickr feed ${res.status}`);
  const photos = parseGeoFeed(await res.text(), who);
  feeds.set(who.nsid, { at: Date.now(), photos });
  return photos;
}

/**
 * Favourites' geotagged photos within the search radius. `asked` is how many
 * favourites have a Flickr photostream, so the caller can tell "none of them
 * has been here" from "you have no favourites to ask".
 */
export async function fetchFavouritePhotos(query: SpotSearch): Promise<{ photos: RawPhoto[]; asked: number; ok: boolean }> {
  let favourites: Favourite[];
  try {
    favourites = await favouritesOnFlickr();
  } catch {
    return { photos: [], asked: 0, ok: true };
  }
  let ok = true;
  const photos: RawPhoto[] = [];
  await Promise.all(favourites.map(async (who) => {
    try {
      photos.push(...(await feedFor(who)).filter((p) => distance(p.at, query.centre) <= query.radiusM));
    } catch {
      ok = false;
    }
  }));
  return { photos, asked: favourites.length, ok };
}
