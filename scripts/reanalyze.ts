/**
 * Re-run colour extraction + chapter assignment over the existing archive,
 * using the current algorithm — no re-upload, no derivative regeneration.
 * Reads each original from /photos, recomputes oklch + autoChapter, keeps
 * everything else (derivatives, placeholder, EXIF), then rebuilds the manifest.
 *
 *   npm run reanalyze
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { PHOTOS_DIR } from '../src/lib/paths';
import { dominantColour } from '../src/lib/dominant';
import { spatialSignature } from '../src/lib/signature';
import { embedBuffer } from '../src/lib/embed';
import { guessMedium, parseExif } from '../src/lib/ingest';
import { classify, roundOklch } from '../src/lib/color';
import { readStore, rebuild } from '../src/lib/manifest';
import { MANIFEST_PATH } from '../src/lib/paths';

async function main() {
  const store = await readStore();
  if (store.length === 0) {
    console.log('Archive is empty — nothing to re-analyse.');
    return;
  }

  let changed = 0;
  for (const photo of store) {
    let buf: Buffer;
    try {
      buf = await fs.readFile(path.join(PHOTOS_DIR, photo.filename));
    } catch {
      console.warn(`  ! missing original, skipping ${photo.filename}`);
      continue;
    }
    const oklch = roundOklch(await dominantColour(buf));
    const { chapter } = classify(oklch);
    const before = photo.autoChapter;
    photo.oklch = oklch;
    photo.autoChapter = chapter;
    // Re-parse EXIF from the original so newer fields (e.g. GPS location) get
    // picked up for photos ingested before they existed.
    const meta = await sharp(buf, { failOn: 'none' }).metadata();
    photo.exif = parseExif(meta.exif);
    photo.autoMedium = guessMedium(photo.exif);
    photo.medium = photo.autoMedium;
    // Backfill similarity signatures (only if missing — embeddings are stable).
    if (!photo.colourGrid) photo.colourGrid = await spatialSignature(buf);
    if (!photo.embedding) {
      photo.embedding = await embedBuffer(buf).catch((e) => { console.warn('  embed skipped:', e?.message); return undefined; });
    }
    if (before !== chapter) {
      changed++;
      console.log(`  ${photo.filename}: ${before} → ${chapter}`);
    }
  }

  const STORE_PATH = path.join(path.dirname(MANIFEST_PATH), 'photos.json');
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2));
  const manifest = await rebuild();

  console.log(`\nRe-analysed ${store.length} photos · ${changed} moved chapters · ${manifest.chapters.length} chapters now.`);
  for (const c of manifest.chapters) console.log(`  ${c.name.padEnd(10)} ${c.photos.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
