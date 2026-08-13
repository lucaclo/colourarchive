import fs from 'node:fs/promises';
import path from 'node:path';
import { MANIFEST_PATH, OVERRIDES_PATH, STORE_PATH } from './paths';
import {
  chapterName, chapterRank, chapterKey, baseKeyOf,
  lightnessBand, ACHROMATIC_KEY, SPLIT_MIN, MERGE_MAX, roundOklch,
  type OKLCH, type Band,
} from './color';
import type { Photo, Chapter, Manifest, Overrides, Derivative } from './types';
import { scheduleDeploy } from './deploy';

// Flat photo list is the source of truth (append-only, deduped by id).
// The nested, ordered, override-applied `manifest.json` is derived from it —
// so nothing hand-edited ever gets clobbered by a rebuild. Its path lives in
// ./paths with the others, because the build hook reads the same file.

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/**
 * The same read, but not re-parsed when nothing has changed.
 *
 * `photos.json` is 528KB — seventy per cent of it DINOv2 embeddings that most
 * callers never look at — and it was being read and parsed from scratch on every
 * request that needed a filename: every match, every resemble, every original,
 * every similar. That is a millisecond of blocking CPU per request spent
 * rebuilding an object identical to the one thrown away a moment earlier.
 *
 * Keyed on the file's modification time rather than on a duration, so a write —
 * an upload, a relabel, a removal — is picked up on the very next read and there
 * is no window where a stale copy is served. `stat` is the only syscall paid
 * when the answer has not changed.
 *
 * The parsed value is shared, not copied. Every caller here treats it as
 * read-only; the mutating paths below all build a new array and write it out.
 */
const parsed = new Map<string, { mtimeMs: number; size: number; value: unknown }>();

async function readJsonCached<T>(p: string, fallback: T): Promise<T> {
  let stamp: { mtimeMs: number; size: number };
  try {
    const stat = await fs.stat(p);
    stamp = { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    parsed.delete(p);
    return fallback;
  }
  const hit = parsed.get(p);
  // Size as well as time: a same-millisecond rewrite is possible on a fast
  // machine, and a length change is the cheapest way to notice one.
  if (hit && hit.mtimeMs === stamp.mtimeMs && hit.size === stamp.size) return hit.value as T;

  const value = await readJson<T>(p, fallback);
  parsed.set(p, { ...stamp, value });
  return value;
}

export const readStore = () => readJsonCached<Photo[]>(STORE_PATH, []);
export const readOverrides = () => readJsonCached<Overrides>(OVERRIDES_PATH, {});

// --- Write lock --------------------------------------------------------------
// Every mutation here is a read-modify-write over a whole JSON file, and the
// endpoints that call them can overlap: two genre buttons clicked in quick
// succession both read the same overrides and the second write silently
// discarded the first. Uploads had the same hazard, which is why they had to be
// sent as one big batch. Serialising the mutations removes the class of bug and
// lets the client send photos in parallel.
let writeChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});   // one failure must not wedge the queue
  return run;
}

/** Relabel a photo's medium (film|digital) via the overrides file, rebuild. */
export function setMedium(id: string, medium: 'film' | 'digital'): Promise<Manifest> {
  return withLock(async () => {
    const overrides = await readOverrides();
    overrides.photos = overrides.photos ?? {};
    overrides.photos[id] = { ...overrides.photos[id], medium };
    await writeJson(OVERRIDES_PATH, overrides);
    const manifest = await rebuild();
    scheduleDeploy();
    return manifest;
  });
}

/** Relabel a photo's genre via the overrides file, rebuild. */
export function setGenre(id: string, genre: import('./types').Genre): Promise<Manifest> {
  return withLock(async () => {
    const overrides = await readOverrides();
    overrides.photos = overrides.photos ?? {};
    overrides.photos[id] = { ...overrides.photos[id], genre };
    await writeJson(OVERRIDES_PATH, overrides);
    const manifest = await rebuild();
    scheduleDeploy();
    return manifest;
  });
}

/**
 * Replace one photo's derivative list and rebuild.
 *
 * The repair path for the derivative audit (`npm run check:photos -- --fix`):
 * after regenerating the files, or after dropping a declaration for a format
 * nothing writes any more, the entry has to say what is actually on disk.
 *
 * The write lock above is not enough here, and the difference matters. Every
 * other mutation in this file runs inside the app, where `withLock` is a real
 * queue; this one runs from a `tsx` CLI in a *different process* from the Astro
 * server, which knows nothing of it. Two processes each doing a whole-file
 * read-modify-write is the classic lost update: an upload landing between this
 * read and its rename would be erased by it, and the rename being atomic only
 * guarantees the file is never half-written, not that it is never stale.
 *
 * So the store's modification time is taken at the read and checked again at the
 * write, and a change means someone else got there first — retry, then give up
 * and say so rather than overwrite them. The lock is still taken, because within
 * the app it is the cheaper of the two mechanisms.
 *
 * Deliberately no `scheduleDeploy()`: a repair leaves the archive looking the
 * same as it was always meant to look, and the CLI that calls this exits long
 * before the debounce would fire.
 */
