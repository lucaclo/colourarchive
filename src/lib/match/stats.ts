import sharp from 'sharp';
import { measureRegionsFromPixels, measureVignetteFromPixels, type MeasureResult } from './stats-core';
import type { RegionMasks, VignetteStats } from './types';

// Server-side adapter: get pixels out of a file with sharp, then hand them to
// the shared measurement core. All the actual maths lives in stats-core.ts so
// the browser fallback runs the identical code against canvas pixels.

/** Cap on the long edge for colour sampling. At 4000px a 60MP file still yields
 *  ~25MP of samples — far beyond what the standard error of these statistics
 *  requires — while keeping one pass under a couple of seconds. */
const SAMPLE_EDGE = 4000;

export type { MeasureResult };

export async function measureRegions(imagePath: string, masks: RegionMasks): Promise<MeasureResult> {
  const { data, info } = await sharp(imagePath)
    .resize({ width: SAMPLE_EDGE, height: SAMPLE_EDGE, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return measureRegionsFromPixels(
    { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: info.channels },
    masks,
  );
}

export async function measureVignette(imagePath: string): Promise<VignetteStats> {
  const SIZE = 192;
  const { data, info } = await sharp(imagePath)
    .resize(SIZE, SIZE, { fit: 'fill' })
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return measureVignetteFromPixels({
    data: new Uint8Array(data.buffer, data.byteOffset, data.length),
    width: info.width,
    height: info.height,
    channels: info.channels,
  });
}
