import fs from 'node:fs/promises';
import path from 'node:path';

import { PHOTOGRAPHER_CACHE_DIR } from '../paths';
import { readInspStore } from '../inspiration';
import type { Photo } from '../types';
import {
  arenaBlockChannels, bskyFollows, fetchWork, looksLikeName, mastodonFollows, tidyName,
  type ProfileLink, type WorkItem,
} from './sources';
import { anyReadable, normaliseName, readable, readPhotographers, sameLink, workFor, type Photographer } from './store';
import {
  closeness, measureRef, measureUrl, metricsOf, populationQuartiles, reasonLine, saveMeasures, traits,
  type ImageMeasure, type Metrics, type Quartiles, type Trait,
} from './style';

/**
 * Photographers like the ones you favourite.
 *
 * There's no index of photographers to search, so candidates come from the
 * people around your favourites, where the open web shows it:
 * - who they follow on Bluesky and Mastodon;
 * - on Are.na, the other channels their pictures were saved into, which are
 *   very often channels named after another photographer ("people who keep
 *   X also keep Y");
 * - people already credited on your board whom you haven't starred.
 *
 * Each candidate's recent pictures are measured locally and compared with
 * each favourite (`style.ts`); the list is ranked by that, never by how
 * popular anyone is.
 */

export interface Suggestion {
  key: string;
  name: string;
  link: ProfileLink;
  thumbs: { src: string; url: string }[];
  reason: string;
  traits: string[];
  score: number;
  via: string;
}

export interface Progress { stage: string; done: number; total: number }

const SUGGESTIONS = path.join(PHOTOGRAPHER_CACHE_DIR, 'suggestions.json');
const PHOTO_WORDS = /photo|📷|📸|film|35mm|120\b|analog|camera|shooter|leica|hasselblad|fujifilm|street|portrait|landscape|documentary|darkroom/i;
const MAX_CANDIDATES = 36;
const PER_CANDIDATE = 8;

export const linkKey = (l: ProfileLink): string => `${l.kind}:${l.host ?? ''}:${l.id ?? l.url}`;

export async function lastSuggestions(): Promise<{ at: string; items: Suggestion[] } | null> {
  try { return JSON.parse(await fs.readFile(SUGGESTIONS, 'utf8')); } catch { return null; }
}

/** Run `fn` over `items`, `n` at a time. */
async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

interface Pool { name: string; link: ProfileLink; weight: number; via: string }

async function gatherCandidates(favs: Photographer[], everyone: Photographer[], dismissed: Set<string>): Promise<Pool[]> {
  const pool = new Map<string, Pool>();
  const isKnown = (l: ProfileLink) => favs.some((f) => f.links.some((x) => sameLink(x, l)));
  // Someone else's channel of the same photographer is more of them, not
  // somebody new: the same name, or a title that contains it.
  const favNames = favs.map((f) => normaliseName(tidyName(f.name))).filter((n) => n.length > 3);
  const sameAsFavourite = (name: string) => { const n = normaliseName(name); return favNames.some((f) => n === f || n.includes(f)); };
  const add = (name: string, link: ProfileLink, weight: number, via: string) => {
    if (isKnown(link) || sameAsFavourite(name)) return;
    const key = linkKey(link);
    if (dismissed.has(key)) return;
    const had = pool.get(key);
    if (had) { had.weight += weight; return; }
    pool.set(key, { name, link, weight, via });
  };

  await Promise.all(favs.flatMap((f) => f.links.map(async (l) => {
    try {
      if (l.kind === 'bluesky' && l.id) {
        for (const c of await bskyFollows(l.id, 300)) add(c.name, c.link, 2 + (PHOTO_WORDS.test(`${c.bio} ${c.name}`) ? 1.5 : 0), `followed by ${f.name}`);
      } else if (l.kind === 'mastodon' && l.id && l.host) {
        for (const c of await mastodonFollows(l.host, l.id)) add(c.name, c.link, 2 + (PHOTO_WORDS.test(`${c.bio} ${c.name}`) ? 1.5 : 0), `followed by ${f.name}`);
      } else if (l.kind === 'arena-channel' || l.kind === 'arena-user') {
        const blocks = (await fetchWork(l, 12)).filter((w) => w.key.startsWith('arena:')).slice(0, 6);
        for (const b of blocks) {
          for (const ch of await arenaBlockChannels(b.key.slice(6))) {
            // A channel named after a person is where their work is kept; one
            // named after a mood ("b/w aesthetic") is not a photographer.
            const title = tidyName(ch.title);
            if (ch.slug === l.id || ch.length < 8 || !looksLikeName(title)) continue;
            add(title, { kind: 'arena-channel', id: ch.slug, url: `https://www.are.na/${ch.user}/${ch.slug}` }, 2.5, `kept alongside ${f.name}`);
          }
        }
      }
    } catch (err) {
      console.warn('[photographers] candidates from', l.url, err);
    }
  })));

  // On your board already, credited but not starred.
  for (const p of everyone) {
    if (p.favourite) continue;
    let l: ProfileLink | undefined;
    for (const x of p.links) if (!l && await readable(x)) l = x;
    if (l) add(p.name, l, 4, 'on your board');
  }
  return [...pool.values()].sort((a, b) => b.weight - a.weight).slice(0, MAX_CANDIDATES);
}

