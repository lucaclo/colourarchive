import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { analysePhoto, analysePhotoDetailed } from './analyze';
import { writePreviewAssets, writeReferencePreview, type PreviewAssets } from './preview';
import { mergeReferences, solveMatch, type MatchSolution } from './solve';
import { MATCH_CACHE_DIR, MATCH_KEPT_DIR } from '../paths';
import type { BaselineMode, PhotoAnalysis, RegionKey } from './types';

// One comparison, start to finish.
//
// A match is expensive — two decodes, six model passes, two full-resolution
// measurement sweeps — and completely deterministic in its inputs. So it is
// keyed by the content hashes of every photo involved plus the baseline, and
// re-running the same pair (or the same weighted set of references) is free.
// That matters more than it sounds: the strength slider, the preset download,
// and reopening a kept report all resolve to the same match, and none of them
// should pay for it again.

/** One reference photo's contribution to a match, alongside its own preview. */
export interface ReferenceRecord {
  analysis: PhotoAnalysis;
  weight: number;
  name: string;
  previewUrl: string;
}

export interface MatchRecord {
  id: string;
  createdAt: string;
  references: ReferenceRecord[];
  /** What was actually solved against — references[0].analysis unchanged when
   *  there is only one, or the weighted blend from mergeReferences when there
   *  are several. Kept alongside `references` so the evidence panel has one
   *  set of numbers to read regardless of how many photos went in. */
  reference: PhotoAnalysis;
  mine: PhotoAnalysis;
  solution: MatchSolution;
  preview: PreviewAssets;
  /** Region each preview mask channel holds — mirrors preview.maskChannels,
   *  repeated here because the client needs it alongside the solution. */
  maskChannels: RegionKey[];
  /** Combined display name across every reference, for the report header and
   *  preset naming. */
  referenceName: string;
  myName: string;
  kept: boolean;
}

const records = new Map<string, MatchRecord>();

/** Bounded: preview assets live on disk under public/, so an unbounded map
 *  would also mean unbounded disk use. Kept reports are exempt. */
const MAX_UNKEPT = 12;

/** Order-independent: the same weighted set of references hashes the same
 *  whichever order they were uploaded in, so re-submitting them in a
 *  different order still hits the cache. */
export const matchId = (
  refs: { hash: string; weight: number }[],
  myHash: string,
  baseline: BaselineMode,
): string => {
  const refPart = refs.map((r) => `${r.hash}@${r.weight}`).sort().join(',');
  return createHash('sha256').update(`${refPart}:${myHash}:${baseline}`).digest('hex').slice(0, 16);
};

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

export interface ReferenceInput {
  buf: Buffer;
  name: string;
  /** Original file on disk, used for the reference preview so it is not
   *  re-encoded from an already-lossy derivative. */
  path: string;
  /** Relative weight against the other references in this match. Need not sum
   *  to 1 — mergeReferences normalises. */
  weight: number;
}

export interface RunMatchInput {
  /** At least one. A single reference behaves exactly as it always has —
   *  mergeReferences short-circuits rather than doing pointless work on one
   *  input, so a one-reference match pays no blending cost at all. */
  references: ReferenceInput[];
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
  if (input.references.length === 0) throw new Error('runMatch: at least one reference is required.');

  const refHashes = input.references.map((r) => createHash('sha256').update(r.buf).digest('hex').slice(0, 16));
  const myHash = createHash('sha256').update(input.myBuf).digest('hex').slice(0, 16);
  const id = matchId(
    input.references.map((r, i) => ({ hash: refHashes[i], weight: r.weight })),
    myHash,
    input.baseline,
  );

  const existing = records.get(id);
  if (existing) { onStage('cached'); return existing; }

  const outDir = path.join(MATCH_CACHE_DIR, id);
  const webBase = `/api/match/asset/${id}`;

  // Every reference is always a rendered image — each one is something
  // someone already finished editing — so its baseline is never in question.
  onStage('reference');
  const analyses = await Promise.all(
    input.references.map((r) => analysePhoto(r.buf, r.name, { baseline: 'native' })),
  );
  const references: ReferenceRecord[] = await Promise.all(
    input.references.map(async (r, i) => ({
      analysis: analyses[i],
      weight: r.weight,
      name: r.name,
      previewUrl: await writeReferencePreview(r.path, outDir, webBase, i),
    })),
  );
  const reference = mergeReferences(references.map((r) => ({ analysis: r.analysis, weight: r.weight })));

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

    const clean = (s: string) => s.replace(/\.[^.]+$/, '');
    const record: MatchRecord = {
      id,
      createdAt: new Date().toISOString(),
      references,
      reference,
      mine: detailed.analysis,
      solution,
      preview,
      maskChannels: preview.maskChannels,
      referenceName: references.map((r) => clean(r.name)).join(' + '),
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
        references: record.references,
        reference: record.reference,
        mine: record.mine,
        preview: record.preview,
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
