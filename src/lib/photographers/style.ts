import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

import { IMG_DIR, PHOTOGRAPHER_CACHE_DIR } from '../paths';
import { clipEmbedBuffer, clipEmbedText } from '../clip';
import { measureRegionsFromPixels } from '../match/stats-core';
import { NO_MASKS } from '../match/types';
import { compareLooks, splitVector, trimSignature, TOO_FAR, type LookSignature } from '../match/resemble';
import type { Photo } from '../types';
import { readManifest } from '../manifest';
import { readInspStore } from '../inspiration';
import { looksFor, photoLookRequest } from '../match/looks';
import { getImage } from './sources';

/**
 * A photographer's style, measured — so "similar photographers" means
 * similar in the darkroom, not just similar subjects.
 *
 * Each picture gets two measurements, both local:
 * - its **grade**: the same look signature Style Match ranks the archive by
 *   (`resemble.ts`: tone curve, cast, saturation, contrast, split), taken on a
 *   thumbnail, which is enough for distributions of colour and tone;
 * - its **content**: a CLIP embedding, what's in it and how it's framed.
 *
 * A photographer is the set of their pictures. Two photographers are
 * compared picture-to-nearest-picture, not average to average: someone who
 * shoots both soft colour and hard black and white averages out to a style
 * neither of them has.
 */

export interface ImageMeasure { look: LookSignature; clip: number[]; photo: number }

const MEASURE_EDGE = 512;
const VERSION = 1;
const CACHE = path.join(PHOTOGRAPHER_CACHE_DIR, 'measures.json');

let memory: { version: number; entries: Record<string, ImageMeasure> } | null = null;
let dirty = false;

async function load() {
  if (memory) return memory;
  try {
    const parsed = JSON.parse(await fs.readFile(CACHE, 'utf8'));
    memory = parsed?.version === VERSION ? parsed : { version: VERSION, entries: {} };
  } catch { memory = { version: VERSION, entries: {} }; }
  return memory!;
}
export async function saveMeasures(): Promise<void> {
  if (!memory || !dirty) return;
  await fs.mkdir(PHOTOGRAPHER_CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE, JSON.stringify(memory));
  dirty = false;
}

/* ── Is it a photograph? ───────────────────────────────────────────────── */

// Follows on Bluesky post memes, screenshots and drawings as well as
// photographs; a candidate whose feed is mostly those is not a photographer.
const KINDS = ['a photograph', 'a screenshot of text or an app', 'a drawing or illustration', 'a graphic design poster with text', 'a meme'];
let kindVectors: Promise<number[][]> | null = null;
const getKinds = () => (kindVectors ??= Promise.all(KINDS.map((k) => clipEmbedText(k))));

const dot = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Softmax share of "a photograph" among the kinds, CLIP's usual ×100 scale. */
export function photoShare(clip: number[], kinds: number[][]): number {
  const logits = kinds.map((k) => 100 * dot(clip, k));
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  return exps[0] / exps.reduce((a, b) => a + b, 0);
}

/* ── Measuring ─────────────────────────────────────────────────────────── */

