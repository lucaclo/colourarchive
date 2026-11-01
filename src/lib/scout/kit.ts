/**
 * Your kit, read off your own photographs (issue #153).
 *
 * A field calculator asks you to type in your bodies and lenses. The archive
 * doesn't need to: every digital photograph's EXIF already names the body and
 * the lens it was made with, so the kit is simply what you actually shoot,
 * paired the way you actually pair it, most-used first.
 *
 * Each pairing carries what Scout's lens controls need: the sensor format,
 * the megapixels (for the pixel-sharp circle of confusion and the NPF rule),
 * the focal length or a zoom's range, and the widest aperture. The sensor and
 * the resolution come from a short table of known bodies; for anything else
 * the lens mount says the format (Sony's FE is full frame, plain E is APS-C)
 * and the largest file it made sets a floor on the resolution.
 *
 * Pure, and run at build time: the page bakes the list in, so the static
 * publish has it too. Body and lens names are no more private than the
 * lightbox's own details panel, which already shows them.
 */

import { RESOLUTIONS } from './astrophoto';
import { FOCAL_LENGTHS } from './frame';

export interface KitPhoto {
  medium: 'film' | 'digital';
  camera?: string;
  lens?: string;
  /** "35mm", as EXIF gives it. */
  focalLength?: string;
  width?: number;
  height?: number;
}

export interface KitEntry {
  /** Stable across builds: the raw camera and lens names. */
  id: string;
  /** "a7C II · 24–50mm", or "GR IIIx" for a fixed-lens camera. */
  label: string;
  body: string;
  lens: string;
  sensor: string;
  megapixels: number;
  focalMin: number;
  focalMax: number;
  /** The focal length you shoot this lens at most. */
  focalUsual: number;
  /** Widest aperture at the wide end, ƒ-number. */
  maxAperture: number;
  /** How many photos in the archive were made with it. */
  count: number;
}

interface Body {
  test: RegExp;
  name: string;
  sensor: string;
  megapixels: number;
  /** A fixed-lens camera: its lens is part of the body. */
  fixed?: boolean;
}

/**
 * Bodies worth naming. Effective megapixels from the makers' own figures;
 * Ricoh's APS-C is the same 23.5 × 15.6 mm Scout's APS-C entry already uses.
 */
const BODIES: Body[] = [
  { test: /ILCE-7CM2/i, name: 'a7C II', sensor: 'ff', megapixels: 33 },
  { test: /ILCE-7CR/i, name: 'a7CR', sensor: 'ff', megapixels: 61 },
  { test: /ILCE-7C\b/i, name: 'a7C', sensor: 'ff', megapixels: 24 },
  { test: /ILCE-7RM5/i, name: 'a7R V', sensor: 'ff', megapixels: 61 },
  { test: /ILCE-7RM4/i, name: 'a7R IV', sensor: 'ff', megapixels: 61 },
  { test: /ILCE-7RM3/i, name: 'a7R III', sensor: 'ff', megapixels: 42 },
  { test: /ILCE-7M4/i, name: 'a7 IV', sensor: 'ff', megapixels: 33 },
  { test: /ILCE-7M3/i, name: 'a7 III', sensor: 'ff', megapixels: 24 },
  { test: /ILCE-6700/i, name: 'a6700', sensor: 'apsc', megapixels: 26 },
  { test: /ILCE-6400/i, name: 'a6400', sensor: 'apsc', megapixels: 24 },
  { test: /ILCE-6600/i, name: 'a6600', sensor: 'apsc', megapixels: 24 },
  { test: /GR IIIx/i, name: 'GR IIIx', sensor: 'apsc', megapixels: 24, fixed: true },
  { test: /GR III\b/i, name: 'GR III', sensor: 'apsc', megapixels: 24, fixed: true },
];

const SCANNER = /noritsu|frontier|scanner|qss|ez controller/i;

/** "FE 24-50mm F2.8 G" → 24, 50, 2.8. Null when the name carries no focal length. */
export function parseLens(raw: string): { min: number; max: number; aperture: number | null } | null {
  const focal = raw.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*mm/i);
  if (!focal) return null;
  const min = Number(focal[1]);
  const max = focal[2] ? Number(focal[2]) : min;
  const f = raw.match(/\bF\s*\/?\s*(\d+(?:\.\d+)?)/i);
  return { min, max, aperture: f ? Number(f[1]) : null };
}

/** "24–50mm", the way it's engraved, minus the marketing letters. */
function lensLabel(min: number, max: number): string {
  return min === max ? `${min}mm` : `${min}–${max}mm`;
}

const cleanLens = (raw: string) => raw.trim().replace(/^Sony\s+/i, '');

