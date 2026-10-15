// Style Match accuracy benchmark.
//
//   npm run match:bench [-- --photos 8 --grades 3]
//   OLD_MATCH_DIR=path/to/old/src/lib/match npm run match:bench   (adds "before")
//
// Every number is a SIMULATION through the Lightroom model (lr-model.ts): how
// close the preset Style Match writes would bring your photo to the reference,
// measured as Lightroom's render would be measured. Two kinds of case:
//
//   synthetic  your own archive photo, with a random Lightroom grade applied
//              through the model, used as the reference. The right answer
//              exists and is reachable, so a perfect solver scores ~0.
//   real       inspiration-board references against archive photos — the job
//              people actually do, where some of the gap is content, not grade.
//
// ΔE is OKLab × 100 averaged over shadows, midtones and highlights (about 1 is
// the smallest difference anyone sees side by side). Tone is the mean gap
// along the histogram in 0..255 levels.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { identityAdjustments, type Adjustments } from '../src/lib/match/adjustments';
import { linearToOklab, prepareLr, renderLinear, srgbEncode, type LrTables } from '../src/lib/match/lr-model';
import { lrTables } from '../src/lib/match/lr-tables-node';
import { refineSolution } from '../src/lib/match/refine';
import { closeness, simulate, targetFromAnalysis, type Closeness } from '../src/lib/match/simulate';
import { solveMatch } from '../src/lib/match/solve';
import { solveAndRefine } from '../src/lib/match/engine';
import { segmentRegions } from '../src/lib/match/regions';
import { decodeSample, measureRegionsFromPixels } from '../src/lib/match/stats-core';
import { ANALYSIS_VERSION, HSL_BANDS, NO_MASKS, type PhotoAnalysis, type RgbImage } from '../src/lib/match/types';

const args = process.argv.slice(2);
const opt = (name: string, d: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const PHOTOS = opt('photos', 8);
const GRADES = opt('grades', 3);
const CROP = opt('crop', 0.4);
const MASKS = args.includes('--masks');
const TMP = path.join(process.cwd(), 'node_modules', '.cache', 'match-bench');
const EDGE = 900;
const ROOT = process.cwd();

// Deterministic, so runs compare.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const U = (lo: number, hi: number) => lo + (hi - lo) * rand();

async function load(file: string): Promise<RgbImage> {
  const { data, info } = await sharp(file)
    .resize({ width: EDGE, height: EDGE, fit: 'inside' })
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: 3 };
}

const noTexture = { usable: false, blocked: 'resolution' as const, normalised: false, nativeSize: { width: 1, height: 1 }, grain: 0, grainSize: 0, acutance: 0, flatToEdge: 0, measuredAt: { width: 1, height: 1 } };

const maskCache = new Map<string, Awaited<ReturnType<typeof segmentRegions>>>();

/** Segment through a PNG on disk, as the app does (only with --masks). */
async function masksFor(img: RgbImage, id: string) {
  if (!MASKS) return NO_MASKS(img.width, img.height);
  const hit = maskCache.get(id);
  if (hit) return hit;
  await fs.mkdir(TMP, { recursive: true });
  const file = path.join(TMP, `${maskCache.size}.png`);
  await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 3 } }).png().toFile(file);
  const masks = await segmentRegions(file);
  maskCache.set(id, masks);
  return masks;
}

async function analyse(img: RgbImage, id: string): Promise<PhotoAnalysis> {
  const m = measureRegionsFromPixels(img, await masksFor(img, id));
  return {
    id, filename: id, baseline: 'export', width: img.width, height: img.height, sampledAt: m.sampledAt,
    regions: m.regions, hslBands: m.hslBands, texture: noTexture,
    vignette: { falloffStops: 0, symmetry: 0, usable: false }, timings: {}, warnings: [],
    version: ANALYSIS_VERSION, sample: m.sample,
  };
}

/** Render a whole image through the model, back to sRGB bytes. */
function grade(img: RgbImage, adj: Adjustments, t: LrTables): RgbImage {
  const prep = prepareLr(adj, t);
  const out = new Uint8Array(img.width * img.height * 3);
  const px = new Float64Array(3);
  const dec = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const lut = Array.from({ length: 256 }, (_, i) => dec(i));
  for (let i = 0; i < img.width * img.height; i++) {
    const p = i * img.channels;
    renderLinear(prep, lut[img.data[p]], lut[img.data[p + 1]], lut[img.data[p + 2]], null, px);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(srgbEncode(px[c]) * 255);
  }
  return { data: out, width: img.width, height: img.height, channels: 3 };
}

/** The right part of an image, from `from` (0..1) across. */
function crop(img: RgbImage, from: number): RgbImage {
  const x0 = Math.floor(img.width * from);
  const w = img.width - x0;
  const out = new Uint8Array(w * img.height * 3);
  for (let y = 0; y < img.height; y++) {
    out.set(img.data.subarray((y * img.width + x0) * 3, (y * img.width + img.width) * 3), y * w * 3);
  }
  return { data: out, width: w, height: img.height, channels: 3 };
}

