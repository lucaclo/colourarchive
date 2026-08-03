import sharp from 'sharp';
import {
  CROP,
  TEXTURE_NORM_EDGE,
  measureTextureFrom,
  toLuma,
  type CropSampler,
  type TextureSource,
} from './texture-core';
import type { TextureStats } from './types';

// Server-side adapter: crop extraction with sharp, maths in texture-core.ts.

export { textureComparable, TEXTURE_SCALE_TOLERANCE } from './texture-core';

/** Build a sampler that pulls native-resolution crops out of one source. */
function samplerFor(source: string | Buffer): CropSampler {
  return async (left, top) => {
    try {
      const { data, info } = await sharp(source as any)
        .extract({ left, top, width: CROP, height: CROP })
        .toColorspace('srgb')
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return {
        luma: toLuma(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width * info.height, info.channels),
        width: info.width,
        height: info.height,
      };
    } catch {
      // A crop that fails (rounding at the far edge) is simply skipped.
      return null;
    }
  };
}

export async function measureTexture(
  imagePath: string,
  width: number,
  height: number,
): Promise<TextureStats> {
  const src: TextureSource = {
    nativeWidth: width,
    nativeHeight: height,
    sampleNative: samplerFor(imagePath),
    normalised: null,
  };

  if (Math.max(width, height) > TEXTURE_NORM_EDGE) {
    // TIFF, not JPEG: re-encoding lossily here would rewrite the very
    // frequencies being measured.
    const out = await sharp(imagePath)
      .resize({ width: TEXTURE_NORM_EDGE, height: TEXTURE_NORM_EDGE, fit: 'inside', withoutEnlargement: true })
      .toColorspace('srgb')
      .tiff({ compression: 'lzw' })
      .toBuffer({ resolveWithObject: true });
    src.normalised = {
      width: out.info.width,
      height: out.info.height,
      sample: samplerFor(out.data),
    };
  }

  return measureTextureFrom(src);
}
