/**
 * One-off: classify a genre for every existing photo that doesn't have one yet,
 * using the local CLIP model. Touches ONLY the genre fields — colour, chapters,
 * medium, EXIF, derivatives are all left exactly as they are — then rebuilds
 * the manifest so the dropdown appears.
 *
 *   npm run backfill:genre
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PHOTOS_DIR, MANIFEST_PATH } from '../src/lib/paths';
import { classifyGenrePath } from '../src/lib/genre';
import { readStore, rebuild } from '../src/lib/manifest';

async function main() {
  const store = await readStore();
  if (store.length === 0) { console.log('Archive is empty — nothing to classify.'); return; }

  let done = 0, skipped = 0, missing = 0;
  const tally: Record<string, number> = {};
  for (const photo of store) {
    if (photo.autoGenre) { skipped++; tally[photo.genre ?? photo.autoGenre] = (tally[photo.genre ?? photo.autoGenre] ?? 0) + 1; continue; }
    const file = path.join(PHOTOS_DIR, photo.filename);
    try { await fs.access(file); } catch { console.warn(`  ! missing original, skipping ${photo.filename}`); missing++; continue; }

    const genre = await classifyGenrePath(file).catch((e) => { console.warn(`  genre skipped (${photo.filename}):`, e?.message); return undefined; });
    if (!genre) continue;
    photo.autoGenre = genre;
    if (!photo.genre) photo.genre = genre; // keep any hand-set genre
    done++; tally[genre] = (tally[genre] ?? 0) + 1;
    console.log(`  ${photo.filename} → ${genre}`);
  }

  const STORE_PATH = path.join(path.dirname(MANIFEST_PATH), 'photos.json');
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2));
  await rebuild();

  console.log(`\nClassified ${done}, kept ${skipped}, missing ${missing}.`);
  console.log('Genre spread:', Object.entries(tally).map(([g, n]) => `${g} ${n}`).join(' · '));
}

main().catch((err) => { console.error(err); process.exit(1); });
