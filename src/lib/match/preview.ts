import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { RegionMasks } from './regions';
import type { RegionKey } from './types';

// Assets the browser needs to render the live preview.
//
// The strength slider has to feel instant, which rules out a server round-trip
// per drag. So the browser is given everything it needs to run the transform
// itself: the photo, and the masks, as textures.
//
// Masks are packed FOUR TO A TEXTURE, one per RGBA channel. A separate texture
// per region would mean up to ten texture units and ten fetches per fragment;
// packed, the shader does one fetch and reads four masks out of it. Four covers
// every case we actually emit, because the solver only ever produces masks for
// regions large enough to be worth adjusting.

/** Long edge of the preview image. Large enough to judge a grade on an iPad,
 *  small enough to upload as a texture without a stall. */
const PREVIEW_EDGE = 1600;

/** Masks the preview can render, in the order they are packed into RGBA. */
export const PREVIEW_MASK_LIMIT = 4;

export interface PreviewAssets {
  /** Web path to the preview image. */
  photo: string;
  /** Web path to the packed mask texture, or null when no masks apply. */
  maskTexture: string | null;
  /** Which region each RGBA channel holds, in order. Length 0..4. */
  maskChannels: RegionKey[];
  width: number;
  height: number;
}

/**
 * Write the preview image and packed mask texture for one photo.
 *
 * `regionOrder` is the set of regions the solver actually produced adjustments
 * for — only those are worth packing.
 */
export async function writePreviewAssets(
  workingPath: string,
  masks: RegionMasks,
  regionOrder: RegionKey[],
  outDir: string,
  webBase: string,
): Promise<PreviewAssets> {
  await fs.mkdir(outDir, { recursive: true });

  const img = await sharp(workingPath)
    .resize({ width: PREVIEW_EDGE, height: PREVIEW_EDGE, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .webp({ quality: 92 })
    .toBuffer({ resolveWithObject: true });
  await fs.writeFile(path.join(outDir, 'photo.webp'), img.data);

  // Un-eroded masks: see the note on RegionMasks.full. Rendering with eroded
  // masks leaves a visible untouched seam around every region.
  const channels = regionOrder.filter((k) => masks.full[k]).slice(0, PREVIEW_MASK_LIMIT);

  let maskTexture: string | null = null;
  if (channels.length > 0) {
    const n = masks.width * masks.height;
    const packed = Buffer.alloc(n * 4, 0);
    for (let c = 0; c < channels.length; c++) {
      const src = masks.full[channels[c]]!;
      for (let i = 0; i < n; i++) packed[i * 4 + c] = src[i];
    }
    // Any channel with no mask stays zero, which the shader reads as "this
    // region does not apply here" — the correct default.
    const png = await sharp(packed, { raw: { width: masks.width, height: masks.height, channels: 4 } })
      .png({ compressionLevel: 6 })
      .toBuffer();
    await fs.writeFile(path.join(outDir, 'masks.png'), png);
    maskTexture = `${webBase}/masks.png`;
  }

  return {
    photo: `${webBase}/photo.webp`,
    maskTexture,
    maskChannels: channels,
    width: img.info.width,
    height: img.info.height,
  };
}

/** Reference thumbnail shown beside the preview for comparison. Indexed so a
 *  match against several references can write one file per reference into the
 *  same output directory without overwriting each other. */
export async function writeReferencePreview(
  sourcePath: string,
  outDir: string,
  webBase: string,
  index = 0,
): Promise<string> {
  await fs.mkdir(outDir, { recursive: true });
  const filename = index === 0 ? 'reference.webp' : `reference-${index}.webp`;
  const buf = await sharp(sourcePath)
    .resize({ width: PREVIEW_EDGE, height: PREVIEW_EDGE, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .webp({ quality: 92 })
    .toBuffer();
  await fs.writeFile(path.join(outDir, filename), buf);
  return `${webBase}/${filename}`;
}
