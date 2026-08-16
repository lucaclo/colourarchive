/**
 * The manifest and the files in public/img are two records of the same set of
 * photographs, and until this module nothing checked one against the other.
 *
 * Both drift, in opposite directions. An entry can name a derivative that is not
 * on disk — the page then lays out a slot, asks for the file, and the reader gets
 * a hole where a photograph should be. And a file can outlive the entry that
 * owned it, which costs nothing visible but ships bytes nobody can ever reach.
 *
 * The audit here is pure: it takes the entries and a listing of what is present
 * and returns both directions of the mismatch. The callers supply the world —
 * `scripts/check-photos.ts` reads public/img, the build hook reads the emitted
 * dist/client/img, and neither has to agree with the other about anything except
 * this file's idea of which derivatives an entry ought to have.
 */
import type { Photo } from './types';

// Widths for on-screen derivatives. Originals stay byte-for-byte untouched in
// /photos — derivatives are display-only.
export const WIDTHS = [640, 1280, 2000];

/**
 * The tag in a derivative's filename: a width, or `full` for a photograph too
 * small for even the narrowest width, which is emitted once at native size.
 */
export type Tag = number | 'full';

/** Formats still generated on ingest. `webp` was dropped once AVIF was universal. */
export const FORMATS = ['avif', 'webp'] as const;
export type Format = (typeof FORMATS)[number];
export const GENERATED: Format = 'avif';

/**
 * The derivatives a photograph of this source width ought to have.
 *
 * Deliberately mirrors the generator in `ingest.ts` line for line, including its
 * edge cases: a source narrower than a width never produces that width (nothing
 * is ever upscaled), and a source whose width could not be read at all gets the
 * full set, because that is what the generator does with a falsy width.
 *
 * This is why a bare count of files per width proves nothing. Only 46 of the 79
 * photographs here are 2000px or wider, so 46 is the correct number of 2000px
 * derivatives, not a shortfall.
 */
export function expectedTags(sourceWidth: number): Tag[] {
  if (!sourceWidth) return [...WIDTHS];
  const fits = WIDTHS.filter((w) => w <= sourceWidth);
  return fits.length ? fits : ['full'];
}

/** Filename of a derivative — the same name `ingest.ts` writes. */
export const derivativeName = (id: string, tag: Tag, format: Format = GENERATED): string =>
  `${id}-${tag}.${format}`;

