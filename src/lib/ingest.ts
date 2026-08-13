import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import exifReader from 'exif-reader';
import { PHOTOS_DIR, IMG_DIR, imgUrl } from './paths';
import { dominantColour } from './dominant';
import { spatialSignature } from './signature';
import { embedBuffer } from './embed';
import { classifyGenreBuffer } from './genre';
import { classify, roundOklch } from './color';
import { WIDTHS, derivativeName } from './derivatives';
import type { Photo, Exif, Derivative, Medium, Genre } from './types';

// Widths live in ./derivatives, alongside the audit that checks the files this
// writes are still there. Originals stay byte-for-byte untouched in /photos —
// derivatives are display-only. Colour is preserved (ICC kept), EXIF is
// stripped from the output files (it lives in the manifest instead).
const AVIF_QUALITY = 62; // colour-managed, visually lossless-ish

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(PHOTOS_DIR, { recursive: true });
  await fs.mkdir(IMG_DIR, { recursive: true });
}

export function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/** Save an uploaded/original file into /photos untouched (deduped by content
 *  hash). Returns the on-disk filename and the stable id. */
export async function saveOriginal(
  buf: Buffer,
  originalName: string,
): Promise<{ id: string; filename: string; existed: boolean }> {
  await ensureDirs();
  const id = hashBuffer(buf);
  const ext = (path.extname(originalName) || '.jpg').toLowerCase();
  // Keep a readable original name but guarantee uniqueness with a short hash.
  const base = path.basename(originalName, path.extname(originalName)) || 'photo';
  const safeBase = base.replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 60);
  const filename = `${safeBase}.${id}${ext}`;
  const dest = path.join(PHOTOS_DIR, filename);
  try {
    await fs.access(dest);
    return { id, filename, existed: true };
  } catch {
    await fs.writeFile(dest, buf); // exact bytes, never re-encoded
    return { id, filename, existed: false };
  }
}

export function parseExif(raw: Buffer | undefined): Exif {
  if (!raw) return {};
  try {
    const p = exifReader(raw);
    const img = p.Image ?? {};
    const photo = p.Photo ?? {};
    const fnum = photo.FNumber;
    const exposure = photo.ExposureTime;
    const focal = photo.FocalLength;
    const captured = photo.DateTimeOriginal ?? img.DateTime;
    const location = parseGps(p.GPSInfo);
    return {
      location,
      capturedAt: captured instanceof Date ? captured.toISOString() : (captured as string | undefined),
      camera: [img.Make, img.Model].filter(Boolean).join(' ').trim() || undefined,
      lens: (photo.LensModel as string) || undefined,
      focalLength: focal ? `${Math.round(focal as number)}mm` : undefined,
      aperture: fnum ? `f/${fnum}` : undefined,
      shutter: exposure ? formatShutter(exposure as number) : undefined,
      iso: (photo.ISOSpeedRatings as number) || (photo.PhotographicSensitivity as number) || undefined,
      software: (img.Software as string) || undefined,
    };
  } catch {
    return {};
  }
}

// Guess film vs digital from EXIF. No signal is perfect (film scans vary), so
// this is a best-effort default — relabelable per photo on the Add/Remove page.
const SCANNER_HINT = /noritsu|frontier|fuji.*sp-?\d|silverfast|vuescan|plustek|primefilm|reflecta|imacon|flextight|coolscan|pakon|epson scan|scanner/i;

export function guessMedium(exif: Exif): Medium {
  const hay = `${exif.camera ?? ''} ${exif.software ?? ''}`;
  if (SCANNER_HINT.test(hay)) return 'film';
  // A real digital camera signature: a model plus exposure metadata.
  if (exif.camera && (exif.iso || exif.shutter || exif.aperture)) return 'digital';
  // No camera metadata at all → most likely a film scan.
  return 'film';
}

function formatShutter(s: number): string {
  if (s >= 1) return `${s}s`;
  return `1/${Math.round(1 / s)}s`;
}

