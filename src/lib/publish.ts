/**
 * What the published site says about itself, and the check that it is publishable.
 *
 * Two things the archive had no way to know, both of which cost it ten days:
 *
 * A photograph could be listed with no file behind it, and the first anyone knew
 * was a 404 in a phone's network log. So the build audits the images it just
 * emitted against the manifest it just baked, and refuses to finish if an entry
 * would reach a reader as a hole.
 *
 * And a deployed site looked exactly like a current one. Netlify has no
 * repository linked here — deliberately, since `photos/` and `public/img/*` are
 * out of git and a repository-driven build would list 79 photographs and be able
 * to show none of them — so publishing is one manual command, and a manual
 * command that is not run leaves no trace. `publish.json` is that trace: a stamp
 * the built site carries, so the drift between the Mac and the web is a thing
 * anyone can read rather than a thing someone has to notice.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPhotos, describeAudit } from './derivatives';
import type { Audit } from './derivatives';
import { INSPIRATION_STORE, MANIFEST_PATH } from './paths';
import type { Manifest, Photo } from './types';

/**
 * The build hook reads `photos.json` and `manifest.json` straight off disk
 * rather than through `./manifest`.
 *
 * Not a preference. `astro:build:done` runs after Vite has closed its module
 * runner, so a dynamic import from inside the hook throws "Vite module runner
 * has been closed" — and importing the module statically would pull the whole
 * mutation layer, its write lock and its auto-deploy timer into the config file
 * that every `astro dev` loads. Two JSON files, read once, at the end.
 */
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_MANIFEST: Manifest = { generatedAt: '', count: 0, chapters: [] };

/**
 * Audit a directory of derivatives against the records that own them.
 *
 * Two decisions, both learned the hard way:
 *
 * **What can break is what the page renders**, so the fatal half is measured
 * against `manifest.json` — the file the archive page is actually built from —
 * rather than `photos.json`. A store that will not parse used to audit as zero
 * entries and pass, while the page went on rendering from a manifest nobody had
 * checked; auditing the rendered record cannot fail open that way, because an
 * unreadable manifest is a page with no photographs on it.
 *
 * **What owns a file is not only the archive.** The inspiration board keeps its
 * own store and writes into the same `public/img`. Auditing without it declares
 * every reference on the board an orphan — which is not a hypothetical: the
 * first `--prune` run deleted all thirteen of them.
 */
export async function auditRendered(files: string[]): Promise<{ audit: Audit; manifest: Manifest }> {
  const [manifest, board] = await Promise.all([
    readJson<Manifest>(MANIFEST_PATH, EMPTY_MANIFEST),
    readJson<Photo[]>(INSPIRATION_STORE, []),
  ]);
  const rendered = manifest.chapters.flatMap((c) => c.photos);
  const audit = auditPhotos([...rendered, ...board], files);
  return { manifest, audit: onlyRendered(audit, new Set(rendered.map((p) => p.id))) };
}

/**
 * Narrow an audit's faults to the photographs the published page renders,
 * keeping its orphans as they are.
 *
 * The board owns files in the same directory, so it has to be in the audit or
 * every reference on it reads as an orphan. But it is `prerender = false` and
 * never reaches the published build, so a hole in it is the CLI's business and
 * not a reason to refuse to publish the archive. Both halves are needed and they
 * pull in opposite directions; this is where they meet.
 */
export function onlyRendered(audit: Audit, renderedIds: Set<string>): Audit {
  return {
    ...audit,
    missing: audit.missing.filter((m) => renderedIds.has(m.id)),
    undeclared: audit.undeclared.filter((u) => renderedIds.has(u.id)),
  };
}

/**
 * Where the archive is published.
 *
 * Hard-coded rather than asked of Netlify: `.netlify/state.json` holds a site id
 * and nothing else, and turning that into a URL needs an authenticated API call
 * — a login prompt standing between someone and the answer to "is the site up to
 * date". Overridable for a rename or a second host.
 */
export const SITE_URL = process.env.SITE_URL ?? 'https://colourarchive.netlify.app';

/** The stamp the built site carries at `/publish.json`. */
export interface PublishStamp {
  /** When this snapshot was built. The deploy follows within seconds. */
  builtAt: string;
  count: number;
  chapters: number;
  /** Every photograph's id, in the order the archive presents them. */
  photos: string[];
}