export function replaceDerivatives(id: string, derivatives: Derivative[]): Promise<Manifest> {
  return withLock(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const stamp = await mtimeOf(STORE_PATH);
      const photos = await readStore();
      const next = photos.map((p) => (p.id === id ? { ...p, derivatives } : p));
      if ((await mtimeOf(STORE_PATH)) !== stamp) continue; // someone wrote while we read
      await writeJson(STORE_PATH, next, stamp);
      return rebuild();
    }
    throw new Error(
      `photos.json kept changing under the repair of ${id} — is an upload running? Nothing was written.`,
    );
  });
}

const mtimeOf = async (p: string): Promise<number> => {
  try {
    return (await fs.stat(p)).mtimeMs;
  } catch {
    return 0;
  }
};

// Write to a sibling temp file and rename over the target. photos.json is the
// only copy of the archive's metadata; a plain writeFile interrupted halfway
// (crash, power, Ctrl-C mid-ingest) leaves it truncated and unparseable, and
// readJson's fallback would then quietly treat the archive as empty. Rename is
// atomic within a filesystem, so the file is either the old one or the new one.
//
// `expect` is the modification time the caller last saw. Passing it turns the
// write into a compare-and-swap for callers outside this process — see
// replaceDerivatives. Omitting it keeps the old behaviour, which is correct for
// everything running inside the app behind the write lock.
async function writeJson(p: string, data: unknown, expect?: number): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  if (expect !== undefined && (await mtimeOf(p)) !== expect) {
    await fs.rm(tmp, { force: true });
    throw new Error(`${path.basename(p)} changed while it was being rewritten — nothing was written.`);
  }
  await fs.rename(tmp, p);
  // The rename gives the file a new mtime, so the read cache would notice on its
  // own. Dropping the entry here anyway keeps the invariant local: whoever reads
  // this function can see that a write invalidates, without having to reason
  // about filesystem timestamp resolution.
  parsed.delete(p);
}

// --- Perceptual gradient ordering -------------------------------------------
// Order a chapter so consecutive photos are as visually close as possible.
// Each photo is a point in OKLab (perceptually uniform); we build the shortest
// path through them (greedy nearest-neighbour + 2-opt), which minimises the
// total colour "jump" from frame to frame — far smoother than a 1-D hue sort,
// and fully automatic. Deterministic (fixed dark→ start, stable tie-breaks) so
// it never reshuffles arbitrarily on rebuild.

// Lightness weight in the distance. 1 = full perceptual ΔE (lightness flows as
// smoothly as hue/chroma). Lower would favour colour continuity over tone.
const L_WEIGHT = 1;
const MAX_2OPT = 400; // skip the O(n²) polish on very large chapters

type Lab = [number, number, number];
const toLab = (o: OKLCH): Lab => {
  const rad = (o.H * Math.PI) / 180;
  return [o.L, o.C * Math.cos(rad), o.C * Math.sin(rad)];
};
const dE = (a: Lab, b: Lab): number => {
  const dl = (a[0] - b[0]) * L_WEIGHT;
  return Math.sqrt(dl * dl + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
};

function orderByGradient(photos: Photo[]): Photo[] {
  if (photos.length <= 2) return photos.slice();
  const labs = photos.map((p) => toLab(p.oklch));
  const n = photos.length;

  // Start deterministically at the darkest photo (stable, and a natural entry).
  let start = 0;
  for (let i = 1; i < n; i++) if (labs[i][0] < labs[start][0]) start = i;

  // Greedy nearest-neighbour path.
  const used = new Array<boolean>(n).fill(false);
  const order = [start];
  used[start] = true;
  for (let step = 1; step < n; step++) {
    const last = order[order.length - 1];
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const d = dE(labs[last], labs[i]);
      if (d < bd) { bd = d; best = i; }
    }
    order.push(best);
    used[best] = true;
  }

  // 2-opt: reverse segments while it shortens the open path (removes crossings).
  if (n <= MAX_2OPT) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < n - 1; i++) {
        for (let k = i + 1; k < n; k++) {
          const a = i > 0 ? labs[order[i - 1]] : null;
          const b = labs[order[i]];
          const c = labs[order[k]];
          const d = k < n - 1 ? labs[order[k + 1]] : null;
          let before = 0, after = 0;
          if (a) { before += dE(a, b); after += dE(a, c); }
          if (d) { before += dE(c, d); after += dE(b, d); }
          if (after < before - 1e-9) {
            for (let lo = i, hi = k; lo < hi; lo++, hi--) {
              const t = order[lo]; order[lo] = order[hi]; order[hi] = t;
            }
            improved = true;
          }
        }
      }
    }
  }

  return order.map((i) => photos[i]);
}

