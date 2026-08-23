/**
 * Gear-aware presets — issue #62.
 *
 * `chapter-dna.ts` groups the archive's measured looks by which colour
 * chapter a photo landed in; this groups the same measurements by which
 * lens shot it, off the EXIF already sitting on every digital photo. The
 * averaging is the identical function (`chapterDna` — the name is chapter-
 * shaped but the maths only ever cared about "several signatures, one
 * mean", which a lens is exactly as much an instance of as a chapter is).
 *
 * A lens's DNA is described **relative to the archive's own overall
 * average**, not in absolute terms — "warmer and higher-contrast than your
 * archive overall" is a claim this measurement can actually support;
 * "warm, high-contrast" in the abstract is not, because warm and
 * high-contrast compared to what is exactly the question a single archive's
 * own habits answer differently from anyone else's. `compareLooks` already
 * produces that comparison; this only reads its sign.
 *
 * **What this deliberately does not claim.** The issue's own example reads
 * "35mm work trends toward one grain/contrast profile" — grain is texture,
 * and texture does not survive a resized derivative (`looks.ts` measures
 * archive photos from derivatives for speed, and says why grain is exactly
 * what that trade gives up). So a preset here covers colour, tone, contrast
 * and split-toning — everything `resemble.ts`'s `LookSignature` covers —
 * and stays silent on grain rather than printing a number with no
 * measurement behind it.
 */

import { chapterDna, MIN_CHAPTER_PHOTOS } from './chapter-dna';
import { compareLooks, type LookSignature, type Resemblance } from './resemble';
import type { Photo } from '../types';

/** Every digital photo, grouped by the lens EXIF says shot it. Film and any
 *  photo missing the field are left out — there is no lens to key a preset
 *  on, and folding them into an "unknown" bucket would offer a preset for
 *  a gear that was never actually chosen. */
export function groupPhotosByLens(photos: Photo[]): Map<string, Photo[]> {
  const byLens = new Map<string, Photo[]>();
  for (const photo of photos) {
    const lens = photo.exif.lens?.trim();
    if (!lens) continue;
    if (!byLens.has(lens)) byLens.set(lens, []);
    byLens.get(lens)!.push(photo);
  }
  return byLens;
}

export interface GearPreset {
  lens: string;
  count: number;
  dna: LookSignature;
  /** How this lens's average look compares to the archive's overall average. */
  vsArchive: Resemblance;
  note: string;
}

/** Below this OKLab distance, a cast reads as too small to name a direction for. */
const CAST_NOISE_FLOOR = 0.006;

function castWord(a: number, b: number): string | null {
  if (Math.hypot(a, b) < CAST_NOISE_FLOOR) return null;
  const axis = Math.abs(b) >= Math.abs(a) ? (b > 0 ? 'warmer' : 'cooler') : a > 0 ? 'more magenta' : 'more green';
  return axis;
}

/** Below this, a contrast or saturation gap reads as noise rather than a trend. */
const TREND_NOISE_FLOOR = 0.01;

const trendWord = (delta: number, hi: string, lo: string): string | null =>
  Math.abs(delta) < TREND_NOISE_FLOOR ? null : delta > 0 ? hi : lo;

/**
 * One sentence: how this lens's look leans against the rest of the archive,
 * in the direction words a photographer would use — not the distance
 * `compareLooks` measured it with, which is `resemblance.note`'s job.
 */
function describeGearLook(archiveDna: LookSignature, lensDna: LookSignature): string {
  const archiveGlobal = archiveDna.regions.global;
  const lensGlobal = lensDna.regions.global;
  if (!archiveGlobal || !lensGlobal) return 'Not enough measured to describe a trend.';

  const cast = castWord(lensGlobal.ab.a - archiveGlobal.ab.a, lensGlobal.ab.b - archiveGlobal.ab.b);
  const contrast = trendWord(lensGlobal.L.sd - archiveGlobal.L.sd, 'higher contrast', 'flatter');
  const saturation = trendWord(lensGlobal.C.mean - archiveGlobal.C.mean, 'more saturated', 'more muted');

  const words = [cast, contrast, saturation].filter((w): w is string => w != null);
  return words.length ? `Trends ${words.join(', ')} than your digital work overall.` : 'Measures close to your digital work’s overall look.';
}

/**
 * A preset per lens with enough photos to trust — fewer than
 * `MIN_CHAPTER_PHOTOS` and there is no settled habit to describe yet,
 * the same refusal `chapter-dna.ts` applies to a thin chapter.
 *
 * `archiveDna` is the mean of every signature passed in `byLensSignatures`
 * together, computed by the caller once rather than per lens.
 */
export function gearPresets(
  archiveDna: LookSignature,
  byLensSignatures: Map<string, LookSignature[]>,
): GearPreset[] {
  const presets: GearPreset[] = [];
  for (const [lens, signatures] of byLensSignatures) {
    if (signatures.length < MIN_CHAPTER_PHOTOS) continue;
    const dna = chapterDna(signatures);
    if (!dna) continue;
    presets.push({
      lens,
      count: signatures.length,
      dna,
      vsArchive: compareLooks(archiveDna, dna),
      note: describeGearLook(archiveDna, dna),
    });
  }
  return presets.sort((a, b) => b.count - a.count);
}