export const STAMP_FILE = 'publish.json';

export function stampFor(manifest: Manifest, builtAt: Date): PublishStamp {
  return {
    builtAt: builtAt.toISOString(),
    count: manifest.count,
    chapters: manifest.chapters.length,
    photos: manifest.chapters.flatMap((c) => c.photos.map((p) => p.id)),
  };
}

/** Read a stamp back, tolerating anything that is not one. */
export function parseStamp(value: unknown): PublishStamp | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.builtAt !== 'string' || typeof v.count !== 'number') return null;
  // A date that will not parse is not a stamp. Letting it through printed the
  // age as "(null days ago)", which reads like a bug in the report rather than
  // what it is — a file at that URL that is not the one we wrote.
  if (!Number.isFinite(Date.parse(v.builtAt))) return null;
  return {
    builtAt: v.builtAt,
    count: v.count,
    chapters: typeof v.chapters === 'number' ? v.chapters : 0,
    photos: Array.isArray(v.photos) ? v.photos.filter((p): p is string => typeof p === 'string') : [],
  };
}

/**
 * The published count, read off the cover of the site itself.
 *
 * The fallback for a site published before the stamp existed — which is every
 * site this ships to, exactly once. The cover kicker has read "N · M chapters"
 * since the archive had a cover, so the one number that matters is recoverable
 * without a stamp. Returns null rather than a guess if the cover has changed.
 */
export function coverCount(html: string): { count: number; chapters: number } | null {
  const match = /class="cover-kicker"[^>]*>\s*(\d+)\s*·\s*(\d+)\s*chapters/.exec(html);
  if (!match) return null;
  return { count: Number(match[1]), chapters: Number(match[2]) };
}

/** The difference between what is on the Mac and what is on the web. */
export interface Drift {
  local: PublishStamp;
  /** null when the published site predates the stamp, or could not be read. */
  published: PublishStamp | null;
  /** Photograph ids here and not there. */
  added: string[];
  /** Photograph ids there and not here — removed since, or published from elsewhere. */
  removed: string[];
  /** Whole days between the published build and now, or null without a stamp. */
  ageDays: number | null;
  /** What the published cover claims, when there is no stamp to ask. */
  cover?: { count: number; chapters: number } | null;
  /** Whether the published stamp named its photographs, or only counted them. */
  named: boolean;
  drifted: boolean;
}

export function driftBetween(
  local: PublishStamp,
  published: PublishStamp | null,
  now: Date,
  cover: { count: number; chapters: number } | null = null,
): Drift {
  // A stamp from a build before the photo list existed carries a count and no
  // ids. Comparing against its empty list would report every photograph as new,
  // which is the same false alarm the `!published` branch exists to avoid — so
  // that stamp answers "how many", and nothing else is claimed from it.
  const names = Boolean(published?.photos.length);
  const there = new Set(published?.photos ?? []);
  const here = new Set(local.photos);
  const added = names ? local.photos.filter((id) => !there.has(id)) : [];
  const removed = names ? published!.photos.filter((id) => !here.has(id)) : [];
  const builtAt = published ? Date.parse(published.builtAt) : NaN;
  const ageDays = Number.isFinite(builtAt)
    ? Math.floor((now.getTime() - builtAt) / 86_400_000)
    : null;
  // No stamp is itself drift: the published site is old enough to predate the
  // stamp, which is the state this whole mechanism was written for.
  const drifted =
    !published || added.length > 0 || removed.length > 0 || published.count !== local.count;
  return { local, published, added, removed, ageDays, cover, named: names, drifted };
}

/**
 * The drift, in words. `nameOf` turns an id into the photograph's filename — the
 * caller has the store, this does not.
 */
