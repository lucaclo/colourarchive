import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { INBOX_LOG_PATH } from './paths';
import { RAW_EXT, RAW_MESSAGE, ingestBatch } from './ingest-batch';

// Issue #137: an inbox folder in iCloud Drive that Lightroom on the iPad
// exports straight into, so adding a photo no longer needs the Mac's server
// running at that moment. Whoever serves the archive (the dev server, or the
// Mac app's server) scans it when it starts and every few seconds after, runs
// each settled file through the same batch pipeline as Add & remove, and takes
// it out of the inbox once it is in the archive (or already was).
//
// What stays in the inbox: camera RAW (refused, as upload refuses it) and a
// file the pipeline could not read. Both are listed in the log with the
// reason, which Add & remove shows as a quiet corner note.

export const INBOX_NAME = 'Colour Archive Inbox';

/** iCloud Drive's folder on this Mac, where the Files app's "iCloud Drive"
 *  lands. COLOUR_ARCHIVE_INBOX points somewhere else (tests, or no iCloud). */
export function inboxDir(): string {
  if (process.env.COLOUR_ARCHIVE_INBOX) return process.env.COLOUR_ARCHIVE_INBOX;
  return path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', INBOX_NAME);
}

// --- Pure parts ------------------------------------------------------------

const IMAGE_EXT = /\.(jpe?g|png|tiff?|webp|avif|gif|heic|heif)$/i;

export type EntryKind = 'image' | 'raw' | 'placeholder' | 'ignore';

/** What a name in the inbox is. `.photo.jpg.icloud` is iCloud's stand-in for
 *  a file it hasn't downloaded yet: not a file to read, but worth waiting for. */
export function classifyEntry(name: string): EntryKind {
  if (name.startsWith('.')) return name.endsWith('.icloud') ? 'placeholder' : 'ignore';
  if (RAW_EXT.test(name)) return 'raw';
  if (IMAGE_EXT.test(name)) return 'image';
  return 'ignore';
}

export type Stat = { name: string; size: number; mtimeMs: number };
export type Seen = { size: number; mtimeMs: number; since: number };

/** How long a file must sit unchanged before it is read. iCloud writes a
 *  download in pieces, and a half-written JPEG decodes as a grey half-photo. */
export const SETTLE_MS = 4000;

/**
 * Which files have stopped changing. A file is ready once it has been seen at
 * least twice with the same size and modified time, the first of those at
 * least `settleMs` ago, and it isn't empty. Returns the ready names and what
 * to remember for the next scan (files that left the folder are forgotten).
 */
export function settle(prev: ReadonlyMap<string, Seen>, now: Stat[], t: number, settleMs = SETTLE_MS): { ready: string[]; next: Map<string, Seen> } {
  const next = new Map<string, Seen>();
  const ready: string[] = [];
  for (const f of now) {
    const was = prev.get(f.name);
    const same = was && was.size === f.size && was.mtimeMs === f.mtimeMs;
    const since = same ? was.since : t;
    next.set(f.name, { size: f.size, mtimeMs: f.mtimeMs, since });
    if (same && f.size > 0 && t - since >= settleMs) ready.push(f.name);
  }
  return { ready, next };
}

/** The key a failure is remembered under: the same name with new bytes (a
 *  re-export over the top) gets another try. */
export const failureKey = (f: { name: string; size: number; mtimeMs: number }): string => `${f.name}|${f.size}|${f.mtimeMs}`;

// --- The log ---------------------------------------------------------------

export type InboxAdded = { id: string; filename: string; at: string };
export type InboxHeld = { name: string; reason: string; since: string };
export type InboxLog = {
  /** Every photo the inbox brought in, newest last (capped). */
  added: InboxAdded[];
  /** What is still sitting in the inbox, and why. */
  held: InboxHeld[];
  /** Set when the folder itself can't be read, with the reason. */
  problem?: string;
  lastScan?: string;
};

const ADDED_CAP = 500;
const EMPTY: InboxLog = { added: [], held: [] };

export async function readInboxLog(): Promise<InboxLog> {
  try {
    const raw = JSON.parse(await fs.readFile(INBOX_LOG_PATH, 'utf8')) as Partial<InboxLog>;
    return { added: raw.added ?? [], held: raw.held ?? [], problem: raw.problem, lastScan: raw.lastScan };
  } catch {
    return { ...EMPTY };
  }
}

async function writeInboxLog(log: InboxLog): Promise<void> {
  await fs.mkdir(path.dirname(INBOX_LOG_PATH), { recursive: true });
  const tmp = `${INBOX_LOG_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify({ ...log, added: log.added.slice(-ADDED_CAP) }, null, 2)}\n`);
  await fs.rename(tmp, INBOX_LOG_PATH);
}

/** The most recent inbox import: how many photos, when, and their ids — what
 *  Add & remove's Newest order says above the grid. Runs within ten minutes of
 *  each other count as one import (a Lightroom export lands over a while). */
