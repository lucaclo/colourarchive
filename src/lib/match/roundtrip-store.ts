import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MATCH_CALIBRATION_DIR } from '../paths';
import type { Adjustments, GroupStrength } from './adjustments';
import type { Calibration } from './calibration';
import { withApproved, type AppliedAs, type CalRow } from './roundtrip';
import type { PhotoAnalysis } from './types';

// Disk for the round trip. Three things, each its own file so none of them
// is rewritten to change another:
//
//   downloads/<id>.json   what a downloaded preset actually set, with the two
//                         measurements it was solved from. Written at
//                         download time, because that is the only moment the
//                         values are certain — the strength sliders move on,
//                         and an unkept match is evicted after twelve more.
//   roundtrips.json       every check, eligible or not, with its rows.
//   approved.json         the constants the person chose to apply.

const DOWNLOADS = path.join(MATCH_CALIBRATION_DIR, 'downloads');
const ROUNDTRIPS = path.join(MATCH_CALIBRATION_DIR, 'roundtrips.json');
const APPROVED = path.join(MATCH_CALIBRATION_DIR, 'approved.json');

export interface DownloadSnapshot {
  id: string;
  matchId: string;
  at: string;
  strength: GroupStrength;
  variant: 'full' | 'safe';
  /** Whether the file handed over carried masks. */
  hadMasks: boolean;
  /** Exactly what the downloaded file set (masks removed for 'safe'). */
  applied: Adjustments;
  mine: PhotoAnalysis;
  reference: PhotoAnalysis;
  myName: string;
  referenceName: string;
}

export type DownloadSummary = Pick<DownloadSnapshot, 'id' | 'matchId' | 'at' | 'strength' | 'variant' | 'hadMasks'>;

export interface RoundTripRecord {
  id: string;
  downloadId: string;
  at: string;
  appliedAs: AppliedAs;
  eligible: boolean;
  reasons: string[];
  /** Mean share of the gaps closed, for the history line. */
  overall: number | null;
  rows: CalRow[];
}

export interface Approved {
  values: Partial<Record<keyof Calibration, number>>;
  /** When each value was applied, and from how many round trips. */
  meta: Partial<Record<keyof Calibration, { at: string; points: number }>>;
}

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(p: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, p);
}

// Serialised, for the same read-modify-write reason manifest.ts gives.
let chain: Promise<unknown> = Promise.resolve();
const locked = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
};

const safeId = (id: string) => /^[0-9a-f]{16}$/.test(id);

/** Same match, same strengths, same variant → same id, so downloading the
 *  identical preset twice does not make two entries to choose between. */
export async function recordDownload(s: Omit<DownloadSnapshot, 'id' | 'at'>): Promise<string> {
  const key = `${s.matchId}:${s.strength.light.toFixed(2)}:${s.strength.colour.toFixed(2)}:${s.strength.effects.toFixed(2)}:${s.variant}`;
  const id = createHash('sha256').update(key).digest('hex').slice(0, 16);
  await writeJson(path.join(DOWNLOADS, `${id}.json`), { ...s, id, at: new Date().toISOString() });
  return id;
}

export async function readDownload(id: string): Promise<DownloadSnapshot | null> {
  if (!safeId(id)) return null;
  return readJson<DownloadSnapshot | null>(path.join(DOWNLOADS, `${id}.json`), null);
}

/** A match's downloads, newest first — without the heavy measurements. */
export async function listDownloads(matchId: string): Promise<DownloadSummary[]> {
  let names: string[];
  try {
    names = await fs.readdir(DOWNLOADS);
  } catch {
    return [];
  }
  const out: DownloadSummary[] = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const d = await readJson<DownloadSnapshot | null>(path.join(DOWNLOADS, name), null);
    if (d && d.matchId === matchId) {
      out.push({ id: d.id, matchId: d.matchId, at: d.at, strength: d.strength, variant: d.variant, hadMasks: d.hadMasks });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export const readRoundTrips = () => readJson<RoundTripRecord[]>(ROUNDTRIPS, []);

export function appendRoundTrip(rt: Omit<RoundTripRecord, 'id'>): Promise<RoundTripRecord> {
  return locked(async () => {
    const all = await readRoundTrips();
    const record = { ...rt, id: createHash('sha256').update(`${rt.downloadId}:${rt.at}`).digest('hex').slice(0, 16) };
    all.push(record);
    await writeJson(ROUNDTRIPS, all);
    return record;
  });
}

/** Rows from eligible round trips only — the ones allowed to teach anything. */
export async function calibrationRowsSoFar(): Promise<{ rows: CalRow[]; eligible: number; total: number }> {
  const all = await readRoundTrips();
  const eligible = all.filter((r) => r.eligible);
  return { rows: eligible.flatMap((r) => r.rows.map((row) => ({ ...row, source: r.id }))), eligible: eligible.length, total: all.length };
}

export const readApproved = () => readJson<Approved>(APPROVED, { values: {}, meta: {} });

export function writeApproved(next: Approved): Promise<void> {
  return locked(() => writeJson(APPROVED, next));
}

/** What the solver should use now: the estimates, with approved fits over them. */
export async function activeCalibration(): Promise<Calibration> {
  return withApproved((await readApproved()).values);
}

/** Changes whenever the approved set does, so a match solved under one
 *  calibration is never served from cache under another. Empty when nothing
 *  is approved, which keeps every existing match id stable. */
export async function calibrationFingerprint(): Promise<string> {
  const { values } = await readApproved();
  const keys = Object.keys(values).sort();
  if (!keys.length) return '';
  return createHash('sha256').update(keys.map((k) => `${k}=${values[k as keyof Calibration]}`).join(',')).digest('hex').slice(0, 8);
}
