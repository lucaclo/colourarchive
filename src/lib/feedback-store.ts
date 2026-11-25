/**
 * Feedback kept on the Mac (lib/feedback.ts): `<dir>/<id>/note.md` beside its
 * pictures `1.jpg`, `2.png`…; done ones move to `<dir>/done/<id>/`. Every
 * function takes the folder, so tests and `npm run feedback` (which reads
 * more than one) can point it anywhere; the server passes FEEDBACK_DIR.
 *
 * A new item is written into a hidden temp folder and renamed into place, so
 * a reader never sees half of one.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  IMAGE_TYPES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  newFeedbackId,
  noteMarkdown,
  parseNoteMarkdown,
  sniffImage,
  validFeedbackId,
  type FeedbackContext,
  type FeedbackEntry,
} from './feedback';

export interface IncomingFeedback {
  note: string;
  context: FeedbackContext;
  images: Uint8Array[];
}

export type SaveResult = { ok: true; entry: FeedbackEntry } | { ok: false; error: string };

/** What's wrong with a submission, or null. Pictures are judged by their bytes, not their names. */
export function checkFeedback(input: IncomingFeedback): string | null {
  if (!input.note && !input.images.length) return 'Add a note or a picture';
  if (input.images.length > MAX_IMAGES) return `At most ${MAX_IMAGES} pictures`;
  for (const img of input.images) {
    if (img.byteLength > MAX_IMAGE_BYTES) return 'A picture is too large';
    if (!sniffImage(img)) return 'Pictures must be JPEG, PNG or WebP';
  }
  return null;
}

async function writeItem(dir: string, entry: FeedbackEntry, files: { name: string; bytes: Uint8Array }[]): Promise<void> {
  // Every folder name this writes is one validFeedbackId accepts, whoever made the id.
  if (!validFeedbackId(entry.id)) throw new Error(`Not a feedback id: ${entry.id}`);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${entry.id}-${process.pid}`);
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp);
  try {
    for (const f of files) await fs.writeFile(path.join(tmp, f.name), f.bytes);
    await fs.writeFile(path.join(tmp, 'note.md'), noteMarkdown(entry));
    await fs.rename(tmp, path.join(dir, entry.id));
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw err;
  }
}

/** Keep a new item from a page the Mac serves. */
export async function saveFeedback(
  dir: string,
  input: IncomingFeedback,
  now = new Date(),
  rand: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(2)),
): Promise<SaveResult> {
  const error = checkFeedback(input);
  if (error) return { ok: false, error };
  let id = newFeedbackId(now, rand());
  // Two in the same minute with the same four characters: draw again.
  for (let i = 0; i < 8 && (await exists(dir, id)); i++) id = newFeedbackId(now, rand());
  if (await exists(dir, id)) return { ok: false, error: 'Try again' };
  const files = input.images.map((bytes, i) => ({ name: `${i + 1}.${IMAGE_TYPES[sniffImage(bytes)!]}`, bytes }));
  const entry: FeedbackEntry = {
    id,
    note: input.note,
    created: now.toISOString(),
    source: 'mac',
    ...input.context,
    images: files.map((f) => f.name),
  };
  await writeItem(dir, entry, files);
  return { ok: true, entry };
}

/** Keep an issue pulled from GitHub as `gh-<number>`, with the pictures it named. */
export async function importIssue(
  dir: string,
  issue: { number: number; url: string; note: string; context: FeedbackContext; created: string },
  images: Uint8Array[],
): Promise<FeedbackEntry> {
  const files = images
    .map((bytes) => ({ bytes, type: sniffImage(bytes) }))
    .filter((f) => f.type)
    .map((f, i) => ({ name: `${i + 1}.${IMAGE_TYPES[f.type!]}`, bytes: f.bytes }));
  const entry: FeedbackEntry = {
    id: `gh-${issue.number}`,
    note: issue.note,
    created: issue.created,
    source: 'github',
    ...issue.context,
    images: files.map((f) => f.name),
    issue: issue.number,
    url: issue.url,
  };
  await writeItem(dir, entry, files);
  return entry;
}

async function exists(dir: string, id: string): Promise<boolean> {
  for (const p of [path.join(dir, id), path.join(dir, 'done', id)]) {
    try {
      await fs.access(p);
      return true;
    } catch {
      /* not this one */
    }
  }
  return false;
}

export const hasFeedback = exists;

export interface ListedFeedback extends FeedbackEntry {
  /** The item's folder. */
  folder: string;
  /** Its pictures, as full paths. */
  pictures: string[];
}

/** The open items in `dir` (or the done ones), oldest first. A missing folder is an empty list. */
export async function listFeedback(dir: string, which: 'open' | 'done' = 'open'): Promise<ListedFeedback[]> {
  const base = which === 'done' ? path.join(dir, 'done') : dir;
  let names: string[];
  try {
    names = await fs.readdir(base);
  } catch {
    return [];
  }
  const out: ListedFeedback[] = [];
  for (const name of names) {
    if (!validFeedbackId(name)) continue;
    const folder = path.join(base, name);
    let entry: FeedbackEntry | null;
    try {
      entry = parseNoteMarkdown(await fs.readFile(path.join(folder, 'note.md'), 'utf8'));
    } catch {
      continue;
    }
    if (!entry || entry.id !== name) continue;
    out.push({ ...entry, folder, pictures: entry.images.map((f) => path.join(folder, f)) });
  }
  return out.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
}

/** Move an open item to done/, noting when. Null when there's no open item by that id. */
export async function markDone(dir: string, id: string, now = new Date()): Promise<FeedbackEntry | null> {
  if (!validFeedbackId(id)) return null;
  const from = path.join(dir, id);
  let entry: FeedbackEntry | null;
  try {
    entry = parseNoteMarkdown(await fs.readFile(path.join(from, 'note.md'), 'utf8'));
  } catch {
    return null;
  }
  if (!entry) return null;
  entry.done = now.toISOString();
  await fs.writeFile(path.join(from, 'note.md'), noteMarkdown(entry));
  await fs.mkdir(path.join(dir, 'done'), { recursive: true });
  await fs.rename(from, path.join(dir, 'done', id));
  return entry;
}