/** Mean colour of a set of photos, averaged in OKLab so hue behaves. */
function meanOklch(photos: Photo[]): OKLCH {
  if (photos.length === 0) return { L: 0.5, C: 0, H: 0 };
  let sumL = 0, sumA = 0, sumB = 0;
  for (const p of photos) {
    const rad = (p.oklch.H * Math.PI) / 180;
    sumL += p.oklch.L;
    sumA += p.oklch.C * Math.cos(rad);
    sumB += p.oklch.C * Math.sin(rad);
  }
  const n = photos.length;
  const L = sumL / n, a = sumA / n, b = sumB / n;
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return roundOklch({ L, C: Math.sqrt(a * a + b * b), H });
}

const isAchromatic = (key: string) => baseKeyOf(key) === ACHROMATIC_KEY;

/** Group photos into chapters: nearest-anchor base, auto-split busy bands into
 *  their own chapter (deep/pale, when > SPLIT_MIN), then fold tiny chapters
 *  (<= MERGE_MAX) into their nearest neighbour. Deterministic. */
function groupChapters(photos: Photo[], overrides: Overrides): Array<{ key: string; photos: Photo[] }> {
  // 1. Group by effective base chapter (override chapter, else auto).
  const byBase = new Map<string, Photo[]>();
  for (const raw of photos) {
    const ov = overrides.photos?.[raw.id];
    const base = baseKeyOf(ov?.chapter ?? raw.autoChapter);
    const medium = ov?.medium ?? raw.autoMedium ?? raw.medium ?? 'digital';
    const genre = ov?.genre ?? raw.autoGenre ?? raw.genre;
    // Keep the heavy similarity signatures OUT of the rendered manifest.
    const { embedding, colourGrid, ...rest } = raw;
    const photo: Photo = { ...rest, chapter: base, medium, genre };
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base)!.push(photo);
  }

  // 2. Split each base into lightness bands; promote deep/pale to their own
  //    chapter only when busy enough, otherwise keep them in the base chapter.
  const groups: Array<{ key: string; photos: Photo[] }> = [];
  for (const [base, list] of byBase) {
    const bands: Record<Band, Photo[]> = { deep: [], mid: [], pale: [] };
    for (const p of list) bands[lightnessBand(p.oklch.L)].push(p);
    const baseChapter: Photo[] = [...bands.mid];
    for (const b of ['deep', 'pale'] as Band[]) {
      if (bands[b].length > SPLIT_MIN) groups.push({ key: chapterKey(base, b), photos: bands[b] });
      else baseChapter.push(...bands[b]);
    }
    if (baseChapter.length > 0) groups.push({ key: chapterKey(base, 'mid'), photos: baseChapter });
  }

  // 3. Order chapters (wheel, achromatic first; dark -> light within a hue).
  groups.sort((a, b) => chapterRank(a.key) - chapterRank(b.key));

  // 4. Fold tiny chapters into the neighbour closest in colour (never mix
  //    achromatic with a hue chapter).
  const meanLab = (g: { photos: Photo[] }) => toLab(meanOklch(g.photos));
  const near = (a: { photos: Photo[] }, b?: { photos: Photo[] }) =>
    b ? dE(meanLab(a), meanLab(b)) : Infinity;
  let changed = true;
  while (changed && groups.length > 1) {
    changed = false;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].photos.length > MERGE_MAX) continue;
      const cur = groups[i];
      const prev = groups[i - 1], next = groups[i + 1];
      const canPrev = prev && isAchromatic(prev.key) === isAchromatic(cur.key);
      const canNext = next && isAchromatic(next.key) === isAchromatic(cur.key);
      let target: { key: string; photos: Photo[] } | undefined;
      if (canPrev && canNext) target = near(cur, prev) <= near(cur, next) ? prev : next;
      else if (canPrev) target = prev;
      else if (canNext) target = next;
      if (!target) continue;
      target.photos.push(...cur.photos);
      groups.splice(i, 1);
      changed = true;
      break;
    }
  }
  return groups;
}

