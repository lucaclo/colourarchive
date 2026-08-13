/**
 * Check the manifest against the files on disk, in both directions.
 *
 *   npm run check:photos            report, exit 1 if anything is out of step
 *   npm run check:photos -- --fix   put it back in step
 *
 * The fault this exists for: `DSC06090` was listed in `photos.json` with three
 * derivatives and had none of them on disk, so the archive page laid out a slot,
 * asked for `/img/d62b2154e7fee842-2000.avif`, and the reader got a hole. Nothing
 * anywhere compared the two records, so it sat there until a phone's network log
 * happened to be open.
 *
 * `--fix` takes each fault to its own remedy, and only ever the conservative one:
 *
 *   • a missing AVIF          → regenerate it from the untouched original
 *   • a missing legacy WebP   → drop the declaration; WebP has not been generated
 *                               since AVIF became universal, so the file is never
 *                               coming back and only the promise is wrong
 *   • a width never declared  → regenerate the whole set for that photograph
 *   • an orphan file          → left alone unless --prune, because deleting is the
 *                               one action here that cannot be undone by a rebuild
 *
 * A photograph whose original is gone is reported and skipped, never silently
 * dropped from the manifest: an entry with no original and no derivatives is a
 * question for a person, not for a script.
 *
 * The exit code answers one question — is the manifest asserting something that
 * is not there? An orphan is reported at the same volume but does not fail the
 * run: nothing links to it, so it cannot reach a reader, and for a photograph
 * whose original has already been trashed the orphan may be the last copy of it
 * that exists. Deleting that is a decision, so it waits for --prune.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { IMG_DIR, PHOTOS_DIR, imgUrl } from '../src/lib/paths.ts';
import { auditPhotos, auditClean, describeAudit, expectedTags, fileOf, GENERATED } from '../src/lib/derivatives.ts';
import type { Audit } from '../src/lib/derivatives.ts';
import { readStore, replaceDerivatives } from '../src/lib/manifest.ts';
import { renderDerivatives } from '../src/lib/ingest.ts';
import type { Photo } from '../src/lib/types.ts';

const args = new Set(process.argv.slice(2));
const FIX = args.has('--fix');
const PRUNE = args.has('--prune');

const listImages = async (): Promise<string[]> => {
  try {
    return await fs.readdir(IMG_DIR);
  } catch {
    return [];
  }
};

async function audit(): Promise<{ photos: Photo[]; audit: Audit }> {
  const [photos, files] = await Promise.all([readStore(), listImages()]);
  return { photos, audit: auditPhotos(photos, files) };
}

/** Regenerate every derivative for one photograph from its original. */
async function regenerate(photo: Photo): Promise<'done' | 'no-original'> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(path.join(PHOTOS_DIR, photo.filename));
  } catch {
    return 'no-original';
  }
  const derivatives = await renderDerivatives(buf, photo.id, photo.width);
  await replaceDerivatives(photo.id, derivatives);
  return 'done';
}

/**
 * Drop declarations for files that are gone and are not generated any more.
 *
 * Only WebP qualifies today. The declaration is the whole fault: nothing has
 * written a `.webp` since AVIF became universal, the page reads `avif` alone, and
 * every one of these entries has its AVIF sitting right beside the promise.
 */
async function dropStale(photo: Photo, present: Set<string>): Promise<boolean> {
  const cleaned = photo.derivatives.map((d) => {
    if (!d.webp || present.has(fileOf(d.webp))) return d;
    const { webp, ...rest } = d;
    return rest;
  });
  if (cleaned.every((d, i) => d === photo.derivatives[i])) return false;
  await replaceDerivatives(photo.id, cleaned);
  return true;
}

/** The manifest asserting a file that is not there — the part that fails a run. */
const broken = (report: Audit): number => report.missing.length + report.undeclared.length;

async function main() {
  const first = await audit();
  const { photos } = first;
  let report = first.audit;
  console.log(describeAudit(report).join('\n'));

  if (auditClean(report) && !PRUNE) return;

  if (!FIX && !PRUNE) {
    if (broken(report)) console.log('\nRun with --fix to put the files back in step with the manifest.');
    if (report.orphans.length) console.log('Run with --prune to delete the files no entry owns.');
    process.exit(broken(report) ? 1 : 0);
  }

  if (FIX) {
    const present = new Set((await listImages()).filter((f) => !f.startsWith('.')));
    const byId = new Map(photos.map((p) => [p.id, p]));

    // Every photograph with a declared-but-absent AVIF, or a width the source is
    // large enough for that nothing declares. Both are answered by one render.
    const rerender = new Set<string>();
    for (const m of report.missing) if (m.format === GENERATED) rerender.add(m.id);
    for (const u of report.undeclared) rerender.add(u.id);

    // Declarations for a format nothing generates any more — a rewrite, not a render.
    const staleOnly = new Set<string>();
    for (const m of report.missing) if (m.format !== GENERATED && !rerender.has(m.id)) staleOnly.add(m.id);

    console.log('');
    for (const id of rerender) {
      const photo = byId.get(id);
      if (!photo) continue;
      const tags = expectedTags(photo.width).join(', ');
      const outcome = await regenerate(photo);
      if (outcome === 'no-original') {
        console.log(`  ✗ ${photo.filename} — no original in photos/, left as it is`);
      } else {
        console.log(`  ✓ ${photo.filename} — rendered ${tags}`);
      }
    }
    for (const id of staleOnly) {
      const photo = byId.get(id);
      if (!photo) continue;
      if (await dropStale(photo, present)) {
        console.log(`  ✓ ${photo.filename} — dropped a declaration for a format no longer generated`);
      }
    }
  }

  if (PRUNE) {
    // Re-audit first: a --fix run just claimed files that were orphans a moment ago.
    report = (await audit()).audit;
    console.log('');
    for (const file of report.orphans) {
      await fs.rm(path.join(IMG_DIR, file), { force: true });
      console.log(`  ✓ deleted ${imgUrl(file)} — no entry owned it`);
    }
  }

  const after = (await audit()).audit;
  console.log(`\n${describeAudit(after).join('\n')}`);
  if (broken(after)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
