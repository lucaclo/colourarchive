import fs from 'node:fs/promises';
import path from 'node:path';
import type { Stats } from 'node:fs';
import { PHOTOS_DIR } from './paths';
import type { IngestResult } from './ingest-batch';

// Removed originals (R13-16). Removing a photo moves its original into
// <PHOTOS_DIR>/.trash (manifest.ts removePhoto); this lists them, puts one back
// into the archive, and deletes them for good only when asked to.

export const TRASH_DIR = path.join(PHOTOS_DIR, '.trash');

export type Removed = { name: string; shown: string; bytes: number; removedAt: string };

/**
 * `name` if it is one plain file name in the trash, else null: no path parts,
 * no hidden files, nothing that could reach outside the folder.
 */
export function trashName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) return null;
  // eslint-disable-next-line no-control-regex
  if (/[/\\\u0000-\u001f]/.test(name) || name.startsWith('.') || name !== path.basename(name)) return null;
  return name;
}

/** The name as it was given: saveOriginal stores `name.<16-hex id>.ext`. */
export function shownName(name: string): string {
  return name.replace(/\.[0-9a-f]{16}(?=\.[^.]+$)/i, '');
}

async function inTrash(name: string): Promise<{ file: string; stat: Stats } | null> {
  const file = path.join(TRASH_DIR, name);
  if (path.dirname(file) !== TRASH_DIR) return null;
  try {
    const stat = await fs.lstat(file);
    return stat.isFile() ? { file, stat } : null;
  } catch {
    return null;
  }
}

/** Newest first. A rename keeps a file's mtime, so when it was removed is its ctime. */
export async function listRemoved(): Promise<{ items: Removed[]; bytes: number }> {
  let names: string[];
  try {
    names = await fs.readdir(TRASH_DIR);
  } catch {
    return { items: [], bytes: 0 };
  }
  const items: Removed[] = [];
  for (const raw of names) {
    const name = trashName(raw);
    const found = name && (await inTrash(name));
    if (!name || !found) continue;
    items.push({ name, shown: shownName(name), bytes: found.stat.size, removedAt: new Date(found.stat.ctimeMs).toISOString() });
  }
  items.sort((a, b) => b.removedAt.localeCompare(a.removedAt) || a.name.localeCompare(b.name));
  return { items, bytes: items.reduce((sum, i) => sum + i.bytes, 0) };
}

const exists = (file: string) => fs.access(file).then(() => true, () => false);

export type RestoreOutcome =
  | { status: 'restored' | 'already'; result: IngestResult }
  | { status: 'missing' }
  | { status: 'failed'; error: string };

/**
 * Put a removed original back: through the same pipeline as an upload, so it
 * gets its derivatives, chapter and store entry again. Its id is the content
 * hash, so the book and notes kept by id find it again. The trashed copy goes
 * only once the photo is in the store.
 */
export async function restoreRemoved(name: string): Promise<RestoreOutcome> {
  const found = await inTrash(name);
  if (!found) return { status: 'missing' };
  const { ingestBatch } = await import('./ingest-batch');
  const { readStore } = await import('./manifest');
  const [result] = await ingestBatch([{ name: shownName(name), read: () => fs.readFile(found.file) }]);
  const stored = result && (result.status === 'added' || result.status === 'skipped')
    && (await readStore()).some((p) => p.id === result.id);
  if (!stored) return { status: 'failed', error: result?.error ?? 'Couldn’t add this one' };
  // Already listed: a removal can move the original here and then fail to
  // write the store, leaving the entry with no file but this one. Then this
  // copy goes back as its original instead of being deleted.
  if (result.status === 'skipped') {
    const entry = (await readStore()).find((p) => p.id === result.id);
    const original = entry?.filename ? path.join(PHOTOS_DIR, path.basename(entry.filename)) : null;
    if (original && !(await exists(original))) {
      await fs.mkdir(PHOTOS_DIR, { recursive: true });
      await fs.rename(found.file, original);
      return { status: 'already', result }; // still listed, so already in the grid
    }
  }
  await fs.rm(found.file, { force: true });
  return { status: result.status === 'added' ? 'restored' : 'already', result };
}

/** Delete `names` from the trash for good; how many went. Always by name, so nothing goes that wasn't listed. */
export async function emptyRemoved(names: string[]): Promise<number> {
  let deleted = 0;
  for (const name of names) {
    const found = await inTrash(name);
    if (!found) continue;
    await fs.rm(found.file);
    deleted++;
  }
  return deleted;
}

const PREVIEW_PX = 200;
const previews = new Map<string, Buffer>();

/** A small JPEG of a removed original, kept in memory (nothing under public/img). */
export async function previewOf(name: string): Promise<Buffer | null> {
  const found = await inTrash(name);
  if (!found) return null;
  const key = `${name}:${found.stat.size}:${found.stat.mtimeMs}`;
  const hit = previews.get(key);
  if (hit) return hit;
  const sharp = (await import('sharp')).default;
  const jpeg = await sharp(found.file, { failOn: 'none' })
    .rotate()
    .resize(PREVIEW_PX, PREVIEW_PX, { fit: 'cover' })
    .jpeg({ quality: 72 })
    .toBuffer();
  previews.set(key, jpeg);
  if (previews.size > 120) previews.delete(previews.keys().next().value as string);
  return jpeg;
}