export function latestImport(added: InboxAdded[], gapMs = 10 * 60_000): { count: number; at: string; ids: string[] } | null {
  if (added.length === 0) return null;
  const sorted = [...added].sort((a, b) => a.at.localeCompare(b.at));
  const at = sorted[sorted.length - 1].at;
  const ids: string[] = [];
  let prevT = Date.parse(at);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const t = Date.parse(sorted[i].at);
    if (prevT - t > gapMs) break;
    ids.push(sorted[i].id);
    prevT = t;
  }
  return { count: ids.length, at, ids };
}

// --- The scan --------------------------------------------------------------

const SCAN_MS = 5000;
/** At most this many files per scan, read into memory at once. */
const BATCH = 12;

type State = { seen: Map<string, Seen>; failed: Map<string, string>; running: boolean; timer?: ReturnType<typeof setInterval>; scan?: () => Promise<InboxLog> };
// On globalThis, not module scope: the dev server can load this module more
// than once (HMR), and two loops would import the same file twice over.
const g = globalThis as unknown as { __colourInbox?: State };
const state = (): State => (g.__colourInbox ??= { seen: new Map(), failed: new Map(), running: false });

/** Start scanning, once per process. Safe to call on every request. */
export function startInbox(): void {
  if (process.env.COLOUR_ARCHIVE_INBOX === 'off') return;
  const s = state();
  if (s.timer) return;
  // Through the state, so a hot-reloaded copy of this module takes over the
  // loop the first time it is loaded, instead of the old code running on.
  s.timer = setInterval(() => void state().scan?.(), SCAN_MS);
  s.timer.unref?.();
  void scanInbox();
}

/** One pass over the inbox. Never throws; what went wrong goes in the log. */
export async function scanInbox(): Promise<InboxLog> {
  const s = state();
  if (s.running || process.env.COLOUR_ARCHIVE_INBOX === 'off') return readInboxLog();
  s.running = true;
  try {
    return await scanOnce(s);
  } catch (err) {
    console.warn('[inbox] scan failed', err);
    return readInboxLog();
  } finally {
    s.running = false;
  }
}

async function scanOnce(s: State): Promise<InboxLog> {
  const dir = inboxDir();
  const log = await readInboxLog();
  const now = new Date().toISOString();

  let names: string[];
  try {
    await fs.mkdir(dir, { recursive: true });
    names = await fs.readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const problem =
      code === 'EPERM' || code === 'EACCES'
        ? 'macOS hasn’t let the archive into iCloud Drive. Allow it in System Settings › Privacy & Security › Files and Folders.'
        : code === 'ENOENT'
          ? 'iCloud Drive isn’t set up on this Mac.'
          : `The inbox folder can’t be read (${code ?? 'unknown'}).`;
    if (log.problem !== problem) await writeInboxLog({ ...log, problem, lastScan: now });
    return { ...log, problem };
  }

  const held: InboxHeld[] = [];
  const keepSince = new Map(log.held.map((h) => [h.name, h.since]));
  const stats: Stat[] = [];
  for (const name of names) {
    const kind = classifyEntry(name);
    if (kind === 'raw') {
      held.push({ name, reason: RAW_MESSAGE, since: keepSince.get(name) ?? now });
      continue;
    }
    if (kind !== 'image') continue; // placeholders download on their own; anything else isn't ours
    try {
      const st = await fs.stat(path.join(dir, name));
      if (st.isFile()) stats.push({ name, size: st.size, mtimeMs: st.mtimeMs });
    } catch { /* gone between readdir and stat */ }
  }

  const { ready, next } = settle(s.seen, stats, Date.now());
  s.seen = next;
  const byName = new Map(stats.map((f) => [f.name, f]));
  const todo = ready.filter((n) => {
    const reason = s.failed.get(failureKey(byName.get(n)!));
    if (reason) held.push({ name: n, reason, since: keepSince.get(n) ?? now });
    return !reason;
  }).slice(0, BATCH);

  const added: InboxAdded[] = [];
  if (todo.length > 0) {
    const bufs = new Map<string, Buffer>();
    for (const name of todo) {
      try {
        bufs.set(name, await fs.readFile(path.join(dir, name)));
      } catch {
        // Not downloaded yet, or still locked: forget it and see it settle again.
        s.seen.delete(name);
      }
    }
    const items = [...bufs.keys()];
    const results = await ingestBatch(items.map((name) => ({ name, read: async () => bufs.get(name)! })));
    for (let i = 0; i < items.length; i++) {
      const name = items[i];
      const r = results[i];
      if (r.status === 'added' || r.status === 'skipped') {
        if (r.status === 'added') added.push({ id: r.id, filename: r.filename, at: now });
        await fs.unlink(path.join(dir, name)).catch(() => {});
        s.seen.delete(name);
      } else {
        const reason = r.error ?? 'It couldn’t be read.';
        s.failed.set(failureKey(byName.get(name)!), reason);
        held.push({ name, reason, since: keepSince.get(name) ?? now });
      }
    }
    if (added.length) console.log(`[inbox] ${added.length} added from the inbox`);
  }

  const changed =
    added.length > 0 ||
    log.problem !== undefined ||
    JSON.stringify(held.map((h) => [h.name, h.reason])) !== JSON.stringify(log.held.map((h) => [h.name, h.reason]));
  const out: InboxLog = { added: [...log.added, ...added], held, lastScan: now };
  if (changed) await writeInboxLog(out);
  return out;
}

state().scan = scanInbox;