/** Build the ordered, override-applied manifest from the flat store. */
export function buildManifest(photos: Photo[], overrides: Overrides): Manifest {
  const groups = groupChapters(photos, overrides);

  const chapters: Chapter[] = groups.map((g) => ({
    key: g.key,
    name: overrides.chapters?.[g.key] ?? chapterName(g.key, overrides.chapters?.[baseKeyOf(g.key)]),
    oklch: meanOklch(g.photos),
    // Within a chapter: shortest perceptual path (smooth colour gradient).
    photos: orderByGradient(g.photos),
  }));

  // Chain chapters: flip a chapter's path if its other end connects more
  // smoothly to the previous chapter's last photo, so the gradient carries
  // across the gaps too (not just within a chapter).
  for (let i = 1; i < chapters.length; i++) {
    const prev = chapters[i - 1].photos;
    const cur = chapters[i].photos;
    if (prev.length === 0 || cur.length < 2) continue;
    const tail = toLab(prev[prev.length - 1].oklch);
    if (dE(tail, toLab(cur[cur.length - 1].oklch)) < dE(tail, toLab(cur[0].oklch))) {
      cur.reverse();
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    count: photos.length,
    chapters,
  };
}

export async function readManifest(): Promise<Manifest> {
  return readJsonCached<Manifest>(MANIFEST_PATH, {
    generatedAt: new Date().toISOString(),
    count: 0,
    chapters: [],
  });
}

/** Rebuild manifest.json from the store + overrides. */
export async function rebuild(): Promise<Manifest> {
  const [photos, overrides] = await Promise.all([readStore(), readOverrides()]);
  const manifest = buildManifest(photos, overrides);
  await writeJson(MANIFEST_PATH, manifest);
  return manifest;
}

/** Append one processed photo (deduped) and rebuild the manifest. */
export async function addPhoto(photo: Photo): Promise<Manifest> {
  return addPhotos([photo]);
}

/** Append processed photos (deduped) and rebuild. Serialised, so concurrent
 *  ingest requests queue behind each other instead of clobbering the store. */
export function addPhotos(incoming: Photo[]): Promise<Manifest> {
  return withLock(async () => {
    const photos = await readStore();
    const seen = new Set(photos.map((p) => p.id));
    for (const photo of incoming) {
      if (!seen.has(photo.id)) {
        photos.push(photo);
        seen.add(photo.id);
      }
    }
    await writeJson(STORE_PATH, photos);
    const manifest = await rebuild();
    scheduleDeploy();
    return manifest;
  });
}

/** Remove a photo. The original is *moved to photos/.trash* (recoverable),
 *  derivatives are deleted (regenerable). Returns the rebuilt manifest. */
export function removePhoto(id: string): Promise<{ manifest: Manifest; removed: boolean }> {
  return withLock(() => removePhotoLocked(id));
}

async function removePhotoLocked(id: string): Promise<{ manifest: Manifest; removed: boolean }> {
  const { PHOTOS_DIR, IMG_DIR } = await import('./paths');
  const photos = await readStore();
  const photo = photos.find((p) => p.id === id);
  if (!photo) return { manifest: await rebuild(), removed: false };

  // Move original into the trash rather than hard-deleting it.
  const trashDir = path.join(PHOTOS_DIR, '.trash');
  await fs.mkdir(trashDir, { recursive: true });
  const src = path.join(PHOTOS_DIR, photo.filename);
  try {
    await fs.rename(src, path.join(trashDir, photo.filename));
  } catch {
    /* original already gone — proceed */
  }

  // Delete derivatives (they can always be regenerated from the original).
  for (const d of photo.derivatives) {
    for (const web of [d.avif, d.webp].filter((v): v is string => Boolean(v))) {
      const name = web.replace(/^\/img\//, '');
      await fs.rm(path.join(IMG_DIR, name), { force: true });
    }
  }

  await writeJson(STORE_PATH, photos.filter((p) => p.id !== id));

  // Drop any override that pointed at this photo. They used to survive the
  // removal forever: photos.overrides.json is documented as hand-editable, and
  // it slowly filled with keys naming photos that no longer exist.
  const overrides = await readOverrides();
  if (overrides.photos?.[id]) {
    delete overrides.photos[id];
    await writeJson(OVERRIDES_PATH, overrides);
  }

  const manifest = await rebuild();
  scheduleDeploy();
  return { manifest, removed: true };
}