/** The bare filename behind a `/img/…` path recorded in the manifest. */
export const fileOf = (url: string): string => url.replace(/^\/img\//, '');

/** The tag a derivative filename carries, or null if it is not one of ours. */
export function tagOf(file: string): Tag | null {
  const match = /^[0-9a-f]+-(\d+|full)\.(?:avif|webp)$/.exec(file);
  if (!match) return null;
  return match[1] === 'full' ? 'full' : Number(match[1]);
}

/** A derivative the manifest promises and the disk does not have. */
export interface MissingFile {
  id: string;
  filename: string;
  file: string;
  format: Format;
  /** The width recorded alongside it — what the page would put in its srcset. */
  width: number;
}

/** A width the source is large enough for that no derivative records. */
export interface MissingTag {
  id: string;
  filename: string;
  tag: Tag;
}

export interface Audit {
  entries: number;
  files: number;
  /** Declared, absent. The one that reaches a reader as a broken image. */
  missing: MissingFile[];
  /** Expected of the source, never declared. Not a 404 — a smaller largest size. */
  undeclared: MissingTag[];
  /** Present, owned by no entry. */
  orphans: string[];
}

/**
 * Compare the entries against a listing of what is in the image directory.
 *
 * `present` is a flat list of filenames. Dotfiles are ignored — `.gitkeep` is
 * how the directory survives a clone with every derivative gitignored, and
 * reporting it as an orphan every time would train the reader to skim the list.
 */
export function auditPhotos(photos: Photo[], present: Iterable<string>): Audit {
  const files = new Set([...present].filter((f) => !f.startsWith('.')));
  const owned = new Set<string>();
  const missing: MissingFile[] = [];
  const undeclared: MissingTag[] = [];

  for (const photo of photos) {
    const declared = new Set<Tag>();
    for (const derivative of photo.derivatives) {
      for (const format of FORMATS) {
        const url = derivative[format];
        if (!url) continue;
        const file = fileOf(url);
        owned.add(file);
        // A declaration counts as covering its tag whether or not the file is
        // there: a missing file is already reported below, and reporting the
        // same fault twice under two headings makes the report harder to act on.
        if (format === GENERATED) {
          const tag = tagOf(file);
          if (tag !== null) declared.add(tag);
        }
        if (!files.has(file)) {
          missing.push({ id: photo.id, filename: photo.filename, file, format, width: derivative.width });
        }
      }
    }
    for (const tag of expectedTags(photo.width)) {
      if (!declared.has(tag)) undeclared.push({ id: photo.id, filename: photo.filename, tag });
    }
  }

  const orphans = [...files].filter((f) => !owned.has(f)).sort();
  return { entries: photos.length, files: files.size, missing, undeclared, orphans };
}

/** Nothing to report in either direction. */
export const auditClean = (audit: Audit): boolean =>
  audit.missing.length === 0 && audit.undeclared.length === 0 && audit.orphans.length === 0;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * How many photographs each heading names before it stops.
 *
 * The count above the list is the fact; the names are there to be acted on, and
 * a hundred and eighteen lines of them is a wall that gets scrolled past. The
 * remainder is always stated, never dropped silently.
 */
const SHOWN = 8;

function listGroups(lines: string[], groups: Array<[string, string[]]>): void {
  for (const [name, entries] of groups.slice(0, SHOWN)) {
    lines.push(`  ${name}`);
    for (const line of entries) lines.push(`    ${line}`);
  }
  const rest = groups.length - SHOWN;
  if (rest > 0) lines.push(`  …and ${plural(rest, 'other photograph', 'other photographs')}`);
}

/**
 * The report, as lines. Shared by the command and the build hook so the two
 * never describe the same state differently.
 */
export function describeAudit(audit: Audit): string[] {
  const lines: string[] = [
    `${plural(audit.entries, 'entry', 'entries')} in the manifest · ${plural(audit.files, 'file')} in the image directory`,
  ];

  if (audit.missing.length) {
    lines.push('', `Listed but not on disk — ${plural(audit.missing.length, 'derivative')}:`);
    // Severity first, since the list is capped. A photograph missing the format
    // the page actually requests is a hole on the page; one missing only a legacy
    // declaration is a wrong promise nothing reads. Both are faults, and only one
    // of them is what a reader is looking at.
    const groups = groupBy(audit.missing, (m) => m.filename).sort(
      (a, b) =>
        Number(b[1].some((m) => m.format === GENERATED)) - Number(a[1].some((m) => m.format === GENERATED)),
    );
    listGroups(
      lines,
      groups.map(([name, group]) => [name, group.map((m) => `${m.file}  (${m.width}w ${m.format})`)]),
    );
  }

  if (audit.undeclared.length) {
    lines.push('', `Large enough for a width no derivative records — ${plural(audit.undeclared.length, 'width')}:`);
    listGroups(
      lines,
      groupBy(audit.undeclared, (u) => u.filename).map(([name, group]) => [
        name,
        [group.map((u) => u.tag).join(', ')],
      ]),
    );
  }

  if (audit.orphans.length) {
    lines.push('', `On disk, owned by no entry — ${plural(audit.orphans.length, 'file')}:`);
    for (const file of audit.orphans.slice(0, SHOWN * 2)) lines.push(`  ${file}`);
    const rest = audit.orphans.length - SHOWN * 2;
    if (rest > 0) lines.push(`  …and ${plural(rest, 'other file')}`);
  }

  if (auditClean(audit)) lines.push('', 'Every entry has its files, and every file has its entry.');
  return lines;
}

function groupBy<T>(items: T[], key: (item: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(item);
  }
  return [...groups];
}
