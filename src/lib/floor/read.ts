/**
 * Reading the floor (issue #147): a photograph of work prints in, the order
 * they were laid in out. detect.ts finds and straightens each print; each
 * one's photograph is matched by its DINOv2 embedding (embed.ts, the same
 * fingerprint Similar uses) against the photographs that were printed, one
 * print to one photograph, most certain first.
 */
import sharp from 'sharp';
import { embedBuffer } from '../embed';
import { findPrints, readingOrder, sampleRect, type PrintRect, type Raster } from './detect';
import { PHOTO_SHARE } from './workprints';

export interface Candidate { id: string; embedding: number[] }
export interface ReadPrint { id: string | null; score: number; row: number; pairedWithNext: boolean; rect: PrintRect }
export interface FloorReading { prints: ReadPrint[]; width: number; height: number }

const LONG_EDGE = 2000;
/** Below this cosine a print is left unread rather than guessed. */
export const MIN_SCORE = 0.55;

const dot = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** One-to-one, most similar pairs first. */
export function assign(sims: number[][], minScore = MIN_SCORE): { cand: number; score: number }[] {
  const pairs: { p: number; c: number; s: number }[] = [];
  sims.forEach((row, p) => row.forEach((s, c) => pairs.push({ p, c, s })));
  pairs.sort((a, b) => b.s - a.s);
  const out = sims.map(() => ({ cand: -1, score: 0 }));
  const usedP = new Set<number>(), usedC = new Set<number>();
  for (const { p, c, s } of pairs) {
    if (s < minScore) break;
    if (usedP.has(p) || usedC.has(c)) continue;
    usedP.add(p); usedC.add(c);
    out[p] = { cand: c, score: s };
  }
  return out;
}

export async function readFloor(photo: Buffer, candidates: Candidate[]): Promise<FloorReading> {
  const { data, info } = await sharp(photo, { failOn: 'none' }).rotate()
    .resize(LONG_EDGE, LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha().toColorspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const raster: Raster = { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: info.channels };
  const rects = findPrints(raster).map((q) => (q.w > q.h ? { ...q, w: q.h, h: q.w, angle: q.angle + (q.angle > 0 ? -Math.PI / 2 : Math.PI / 2) } : q));
  const embeddings: number[][] = [];
  for (const q of rects) {
    // The card's photograph only: the code strip below would only confuse it.
    const crop = sampleRect(raster, q, 256, { top: 0, bottom: PHOTO_SHARE, inset: 0.05 });
    const jpeg = await sharp(Buffer.from(crop.data), { raw: { width: crop.width, height: crop.height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
    embeddings.push(await embedBuffer(jpeg));
  }
  const matches = assign(embeddings.map((e) => candidates.map((c) => dot(e, c.embedding))));
  const order = readingOrder(rects);
  return {
    width: raster.width,
    height: raster.height,
    prints: order.map((o) => ({
      id: matches[o.index].cand >= 0 ? candidates[matches[o.index].cand].id : null,
      score: Math.round(matches[o.index].score * 1000) / 1000,
      row: o.row,
      pairedWithNext: o.pairedWithNext,
      rect: rects[o.index],
    })),
  };
}
