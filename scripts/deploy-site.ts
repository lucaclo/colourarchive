/**
 * Publish the archive, and say what publishing changed.
 *
 *   npm run deploy:site      preflight, publish, then confirm it arrived
 *   npm run drift            the preflight alone — nothing is published
 *
 * `netlify deploy --prod` on its own was the whole publishing route, and it is a
 * good one: the photographs and their derivatives are out of git deliberately
 * (they are large, and a repository-driven build would produce a site listing
 * seventy-nine photographs and able to show none of them), so one manual command
 * that carries both the code and the imagery is the honest shape.
 *
 * What it could not do is fail loudly enough. Publishing had drifted ten days
 * and 69-against-79 photographs behind the Mac, and the site did not look old,
 * it looked fine — the failure mode is silence. Three attempts on 10 August all
 * died inside Netlify's API and left the same silence behind them.
 *
 * So the command now brackets the deploy with the two questions silence hides:
 * what is the difference between here and there, and did the thing I just sent
 * actually arrive. Both are answered against `/publish.json`, the stamp the build
 * writes into the site — see src/lib/publish.ts.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, IMG_DIR } from '../src/lib/paths.ts';
import { readManifest, readStore } from '../src/lib/manifest.ts';
import { auditPhotos, describeAudit } from '../src/lib/derivatives.ts';
import {
  SITE_URL,
  STAMP_FILE,
  coverCount,
  describeDrift,
  driftBetween,
  parseStamp,
  stampFor,
  type PublishStamp,
} from '../src/lib/publish.ts';

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
/** Anything else is the caller's business with the Netlify CLI (-m, --alias…). */
const PASSTHROUGH = argv.filter((a) => a !== '--check');

const BUILT = path.join(ROOT, 'dist', 'client');
const rule = (label: string) => `\n── ${label} ${'─'.repeat(Math.max(0, 60 - label.length))}`;

/** Fetch the site's stamp. Never throws: not reachable is an answer too. */
async function fetchStamp(): Promise<{ stamp: PublishStamp | null; note?: string }> {
  // The service worker treats same-origin .json as cache-first, and a CDN has
  // opinions of its own; a stamp read through either would describe a site that
  // may no longer exist. Bust both.
  const url = `${SITE_URL}/${STAMP_FILE}?t=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { stamp: null, note: `${res.status} ${res.statusText}` };
    const stamp = parseStamp(await res.json().catch(() => null));
    return stamp ? { stamp } : { stamp: null, note: '200, but not a stamp' };
  } catch (err) {
    return { stamp: null, note: err instanceof Error ? err.message : String(err) };
  }
}

/** What the published cover claims, for a site that has no stamp yet. */
async function fetchCover(): Promise<{ count: number; chapters: number } | null> {
  try {
    const res = await fetch(`${SITE_URL}/?t=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return coverCount(await res.text());
  } catch {
    return null;
  }
}

/**
 * Are the two server functions live?
 *
 * Scout is almost entirely client-side, but place search and the dragged pin's
 * name go through `/api/scout/*` because Nominatim sends no CORS header. A deploy
 * that predates those functions serves Netlify's HTML 404 for them, and the page
 * shows an empty search rather than an error — which is how they were found to
 * have been missing for ten days.
 */
async function functionsLive(): Promise<string> {
  const url = `${SITE_URL}/api/scout/geocode?q=edinburgh`;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type.includes('json')) return 'live';
    return `${res.status}, ${type.split(';')[0] || 'no content-type'} — not a function`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** The manifest against the derivatives, before anything is uploaded. */
async function preflightImages(): Promise<boolean> {
  const [photos, files] = await Promise.all([
    readStore(),
    fs.readdir(IMG_DIR).catch(() => [] as string[]),
  ]);
  const audit = auditPhotos(photos, files);
  if (audit.missing.length || audit.undeclared.length) {
    console.error(rule('images'));
    console.error(describeAudit(audit).join('\n'));
    console.error('\nRun `npm run check:photos -- --fix` first — this would publish broken images.');
    return false;
  }
  return true;
}

/** The stamp the build just wrote, so "did it arrive" has an exact answer. */
async function builtStamp(): Promise<PublishStamp | null> {
  try {
    return parseStamp(JSON.parse(await fs.readFile(path.join(BUILT, STAMP_FILE), 'utf8')));
  } catch {
    return null;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [manifest, photos] = await Promise.all([readManifest(), readStore()]);
  const nameOf = (id: string) => photos.find((p) => p.id === id)?.filename ?? id;
  const local = stampFor(manifest, new Date());

  console.log(rule('drift'));
  const { stamp: published, note } = await fetchStamp();
  if (note) console.log(`  (${SITE_URL}/${STAMP_FILE} → ${note})`);
  const drift = driftBetween(local, published, new Date(), published ? null : await fetchCover());
  console.log(describeDrift(drift, nameOf).join('\n'));
  console.log(`\nScout's server functions: ${await functionsLive()}`);

  if (CHECK) {
    console.log('\nNothing published — run `npm run deploy:site` to publish.');
    return;
  }

  if (!(await preflightImages())) process.exit(1);

  console.log(rule('publish'));
  const code = await new Promise<number>((resolve) => {
    const child = spawn('npx', ['--no-install', 'netlify', 'deploy', '--prod', ...PASSTHROUGH], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('exit', (c) => resolve(c ?? 1));
    child.on('error', () => resolve(1));
  });
  if (code !== 0) {
    // No claim about what is live: a deploy can fail after the upload as easily
    // as before it. `npm run drift` is the thing that actually knows.
    console.error(`\nThe deploy exited ${code}. Run \`npm run drift\` to see what is published now.`);
    process.exit(code);
  }

  // Netlify's CLI has exited 0 on a deploy that never landed. Ask the site.
  console.log(rule('confirm'));
  const sent = await builtStamp();
  if (!sent) {
    console.log('The build wrote no stamp — cannot confirm what is live. Check the site by hand.');
    return;
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
    const { stamp: live } = await fetchStamp();
    if (live?.builtAt === sent.builtAt) {
      console.log(`Live: ${live.count} photographs · the build from ${live.builtAt}.`);
      return;
    }
    if (attempt < 6) await wait(5000);
    else {
      console.error(
        `Sent the build from ${sent.builtAt}, but ${SITE_URL} still answers with ` +
          `${live ? `the build from ${live.builtAt}` : 'no stamp'}.\n` +
          'The deploy reported success and the site did not change. Check app.netlify.com.',
      );
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
