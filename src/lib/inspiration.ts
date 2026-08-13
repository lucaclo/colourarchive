import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { INSPIRATION_DIR, INSPIRATION_STORE, INSPIRATION_MANIFEST, IMG_DIR } from './paths';
import { processPhoto } from './ingest';
import { buildManifest } from './manifest';
import type { Photo, Manifest } from './types';

// The inspiration board is a second collection — same colour pipeline, its own
// store/manifest/originals folder, so it never mixes into the personal archive.

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(p, 'utf8')) as T; } catch { return fallback; }
}
async function writeJson(p: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2));
}

export const readInspStore = () => readJson<Photo[]>(INSPIRATION_STORE, []);
export const readInspManifest = () =>
  readJson<Manifest>(INSPIRATION_MANIFEST, { generatedAt: new Date().toISOString(), count: 0, chapters: [] });

export async function rebuildInsp(): Promise<Manifest> {
  const manifest = buildManifest(await readInspStore(), {}); // no overrides for inspiration
  await writeJson(INSPIRATION_MANIFEST, manifest);
  return manifest;
}

const hash = (buf: Buffer) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

/** Save an inspiration original into /inspiration (deduped by content hash). */
async function saveInspOriginal(buf: Buffer, name: string): Promise<{ id: string; filename: string; existed: boolean }> {
  await fs.mkdir(INSPIRATION_DIR, { recursive: true });
  const id = hash(buf);
  const ext = (path.extname(name) || '.jpg').toLowerCase();
  const base = (path.basename(name, path.extname(name)) || 'ref').replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 60);
  const filename = `${base}.${id}${ext}`;
  const dest = path.join(INSPIRATION_DIR, filename);
  try { await fs.access(dest); return { id, filename, existed: true }; }
  catch { await fs.writeFile(dest, buf); return { id, filename, existed: false }; }
}

/** Ingest one inspiration image (buffer). Reuses the full colour pipeline. */
export async function addInspiration(buf: Buffer, name: string, source: string): Promise<{ photo?: Photo; existed: boolean; id: string }> {
  const store = await readInspStore();
  const { id, filename, existed } = await saveInspOriginal(buf, name);
  if (existed && store.some((p) => p.id === id)) return { existed: true, id };
  const photo = await processPhoto(buf, id, filename);
  photo.source = source?.trim() || undefined;
  store.push(photo);
  await writeJson(INSPIRATION_STORE, store);
  await rebuildInsp();
  return { photo, existed: false, id };
}

/**
 * Replace one reference's derivative list and rebuild — the repair path for
 * `npm run check:photos -- --fix`.
 *
 * The board shares `public/img` with the archive while keeping its own store, so
 * it needs its own way to be put back in step. Leaving it without one is how
 * every reference on the board came to be classified as an orphan and deleted.
 */
export async function replaceInspDerivatives(id: string, derivatives: Photo['derivatives']): Promise<void> {
  const store = await readInspStore();
  await writeJson(INSPIRATION_STORE, store.map((p) => (p.id === id ? { ...p, derivatives } : p)));
  await rebuildInsp();
}

/** Remove an inspiration item (original → /inspiration/.trash, derivatives gone). */
export async function removeInspiration(id: string): Promise<Manifest> {
  const store = await readInspStore();
  const photo = store.find((p) => p.id === id);
  if (!photo) return rebuildInsp();
  const trash = path.join(INSPIRATION_DIR, '.trash');
  await fs.mkdir(trash, { recursive: true });
  try { await fs.rename(path.join(INSPIRATION_DIR, photo.filename), path.join(trash, photo.filename)); } catch {}
  for (const d of photo.derivatives) for (const w of [d.avif, d.webp].filter((v): v is string => Boolean(v))) {
    await fs.rm(path.join(IMG_DIR, w.replace(/^\/img\//, '')), { force: true });
  }
  await writeJson(INSPIRATION_STORE, store.filter((p) => p.id !== id));
  return rebuildInsp();
}
