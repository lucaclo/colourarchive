/**
 * A machine-death check. This archive's originals live only on this Mac's
 * disk — gitignored on purpose (they're large, and photographs are not code)
 * — and the pipeline that reads them depends on things `npm install` does not
 * manage: a LibRaw binary on PATH, sharp's native build, and ~420MB of vision
 * models that live *inside* `node_modules` rather than in the project. None of
 * that shows up as a red test; it shows up as a confusing failure the day this
 * runs on a machine that isn't the one it was set up on.
 *
 *   npm run doctor         quick checks only (seconds)
 *   npm run doctor -- --deep   also re-hashes every original against its
 *                              recorded id (minutes, depending on archive size)
 *
 * `--deep` is opt-in because it reads every byte of every original in
 * `photos/` — cheap for a few dozen RAWs, not something to run by accident on
 * every `npm test`. What it catches, nothing else here does: `photos.json`'s
 * `id` is `hashBuffer` of the original's own bytes (see ingest.ts) — recorded
 * once, at upload, and never touched again. If a file on disk no longer hashes
 * to the id that named it, something changed it after the fact: a bad copy, a
 * bit of bitrot, a manual edit. `check:photos` (run as part of this) already
 * catches a derivative or a manifest entry with nothing behind it; it has no
 * way to notice a file that is still there but is quietly not what it used to
 * be.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { PHOTOS_DIR } from '../src/lib/paths.ts';
import { readStore } from '../src/lib/manifest.ts';
import { hashBuffer } from '../src/lib/ingest.ts';
import { canDecodeRaw } from '../src/lib/match/decode.ts';

const DEEP = process.argv.includes('--deep');

let failed = false;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const warn = (msg: string) => console.log(`  ! ${msg}`);
const fail = (msg: string) => { console.log(`  ✗ ${msg}`); failed = true; };
const section = (title: string) => console.log(`\n${title}`);

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function checkRuntime(): Promise<void> {
  section('Runtime');
  ok(`node ${process.version}`);

  try {
    // Round-trips a tiny synthetic image through sharp's native binary —
    // catches "works on this Mac, not the next one" before an upload does.
    const buf = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#888' } })
      .png()
      .toBuffer();
    if (buf.length > 0) ok(`sharp ${(sharp as unknown as { versions?: { vips?: string } }).versions?.vips ? `(libvips ${(sharp as unknown as { versions: { vips: string } }).versions.vips})` : ''}`.trim());
    else fail('sharp produced an empty buffer');
  } catch (err) {
    fail(`sharp cannot encode an image here: ${(err as Error).message}`);
  }

  // LibRaw's dcraw_emu, or the macOS sips fallback — see decode.ts. Neither
  // is installed by `npm install`; both are silent until a RAW is dropped in.
  if (await canDecodeRaw()) ok('a RAW decoder is available (LibRaw or sips)');
  else fail('no RAW decoder found — Style Match cannot read ARW/CR3/NEF/RAF/DNG here (see README\'s Style Match section)');
}

// The five models the pipeline actually calls `from_pretrained`/`pipeline`
// with — see embed.ts, clip.ts, genre.ts (reuses clip's), match/regions.ts.
// Checked by directory presence, not by loading them: loading a model that
// isn't cached triggers a real download, and a health check should never do
// that as a side effect. If any of these need fetching, ingest a photo (or
// run a match) once, deliberately, while online.
const MODELS = [
  'Xenova/dinov2-small',
  'Xenova/clip-vit-base-patch32',
  'Xenova/segformer-b2-finetuned-ade-512-512',
  'Xenova/segformer_b2_clothes',
  'briaai/RMBG-1.4',
];

async function checkModels(): Promise<void> {
  section('Vision models (@xenova/transformers)');
  const cacheRoot = path.join(process.cwd(), 'node_modules', '@xenova', 'transformers', '.cache');
  if (!(await exists(cacheRoot))) {
    warn('no model cache found yet — each will download on first use (a few hundred MB total)');
    return;
  }
  let missing = 0;
  for (const id of MODELS) {
    const dir = path.join(cacheRoot, ...id.split('/'));
    if (await exists(path.join(dir, 'onnx'))) ok(id);
    else { warn(`${id} — not cached, will download on first use`); missing++; }
  }
  // This cache sits inside node_modules, not the project root — `.cache/`
  // is not even in .gitignore because it was never expected to need one.
  // `npm ci`, a lockfile-driven reinstall, or deleting node_modules to fix
  // an unrelated dependency problem all wipe it silently, and the next
  // upload or match just re-downloads everything with no warning first.
  if (missing === 0) {
    warn('cache lives inside node_modules/@xenova/transformers/.cache — a full reinstall wipes it, not just an upgrade of this package');
  }
}

async function checkCerts(): Promise<void> {
  section('HTTPS certs (optional — only needed to test the offline PWA on iPad)');
  const has = await exists(path.join(process.cwd(), 'certs', 'server.key')) && (await exists(path.join(process.cwd(), 'certs', 'server.crt')));
  if (has) ok('certs/server.key and certs/server.crt are present');
  else warn('not present — the app still runs over plain HTTP; see README for mkcert setup if you need to test offline on a phone');
}

async function checkManifestAgainstFiles(): Promise<void> {
  section('Manifest against the files on disk (npm run check:photos)');
  try {
    execFileSync('npx', ['tsx', 'scripts/check-photos.ts'], { stdio: 'inherit' });
    ok('check:photos passed');
  } catch {
    fail('check:photos found a mismatch — see its own output above');
  }
}

async function checkIntegrity(): Promise<void> {
  section('Original file integrity (--deep: re-hashing every original)');
  const photos = await readStore();
  const started = Date.now();
  let checked = 0;
  let missing = 0;
  const mismatched: string[] = [];
  for (const p of photos) {
    const full = path.join(PHOTOS_DIR, p.filename);
    let buf: Buffer;
    try {
      buf = await fs.readFile(full);
    } catch {
      missing++; // already reported by check:photos above — not this check's job
      continue;
    }
    checked++;
    const actual = hashBuffer(buf);
    if (actual !== p.id) mismatched.push(`${p.filename} — recorded as ${p.id}, now hashes to ${actual}`);
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (mismatched.length === 0) {
    ok(`${checked} original${checked === 1 ? '' : 's'} still hash to the id recorded at upload (${secs}s)`);
  } else {
    fail(`${mismatched.length} original${mismatched.length === 1 ? '' : 's'} no longer match the hash recorded at upload — the file changed after ingest:`);
    for (const m of mismatched) console.log(`      ${m}`);
  }
  if (missing > 0) warn(`${missing} manifest ${missing === 1 ? 'entry has' : 'entries have'} no original on disk — see check:photos above`);
}

async function main(): Promise<void> {
  await checkRuntime();
  await checkModels();
  await checkCerts();
  await checkManifestAgainstFiles();
  if (DEEP) await checkIntegrity();
  else console.log('\n(skipping original-file integrity — pass --deep to re-hash every photograph against its recorded id)');

  console.log(failed ? '\nSomething above needs attention.' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