export function describeDrift(drift: Drift, nameOf: (id: string) => string): string[] {
  const { local, published } = drift;
  const lines: string[] = [];
  if (!published) {
    lines.push(
      `Published: no stamp at ${SITE_URL}/${STAMP_FILE}.`,
      '  Either the site was last published before the stamp existed, or it could not be reached.',
    );
    if (drift.cover) {
      lines.push(
        `  Its cover says ${drift.cover.count} photographs · ${drift.cover.chapters} chapters,` +
          ` against ${local.count} here.`,
      );
    }
  } else {
    const age = drift.ageDays === 0 ? 'today' : `${drift.ageDays} day${drift.ageDays === 1 ? '' : 's'} ago`;
    lines.push(`Published: ${published.count} photographs · built ${published.builtAt.slice(0, 10)} (${age})`);
  }
  lines.push(`On the Mac: ${local.count} photographs · ${local.chapters} chapters`);

  if (drift.added.length) {
    lines.push('', `Would add ${drift.added.length} photograph${drift.added.length === 1 ? '' : 's'}:`);
    for (const id of drift.added.slice(0, 12)) lines.push(`  ${nameOf(id)}`);
    if (drift.added.length > 12) lines.push(`  …and ${drift.added.length - 12} more`);
  }
  if (drift.removed.length) {
    lines.push('', `Would remove ${drift.removed.length} published photograph${drift.removed.length === 1 ? '' : 's'}:`);
    for (const id of drift.removed.slice(0, 12)) lines.push(`  ${nameOf(id)}`);
    if (drift.removed.length > 12) lines.push(`  …and ${drift.removed.length - 12} more`);
  }
  if (!drift.drifted) {
    // Deliberately only about photographs. This used to read "The published site
    // is this archive", printed directly under a line saying Scout's functions
    // answer 404 — a summary that contradicts the measurement above it is worse
    // than no summary, and silence about a dead endpoint is what started all
    // this. What this function can see is the photographs; it says that much.
    lines.push('', 'The published site has the same photographs as this archive.');
    if (!drift.named) {
      lines.push('  (Its stamp counts them but does not name them, so only the counts were compared.)');
    }
  }
  return lines;
}

/**
 * Astro integration: stamp the build, then check it.
 *
 * The order matters. The stamp is written first so a build that fails the audit
 * still leaves the directory describing itself accurately for whoever looks; the
 * throw then stops the deploy that would have followed.
 *
 * Only a *missing* derivative throws — that is the one that reaches a reader as
 * a broken image. An orphaned file and an undeclared width are both reported and
 * neither blocks a publish: refusing to publish 79 correct photographs over a
 * file nobody can reach would make the honest manual route harder to run, which
 * is the failure this whole pair of changes exists to stop.
 */
export function publishStamp() {
  return {
    name: 'colour-archive:publish-stamp',
    hooks: {
      'astro:build:done': async ({ dir, logger }: { dir: URL; logger: { info: (m: string) => void; warn: (m: string) => void } }) => {
        // fileURLToPath, not `dir.pathname`: this project lives in a directory
        // with a space in its name, and a pathname would hand `%20` to fs.
        const out = fileURLToPath(dir);

        // Audit what was emitted, not what is in public/ — the published site is
        // the only thing a reader ever asks for, and the copy step between them
        // is exactly the sort of thing that could go wrong quietly.
        const imgDir = path.join(out, 'img');
        let files: string[] = [];
        try {
          files = await fs.readdir(imgDir);
        } catch {
          /* no images emitted at all — the audit below will say so loudly */
        }
        const { audit, manifest } = await auditRendered(files);

        const stamp = stampFor(manifest, new Date());
        await fs.writeFile(path.join(out, STAMP_FILE), `${JSON.stringify(stamp, null, 2)}\n`);
        logger.info(`stamped ${stamp.count} photographs · ${stamp.chapters} chapters`);

        if (audit.missing.length) {
          throw new Error(
            `This build would publish ${audit.missing.length} broken image${audit.missing.length === 1 ? '' : 's'}.\n\n` +
              `${describeAudit(audit).join('\n')}\n\n` +
              `Run \`npm run check:photos -- --fix\` and build again.`,
          );
        }
        // A summary, not the list. Neither of these stops a publish, and a build
        // that prints twenty lines nobody has to act on teaches the reader to
        // skip the output — including the day it says something else.
        const notes = [
          audit.undeclared.length && `${audit.undeclared.length} width(s) no derivative records`,
          audit.orphans.length && `${audit.orphans.length} file(s) no entry owns`,
        ].filter(Boolean);
        if (notes.length) logger.warn(`${notes.join(', ')} — see \`npm run check:photos\``);
      },
    },
  };
}
