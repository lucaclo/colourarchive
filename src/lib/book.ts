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

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BOOK_PATH } from './paths';
import type { Chapter, Photo } from './types';
import { TRIMS, isTreatment, isTrimId, type Treatment, type TrimId } from './book-pages';

export interface BookCuration {
  /** Chapter key -> every one of that chapter's photo ids, in curated
   *  order — both included and excluded, so re-including a photo restores
   *  its place rather than dropping it at the end. */
  chapters?: Record<string, string[]>;
  /** Photo ids left out of the book, wherever they sit in their chapter's
   *  order above. */
  excluded?: string[];
  /** Photo id -> chapter key it prints under in the book, when that differs
   *  from the photo's own manifest chapter. Book-only, same reasoning as the
   *  rest of this file's header: the photo's real (colour-derived) chapter
   *  is untouched, so this never reaches the archive's own overrides or
   *  triggers a rebuild/deploy — it just changes which section of the book
   *  the plate prints in. A target key absent from the manifest's own
   *  chapters is ignored (see `regroupedChapters`), so a chapter renamed or
   *  removed since a move was saved can't strand a photo. */
  moved?: Record<string, string>;
  /** Photo id -> how it sits on the page (book-pages.ts). Absent means a
   *  bordered photo on its own page. */
  layout?: Record<string, Treatment>;
  /** Photo ids with a blank page before them. */
  blankBefore?: string[];
  /** The page size last chosen, so the spread view and the PDF agree. */
  trim?: TrimId;
}

/** The page-layout fields, validated, as the file reader takes them. */
export function readLayoutFields(raw: Record<string, unknown>): Pick<BookCuration, 'layout' | 'blankBefore' | 'trim'> {
  const out: Pick<BookCuration, 'layout' | 'blankBefore' | 'trim'> = {};
  if (raw.layout && typeof raw.layout === 'object' && !Array.isArray(raw.layout)) {
    const layout: Record<string, Treatment> = {};
    for (const [id, t] of Object.entries(raw.layout as Record<string, unknown>)) if (isTreatment(t) && t !== 'border') layout[id] = t;
    if (Object.keys(layout).length) out.layout = layout;
  }
  if (Array.isArray(raw.blankBefore) && raw.blankBefore.every((id) => typeof id === 'string') && raw.blankBefore.length) {
    out.blankBefore = [...new Set(raw.blankBefore as string[])];
  }
  if (isTrimId(raw.trim)) out.trim = raw.trim;
  return out;
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

  if (raw.moved && typeof raw.moved === 'object' && !Array.isArray(raw.moved)) {
    const moved: Record<string, string> = {};
    for (const [id, chapterKey] of Object.entries(raw.moved as Record<string, unknown>)) {
      if (typeof chapterKey === 'string') moved[id] = chapterKey;
    }
    if (Object.keys(moved).length) curation.moved = moved;
  }

  return { ...curation, ...readLayoutFields(raw) };
}

export async function readBookCuration(): Promise<BookCuration> {
  return readCuration(await readJson());
}

// --- Saving: validate, merge, check the version (R13-01, R13-31) -----------
// The editor posts its whole state, but a save must never be able to empty
// the file: a field absent from the body keeps its saved value, and a field
// present replaces it — empty included, which is how the editor says "nothing
// left out" or "no moves". Every save also names the version of the file it
// was based on; if the file has changed since (another tab, the phone), the
// save is refused rather than written over the newer book.

/** The version of a book file that doesn't exist yet. */
export const EMPTY_BOOK_VERSION = 'empty';

/** A short hash of the file's bytes, or EMPTY_BOOK_VERSION when there is no file. */
export function bookVersionOf(bytes: Buffer | null): string {
  return bytes ? createHash('sha256').update(bytes).digest('hex').slice(0, 16) : EMPTY_BOOK_VERSION;
}

async function readBytes(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function curationOf(bytes: Buffer | null): BookCuration {
  if (!bytes) return {};
  try {
    return readCuration(JSON.parse(bytes.toString('utf8')));
  } catch {
    return {};
  }
}

/** The curation and the version of the bytes it came from, from one read. */
export async function readBookState(file = BOOK_PATH): Promise<{ curation: BookCuration; version: string }> {
  // Unreadable reads as empty, as readBookCuration does, so the page still
  // renders; a save re-reads strictly and fails instead of writing over it.
  const bytes = await readBytes(file).catch(() => null);
  return { curation: curationOf(bytes), version: bookVersionOf(bytes) };
}

/** What one save changes. A field absent keeps its saved value; null clears it. */
export type BookPatch = { [K in keyof BookCuration]?: BookCuration[K] | null };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const has = (o: Record<string, unknown>, key: string) => Object.hasOwn(o, key);

/** Validates a save's body. Any field present but malformed refuses the whole save. */
export function parseBookPatch(body: unknown): { ok: true; patch: BookPatch } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: 'Expected a JSON object.' };
  const bad = (field: string) => ({ ok: false as const, error: `Invalid ${field}.` });
  const patch: BookPatch = {};

  if (has(body, 'chapters')) {
    const v = body.chapters;
    if (!isRecord(v) || !Object.values(v).every(isStringArray)) return bad('chapters');
    // Empty means "nothing to say", never "forget every order": the page always
    // sends each chapter, so only another client could send {}.
    if (Object.keys(v).length) patch.chapters = v as Record<string, string[]>;
  }
  if (has(body, 'excluded')) {
    if (!isStringArray(body.excluded)) return bad('excluded');
    patch.excluded = body.excluded.length ? body.excluded : null;
  }
  if (has(body, 'moved')) {
    const v = body.moved;
    if (!isRecord(v) || !Object.values(v).every((key) => typeof key === 'string')) return bad('moved');
    patch.moved = Object.keys(v).length ? (v as Record<string, string>) : null;
  }
  if (has(body, 'layout')) {
    const v = body.layout;
    if (!isRecord(v) || !Object.values(v).every(isTreatment)) return bad('layout');
    // A border is the default, so it is never stored (as readLayoutFields).
    const layout = Object.fromEntries(Object.entries(v).filter(([, t]) => t !== 'border')) as Record<string, Treatment>;
    patch.layout = Object.keys(layout).length ? layout : null;
  }
  if (has(body, 'blankBefore')) {
    if (!isStringArray(body.blankBefore)) return bad('blankBefore');
    patch.blankBefore = body.blankBefore.length ? [...new Set(body.blankBefore)] : null;
  }
  if (has(body, 'trim')) {
    // Own keys only: `'toString' in TRIMS` is true.
    if (typeof body.trim !== 'string' || !Object.hasOwn(TRIMS, body.trim)) return bad('trim');
    patch.trim = body.trim as TrimId;
  }
  return { ok: true, patch };
}

