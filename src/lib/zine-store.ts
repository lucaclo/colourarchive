/**
 * The magazine's own file (round 13, D2). Until round 13 the zine lived in one
 * browser's storage, so the iPad and the Mac each had their own and clearing
 * Safari's data lost it. Now it is `zine.json` in the data folder, saved the
 * way the book is (book.ts): every save names the version it was based on, a
 * stale one gets 409 and nothing is written, one save runs at a time, and the
 * bytes it replaces are kept as `.bak`.
 *
 * The server keeps the document as the page sends it (it is only ever read by
 * the page, through reviveDoc in zine/doc.ts) after checking it is an object
 * of a sane size. Photos added from a device are JPEGs in ZINE_PHOTOS_DIR,
 * named by the key the page gave them.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ZINE_PATH, ZINE_PHOTOS_DIR } from './paths';

/** The version of a zine file that doesn't exist yet. */
export const EMPTY_ZINE_VERSION = 'empty';
/** A zine is pages of photo references and a little text: far below this. */
export const MAX_ZINE_BYTES = 1_000_000;
/** The page shrinks a device photo to 3000 px JPEG before sending it. */
export const MAX_PHOTO_BYTES = 25_000_000;
/** A photo nothing refers to is kept this long, for a tab that hasn't saved yet. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

const KEY = /^local-[a-z0-9-]{1,64}$/;
/** The page's keys look like `local-1731790000000-k3j9x2`; nothing else is a file name here. */
export const isPhotoKey = (key: unknown): key is string => typeof key === 'string' && KEY.test(key);

export function zineVersionOf(bytes: Buffer | null): string {
  return bytes ? createHash('sha256').update(bytes).digest('hex').slice(0, 16) : EMPTY_ZINE_VERSION;
}

async function readBytes(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every device photo a document refers to: any `{ kind: 'local', id }` in it. */
export function localPhotoKeys(doc: unknown): Set<string> {
  const keys = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isRecord(v)) {
      if (v.kind === 'local' && isPhotoKey(v.id)) keys.add(v.id);
      Object.values(v).forEach(walk);
    }
  };
  walk(doc);
  return keys;
}

/**
 * Only a missing folder means "no photos yet". Any other read error throws:
 * answering [] would make the page drop every device photo, and its next save
 * would leave them for the clean-up to delete.
 */
async function photoKeysOnDisk(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)).filter(isPhotoKey);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export interface ZineState {
  /** null when no zine has been saved yet. */
  doc: unknown;
  version: string;
  /** The device photos on disk, so the page can drop a reference whose file is gone. */
  photos: string[];
}

export async function readZine(file = ZINE_PATH, dir = ZINE_PHOTOS_DIR): Promise<ZineState> {
  const bytes = await readBytes(file);
  // Strict: a file that no longer parses fails the read (500), rather than
  // handing the page an empty zine it would then save over the real one.
  const doc: unknown = bytes ? JSON.parse(bytes.toString('utf8')) : null;
  return { doc, version: zineVersionOf(bytes), photos: await photoKeysOnDisk(dir) };
}

export type ZineSaveResult =
  | { status: 200; version: string }
  | { status: 400; error: string }
  | { status: 409; version: string };

let writeChain: Promise<unknown> = Promise.resolve();

/** One save from the page: `{ version, doc }`, version naming the file it was based on. */
export function saveZine(body: unknown, file = ZINE_PATH, dir = ZINE_PHOTOS_DIR): Promise<ZineSaveResult> {
  if (!isRecord(body) || !isRecord(body.doc)) return Promise.resolve({ status: 400, error: 'Expected { version, doc }.' });
  const next = JSON.stringify(body.doc, null, 2);
  if (next.length > MAX_ZINE_BYTES) return Promise.resolve({ status: 400, error: 'Too big for a zine.' });
  const basedOn = body.version;
  const step = () => commit(file, dir, next, body.doc, basedOn);
  const run = writeChain.then(step, step);
  writeChain = run.catch(() => {});
  return run;
}

async function commit(file: string, dir: string, next: string, doc: unknown, basedOn: unknown): Promise<ZineSaveResult> {
  const bytes = await readBytes(file);
  const current = zineVersionOf(bytes);
  if (typeof basedOn !== 'string' || basedOn !== current) return { status: 409, version: current };
  if (bytes && next === bytes.toString('utf8')) return { status: 200, version: current };
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (bytes) await fs.writeFile(`${file}.bak`, bytes);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, next);
  await fs.rename(tmp, file);
  await pruneOrphans(dir, localPhotoKeys(doc)).catch((err) => console.warn('[zine] prune failed', err));
  return { status: 200, version: zineVersionOf(Buffer.from(next)) };
}

/** Removes device photos no saved page uses, once they're a day old (Start over, a replaced photo). */
async function pruneOrphans(dir: string, used: Set<string>, now = Date.now()): Promise<void> {
  for (const key of await photoKeysOnDisk(dir)) {
    if (used.has(key)) continue;
    const at = path.join(dir, `${key}.jpg`);
    const { mtimeMs } = await fs.stat(at);
    if (now - mtimeMs > ORPHAN_GRACE_MS) await fs.rm(at, { force: true });
  }
}

export function photoPath(key: string, dir = ZINE_PHOTOS_DIR): string {
  return path.join(dir, `${key}.jpg`);
}

const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export async function savePhoto(key: string, bytes: Uint8Array, dir = ZINE_PHOTOS_DIR): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isPhotoKey(key)) return { ok: false, error: 'Bad photo key.' };
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return { ok: false, error: 'Photo too big or empty.' };
  if (!isJpeg(bytes)) return { ok: false, error: 'Expected a JPEG.' };
  await fs.mkdir(dir, { recursive: true });
  const dest = photoPath(key, dir);
  const tmp = `${dest}.${process.pid}.part`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, dest);
  return { ok: true };
}

export async function readPhoto(key: string, dir = ZINE_PHOTOS_DIR): Promise<Buffer | null> {
  if (!isPhotoKey(key)) return null;
  return readBytes(photoPath(key, dir));
}
