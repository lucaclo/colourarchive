/**
 * The book's own curation — issue #82.
 *
 * `export:sequence` and `export:print` (scripts/export-*.ts) build an ordered
 * chapter-and-photo sequence straight from the manifest — every photo, in
 * archive order, with no way to reorder within a chapter or leave one out.
 * That was the largest gap between what the archive already does and a
 * printable object: hand-editing a script's output to drop or reorder a
 * plate is not a workflow, it is a workaround.
 *
 * This is a curation *layer*, not a copy. It never duplicates a photo's own
 * data — only which of a chapter's photos belong in the book and in what
 * order, keyed by the same ids the manifest already uses. A chapter absent
 * here, or a photo absent from its chapter's saved order, has simply never
 * been curated: it falls back to manifest order, included, so ingesting a
 * new photo can never make it silently drop out of a book nobody has
 * curated yet.
 *
 * Deliberately separate from `Overrides` (manifest.ts): an override changes
 * what a photo *is* for the whole archive (its chapter, medium, genre); this
 * changes only whether and where it sits in one particular curated object.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { BOOK_PATH } from './paths';
import type { Chapter, Photo } from './types';

export interface BookCuration {
  /** Chapter key -> every one of that chapter's photo ids, in curated
   *  order — both included and excluded, so re-including a photo restores
   *  its place rather than dropping it at the end. */
  chapters?: Record<string, string[]>;
  /** Photo ids left out of the book, wherever they sit in their chapter's
   *  order above. */
  excluded?: string[];
}

async function readJson(): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(BOOK_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/** Validated rather than trusted — this is user-editable JSON on disk, same
 *  posture `spots.ts` takes with its own on-disk-adjacent storage. */
function readCuration(value: unknown): BookCuration {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const curation: BookCuration = {};

  if (raw.chapters && typeof raw.chapters === 'object' && !Array.isArray(raw.chapters)) {
    const chapters: Record<string, string[]> = {};
    for (const [key, order] of Object.entries(raw.chapters as Record<string, unknown>)) {
      if (Array.isArray(order) && order.every((id) => typeof id === 'string')) {
        chapters[key] = order as string[];
      }
    }
    if (Object.keys(chapters).length) curation.chapters = chapters;
  }

  if (Array.isArray(raw.excluded) && raw.excluded.every((id) => typeof id === 'string')) {
    curation.excluded = raw.excluded as string[];
  }

  return curation;
}

export async function readBookCuration(): Promise<BookCuration> {
  return readCuration(await readJson());
}

// Same read-modify-write hazard manifest.ts's own overrides carry — two
// saves in close succession must not let the second clobber the first.
let writeChain: Promise<unknown> = Promise.resolve();
export function writeBookCuration(curation: BookCuration): Promise<void> {
  const run = writeChain.then(() => write(curation), () => write(curation));
  writeChain = run.catch(() => {});
  return run;
}

async function write(curation: BookCuration): Promise<void> {
  await fs.mkdir(path.dirname(BOOK_PATH), { recursive: true });
  const tmp = `${BOOK_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(curation, null, 2));
  await fs.rename(tmp, BOOK_PATH);
}

/**
 * One chapter's photos in curated order, excluded ones included — the
 * shared ordering step behind both `curatedChapters` below (which then
 * drops the excluded ones for export) and the editor (which needs to show
 * them, so a photo can be included again rather than only ever removed).
 */
function orderedPhotos(chapter: Chapter, curation: BookCuration): Photo[] {
  const order = curation.chapters?.[chapter.key];
  if (!order?.length) return chapter.photos;
  const byId = new Map(chapter.photos.map((p) => [p.id, p] as const));
  const ordered: Photo[] = [];
  for (const id of order) {
    const p = byId.get(id);
    if (p) {
      ordered.push(p);
      byId.delete(id);
    }
  }
  // A photo ingested since this chapter was last curated isn't in the saved
  // order — kept, at its manifest position, rather than silently dropped
  // for not having been curated yet.
  for (const p of chapter.photos) if (byId.has(p.id)) ordered.push(p);
  return ordered;
}

/**
 * The book's own sequence: manifest grouping, curation's order and
 * exclusions applied. A chapter emptied entirely by exclusion drops out
 * rather than printing a divider for nothing.
 */
export function curatedChapters(chapters: Chapter[], curation: BookCuration): Chapter[] {
  const excluded = new Set(curation.excluded ?? []);
  return chapters
    .map((ch) => ({ ...ch, photos: orderedPhotos(ch, curation).filter((p) => !excluded.has(p.id)) }))
    .filter((ch) => ch.photos.length > 0);
}

export interface BookEditorPhoto extends Photo {
  excluded: boolean;
}

export interface BookEditorChapter {
  key: string;
  name: string;
  photos: BookEditorPhoto[];
}

/**
 * Every chapter's photos in curated order, marked rather than filtered —
 * what the editor itself shows, and what `/api/book`'s GET hands the client.
 * Unlike `curatedChapters`, nothing here is ever dropped: an excluded photo
 * is still a photo the editor needs to offer back in.
 */
export function orderedChaptersWithExclusions(chapters: Chapter[], curation: BookCuration): BookEditorChapter[] {
  const excluded = new Set(curation.excluded ?? []);
  return chapters.map((ch) => ({
    key: ch.key,
    name: ch.name,
    photos: orderedPhotos(ch, curation).map((p) => ({ ...p, excluded: excluded.has(p.id) })),
  }));
}
