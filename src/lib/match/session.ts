import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { analysePhoto, analysePhotoDetailed } from './analyze';
import { analysisOutliers, averageAnalyses } from './group';
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
  /** The measurement `solution` was solved against — a single reference's own
   *  analysis, or (see `group.ts`) the centroid of several. Callers that only
   *  ever pass one reference can keep treating this as "the reference's
   *  analysis"; nothing about the shape changes underneath them. */
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
  /** How many references went into `reference`. 1 for an ordinary match. */
  referenceCount: number;
  /** Content hashes of every reference submitted, in request order — the
   *  board resolves these back to thumbnails for the group strip. */
  referenceIds: string[];
  /** Which of `referenceIds`, if any, measured like a different edit from
   *  the rest of the group — see `analysisOutliers`. Always empty below
   *  three references, which is a refusal to guess, not a clean bill. */
  outlierIds: string[];
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
  /** One reference photo, or several meant to share one edit — see group.ts
   *  for how more than one gets combined before solving. */
  references: Array<{
    buf: Buffer;
    name: string;
    /** Original file on disk, used for the reference preview so it is not
     *  re-encoded from an already-lossy derivative. */
    path: string;
  }>;
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
  const refHashes = input.references.map((r) => createHash('sha256').update(r.buf).digest('hex').slice(0, 16));
  const myHash = createHash('sha256').update(input.myBuf).digest('hex').slice(0, 16);
  // Sorted so the same group submitted in a different order still hits the
  // same cache entry — and with exactly one reference this is just that
  // reference's own hash, so every match cached before this existed is still
  // found exactly as it always was.
  const groupKey = [...refHashes].sort().join('+');
  const id = matchId(groupKey, myHash, input.baseline);

  const existing = records.get(id);
  if (existing) { onStage('cached'); return existing; }

  const outDir = path.join(MATCH_CACHE_DIR, id);
  const webBase = `/api/match/asset/${id}`;

  // Every reference is always a rendered image — each is something someone
  // already finished editing — so its baseline is never in question.
  // Independent measurements, so they run in parallel rather than one at a
  // time: three references is three times the model passes, not three times
  // the wait.
  onStage('reference');
  const analyses = await Promise.all(
    input.references.map((r) => analysePhoto(r.buf, r.name, { baseline: 'native' })),
  );
  // For one reference this returns that reference's own analysis, unchanged
  // — see averageAnalyses's own doc comment for why that has to hold exactly.
  const reference = averageAnalyses(analyses);
  const outlierIds = [...analysisOutliers(analyses)];

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
    // The wipe comparison needs one real photograph to show, not an average
    // of several — the first reference submitted stands in for the group.
    const referencePreview = await writeReferencePreview(input.references[0].path, outDir, webBase);

    const record: MatchRecord = {
      id,
      createdAt: new Date().toISOString(),
      reference,
      mine: detailed.analysis,
      solution,
      preview,
      referencePreview,
      maskChannels: preview.maskChannels,
      referenceName:
        input.references.length === 1 ? input.references[0].name : `${input.references.length} references, blended`,
      myName: input.myName,
      kept: false,
      referenceCount: input.references.length,
      referenceIds: refHashes,
      outlierIds,
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
        referenceCount: record.referenceCount,
        referenceIds: record.referenceIds,
        outlierIds: record.outlierIds,
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
      // A report kept before groups existed genuinely was one reference —
      // default the fields it never had rather than leave them undefined for
      // whatever reads them next.
      records.set(data.id, {
        referenceCount: 1,
        referenceIds: [],
        outlierIds: [],
        ...data,
        kept: true,
      } as MatchRecord);
    } catch {
      // A kept report whose assets were cleared is simply skipped.
    }
  }
}
