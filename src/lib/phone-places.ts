/**
 * Places without typing (issue #139): where an archive photo was taken, read
 * off the iPhone photos taken at about the same time.
 *
 * The cameras behind the archive don't geotag on their own, but the phone in
 * the same pocket does, and iCloud Photos puts those phone pictures in the
 * Mac's Photos library with their position and the moment they were taken. So
 * for each dated archive photo without a place, the nearest-in-time located
 * photo in that library (within about twenty minutes) is offered as a
 * suggestion — never placed silently. Accepting it is a placement like any
 * other, in the private `photos.locations.json`.
 *
 * Time is the hard part. The archive stores a camera's wall-clock time; the
 * library stores UTC plus the phone's offset. When the camera also wrote the
 * offset it believed it was in (`OffsetTimeOriginal`, every Sony here does),
 * both sides are compared in UTC, which is right even when the camera was
 * left on home time abroad. Without one, wall clocks are compared. Either way
 * the gap is shown on the suggestion, so a drifting clock is visible.
 *
 * The library is read straight from its SQLite file, read-only. macOS guards
 * it: the app (or Terminal, for the dev server) needs Full Disk Access, and
 * the reader says so in plain words when it doesn't have it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- Pure: matching --------------------------------------------------------

export type ArchiveShot = {
  id: string;
  /** The camera's wall-clock time, stored as if it were UTC (exif-reader). */
  capturedAt: string;
  /** The camera's own UTC offset in minutes, from OffsetTimeOriginal. */
  offsetMin?: number;
};

export type PhoneShot = { utcMs: number; lat: number; lon: number; tzOffsetSec?: number };

export type PlaceSuggestion = {
  id: string;
  lat: number;
  lon: number;
  /** Phone photo minus archive photo, in whole minutes (negative: earlier). */
  gapMin: number;
  /** How the two times were compared. */
  basis: 'utc' | 'local';
};

export const WINDOW_MIN = 20;

/** "+09:00" → 540. Undefined for anything else. */
export function parseOffset(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = value.trim().match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return undefined;
  const min = Number(m[2]) * 60 + Number(m[3]);
  if (min > 14 * 60) return undefined;
  return m[1] === '-' ? -min : min;
}

