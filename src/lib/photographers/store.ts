import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PHOTOGRAPHERS_PATH, PHOTOGRAPHER_CACHE_DIR } from '../paths';
import { canFetch, fetchWork, type ProfileLink, type WorkItem } from './sources';
import { instagramConnected } from './instagram-api';

/**
 * The photographers behind the inspiration board — one private file.
 *
 * A reference's credit lives here (`credits`), not on the reference: the
 * board's store is committed to a public repository and this is a taste
 * graph. `source` on a reference stays what it always was, the link or the
 * words it came with.
 */

export interface Photographer {
  id: string;
  name: string;
  favourite: boolean;
  links: ProfileLink[];
  addedAt: string;
  /** When their sheet was last opened — "new" is anything not seen by then. */
  seenAt?: string;
}

export interface PhotographersFile {
  version: 1;
  photographers: Photographer[];
  /** reference id → photographer id */
  credits: Record<string, string>;
  /** photographer id → work item key → what you did with it */
  marks: Record<string, Record<string, 'pinned' | 'passed'>>;
  /** photographer id → item keys already shown to you */
  known: Record<string, string[]>;
  /** suggestion keys you said no to */
  dismissed: string[];
}

const EMPTY = (): PhotographersFile => ({ version: 1, photographers: [], credits: {}, marks: {}, known: {}, dismissed: [] });

export async function readPhotographers(): Promise<PhotographersFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(PHOTOGRAPHERS_PATH, 'utf8')) as Partial<PhotographersFile>;
    return { ...EMPTY(), ...parsed, version: 1 };
  } catch {
    return EMPTY();
  }
}

let writing: Promise<unknown> = Promise.resolve();

/**
 * Read, change, write — one at a time. Pins and credits can arrive together
 * (several taps in a row), and interleaved whole-file writes would lose one.
 */
export function updatePhotographers<T>(fn: (file: PhotographersFile) => T | Promise<T>): Promise<T> {
  const run = writing.then(async () => {
    const file = await readPhotographers();
    const out = await fn(file);
    await fs.mkdir(path.dirname(PHOTOGRAPHERS_PATH), { recursive: true });
    await fs.writeFile(PHOTOGRAPHERS_PATH, JSON.stringify(file, null, 2));
    return out;
  });
  writing = run.catch(() => {});
  return run;
}

/* ── Pure helpers ──────────────────────────────────────────────────────── */

export const normaliseName = (s: string): string =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Two links are the same account when the platform id matches, else the address. */
export function sameLink(a: ProfileLink, b: ProfileLink): boolean {
  if (a.kind !== b.kind) return false;
  if (a.id && b.id) return a.id === b.id && (a.host ?? '') === (b.host ?? '');
  return a.url.replace(/\/+$/, '').toLowerCase() === b.url.replace(/\/+$/, '').toLowerCase();
}

export function newId(name: string): string {
  const slug = normaliseName(name).replace(/\s+/g, '-').slice(0, 32) || 'photographer';
  return `${slug}-${createHash('sha256').update(`${name}${Date.now()}${Math.random()}`).digest('hex').slice(0, 6)}`;
}

/**
 * The photographer this name or link belongs to, created if there is none.
 * A link is the stronger match; a name only matches a name exactly (after
 * folding case and accents), so two different "Sam"s with links stay apart.
 */
export function findOrCreate(file: PhotographersFile, name: string, link?: ProfileLink): Photographer {
  if (link) {
    const byLink = file.photographers.find((p) => p.links.some((l) => sameLink(l, link)));
    if (byLink) return byLink;
  }
  const n = normaliseName(name);
  const byName = n ? file.photographers.find((p) => normaliseName(p.name) === n) : undefined;
  if (byName) {
    if (link && !byName.links.some((l) => sameLink(l, link))) byName.links.push(link);
    return byName;
  }
  const p: Photographer = { id: newId(name), name: name.trim() || 'Unknown', favourite: false, links: link ? [link] : [], addedAt: new Date().toISOString() };
  file.photographers.push(p);
  return p;
}

/** Items you haven't been shown yet and haven't pinned or passed. */
export function newItems(file: PhotographersFile, id: string, items: WorkItem[]): WorkItem[] {
  const known = new Set(file.known[id] ?? []);
  const marks = file.marks[id] ?? {};
  return items.filter((i) => !known.has(i.key) && !marks[i.key]);
}

/** Whether new work can be read from this link now: Instagram once connected. */
export async function readable(link: ProfileLink): Promise<boolean> {
  return canFetch(link.kind) || (link.kind === 'instagram' && await instagramConnected());
}
export async function anyReadable(links: ProfileLink[]): Promise<boolean> {
  for (const l of links) if (await readable(l)) return true;
  return false;
}

/* ── Their work, cached ────────────────────────────────────────────────── */

const TTL = 30 * 60_000;
const workPath = (id: string) => path.join(PHOTOGRAPHER_CACHE_DIR, 'work', `${id.replace(/[^a-z0-9-]/gi, '_')}.json`);

interface WorkCache { fetchedAt: number; items: WorkItem[]; errors: string[] }

/**
 * Everything every one of their links can show, merged, newest first. Each
 * link fails on its own: a site that's down still leaves the others.
 */
export async function workFor(p: Photographer, force = false): Promise<WorkCache> {
  const at = workPath(p.id);
  if (!force) {
    try {
      const cached = JSON.parse(await fs.readFile(at, 'utf8')) as WorkCache;
      if (Date.now() - cached.fetchedAt < TTL) return cached;
    } catch { /* not cached */ }
  }
  const errors: string[] = [];
  const lists = await Promise.all(p.links.map(async (l) => {
    try { return await fetchWork(l); } catch (err) { errors.push(err instanceof Error ? err.message : String(err)); return []; }
  }));
  const seen = new Set<string>();
  const items = lists.flat().filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
  if (items.some((i) => i.at)) items.sort((a, b) => Date.parse(b.at ?? '0') - Date.parse(a.at ?? '0'));
  const out = { fetchedAt: Date.now(), items, errors };
  await fs.mkdir(path.dirname(at), { recursive: true });
  await fs.writeFile(at, JSON.stringify(out));
  return out;
}

export async function cachedWork(id: string): Promise<WorkItem[]> {
  try { return (JSON.parse(await fs.readFile(workPath(id), 'utf8')) as WorkCache).items; } catch { return []; }
}
