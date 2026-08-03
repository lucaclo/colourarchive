import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

import { MATCH_CACHE_DIR } from '../paths';
import { measureRegionsFromPixels } from './stats-core';
import { NO_MASKS } from './types';
import { LOOK_REGIONS, trimSignature, type LookSignature } from './resemble';

/**
 * Look signatures for the archive — the measurement side of "which of my photos
 * already look like this".
 *
 * The comparison in `resemble.ts` is only honest if both sides come out of the
 * same measurement core, so this runs `measureRegionsFromPixels` — the exact
 * function the reference analysis uses — over each archive photograph, with no
 * masks. No masks means the global frame and the three luminance zones, which is
 * the whole set `resemble.ts` reads, and it means no model has to load.
 *
 * **Measured on the derivative, not the original.** Every archive photo already
 * has an AVIF at several widths, and the statistics this takes are distributions
 * over pixels: the mean colour, the spread of lightness and the percentile curve
 * of a 1280px rendering of a photograph are the same numbers as the 6000px one,
 * to well past the precision anything downstream uses. Grain and acutance are
 * not, which is exactly why this measures none of them. Reading the derivative
 * turns a scan of the archive from minutes into a couple of seconds and touches
 * nothing in `photos/`.
 *
 * Cached to one file on disk keyed by photo id. The cache is a pure function of
 * bytes that never change, so there is no expiry — a photo that is removed
 * leaves a stale entry, which costs a few hundred bytes and is never read again.
 */

const LOOKS_PATH = path.join(MATCH_CACHE_DIR, 'looks.json');

/** Long edge to measure at. Enough pixels that the percentile curve is smooth. */
const MEASURE_EDGE = 1024;

interface LooksFile {
  version: number;
  entries: Record<string, LookSignature>;
}

/**
 * Bumped when the measurement changes shape.
 *
 * Signatures from an older version are dropped rather than migrated: they are
 * cheap to recompute and a silently mixed cache would rank photographs measured
 * two different ways against each other, which is the one thing this file exists
 * to prevent.
 */
const VERSION = 1;

let memory: LooksFile | null = null;

async function load(): Promise<LooksFile> {
  if (memory) return memory;
  try {
    const parsed = JSON.parse(await fs.readFile(LOOKS_PATH, 'utf8')) as LooksFile;
    memory = parsed?.version === VERSION && parsed.entries ? parsed : { version: VERSION, entries: {} };
  } catch {
    memory = { version: VERSION, entries: {} };
  }
  return memory;
}

let writing: Promise<void> | null = null;

async function save(file: LooksFile): Promise<void> {
  // Serialised through one promise: a scan finishing several photos in the same
  // tick would otherwise interleave whole-file writes and lose entries.
  writing = (writing ?? Promise.resolve()).then(async () => {
    try {
      await fs.mkdir(MATCH_CACHE_DIR, { recursive: true });
      await fs.writeFile(LOOKS_PATH, JSON.stringify(file));
    } catch (err) {
      // A cache that cannot be written costs a re-measure, not a failure.
      console.warn('[match] could not cache look signatures', err);
    }
  });
  return writing;
}

/** Measure one image file. Pure apart from reading the file. */
export async function measureLook(id: string, imagePath: string): Promise<LookSignature> {
  const { data, info } = await sharp(imagePath)
    .resize({ width: MEASURE_EDGE, height: MEASURE_EDGE, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const measured = measureRegionsFromPixels(
    {
      data: new Uint8Array(data.buffer, data.byteOffset, data.length),
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
    NO_MASKS(info.width, info.height),
  );
  return trimSignature(id, measured.sampledAt, measured.regions);
}

export interface LookRequest {
  id: string;
  /** Absolute path to the file to measure. */
  imagePath: string;
}

/**
 * Signatures for a set of photographs, measuring only the ones not already
 * cached.
 *
 * Bounded concurrency for the same reason everything else here has it: a first
 * run over a whole archive is a few hundred decodes, and sharp will happily
 * start all of them at once and take the machine with it.
 *
 * A photograph that fails to measure is skipped and reported, not substituted.
 * There is no such thing as a default look, and an entry of zeroes would sit at
 * a fixed distance from every reference and quietly appear in results.
 */
export async function looksFor(
  requests: LookRequest[],
  concurrency = 6,
): Promise<{ signatures: LookSignature[]; measured: number; failed: string[] }> {
  const file = await load();
  const todo = requests.filter((r) => !file.entries[r.id]);
  const failed: string[] = [];

  let next = 0;
  const worker = async () => {
    for (let i = next++; i < todo.length; i = next++) {
      const { id, imagePath } = todo[i];
      try {
        file.entries[id] = await measureLook(id, imagePath);
      } catch {
        failed.push(id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  if (todo.length > failed.length) await save(file);

  const signatures = requests.map((r) => file.entries[r.id]).filter(Boolean);
  return { signatures, measured: todo.length - failed.length, failed };
}

/** Everything already measured, without touching a file. */
export async function cachedLooks(): Promise<LookSignature[]> {
  return Object.values((await load()).entries);
}

/** Drop the cache — used by the probe script and after a measurement change. */
export async function clearLooks(): Promise<void> {
  memory = { version: VERSION, entries: {} };
  await fs.rm(LOOKS_PATH, { force: true });
}

export { LOOK_REGIONS };
