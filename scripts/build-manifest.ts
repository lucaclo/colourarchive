/**
 * Rescan /photos, ingest anything not yet in the store, rebuild the manifest,
 * and print the chapter breakdown to the terminal — the step-1 sanity check.
 *
 *   npm run manifest
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PHOTOS_DIR } from '../src/lib/paths';
import { hashBuffer, processPhoto } from '../src/lib/ingest';
import { readStore, rebuild } from '../src/lib/manifest';

const IMAGE_RE = /\.(jpe?g|png|tiff?|webp|avif|heic|heif)$/i;

async function main() {
  const known = new Set((await readStore()).map((p) => p.id));

  let files: string[] = [];
  try {
    files = (await fs.readdir(PHOTOS_DIR)).filter((f) => IMAGE_RE.test(f));
  } catch {
    console.error(`No /photos directory yet at ${PHOTOS_DIR}`);
  }

  let added = 0;
  for (const file of files) {
    const buf = await fs.readFile(path.join(PHOTOS_DIR, file));
    const id = hashBuffer(buf);
    if (known.has(id)) continue;
    process.stdout.write(`  analysing ${file}\n`);
    const photo = await processPhoto(buf, id, file);
    const { addPhoto } = await import('../src/lib/manifest');
    await addPhoto(photo);
    known.add(id);
    added++;
  }

  const manifest = await rebuild();
  printBreakdown(manifest, added);
}

function bar(n: number, max: number, width = 24): string {
  const filled = max > 0 ? Math.round((n / max) * width) : 0;
  return '█'.repeat(filled) + '·'.repeat(width - filled);
}

function printBreakdown(manifest: Awaited<ReturnType<typeof rebuild>>, added: number) {
  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log(`  COLOUR ARCHIVE — chapter breakdown`);
  console.log(`  ${manifest.count} photographs · ${manifest.chapters.length} chapters · ${added} new`);
  console.log(line);
  const max = Math.max(1, ...manifest.chapters.map((c) => c.photos.length));
  manifest.chapters.forEach((ch, i) => {
    const rn = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI'][i] ?? `${i + 1}`;
    const meanH = ch.key === 'achromatic' ? '—' : `${ch.oklch.H.toFixed(0)}°`;
    console.log(
      `  ${rn.padEnd(4)} ${ch.name.padEnd(12)} ${String(ch.photos.length).padStart(3)}  ${bar(ch.photos.length, max)}  hue ${meanH}`,
    );
  });
  console.log(line);
  console.log(`  Check the grouping. Rename or reassign in photos.overrides.json.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