async function measureItems(items: WorkItem[]): Promise<ImageMeasure[]> {
  // A thumbnail the Mac makes itself (api/photographers/thumb) is measured
  // from the original it was made from.
  const ms = await pool(items.slice(0, PER_CANDIDATE), 4, (w) => measureUrl(w.thumb.startsWith('/') ? w.full : w.thumb));
  return ms.filter((m): m is ImageMeasure => Boolean(m));
}


export async function traitsOf(measures: ImageMeasure[], q: Quartiles): Promise<Trait[]> {
  return traits(measures.map((m) => metricsOf(m.look)).filter((m): m is Metrics => Boolean(m)), q);
}

/** One photographer's measured pictures: credited references plus recent work. */
export async function printOf(p: Photographer, credits: Record<string, string>, board: Photo[]): Promise<ImageMeasure[]> {
  const refs = board.filter((r) => credits[r.id] === p.id);
  const fromBoard = (await Promise.all(refs.map(measureRef))).filter((m): m is ImageMeasure => Boolean(m));
  let fromWork: ImageMeasure[] = [];
  if (await anyReadable(p.links)) {
    try { fromWork = await measureItems((await workFor(p)).items); } catch { /* the board alone, then */ }
  }
  return [...fromBoard, ...fromWork];
}

let running: Promise<Suggestion[]> | null = null;

/**
 * Find and rank. One run at a time: a second request while one is going
 * waits for the same result instead of measuring everything twice.
 */
export function suggest(onProgress: (p: Progress) => void = () => {}): Promise<Suggestion[]> {
  running ??= run(onProgress).finally(() => { running = null; void saveMeasures(); });
  return running;
}

async function run(onProgress: (p: Progress) => void): Promise<Suggestion[]> {
  const file = await readPhotographers();
  const favs = file.photographers.filter((p) => p.favourite);
  if (!favs.length) throw new Error('Star a photographer first.');
  const board = await readInspStore();

  onProgress({ stage: 'Reading your favourites', done: 0, total: favs.length });
  const q = await populationQuartiles();
  const favPrints = await pool(favs, 2, async (f, i) => {
    const measures = await printOf(f, file.credits, board);
    onProgress({ stage: 'Reading your favourites', done: i + 1, total: favs.length });
    return { f, measures, traits: await traitsOf(measures, q) };
  });
  const usable = favPrints.filter((x) => x.measures.length >= 2);
  if (!usable.length) throw new Error('Your favourites need a few pictures first: pin some, or link a profile.');

  onProgress({ stage: 'Looking around them', done: 0, total: 1 });
  const candidates = await gatherCandidates(favs, file.photographers, new Set(file.dismissed));
  if (!candidates.length) throw new Error('Nobody new around your favourites yet. Link their Bluesky, Mastodon or Are.na.');

  let done = 0;
  const scored = await pool(candidates, 3, async (c) => {
    try {
      const items = (await fetchWork(c.link, 24)).filter((w) => w.thumb);
      const measures = await measureItems(items);
      // A photographer posts photographs: most of what was measured must be.
      const photoShare = measures.reduce((s, m) => s + m.photo, 0) / (measures.length || 1);
      if (measures.length < 5 || photoShare < 0.55) return null;
      const theirs = await traitsOf(measures, q);
      let best: { score: number; reason: string } | null = null;
      for (const fav of usable) {
        const cl = closeness({ measures }, { measures: fav.measures });
        if (!best || cl.score < best.score) best = { score: cl.score, reason: reasonLine(theirs, { name: fav.f.name, traits: fav.traits }, cl) };
      }
      return {
        key: linkKey(c.link), name: c.name, link: c.link, via: c.via,
        thumbs: items.slice(0, 6).map((w) => ({ src: w.thumb, url: w.url })),
        reason: best!.reason, traits: theirs.map((t) => t.word), score: best!.score,
      } satisfies Suggestion;
    } catch {
      return null;
    } finally {
      onProgress({ stage: 'Measuring their work', done: ++done, total: candidates.length });
    }
  });

  const items = scored.filter((s): s is Suggestion => Boolean(s)).sort((a, b) => a.score - b.score).slice(0, 12);
  await fs.mkdir(PHOTOGRAPHER_CACHE_DIR, { recursive: true });
  await fs.writeFile(SUGGESTIONS, JSON.stringify({ at: new Date().toISOString(), items }));
  return items;
}

/** Drop one suggestion from the saved list (favourited or dismissed). */
export async function forgetSuggestion(key: string): Promise<void> {
  const last = await lastSuggestions();
  if (!last) return;
  last.items = last.items.filter((s) => s.key !== key);
  await fs.writeFile(SUGGESTIONS, JSON.stringify(last));
}
