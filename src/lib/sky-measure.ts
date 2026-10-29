import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { PHOTOS_DIR, SKY_CACHE_PATH } from './paths';
import { srgb255ToOklch } from './color';
import { isSunsetHue } from './scout/sky-check';

// The sky's own colour in one photograph (issue #143), from the scene
// segmentation Style Match already runs (SegFormer, ADE20K's "sky"): the mean
// warm-or-magenta chroma over the pixels labelled sky. Null when the frame
// shows too little sky to say. Cached by photo id, since it never changes and
// three models per photo is not cheap; only photos matched to a reading are
// ever measured.

const MIN_SKY = 0.03;
type Cache = Record<string, number | null>;
let cache: Cache | null = null;

async function load(): Promise<Cache> {
  if (cache) return cache;
  try { cache = JSON.parse(await fs.readFile(SKY_CACHE_PATH, 'utf8')) as Cache; } catch { cache = {}; }
  return cache;
}

export async function skyColourOf(photo: { id: string; filename: string }): Promise<number | null> {
  const c = await load();
  if (photo.id in c) return c[photo.id];
  const file = path.join(PHOTOS_DIR, photo.filename);
  const { segmentRegions } = await import('./match/regions');
  const regions = await segmentRegions(file);
  const mask = regions.masks['scene.sky'];
  let value: number | null = null;
  if (mask && (regions.coverage['scene.sky'] ?? 0) >= MIN_SKY) {
    // Unrotated, as segmentRegions reads it, so the mask lines up.
    const { data, info } = await sharp(file, { failOn: 'none' }).resize(regions.width, regions.height, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let sum = 0, n = 0;
    for (let i = 0; i < regions.width * regions.height; i++) {
      if (!mask[i]) continue;
      const o = srgb255ToOklch(data[i * info.channels], data[i * info.channels + 1], data[i * info.channels + 2]);
      if (isSunsetHue(o.H)) sum += o.C;
      n++;
    }
    value = n ? Math.round((sum / n) * 1e4) / 1e4 : null;
  }
  c[photo.id] = value;
  await fs.mkdir(path.dirname(SKY_CACHE_PATH), { recursive: true });
  await fs.writeFile(SKY_CACHE_PATH, JSON.stringify(c));
  return value;
}