function randomGrade(): Adjustments {
  const a = identityAdjustments();
  a.exposure = U(-0.6, 0.6);
  const lift = U(0, 18);
  const s = U(-14, 22);
  a.curve = [
    { x: 0, y: Math.round(lift) },
    { x: 64, y: Math.round(64 - s + lift * 0.5) },
    { x: 128, y: Math.round(128 + U(-8, 8)) },
    { x: 192, y: Math.round(192 + s) },
    { x: 255, y: Math.round(255 - U(0, 10)) },
  ];
  a.saturation = U(-30, 25);
  a.vibrance = U(-15, 30);
  a.grading.global = { hue: U(0, 360), sat: U(0, 22), lum: 0 };
  a.grading.shadows = { hue: U(150, 260), sat: U(0, 35), lum: 0 };
  a.grading.highlights = { hue: U(20, 70), sat: U(0, 35), lum: 0 };
  for (let k = 0; k < 2; k++) {
    const b = HSL_BANDS[Math.floor(U(0, 8))].key;
    a.hsl[b] = { hue: U(-30, 30), sat: U(-40, 30), lum: U(-25, 25) };
  }
  return a;
}

/** Mean per-pixel ΔE (OKLab × 100) between two grades of the same sample. */
function pixelDeltaE(a: Adjustments, b: Adjustments, sample: ReturnType<typeof decodeSample>, t: LrTables): number {
  const pa = prepareLr(a, t), pb = prepareLr(b, t);
  const x = new Float64Array(3), y = new Float64Array(3);
  let sum = 0;
  for (let i = 0; i < sample.n; i++) {
    const [r, g, bl] = [sample.linear[i * 3], sample.linear[i * 3 + 1], sample.linear[i * 3 + 2]];
    renderLinear(pa, r, g, bl, null, x);
    renderLinear(pb, r, g, bl, null, y);
    const la = linearToOklab(x[0], x[1], x[2]), lb = linearToOklab(y[0], y[1], y[2]);
    sum += 100 * Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
  }
  return sum / sample.n;
}

interface Recovery { untouched: number; before?: number; unrefined: number; refined: number; engine: number; trueTone?: number; trueColour?: number }
const recovery: Recovery[] = [];

interface Row { kind: string; untouched: Closeness; oracle?: Closeness; before?: Closeness; unrefined: Closeness; refined: Closeness; engine: Closeness; ms: number }

async function oldSolver(): Promise<null | ((ref: string, mine: string) => Adjustments)> {
  const dir = process.env.OLD_MATCH_DIR;
  if (!dir) return null;
  const solve = await import(path.resolve(dir, 'solve.ts'));
  const core = await import(path.resolve(dir, 'stats-core.ts'));
  const types = await import(path.resolve(dir, 'types.ts'));
  const cache = new Map<string, PhotoAnalysis>();
  return (refFile: string, mineFile: string) => {
    const an = (f: string) => {
      const img = images.get(f)!;
      const m = core.measureRegionsFromPixels(img, types.NO_MASKS(img.width, img.height));
      return { id: f, filename: f, baseline: 'export', width: img.width, height: img.height, sampledAt: 0, texture: noTexture, vignette: { falloffStops: 0, symmetry: 0, usable: false }, timings: {}, warnings: [], regions: m.regions, hslBands: m.hslBands } as PhotoAnalysis;
    };
    const r = cache.get(refFile) ?? an(refFile);
    const m = cache.get(mineFile) ?? an(mineFile);
    cache.set(refFile, r);
    cache.set(mineFile, m);
    return solve.solveMatch(r, m).faithful as Adjustments;
  };
}

const images = new Map<string, RgbImage>();

