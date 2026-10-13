import sharp from 'sharp';
import { srgb255ToOklch } from './color';
import { dominantColours } from './zine/colour';
import type { Swatch } from './colour-search';

/**
 * A photo's main colours with the share of the frame each covers, for colour
 * search and the lightbox palette strip.
 *
 * The clustering is the zine's own deterministic k-means (`dominantColours`),
 * not a second copy: same photo, same palette, so the backfill is a no-op the
 * second time it runs. Six clusters rather than five so a small, distinct
 * colour (a sign, a coat) gets a cluster of its own instead of being averaged
 * into its surroundings.
 */
const EDGE = 96;
const K = 6;

export async function computePalette(input: Buffer | string): Promise<Swatch[]> {
  const { data } = await sharp(input)
    .rotate()
    .resize(EDGE, EDGE, { fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const swatches = dominantColours(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), K);
  return swatches.map((s) => {
    const n = parseInt(s.hex.slice(1), 16);
    const o = srgb255ToOklch((n >> 16) & 255, (n >> 8) & 255, n & 255);
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return { L: r(o.L), C: r(o.C), H: Math.round(o.H), share: r(s.weight) };
  });
}