// EXIF GPS is [deg, min, sec] + a N/S/E/W ref. Convert to signed decimal degrees.
function parseGps(gps: any): { lat: number; lon: number } | undefined {
  if (!gps) return undefined;
  const dms = (v: any, ref: any): number | undefined => {
    if (!Array.isArray(v) || v.length < 3) return undefined;
    let dec = Number(v[0]) + Number(v[1]) / 60 + Number(v[2]) / 3600;
    if (!Number.isFinite(dec)) return undefined;
    if (ref === 'S' || ref === 'W') dec = -dec;
    return Math.round(dec * 1e6) / 1e6;
  };
  const lat = dms(gps.GPSLatitude, gps.GPSLatitudeRef);
  const lon = dms(gps.GPSLongitude, gps.GPSLongitudeRef);
  if (lat === undefined || lon === undefined) return undefined;
  return { lat, lon };
}

/**
 * Write the on-screen derivatives for one original and describe them.
 *
 * Its own function because ingest is no longer the only caller: `--fix` on the
 * derivative audit regenerates a photograph whose files went missing, and a
 * repair that wrote *slightly* different files from an ingest — a different
 * quality, a width the never-upscale rule would have skipped — would be a
 * second, quieter way for the two records to disagree.
 */
export async function renderDerivatives(
  buf: Buffer,
  id: string,
  sourceWidth: number,
): Promise<Derivative[]> {
  await ensureDirs();
  const derivatives: Derivative[] = [];
  for (const w of WIDTHS) {
    if (sourceWidth && w > sourceWidth) continue; // never upscale
    const avifName = derivativeName(id, w);
    await sharp(buf, { failOn: 'none' })
      .resize({ width: w, withoutEnlargement: true })
      .keepIccProfile()
      .avif({ quality: AVIF_QUALITY, effort: 4 })
      .toFile(path.join(IMG_DIR, avifName));
    derivatives.push({ width: w, avif: imgUrl(avifName) });
  }
  if (derivatives.length === 0) {
    // Image smaller than the smallest width: emit a single native-width file.
    const avifName = derivativeName(id, 'full');
    await sharp(buf, { failOn: 'none' })
      .keepIccProfile()
      .avif({ quality: AVIF_QUALITY, effort: 4 })
      .toFile(path.join(IMG_DIR, avifName));
    derivatives.push({ width: sourceWidth || 0, avif: imgUrl(avifName) });
  }
  return derivatives;
}

/** Full analysis + derivative generation for one original file. */
export async function processPhoto(
  buf: Buffer,
  id: string,
  filename: string,
): Promise<Photo> {
  const ext = path.extname(filename).replace('.', '').toLowerCase();
  const image = sharp(buf, { failOn: 'none' });
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const oklch = roundOklch(await dominantColour(buf));
  const { chapter } = classify(oklch);

  const derivatives = await renderDerivatives(buf, id, width);

  // Tiny blurred placeholder, inlined as a data URI for the fade-in.
  const placeholderBuf = await sharp(buf, { failOn: 'none' })
    .resize({ width: 24 })
    .blur(1.2)
    .webp({ quality: 40 })
    .toBuffer();
  const placeholder = `data:image/webp;base64,${placeholderBuf.toString('base64')}`;

  const exif = parseExif(meta.exif);
  const medium = guessMedium(exif);

  // Similarity signatures + genre. All best-effort — if a model is
  // unavailable, ingest still succeeds (that feature just skips this photo).
  const [colourGrid, embedding, genre] = await Promise.all([
    spatialSignature(buf),
    embedBuffer(buf).catch((e) => { console.warn('[embed] skipped', e?.message); return undefined; }),
    classifyGenreBuffer(buf).catch((e) => { console.warn('[genre] skipped', e?.message); return undefined as Genre | undefined; }),
  ]);

  return {
    embedding,
    colourGrid,
    id,
    filename,
    ext,
    width,
    height,
    bytes: buf.length,
    oklch,
    autoChapter: chapter,
    chapter, // effective; overrides applied later during manifest assembly
    autoMedium: medium,
    medium, // effective; overrides applied later during manifest assembly
    autoGenre: genre,
    genre, // effective; overrides applied later during manifest assembly
    placeholder,
    derivatives,
    exif,
    addedAt: new Date().toISOString(),
  };
}