/** The nearest standard resolution at or above what the largest file shows. */
function megapixelsFrom(photos: KitPhoto[]): number | null {
  const most = Math.max(0, ...photos.map((p) => (p.width ?? 0) * (p.height ?? 0)));
  if (most < 12e6) return null; // exported small, so it says nothing
  const mp = most / 1e6;
  return RESOLUTIONS.find((r) => r >= mp - 0.5) ?? RESOLUTIONS[RESOLUTIONS.length - 1];
}

function sensorFromMount(lens: string): string {
  if (/\bFE\b/.test(lens)) return 'ff';
  if (/^E\b/.test(lens)) return 'apsc';
  return 'ff';
}

/**
 * Every body and lens pairing in the archive, most-used first.
 *
 * Film is left out: a scanner's EXIF names the scanner, not the camera. So is
 * a photo whose lens field is empty or dashes (an adapted manual lens), since
 * there's no focal length to load.
 */
export function kitFromPhotos(photos: readonly KitPhoto[], limit = 8): KitEntry[] {
  const groups = new Map<string, KitPhoto[]>();
  for (const p of photos) {
    if (p.medium !== 'digital' || !p.camera || SCANNER.test(p.camera)) continue;
    const lens = cleanLens(p.lens ?? '');
    if (!lens || /^-+$/.test(lens)) continue;
    const id = `${p.camera.trim()}|${lens}`;
    const list = groups.get(id);
    if (list) list.push(p);
    else groups.set(id, [p]);
  }

  const out: KitEntry[] = [];
  for (const [id, list] of groups) {
    const [camera, lens] = id.split('|');
    const parsed = parseLens(lens);
    if (!parsed) continue;
    const body = BODIES.find((b) => b.test.test(camera));
    const bodyName = body?.name ?? camera.replace(/^(SONY|NIKON|CANON|FUJIFILM|RICOH IMAGING COMPANY, LTD\.)\s+/i, '');
    const usual = mostCommon(list.map((p) => parseFloat(p.focalLength ?? '')).filter((f) => f > 0)) ?? parsed.min;
    out.push({
      id,
      label: body?.fixed ? bodyName : `${bodyName} · ${lensLabel(parsed.min, parsed.max)}`,
      body: bodyName,
      lens: `${lensLabel(parsed.min, parsed.max)}${parsed.aperture ? ` ƒ/${parsed.aperture}` : ''}`,
      sensor: body?.sensor ?? sensorFromMount(lens),
      megapixels: body?.megapixels ?? megapixelsFrom(list) ?? 24,
      focalMin: parsed.min,
      focalMax: parsed.max,
      focalUsual: Math.min(parsed.max, Math.max(parsed.min, usual)),
      maxAperture: parsed.aperture ?? 2.8,
      count: list.length,
    });
  }
  return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}

function mostCommon(values: number[]): number | null {
  const n = new Map<number, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [v, c] of n) if (c > bestCount) [best, bestCount] = [v, c];
  return best;
}

/**
 * The focal lengths to offer while a kit lens is loaded: a prime's one, or a
 * zoom's two ends and the usual stops between them.
 */
export function kitFocalLengths(entry: Pick<KitEntry, 'focalMin' | 'focalMax' | 'focalUsual'>): number[] {
  const inside = FOCAL_LENGTHS.filter((f) => f > entry.focalMin && f < entry.focalMax);
  return [...new Set([entry.focalMin, ...inside, entry.focalUsual, entry.focalMax])].sort((a, b) => a - b);
}

/** Read the baked list back, keeping only well-formed entries. */
export function readKit(value: unknown): KitEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is KitEntry =>
      e && typeof e.id === 'string' && typeof e.label === 'string' && typeof e.sensor === 'string' &&
      [e.megapixels, e.focalMin, e.focalMax, e.focalUsual, e.maxAperture].every((n) => typeof n === 'number' && n > 0),
  );
}

/**
 * One photograph's lens, for "plan this shot again" (issue #160): the body's
 * format and resolution, the focal length it was shot at and its aperture.
 * Null for film, or a photo whose EXIF names no focal length.
 */
export function lensOfPhoto(p: KitPhoto & { aperture?: string }): { sensor: string; focalLengthMm: number; aperture?: number; megapixels: number } | null {
  if (p.medium !== 'digital' || !p.camera || SCANNER.test(p.camera)) return null;
  const focal = parseFloat(p.focalLength ?? '');
  if (!(focal > 0)) return null;
  const body = BODIES.find((b) => b.test.test(p.camera!));
  const aperture = parseFloat((p.aperture ?? '').replace(/^f\//i, ''));
  return {
    sensor: body?.sensor ?? sensorFromMount(cleanLens(p.lens ?? '')),
    focalLengthMm: focal,
    ...(aperture > 0 ? { aperture } : {}),
    megapixels: body?.megapixels ?? megapixelsFrom([p]) ?? 24,
  };
}
