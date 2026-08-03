import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { analysePhoto, analysePhotoDetailed } from './analyze';
import { writePreviewAssets, writeReferencePreview, type PreviewAssets } from './preview';
import { solveMatch, type MatchSolution } from './solve';
import { MATCH_CACHE_DIR, MATCH_KEPT_DIR } from '../paths';
import type { BaselineMode, PhotoAnalysis, RegionKey } from './types';

// One comparison, start to finish.
//
// A match is expensive — two decodes, six model passes, two full-resolution
// measurement sweeps — and completely deterministic in its inputs. So it is
// keyed by the content hashes of both photos plus the baseline, and re-running
// the same pair is free. That matters more than it sounds: the strength slider,
// the preset download, and reopening a kept report all resolve to the same
// match, and none of them should pay for it again.

export interface MatchRecord {
  id: string;
  createdAt: string;
  reference: PhotoAnalysis;
  mine: PhotoAnalysis;
  solution: MatchSolution;
  preview: PreviewAssets;
  referencePreview: string;
  /** Region each preview mask channel holds — mirrors preview.maskChannels,
   *  repeated here because the client needs it alongside the solution. */
  maskChannels: RegionKey[];
  /** Display names, for the report header and preset naming. */
  referenceName: string;
  myName: string;
  kept: boolean;
}

const records = new Map<string, MatchRecord>();

/** Bounded: preview assets live on disk under public/, so an unbounded map
 *  would also mean unbounded disk use. Kept reports are exempt. */
const MAX_UNKEPT = 12;

export const matchId = (refHash: string, myHash: string, baseline: BaselineMode): string =>
  createHash('sha256').update(`${refHash}:${myHash}:${baseline}`).digest('hex').slice(0, 16);

export function getMatch(id: string): MatchRecord | undefined {
  return records.get(id);
}

export function listMatches(): MatchRecord[] {
  return [...records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function evictOldUnkept(): Promise<void> {
  const unkept = [...records.values()]
    .filter((r) => !r.kept)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (unkept.length > MAX_UNKEPT) {
    const victim = unkept.shift();
    if (!victim) break;
    records.delete(victim.id);
    await fs.rm(path.join(MATCH_CACHE_DIR, victim.id), { recursive: true, force: true }).catch(() => {});
  }
}

export interface RunMatchInput {
  referenceBuf: Buffer;
  referenceName: string;
  /** Original file on disk, used for the reference preview so it is not
   *  re-encoded from an already-lossy derivative. */
  referencePath: string;
  myBuf: Buffer;
  myName: string;
  baseline: BaselineMode;
}

/** Stages, in the order they run. The work is 20 seconds and up on a large RAW
 *  — long enough that a caller needs to be able to say what it is doing rather
 *  than show one sentence and hope. Named for what is actually happening, so
 *  the wait is legible instead of merely long. */
export type MatchStage = 'reference' | 'mine' | 'solve' | 'preview' | 'cached';
export const MATCH_STAGE_LABEL: Record<MatchStage, string> = {
  cached: 'Already measured — opening',
  reference: 'Measuring the reference',
  mine: 'Decoding and segmenting your photo',
  solve: 'Solving the grade',
  preview: 'Building the preview',
};
export type OnStage = (stage: MatchStage) => void;

export async function runMatch(input: RunMatchInput, onStage: OnStage = () => {}): Promise<MatchRecord> {
  const refHash = createHash('sha256').update(input.referenceBuf).digest('hex').slice(0, 16);
  const myHash = createHash('sha256').update(input.myBuf).digest('hex').slice(0, 16);
  const id = matchId(refHash, myHash, input.baseline);

  const existing = records.get(id);
  if (existing) { onStage('cached'); return existing; }

  const outDir = path.join(MATCH_CACHE_DIR, id);
  const webBase = `/api/match/asset/${id}`;

  // The reference is always a rendered image — it is something someone already
  // finished editing — so its baseline is never in question.
  onStage('reference');
  const reference = await analysePhoto(input.referenceBuf, input.referenceName, { baseline: 'native' });

  // The user's photo needs its masks and decoded pixels kept alive long enough
  // to write the preview, so it goes through the detailed path.
  onStage('mine');
  const detailed = await analysePhotoDetailed(input.myBuf, input.myName, { baseline: input.baseline });
  try {
    onStage('solve');
    const solution = solveMatch(reference, detailed.analysis);

    // Only regions the solver actually adjusted are worth packing into the
    // preview texture.
    const regionOrder = solution.faithful.masks.map((m) => m.region);
    onStage('preview');
    const preview = await writePreviewAssets(
      detailed.workingPath,
      detailed.masks,
      regionOrder,
      outDir,
      webBase,
    );
    const referencePreview = await writeReferencePreview(input.referencePath, outDir, webBase);

    const record: MatchRecord = {
      id,
      createdAt: new Date().toISOString(),
      reference,
      mine: detailed.analysis,
      solution,
      preview,
      referencePreview,
      maskChannels: preview.maskChannels,
      referenceName: input.referenceName,
      myName: input.myName,
      kept: false,
    };
    records.set(id, record);
    await evictOldUnkept();
    return record;
  } finally {
    await detailed.cleanup();
  }
}

/** Persist a match so it survives eviction and a restart. */
export async function keepMatch(id: string): Promise<MatchRecord | undefined> {
  const record = records.get(id);
  if (!record) return undefined;
  record.kept = true;
  await fs.mkdir(MATCH_KEPT_DIR, { recursive: true });
  await fs.writeFile(
    path.join(MATCH_KEPT_DIR, `${id}.json`),
    JSON.stringify(
      {
        id: record.id,
        createdAt: record.createdAt,
        referenceName: record.referenceName,
        myName: record.myName,
        solution: record.solution,
        reference: record.reference,
        mine: record.mine,
        preview: record.preview,
        referencePreview: record.referencePreview,
        maskChannels: record.maskChannels,
      },
      null,
      2,
    ),
  );
  return record;
}

/** Reload kept reports at startup so they survive a restart. */
export async function loadKeptMatches(): Promise<void> {
  let files: string[];
  try {
    files = await fs.readdir(MATCH_KEPT_DIR);
  } catch {
    return;
  }
  for (const f of files.filter((n) => n.endsWith('.json'))) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(MATCH_KEPT_DIR, f), 'utf8'));
      // The preview assets must still exist on disk, or the report would load
      // with broken images.
      await fs.access(path.join(MATCH_CACHE_DIR, data.id, 'photo.webp'));
      records.set(data.id, { ...data, kept: true } as MatchRecord);
    } catch {
      // A kept report whose assets were cleared is simply skipped.
    }
  }
}
