import { measureRegionsFromPixels, measureVignetteFromPixels } from '../stats-core';
import {
  CROP,
  TEXTURE_NORM_EDGE,
  measureTextureFrom,
  toLuma,
  type CropSampler,
  type TextureSource,
} from '../texture-core';
import { NO_MASKS, type BaselineMode, type PhotoAnalysis } from '../types';

// The offline fallback: measure a photo on this device, with no server and no
// models.
//
// ── What this deliberately does NOT do ─────────────────────────────────────
// No segmentation. Running SegFormer-B2 twice plus RMBG under WASM would mean
// downloading roughly 250MB to the device and tens of seconds per photo, with
// a real out-of-memory risk on iPad Safari — which is precisely the device this
// path exists for. A fallback that is slow and crashes is worse than one that
// is upfront about its limits.
//
// So masks are unavailable here, and everything that does not depend on them
// still works: the global frame, the three luminance zones, all eight Colour
// Mixer bands, texture and vignette. That is enough for Exposure, the tone
// curve, Saturation, Colour Grading and the Colour Mixer — most of a grade.
//
// Every number is produced by the SAME core the server uses (stats-core.ts,
// texture-core.ts), so a photo measured here and on the Mac agrees.

/** Matches SAMPLE_EDGE on the server so sampling density is comparable. */
const SAMPLE_EDGE = 4000;

const RAW_EXT = /\.(arw|srf|sr2|cr2|cr3|crw|nef|nrw|raf|orf|rw2|pef|dng|erf|dcr|mrw|mos|rwl|iiq|srw|3fr|fff)$/i;

export class BrowserAnalysisError extends Error {}

function draw(source: ImageBitmap, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new BrowserAnalysisError('This browser would not provide a 2D canvas.');
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/** Crop sampler over a canvas holding the image at a given scale. */
function samplerFor(source: ImageBitmap, scaledW: number, scaledH: number): CropSampler {
  const canvas = document.createElement('canvas');
  canvas.width = scaledW;
  canvas.height = scaledH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) ctx.drawImage(source, 0, 0, scaledW, scaledH);
  return async (left, top) => {
    if (!ctx) return null;
    if (left < 0 || top < 0 || left + CROP > scaledW || top + CROP > scaledH) return null;
    const d = ctx.getImageData(left, top, CROP, CROP);
    return { luma: toLuma(d.data, CROP * CROP, 4), width: CROP, height: CROP };
  };
}

function fit(w: number, h: number, edge: number): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

async function bitmapFrom(blob: Blob, label: string): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new BrowserAnalysisError(
      `This device could not decode ${label}. Without the Mac there is no RAW decoder available — export a JPEG from Lightroom with every slider reset and use that instead.`,
    );
  }
}

/**
 * Measure one photo entirely on this device.
 *
 * `requested` is what the person chose in the dropdown, which on this path is
 * mostly not achievable — there is no decoder here. The recorded baseline is
 * therefore what ACTUALLY happened, never what was asked for: reporting "RAW
 * decoded on this Mac" while running on an iPad with no Mac in reach is exactly
 * the kind of confident-and-wrong label this whole feature is built to avoid.
 *
 * The one request that survives is `export`, because a JPEG exported from
 * Lightroom with sliders reset genuinely IS Lightroom's baseline — that claim
 * is about the file's provenance, not about any decoding we did.
 */
export async function analyseInBrowser(
  blob: Blob,
  filename: string,
  requested: BaselineMode = 'native',
): Promise<PhotoAnalysis> {
  const baseline: BaselineMode = requested === 'export' ? 'export' : 'native';
  if (RAW_EXT.test(filename)) {
    throw new BrowserAnalysisError(
      'RAW files need the Mac, which decodes them with macOS Image I/O. Export a JPEG from Lightroom with every slider reset — that is the more accurate baseline anyway.',
    );
  }

  const started = Date.now();
  const timings: Record<string, number> = {};
  const warnings: string[] = [
    'Measured on this device without the Mac, so no segmentation ran. Sky, subject, skin and the other masked regions were not measured — only the whole frame, the luminance zones and the colour bands.',
  ];

  const t0 = Date.now();
  const bitmap = await bitmapFrom(blob, filename);
  timings.decode = (Date.now() - t0) / 1000;

  const nativeW = bitmap.width;
  const nativeH = bitmap.height;

  try {
    // Colour and tone.
    const t1 = Date.now();
    const s = fit(nativeW, nativeH, SAMPLE_EDGE);
    const pixels = draw(bitmap, s.width, s.height);
    const measured = measureRegionsFromPixels(
      { data: pixels.data, width: s.width, height: s.height, channels: 4 },
      NO_MASKS(s.width, s.height),
    );
    timings.measure = (Date.now() - t1) / 1000;

    // Texture, at native and at the common comparison scale.
    const t2 = Date.now();
    const norm = fit(nativeW, nativeH, TEXTURE_NORM_EDGE);
    const src: TextureSource = {
      nativeWidth: nativeW,
      nativeHeight: nativeH,
      sampleNative: samplerFor(bitmap, nativeW, nativeH),
      normalised:
        Math.max(nativeW, nativeH) > TEXTURE_NORM_EDGE
          ? { width: norm.width, height: norm.height, sample: samplerFor(bitmap, norm.width, norm.height) }
          : null,
    };
    const texture = await measureTextureFrom(src);
    timings.texture = (Date.now() - t2) / 1000;

    // Vignette.
    const t3 = Date.now();
    const vig = draw(bitmap, 192, 192);
    const vignette = measureVignetteFromPixels({ data: vig.data, width: 192, height: 192, channels: 4 });
    timings.vignette = (Date.now() - t3) / 1000;

    if (!texture.usable && texture.reason) warnings.push(texture.reason);
    timings.total = (Date.now() - started) / 1000;

    return {
      // Content hashing would mean reading the whole file again for no benefit
      // here — nothing on this path is cached across reloads.
      id: `local-${filename}-${blob.size}`,
      filename,
      baseline,
      baselineNote: 'Measured on this device.',
      width: nativeW,
      height: nativeH,
      sampledAt: measured.sampledAt,
      regions: measured.regions,
      texture,
      vignette,
      hslBands: measured.hslBands,
      timings,
      warnings,
    };
  } finally {
    bitmap.close();
  }
}

/** Fetch a reference image by URL and measure it here. Used when the Mac is
 *  unreachable, so the reference comes from its already-published derivative
 *  rather than the untouched original. */
export async function analyseReferenceInBrowser(url: string, name: string): Promise<PhotoAnalysis> {
  const res = await fetch(url);
  if (!res.ok) throw new BrowserAnalysisError('Could not load the reference image from this device.');
  const analysis = await analyseInBrowser(await res.blob(), name, 'native');
  analysis.warnings.push(
    'The reference was read from its display copy rather than the original file, which is slightly compressed. Colour and tone are reliable; fine grain readings are less so.',
  );
  return analysis;
}
