/**
 * One-off: compute a CLIP image embedding for every existing photo that
 * doesn't have one yet, so free-text search (/api/search) has something to
 * rank against. Touches ONLY clipEmbedding — colour, chapters, medium, genre,
 * EXIF, derivatives are all left exactly as they are — then rebuilds the
 * manifest (a no-op for its shape, since clipEmbedding is stripped from the
 * public manifest, but keeps rebuild's other bookkeeping in sync).
 *
 *   npm run backfill:clip
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PHOTOS_DIR, MANIFEST_PATH } from '../src/lib/paths';
import { clipEmbedPath } from '../src/lib/clip';
import { readStore, rebuild } from '../src/lib/manifest';

async function main() {
  const store = await readStore();
  if (store.length === 0) { console.log('Archive is empty — nothing to embed.'); return; }

  let done = 0, skipped = 0, missing = 0;
  for (const photo of store) {
    if (photo.clipEmbedding) { skipped++; continue; }
    const file = path.join(PHOTOS_DIR, photo.filename);
    try { await fs.access(file); } catch { console.warn(`  ! missing original, skipping ${photo.filename}`); missing++; continue; }

    const embedding = await clipEmbedPath(file).catch((e) => { console.warn(`  clip skipped (${photo.filename}):`, e?.message); return undefined; });
    if (!embedding) continue;
    photo.clipEmbedding = embedding;
    done++;
    console.log(`  ${photo.filename} embedded`);
  }

  const STORE_PATH = path.join(path.dirname(MANIFEST_PATH), 'photos.json');
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2));
  await rebuild();

  console.log(`\nEmbedded ${done}, kept ${skipped}, missing ${missing}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