/** The saved curation with a save's fields applied: present replaces, null clears, absent keeps. */
export function mergeBookCuration(saved: BookCuration, patch: BookPatch): BookCuration {
  const out: Record<string, unknown> = { ...saved };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete out[key];
    else out[key] = value;
  }
  return out as BookCuration;
}

export type BookSaveResult =
  | { status: 200; version: string }
  | { status: 400; error: string }
  | { status: 409; version: string };

// Same read-modify-write hazard manifest.ts's own overrides carry: the read,
// the version check and the write run as one step, one save at a time, so two
// saves arriving together can't both pass the check.
let writeChain: Promise<unknown> = Promise.resolve();

/**
 * One save from the editor: `body` is the POST body, with `version` naming
 * the file it was based on. A body with no version is refused like a stale
 * one (409): the editor always sends one, so its absence means a tab or a
 * script from before versions, which can't know what it would overwrite.
 */
export function saveBookCuration(body: unknown, file = BOOK_PATH): Promise<BookSaveResult> {
  const parsed = parseBookPatch(body);
  if (!parsed.ok) return Promise.resolve({ status: 400, error: parsed.error });
  const basedOn = (body as Record<string, unknown>).version;
  const step = () => commitSave(file, parsed.patch, basedOn);
  const run = writeChain.then(step, step);
  writeChain = run.catch(() => {});
  return run;
}

async function commitSave(file: string, patch: BookPatch, basedOn: unknown): Promise<BookSaveResult> {
  const bytes = await readBytes(file);
  const current = bookVersionOf(bytes);
  if (typeof basedOn !== 'string' || basedOn !== current) return { status: 409, version: current };
  if (!Object.keys(patch).length) return { status: 200, version: current };
  // Strict here, unlike the page's read: a hand-edited file that no longer
  // parses must fail the save, not be merged into {} and written over (and
  // then lose its backup to the next autosave).
  const saved = bytes ? readCuration(JSON.parse(bytes.toString('utf8'))) : {};
  const next = JSON.stringify(mergeBookCuration(saved, patch), null, 2);
  if (bytes && next === bytes.toString('utf8')) return { status: 200, version: current };
  await fs.mkdir(path.dirname(file), { recursive: true });
  // One backup: the bytes just checked, so it is exactly the book this save replaces.
  if (bytes) await fs.writeFile(`${file}.bak`, bytes);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, next);
  await fs.rename(tmp, file);
  return { status: 200, version: bookVersionOf(Buffer.from(next)) };
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
 * Re-sections photos across chapters per `curation.moved`, before either
 * ordering or exclusion is applied. Chapter identity (name, oklch) is kept
 * from the manifest's own grouping — a move only relocates which section a
 * photo's id shows up in, never invents a chapter.
 */
function regroupedChapters(chapters: Chapter[], curation: BookCuration): Chapter[] {
  const moved = curation.moved;
  if (!moved || !Object.keys(moved).length) return chapters;
  // Two passes, not one: a chapter's own photos keep their relative order and
  // sort ahead of anything moved in, rather than incoming photos landing
  // wherever their source chapter happened to be processed.
  const home = new Map(chapters.map((ch) => [ch.key, [] as Photo[]]));
  const incoming = new Map(chapters.map((ch) => [ch.key, [] as Photo[]]));
  for (const ch of chapters) {
    for (const p of ch.photos) {
      const target = moved[p.id];
      if (target && incoming.has(target)) incoming.get(target)!.push(p);
      else home.get(ch.key)!.push(p);
    }
  }
  return chapters.map((ch) => ({ ...ch, photos: [...home.get(ch.key)!, ...incoming.get(ch.key)!] }));
}

/**
 * The book's own sequence: manifest grouping (with moves applied), curation's
 * order and exclusions applied. A chapter emptied entirely by exclusion (or
 * by every photo being moved out) drops out rather than printing a divider
 * for nothing.
 */
export function curatedChapters(chapters: Chapter[], curation: BookCuration): Chapter[] {
  const excluded = new Set(curation.excluded ?? []);
  return regroupedChapters(chapters, curation)
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
  return regroupedChapters(chapters, curation).map((ch) => ({
    key: ch.key,
    name: ch.name,
    photos: orderedPhotos(ch, curation).map((p) => ({ ...p, excluded: excluded.has(p.id) })),
  }));
}
