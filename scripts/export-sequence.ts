/**
 * Book export. Writes the ordered chapter-and-photo list with original
 * filenames to sequence.json, so the sequence the site arrives at can leave
 * the site intact. Nothing print-specific yet.
 *
 *   npm run export:sequence
 */
import fs from 'node:fs/promises';
import { readManifest } from '../src/lib/manifest';
import { readBookCuration, curatedChapters } from '../src/lib/book';
import { EXPORT_PATH } from '../src/lib/paths';

async function main() {
  const manifest = await readManifest();
  const curation = await readBookCuration();
  const chapters = curatedChapters(manifest.chapters, curation);
  const sequence = {
    generatedAt: new Date().toISOString(),
    count: chapters.reduce((n, ch) => n + ch.photos.length, 0),
    chapters: chapters.map((ch) => ({
      key: ch.key,
      name: ch.name,
      oklch: ch.oklch,
      photos: ch.photos.map((p) => ({
        id: p.id,
        filename: p.filename,
        oklch: p.oklch,
        capturedAt: p.exif.capturedAt ?? null,
      })),
    })),
  };
  await fs.writeFile(EXPORT_PATH, JSON.stringify(sequence, null, 2));
  console.log(`Wrote ${EXPORT_PATH} — ${sequence.count} photos across ${chapters.length} chapters.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
