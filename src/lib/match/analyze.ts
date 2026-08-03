import { createHash } from 'node:crypto';
import { toWorkingImage } from './decode';
import { segmentRegions, type RegionMasks } from './regions';
import { measureRegions, measureVignette } from './stats';
import { measureTexture } from './texture';
import type { BaselineMode, PhotoAnalysis } from './types';

// Orchestrates one photo's full analysis. Nothing here decides anything — it
// only measures, so the same function serves the reference photo and the user's
// photo identically. Asymmetry between the two would be a bug: any difference
// in how they are measured shows up later as a difference in the grade, and
// would be indistinguishable from a real one.

/** Analyses are pure functions of the input bytes, so they cache on content
 *  hash. A 50MB RAW takes real time to decode and segment; re-dragging the
 *  strength slider, re-running against a second reference, or reloading the
 *  page must never pay that cost twice. */
const cache = new Map<string, PhotoAnalysis>();

/** Bounded so a long session can't grow without limit. Analyses are a few KB
 *  each, so this is generous. */
const CACHE_MAX = 64;

export const analysisCacheKey = (buf: Buffer, baseline: BaselineMode): string =>
  `${createHash('sha256').update(buf).digest('hex').slice(0, 16)}:${baseline}`;

export function getCachedAnalysis(key: string): PhotoAnalysis | undefined {
  return cache.get(key);
}

function remember(key: string, analysis: PhotoAnalysis): void {
  cache.set(key, analysis);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export interface AnalyseOptions {
  /** Which baseline the caller wants. Ignored (with a note) when it cannot
   *  apply — e.g. asking for an embedded preview on a JPEG. */
  baseline?: BaselineMode;
  /** Skip the cache — used by the probe script when iterating on the maths. */
  fresh?: boolean;
}

/**
 * Analysis plus the intermediates a caller may still need.
 *
 * The preview renderer needs the masks and the decoded working file, both of
 * which `analysePhoto` throws away — the working file is a full-resolution
 * TIFF, hundreds of megabytes for a 60MP RAW, so holding it by default would be
 * careless. Callers that need them take on the obligation to call `cleanup`.
 */
export interface DetailedAnalysis {
  analysis: PhotoAnalysis;
  masks: RegionMasks;
  /** Lossless full-resolution decode. Valid until `cleanup` is called. */
  workingPath: string;
  cleanup: () => Promise<void>;
}

export async function analysePhotoDetailed(
  buf: Buffer,
  filename: string,
  opts: AnalyseOptions = {},
): Promise<DetailedAnalysis> {
  const requested = opts.baseline ?? 'macos';
  const key = analysisCacheKey(buf, requested);

  const timings: Record<string, number> = {};
  const warnings: string[] = [];
  const started = Date.now();

  const t0 = Date.now();
  const work = await toWorkingImage(buf, filename, requested);
  timings.decode = (Date.now() - t0) / 1000;

  try {
    const masks = await segmentRegions(work.path);
    Object.assign(timings, masks.timings);
    warnings.push(...masks.warnings);

    const t1 = Date.now();
    const measured = await measureRegions(work.path, masks);
    timings.measure = (Date.now() - t1) / 1000;

    // Texture reads the working file at its NATIVE size — never the sampling
    // resolution, which would destroy the signal being measured.
    const t2 = Date.now();
    const texture = await measureTexture(work.path, work.width, work.height);
    timings.texture = (Date.now() - t2) / 1000;

    const t3 = Date.now();
    const vignette = await measureVignette(work.path);
    timings.vignette = (Date.now() - t3) / 1000;

    if (!texture.usable && texture.reason) warnings.push(texture.reason);

    timings.total = (Date.now() - started) / 1000;

    const analysis: PhotoAnalysis = {
      id: key.split(':')[0],
      filename,
      baseline: work.baseline,
      baselineNote: work.note,
      width: work.width,
      height: work.height,
      sampledAt: measured.sampledAt,
      regions: measured.regions,
      texture,
      vignette,
      hslBands: measured.hslBands,
      timings,
      warnings,
    };

    remember(key, analysis);
    return { analysis, masks, workingPath: work.path, cleanup: work.cleanup };
  } catch (err) {
    // Only clean up on the failure path — on success the caller owns the
    // working file and decides when it is no longer needed.
    await work.cleanup();
    throw err;
  }
}

/** Analyse one photo. Intermediates are released before returning. */
export async function analysePhoto(
  buf: Buffer,
  filename: string,
  opts: AnalyseOptions = {},
): Promise<PhotoAnalysis> {
  const requested = opts.baseline ?? 'macos';
  if (!opts.fresh) {
    const hit = cache.get(analysisCacheKey(buf, requested));
    if (hit) return hit;
  }
  const detailed = await analysePhotoDetailed(buf, filename, opts);
  try {
    return detailed.analysis;
  } finally {
    // Temp TIFFs are large (a 60MP decode is hundreds of MB). Always remove
    // them, including on failure.
    await detailed.cleanup();
  }
}