/** Index of the first element whose key is ≥ `t`. */
function lowerBound(keys: number[], t: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** For each shot, the nearest phone photo within `windowMin`, if any. */
export function suggestPlaces(shots: ArchiveShot[], phone: PhoneShot[], windowMin = WINDOW_MIN): PlaceSuggestion[] {
  const located = phone.filter((p) => Number.isFinite(p.utcMs) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && !(p.lat === 0 && p.lon === 0));
  const byUtc = [...located].sort((a, b) => a.utcMs - b.utcMs);
  const utcKeys = byUtc.map((p) => p.utcMs);
  const withTz = located.filter((p) => p.tzOffsetSec !== undefined);
  const localOf = (p: PhoneShot) => p.utcMs + p.tzOffsetSec! * 1000;
  const byLocal = [...withTz].sort((a, b) => localOf(a) - localOf(b));
  const localKeys = byLocal.map(localOf);
  const window = windowMin * 60_000;

  const nearest = (keys: number[], list: PhoneShot[], t: number) => {
    const i = lowerBound(keys, t);
    let best: { p: PhoneShot; gap: number } | null = null;
    for (const j of [i - 1, i]) {
      if (j < 0 || j >= keys.length) continue;
      const gap = keys[j] - t;
      if (Math.abs(gap) <= window && (!best || Math.abs(gap) < Math.abs(best.gap))) best = { p: list[j], gap };
    }
    return best;
  };

  const out: PlaceSuggestion[] = [];
  for (const shot of shots) {
    const wall = Date.parse(shot.capturedAt);
    if (!Number.isFinite(wall)) continue;
    const hit =
      shot.offsetMin !== undefined
        ? (() => { const h = nearest(utcKeys, byUtc, wall - shot.offsetMin! * 60_000); return h && { ...h, basis: 'utc' as const }; })()
        : (() => { const h = nearest(localKeys, byLocal, wall); return h && { ...h, basis: 'local' as const }; })();
    if (!hit) continue;
    out.push({ id: shot.id, lat: hit.p.lat, lon: hit.p.lon, gapMin: Math.round(hit.gap / 60_000), basis: hit.basis });
  }
  return out;
}

/** "iPhone photo 6 min later", "…at the same minute". */
export function describeGap(gapMin: number): string {
  if (gapMin === 0) return 'iPhone photo the same minute';
  return `iPhone photo ${Math.abs(gapMin)} min ${gapMin > 0 ? 'later' : 'earlier'}`;
}

// --- The library -----------------------------------------------------------

/** Core Data's epoch, 2001-01-01, in Unix seconds. */
const CORE_DATA_EPOCH = 978_307_200;

export function photosLibraryPath(): string {
  return process.env.COLOUR_ARCHIVE_PHOTOS_LIBRARY
    || path.join(os.homedir(), 'Pictures', 'Photos Library.photoslibrary', 'database', 'Photos.sqlite');
}

export class LibraryProblem extends Error {}

type Db = { prepare(sql: string): { all(...args: unknown[]): unknown[] }; close(): void };

async function open(file: string): Promise<{ db: Db; done: () => void }> {
  const { DatabaseSync } = await import('node:sqlite');
  try {
    fs.accessSync(file, fs.constants.R_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new LibraryProblem('There’s no Photos library on this Mac.');
    throw new LibraryProblem('macOS keeps the Photos library private. Give Colour Archive (or Terminal, for the dev server) Full Disk Access in System Settings › Privacy & Security, then look again.');
  }
  try {
    const db = new DatabaseSync(file, { readOnly: true }) as unknown as Db;
    db.prepare('SELECT 1 FROM ZASSET LIMIT 1').all();
    return { db, done: () => db.close() };
  } catch {
    // Photos holds the file open in WAL mode; a read-only open can fail on the
    // shared-memory file. Read a copy instead — never the library itself.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colour-photos-'));
    for (const ext of ['', '-wal', '-shm']) {
      if (fs.existsSync(file + ext)) fs.copyFileSync(file + ext, path.join(dir, `Photos.sqlite${ext}`));
    }
    const db = new DatabaseSync(path.join(dir, 'Photos.sqlite'), { readOnly: false }) as unknown as Db;
    return { db, done: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
  }
}

/** Located photos in the Mac's Photos library taken between two instants. */
export async function readPhoneShots(fromMs: number, toMs: number, file = photosLibraryPath()): Promise<PhoneShot[]> {
  const { db, done } = await open(file);
  try {
    const cols = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    const asset = cols('ZASSET');
    if (!asset.has('ZDATECREATED') || !asset.has('ZLATITUDE') || !asset.has('ZLONGITUDE')) {
      throw new LibraryProblem('This Photos library is laid out in a way the archive doesn’t know.');
    }
    const extra = cols('ZADDITIONALASSETATTRIBUTES');
    const tz = extra.has('ZTIMEZONEOFFSET') && extra.has('ZASSET');
    const trashed = asset.has('ZTRASHEDSTATE') ? 'AND COALESCE(a.ZTRASHEDSTATE, 0) = 0' : '';
    const rows = db.prepare(`
      SELECT a.ZDATECREATED AS t, a.ZLATITUDE AS lat, a.ZLONGITUDE AS lon${tz ? ', x.ZTIMEZONEOFFSET AS tz' : ''}
      FROM ZASSET a ${tz ? 'LEFT JOIN ZADDITIONALASSETATTRIBUTES x ON x.ZASSET = a.Z_PK' : ''}
      WHERE a.ZDATECREATED BETWEEN ? AND ?
        AND a.ZLATITUDE BETWEEN -90 AND 90 AND a.ZLONGITUDE BETWEEN -180 AND 180
        AND NOT (a.ZLATITUDE = 0 AND a.ZLONGITUDE = 0) ${trashed}
    `).all(fromMs / 1000 - CORE_DATA_EPOCH, toMs / 1000 - CORE_DATA_EPOCH) as { t: number; lat: number; lon: number; tz?: number | null }[];
    return rows.map((r) => ({
      utcMs: (r.t + CORE_DATA_EPOCH) * 1000,
      lat: r.lat,
      lon: r.lon,
      ...(typeof r.tz === 'number' ? { tzOffsetSec: r.tz } : {}),
    }));
  } finally {
    done();
  }
}
