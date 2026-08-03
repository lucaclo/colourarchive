import sharp from 'sharp';
import { srgb255ToOklch } from './color';

// A 4x4 spatial signature: downsample the image to 4x4 (each output pixel is the
// average of its region) and record OKLab [L,a,b] per cell, row-major. Cheap,
// and it captures *where* the light and colour sit — the tonal & colour layout
// of the composition (sky-on-top, dark corners, a warm centre, etc.).
export async function spatialSignature(buf: Buffer): Promise<number[]> {
  const { data } = await sharp(buf, { failOn: 'none' })
    .resize(4, 4, { fit: 'fill' })
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
  const grid: number[] = [];
  for (let i = 0; i < 16; i++) {
    const o = srgb255ToOklch(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    const rad = (o.H * Math.PI) / 180;
    grid.push(r4(o.L), r4(o.C * Math.cos(rad)), r4(o.C * Math.sin(rad)));
  }
  return grid; // 48 values
}