export async function measureBuffer(key: string, buf: Buffer, clip?: number[]): Promise<ImageMeasure> {
  const { data, info } = await sharp(buf)
    .resize({ width: MEASURE_EDGE, height: MEASURE_EDGE, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb').removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const measured = measureRegionsFromPixels(
    { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: info.channels },
    NO_MASKS(info.width, info.height),
  );
  const look = trimSignature(key, measured.sampledAt, measured.regions);
  // CLIP sees 224px anyway; a small JPEG also spares it decoding AVIF/WebP.
  const vec = clip ?? await clipEmbedBuffer(await sharp(buf).resize({ width: 336, height: 336, fit: 'inside' }).jpeg({ quality: 90 }).toBuffer());
  return { look, clip: vec, photo: photoShare(vec, await getKinds()) };
}

const urlKey = (url: string) => `u:${createHash('sha1').update(url).digest('hex').slice(0, 16)}`;

/** A remote picture, measured once and cached by address. */
export async function measureUrl(url: string): Promise<ImageMeasure | null> {
  const cache = await load();
  const key = urlKey(url);
  if (cache.entries[key]) return cache.entries[key];
  try {
    const m = await measureBuffer(key, await getImage(url, 15 * 1024 * 1024));
    cache.entries[key] = m; dirty = true;
    return m;
  } catch { return null; }
}

/** A reference on the board, from its own derivative and stored CLIP vector. */
export async function measureRef(photo: Photo): Promise<ImageMeasure | null> {
  const cache = await load();
  const key = `r:${photo.id}`;
  if (cache.entries[key]) return cache.entries[key];
  const d = photo.derivatives[Math.min(1, photo.derivatives.length - 1)];
  if (!d) return null;
  try {
    const buf = await fs.readFile(path.join(IMG_DIR, d.avif.replace(/^\/img\//, '')));
    const m = await measureBuffer(key, buf, photo.clipEmbedding);
    cache.entries[key] = m; dirty = true;
    return m;
  } catch { return null; }
}

/* ── Words for a look ──────────────────────────────────────────────────── */

export type Metric = 'blacks' | 'key' | 'contrast' | 'sat' | 'warm' | 'tint' | 'split';
export type Metrics = Record<Metric, number>;

/** The handful of numbers a person would describe a grade by. */
export function metricsOf(sig: LookSignature): Metrics | null {
  const g = sig.regions.global;
  if (!g || g.percentiles.length < 3) return null;
  const split = splitVector(sig, 200);
  return {
    blacks: g.percentiles[1],         // 5th percentile of lightness: where black sits
    key: g.L.mean,
    contrast: g.L.sd,
    sat: g.C.mean,
    warm: g.ab.b,                     // OKLab b: + yellow, − blue
    tint: g.ab.a,                     // OKLab a: + magenta, − green
    split: split ? split.b : 0,       // highlights warmer than shadows when +
  };
}

const WORDS: Record<Metric, [string, string]> = {
  blacks: ['lifted blacks', 'deep blacks'],
  key: ['bright', 'dark'],
  contrast: ['hard contrast', 'soft contrast'],
  sat: ['rich colour', 'muted colour'],
  warm: ['warm', 'cool'],
  tint: ['magenta tint', 'green tint'],
  split: ['warm highlights, cool shadows', 'warm shadows, cool highlights'],
};
const METRICS = Object.keys(WORDS) as Metric[];

/** Quartiles of each metric over a population of pictures. */
export type Quartiles = Record<Metric, [number, number, number]>;
export function quartiles(pop: Metrics[]): Quartiles {
  const q = {} as Quartiles;
  for (const m of METRICS) {
    const v = pop.map((p) => p[m]).sort((a, b) => a - b);
    const at = (f: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(f * (v.length - 1)))] : 0);
    q[m] = [at(0.25), at(0.5), at(0.75)];
  }
  return q;
}

/**
 * The pictures traits are judged against: your archive and the board. The
 * archive's signatures come from Style Match's own cache (looks.ts), measured
 * now if missing — the first time is a couple of seconds for a few hundred
 * photographs. Held for ten minutes; a new photograph barely moves quartiles.
 */
let popCache: { at: number; q: Quartiles } | null = null;
export async function populationQuartiles(): Promise<Quartiles> {
  if (popCache && Date.now() - popCache.at < 10 * 60_000) return popCache.q;
  const archive = (await readManifest()).chapters.flatMap((c) => c.photos);
  const requests = archive.map(photoLookRequest).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const { signatures } = await looksFor(requests);
  const ms: Metrics[] = [];
  for (const sig of signatures) { const m = metricsOf(sig); if (m) ms.push(m); }
  for (const p of await readInspStore()) {
    const r = await measureRef(p);
    const m = r && metricsOf(r.look);
    if (m) ms.push(m);
  }
  popCache = { at: Date.now(), q: quartiles(ms) };
  return popCache.q;
}

export interface Trait { metric: Metric; word: string; strength: number }

/** Below this mean chroma there is no colour to describe. */
const MONO = 0.02;

/**
 * What stands out about a set of pictures, against a population (the
 * archive and the board): a metric is named only when its mean sits well
 * outside the population's middle half. Relative on purpose — "lifted
 * blacks" means lifted compared with the pictures you keep, not an absolute
 * that suits one kind of photograph.
 */
export function traits(ms: Metrics[], q: Quartiles, max = 4): Trait[] {
  if (!ms.length) return [];
  const mean = {} as Metrics;
  for (const m of METRICS) mean[m] = ms.reduce((s, x) => s + x[m], 0) / ms.length;
  const out: Trait[] = [];
  const mono = mean.sat < MONO;
  if (mono) out.push({ metric: 'sat', word: 'black and white', strength: 9 });
  for (const m of METRICS) {
    if (mono && (m === 'sat' || m === 'warm' || m === 'tint' || m === 'split')) continue;
    const [lo, mid, hi] = q[m];
    const spread = Math.max(hi - lo, 1e-4);
    const z = (mean[m] - mid) / spread;
    if (Math.abs(z) >= 0.6) out.push({ metric: m, word: WORDS[m][z > 0 ? 0 : 1], strength: Math.abs(z) });
  }
  return out.sort((a, b) => b.strength - a.strength).slice(0, max);
}

/* ── Comparing two photographers ───────────────────────────────────────── */

export interface Print { measures: ImageMeasure[] }

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : Infinity; };

function meanUnit(vs: number[][]): number[] {
  const out = new Array(vs[0]?.length ?? 0).fill(0);
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i];
  const n = Math.hypot(...out) || 1;
  return out.map((x) => x / n);
}

export interface Closeness { look: number; content: number; score: number }

/**
 * How close `a` is to `b`. `look` is in Style Match's own unit (1 ≈ one
 * regrade apart, `TOO_FAR` = unrelated); `content` is a cosine distance
 * between the two bodies of work. `score` weights the grade first.
 */
export function closeness(a: Print, b: Print): Closeness {
  const nearest = a.measures.map((x) => Math.min(...b.measures.map((y) => compareLooks(y.look, x.look).distance)));
  const look = median(nearest.filter(Number.isFinite));
  const content = 1 - dot(meanUnit(a.measures.map((m) => m.clip)), meanUnit(b.measures.map((m) => m.clip)));
  const score = 0.6 * Math.min(look / TOO_FAR, 1.5) + 0.4 * Math.min(content / 0.3, 1.5);
  return { look, content, score };
}

/** "Like Oscar K: lifted blacks, muted colour" — only what both share. */
export function reasonLine(theirs: Trait[], favourite: { name: string; traits: Trait[] }, c: Closeness): string {
  const shared = theirs.filter((t) => favourite.traits.some((f) => f.word === t.word)).map((t) => t.word);
  if (shared.length) return `Like ${favourite.name}: ${shared.slice(0, 3).join(', ')}`;
  if (c.content < 0.12) return `Like ${favourite.name}, in what they photograph`;
  return `Nearest to ${favourite.name}`;
}