async function main() {
  const t = await lrTables();
  const old = await oldSolver();
  const imgDir = path.join(ROOT, 'public', 'img');
  const archive = (await fs.readdir(imgDir)).filter((f) => f.endsWith('-1280.avif')).sort();
  const pick = Array.from({ length: PHOTOS }, (_, i) => archive[Math.floor((i * archive.length) / PHOTOS)]);
  const insp = (await fs.readdir(path.join(ROOT, 'inspiration'))).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();

  const rows: Row[] = [];
  const run = (kind: string, ref: PhotoAnalysis, mine: PhotoAnalysis, oldAdj?: Adjustments, truth?: Adjustments) => {
    const sample = decodeSample(mine.sample!);
    const target = targetFromAnalysis(ref);
    const sol = solveMatch(ref, mine);
    const t0 = Date.now();
    const refined = refineSolution(sol, ref, mine, t);
    const ms = Date.now() - t0;
    const engine = solveAndRefine(ref, mine, { tables: t });
    if (truth && process.env.BENCH_DEBUG) {
      const f = engine.faithful;
      const mid = (a: Adjustments) => Math.round(a.curve.reduce((m, p) => (Math.abs(p.x - 128) < Math.abs(m.x - 128) ? p : m)).y - 128);
      console.log(
        `exp ${truth.exposure.toFixed(2)}→${f.exposure.toFixed(2)}  sat ${truth.saturation.toFixed(0)}/${truth.vibrance.toFixed(0)}→${f.saturation.toFixed(0)}/${f.vibrance.toFixed(0)}`,
        ` glob ${truth.grading.global.hue.toFixed(0)}@${truth.grading.global.sat.toFixed(0)}→${f.grading.global.hue.toFixed(0)}@${f.grading.global.sat.toFixed(0)}`,
        ` masks ${f.masks.map((m) => m.region + ':' + m.exposure.toFixed(2)).join(',')}`,
        ` mid ${mid(truth)}→${mid(f)}  untouched ${pixelDeltaE(identityAdjustments(), truth, sample, t).toFixed(1)} engine ${pixelDeltaE(f, truth, sample, t).toFixed(1)}`,
      );
    }
    if (truth) {
      recovery.push({
        untouched: pixelDeltaE(identityAdjustments(), truth, sample, t),
        before: oldAdj ? pixelDeltaE(oldAdj, truth, sample, t) : undefined,
        unrefined: pixelDeltaE(sol.faithful, truth, sample, t),
        refined: pixelDeltaE(refined.faithful, truth, sample, t),
        engine: pixelDeltaE(engine.faithful, truth, sample, t),
        // Diagnosis: the refined preset with the TRUE tone (exposure + curve)
        // swapped in, and with the true colour swapped in instead.
        trueTone: pixelDeltaE({ ...refined.faithful, exposure: truth.exposure, curve: truth.curve }, truth, sample, t),
        trueColour: pixelDeltaE({ ...truth, exposure: refined.faithful.exposure, curve: refined.faithful.curve, masks: [] }, truth, sample, t),
      });
    }
    const c = (a: Adjustments) => closeness(simulate(a, sample, t), target);
    rows.push({
      kind,
      untouched: c(identityAdjustments()),
      oracle: truth ? c(truth) : undefined,
      before: oldAdj ? c(oldAdj) : undefined,
      unrefined: c(sol.faithful),
      refined: refined.predicted!.faithful,
      // Measured against the reference AS IS, so the composition step is
      // judged by the same yardstick as everything else.
      engine: c(engine.faithful),
      ms,
    });
  };

  for (const f of pick) {
    const file = path.join(imgDir, f);
    const img = await load(file);
    images.set(file, img);
    const mine = await analyse(img, f);
    for (let g = 0; g < GRADES; g++) {
      const truth = randomGrade();
      const graded = crop(grade(img, truth, t), CROP);
      const key = `${file}#${g}`;
      images.set(key, graded);
      // The reference is a DIFFERENT crop of the graded photo — its right
      // 60% — so content doesn't line up pixel for pixel, as in real use.
      run('synthetic', await analyse(graded, key), mine, old?.(key, file), truth);
    }
  }
  for (let i = 0; i < Math.min(insp.length, PHOTOS * 2); i++) {
    const refFile = path.join(ROOT, 'inspiration', insp[i]);
    const mineFile = path.join(imgDir, pick[i % pick.length]);
    if (!images.has(refFile)) images.set(refFile, await load(refFile));
    run('real', await analyse(images.get(refFile)!, insp[i]), await analyse(images.get(mineFile)!, mineFile), old?.(refFile, mineFile));
  }

  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
  for (const kind of ['synthetic', 'real']) {
    const rs = rows.filter((r) => r.kind === kind);
    if (!rs.length) continue;
    console.log(`\n${kind} (${rs.length} pairs)            ΔE mean  ΔE median  tone (levels)`);
    const line = (label: string, get: (r: Row) => Closeness | undefined) => {
      const v = rs.map(get).filter((x): x is Closeness => Boolean(x));
      if (!v.length) return;
      console.log(`  ${label.padEnd(26)} ${avg(v.map((x) => x.deltaE)).toFixed(2).padStart(6)}  ${median(v.map((x) => x.deltaE)).toFixed(2).padStart(9)}  ${avg(v.map((x) => x.toneLevels)).toFixed(2).padStart(12)}`);
    };
    line('untouched', (r) => r.untouched);
    line('oracle: the real grade', (r) => r.oracle);
    line('before round 6', (r) => r.before);
    line('round 6, solver only', (r) => r.unrefined);
    line('round 6, refined', (r) => r.refined);
    line('round 6, composed+refined', (r) => r.engine);
    console.log(`  refinement time: mean ${avg(rs.map((r) => r.ms)).toFixed(0)} ms`);
    if (kind === 'synthetic' && recovery.length) {
      console.log('\n  grade recovery: your photo under the preset vs under the true grade, per-pixel ΔE');
      for (const k of ['untouched', 'before', 'unrefined', 'refined', 'engine', 'trueTone', 'trueColour'] as const) {
        const v = recovery.map((r) => r[k]).filter((x): x is number => x !== undefined);
        if (v.length) console.log(`    ${k.padEnd(12)} mean ${avg(v).toFixed(2)}  median ${median(v).toFixed(2)}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
