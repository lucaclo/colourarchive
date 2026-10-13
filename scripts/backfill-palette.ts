/**
 * One-off: compute the colour palette (src/lib/palette.ts) for every photo in
 * the archive and on the inspiration board that doesn't have one yet. Touches
 * ONLY `palette`, then rebuilds both manifests so the archive page can search
 * by colour. Safe to run again: photos that have a palette are skipped.
 *
 * Reads the original when it's on disk, else the largest derivative, which is
 * plenty for six colours at 96px.
 *
 *   npm run backfill:palette
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PHOTOS_DIR, INSPIRATION_DIR, INSPIRATION_STORE, STORE_PATH, ROOT } from '../src/lib/paths';
import { computePalette } from '../src/lib/palette';
import { readStore, rebuild } from '../src/lib/manifest';
import { readInspStore, rebuildInsp } from '../src/lib/inspiration';
import type { Photo } from '../src/lib/types';

async function source(photo: Photo, dir: string): Promise<string | null> {
  const original = path.join(dir, photo.filename);
  try { await fs.access(original); return original; } catch {}
  const largest = [...photo.derivatives].sort((a, b) => b.width - a.width)[0];
  if (!largest) return null;
  const derivative = path.join(ROOT, 'public', largest.avif.replace(/^\//, ''));
  try { await fs.access(derivative); return derivative; } catch { return null; }
}

async function fill(store: Photo[], dir: string, label: string): Promise<number> {
  let done = 0, kept = 0, missing = 0;
  for (const photo of store) {
    if (photo.palette?.length) { kept++; continue; }
    const file = await source(photo, dir);
    if (!file) { console.warn(`  ! no file for ${photo.filename}`); missing++; continue; }
    try {
      photo.palette = await computePalette(file);
      done++;
    } catch (e) {
      console.warn(`  palette skipped (${photo.filename}):`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`${label}: computed ${done}, kept ${kept}, missing ${missing}.`);
  return done;
}

async function main() {
  const store = await readStore();
  if (await fill(store, PHOTOS_DIR, 'Archive')) {
    await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2));
    await rebuild();
  }
  const insp = await readInspStore();
  if (await fill(insp, INSPIRATION_DIR, 'Inspiration')) {
    await fs.writeFile(INSPIRATION_STORE, JSON.stringify(insp, null, 2));
    await rebuildInsp();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
