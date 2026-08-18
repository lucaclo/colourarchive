import fs from 'node:fs/promises';
import path from 'node:path';
import { analysePhoto } from '../src/lib/match/analyze';
import { identityAdjustments, zeroHsl, type Adjustments, type HslTriple } from '../src/lib/match/adjustments';
import { buildPresetFiles } from '../src/lib/match/xmp';
import { DEFAULT_CALIBRATION, type Calibration } from '../src/lib/match/calibration';
import { HSL_BANDS, type HslBand, type PhotoAnalysis } from '../src/lib/match/types';

// The measurement harness `calibration.ts` documents but does not ship.
//
//   npx tsx scripts/match-calibrate.ts probes <base.jpg> --out=<dir>
//   npx tsx scripts/match-calibrate.ts fit <base.jpg> <exportsDir> [--out=calibration.json]
//
// See CALIBRATION.md for the full walkthrough. Short version: `probes` writes
// one .xmp per (calibration constant × slider value) that isolates that ONE
// control; apply each to <base.jpg> in real Lightroom, export a JPEG per probe
// named exactly as printed, drop them all in one folder, then run `fit`
// against that folder. `fit` re-measures every export with this app's own
// `analyze.ts` — the same code path a live match runs through — and solves
// each calibration constant from how much the measured quantity actually
// moved per slider unit, replacing `DEFAULT_CALIBRATION`'s estimates.
//
// Every `measure` function and every `kind` below is the ALGEBRAIC INVERSE of
// the corresponding line in solve.ts — see the comment on each probe. Getting
// that inversion wrong would silently miscalibrate rather than fail loudly,
// so if you touch solve.ts's use of a calibration constant, update its probe
// here to match.

const RED_BAND_INDEX = HSL_BANDS.findIndex((b) => b.key === 'red');

const zeroWheel = () => ({ hue: 0, sat: 0, lum: 0 });
const zeroGrading = () => ({
  global: zeroWheel(), shadows: zeroWheel(), midtones: zeroWheel(), highlights: zeroWheel(),
  blending: 50, balance: 0,
});

function withHsl(band: HslBand['key'], triple: Partial<HslTriple>): Adjustments['hsl'] {
  const hsl = zeroHsl();
  hsl[band] = { hue: 0, sat: 0, lum: 0, ...triple };
  return hsl;
}

/**
 * How a probe's (applied slider, measured quantity) pairs turn into a
 * calibration constant. Mirrors the three shapes solve.ts actually uses:
 *
 *   'unit'    measured = applied * (unit / 100)      →  unit  = 100 * slope(applied → measured)
 *   'gain100' applied  = measured * 100 * gain        →  gain  = slope(measured → applied) / 100
 *   'gainRaw' applied  = measured * gain               →  gain  = slope(measured → applied)
 *
 * All three reduce to a single through-the-origin linear fit; only which axis
 * is "applied" and which is "measured" changes, plus a /100 or *100. Fitting
 * through the origin (rather than each point alone) means a probe with 3+
 * slider magnitudes averages out per-point measurement noise, which one point
 * alone cannot.
 */
type ProbeKind = 'unit' | 'gain100' | 'gainRaw';

interface Probe {
  key: keyof Calibration;
  label: string;
  kind: ProbeKind;
  /** Slider magnitudes to probe at. Signed where the control is signed. */
  points: number[];
  /** Full Adjustments for one probe point, built from identity. */
  build: (v: number) => Adjustments;
  /** Measured quantity, in the units solve.ts computes it in. Null skips the
   *  point (e.g. a region the photo doesn't contain). */
  measure: (base: PhotoAnalysis, exported: PhotoAnalysis) => number | null;
  /** What kind of base photo this probe needs, for the console instructions. */
  baseHint: string;
}

const identity = () => identityAdjustments();

const PROBES: Probe[] = [
  {
    key: 'saturationGain',
    label: 'Saturation',
    kind: 'gain100',
    points: [-60, -30, 30, 60],
    build: (v) => ({ ...identity(), saturation: v }),
    // Inverse of solve.ts:619 `adj.saturation = clampTo(wantedDelta*100*cal.saturationGain, 100)`,
    // where wantedDelta = k-1 and k = solve.ts:602-604's chroma-magnitude ratio,
    // which on a single global region reduces to refC/mineC.
    measure: (base, exp) => {
      const b = base.regions.global?.C.mean, e = exp.regions.global?.C.mean;
      if (!b || b < 1e-5) return null;
      return e! / b - 1;
    },
    baseHint: 'any photo with visible colour (not a grey card)',
  },
  {
    key: 'vibranceGain',
    label: 'Vibrance',
    kind: 'gain100',
    points: [-60, -30, 30, 60],
    build: (v) => ({ ...identity(), vibrance: v }),
    // Same inversion as saturationGain — see the note on that probe for why
    // the restrained-mode 0.7/0.3 split (solve.ts:616-617) does NOT belong
    // here: that split is how the solver allocates a desired ratio across the
    // two controls, not a description of either control's own strength.
    measure: (base, exp) => {
      const b = base.regions.global?.C.mean, e = exp.regions.global?.C.mean;
      if (!b || b < 1e-5) return null;
      return e! / b - 1;
    },
    baseHint: 'same as Saturation — visible colour, ideally including some skin-tone-like midtones since Vibrance treats them differently',
  },
  {
    key: 'colorGradeUnit',
    label: 'Colour Grading > Global saturation',
    kind: 'unit',
    points: [30, 60, 100],
    build: (v) => ({ ...identity(), grading: { ...zeroGrading(), global: { hue: 0, sat: v, lum: 0 } } }),
    // Inverse of solve.ts:669 `gradeSat = min(100, (castMag/cal.colorGradeUnit)*100)`.
    // castMag is hue-independent (solve.ts:658 `Math.hypot(da, db)`), so the
    // probe's wheel hue (0 = red here) does not matter for the fit.
    measure: (base, exp) => {
      const b = base.regions.global?.ab, e = exp.regions.global?.ab;
      if (!b || !e) return null;
      return Math.hypot(e.a - b.a, e.b - b.b);
    },
    baseHint: 'a photo with a near-neutral global cast, so the wheel\'s push is the dominant signal',
  },
  {
    key: 'tempUnit',
    label: 'Temp (manual, relative)',
    kind: 'unit',
    points: [-100, -50, 50, 100],
    build: (v) => ({ ...identity(), temp: v }),
    // Inverse of solve.ts:678 `adj.temp = (db/cal.tempUnit)*100`.
    measure: (base, exp) => {
      const b = base.regions.global?.ab, e = exp.regions.global?.ab;
      if (!b || !e) return null;
      return e.b - b.b;
    },
    baseHint: 'same neutral-cast photo as Colour Grading > Global',
  },
  {
    key: 'tintUnit',
    label: 'Tint (manual, relative)',
    kind: 'unit',
    points: [-100, -50, 50, 100],
    build: (v) => ({ ...identity(), tint: v }),
    // Inverse of solve.ts:679 `adj.tint = (da/cal.tintUnit)*100`.
    measure: (base, exp) => {
      const b = base.regions.global?.ab, e = exp.regions.global?.ab;
      if (!b || !e) return null;
      return e.a - b.a;
    },
    baseHint: 'same neutral-cast photo as Colour Grading > Global',
  },
  {
    key: 'hslSaturationGain',
    label: 'Colour Mixer > Red > Saturation',
    kind: 'gain100',
    points: [-60, -30, 30, 60],
    build: (v) => ({ ...identity(), hsl: withHsl('red', { sat: v }) }),
    // Inverse of solve.ts:723-724 `hsl.sat = clampTo((bandRatio-1)*100*damp*cal.hslSaturationGain, ...)`.
    // Probed on Red as the representative band — all eight bands share the
    // same slider mechanism, so one band's fit is a reasonable stand-in for
    // all of them rather than requiring eight separate probe sets.
    measure: (base, exp) => {
      const b = base.hslBands[RED_BAND_INDEX], e = exp.hslBands[RED_BAND_INDEX];
      if (!b || !e || b.weight < 0.02 || e.weight < 0.02 || b.chroma < 1e-5) return null;
      return e.chroma / b.chroma - 1;
    },
    baseHint: 'a photo containing a clearly red/warm subject with real weight in frame (e.g. a red object filling a meaningful fraction of it) — a colour chart works well',
  },
  {
    key: 'hslLuminanceGain',
    label: 'Colour Mixer > Red > Luminance',
    kind: 'gainRaw',
    points: [-60, -30, 30, 60],
    build: (v) => ({ ...identity(), hsl: withHsl('red', { lum: v }) }),
    // Inverse of solve.ts:728 `hsl.lum = clampTo((r.L - m.L)*cal.hslLuminanceGain*damp, ...)`.
    // No /100 here — unlike the other HSL/effects constants, this one is a
    // direct multiplier on a 0..1 OKLCH lightness delta, which is why it is
    // ~320 rather than a small fraction like the others.
    measure: (base, exp) => {
      const b = base.hslBands[RED_BAND_INDEX], e = exp.hslBands[RED_BAND_INDEX];
      if (!b || !e || b.weight < 0.02 || e.weight < 0.02) return null;
      return e.L - b.L;
    },
    baseHint: 'same red-subject photo as Colour Mixer > Red > Saturation',
  },
  {
    key: 'hslHueDegreesAt100',
    label: 'Colour Mixer > Red > Hue',
    kind: 'unit',
    points: [-80, -40, 40, 80],
    build: (v) => ({ ...identity(), hsl: withHsl('red', { hue: v }) }),
    // Inverse of solve.ts:732 `hsl.hue = clampTo((dh/cal.hslHueDegreesAt100)*100*damp, ...)`.
    measure: (base, exp) => {
      const b = base.hslBands[RED_BAND_INDEX], e = exp.hslBands[RED_BAND_INDEX];
      if (!b || !e || b.weight < 0.02 || e.weight < 0.02) return null;
      let dh = e.hue - b.hue;
      while (dh > 180) dh -= 360;
      while (dh < -180) dh += 360;
      return dh;
    },
    baseHint: 'same red-subject photo as Colour Mixer > Red > Saturation',
  },
  {
    key: 'grainUnit',
    label: 'Grain > Amount',
    kind: 'unit',
    points: [40, 70, 100],
    build: (v) => ({ ...identity(), grainAmount: v, grainSize: 25, grainRoughness: 50 }),
    // Inverse of solve.ts:885 `adj.grainAmount = min(100, (dGrain/cal.grainUnit)*100*damp)`.
    measure: (base, exp) => {
      if (!base.texture.usable || !exp.texture.usable) return null;
      return exp.texture.grain - base.texture.grain;
    },
    baseHint: 'a clean, low-noise base photo, so added grain is the only thing moving the measurement',
  },
  {
    key: 'noiseReductionUnit',
    label: 'Noise Reduction',
    kind: 'unit',
    points: [30, 60, 100],
    build: (v) => ({ ...identity(), noiseReduction: v }),
    // Inverse of solve.ts:892 `adj.noiseReduction = min(100, (-dGrain/cal.noiseReductionUnit)*100*damp)`.
    measure: (base, exp) => {
      if (!base.texture.usable || !exp.texture.usable) return null;
      return base.texture.grain - exp.texture.grain;
    },
    baseHint: 'the OPPOSITE of the Grain probe — a genuinely noisy photo (high ISO), so there is real grain for the slider to remove',
  },
  {
    key: 'textureUnit',
    label: 'Texture',
    kind: 'unit',
    points: [-80, -40, 40, 80],
    build: (v) => ({ ...identity(), texture: v }),
    // Inverse of solve.ts:895 `adj.texture = clamp((dAcut/cal.textureUnit)*100*damp, -100, 100)`.
    measure: (base, exp) => {
      if (!base.texture.usable || !exp.texture.usable) return null;
      return exp.texture.acutance - base.texture.acutance;
    },
    baseHint: 'a photo with real mid-frequency detail (skin, foliage, fabric) — a flat card has nothing for Texture to act on',
  },
  {
    key: 'vignetteStopsAt100',
    label: 'Vignette (Effects panel)',
    kind: 'unit',
    points: [-100, -60, -30],
    build: (v) => ({ ...identity(), vignette: v }),
    // Inverse of solve.ts:909 `adj.vignette = clamp((dStops/cal.vignetteStopsAt100)*100*damp, -100, 100)`.
    measure: (base, exp) => {
      if (!base.vignette.usable || !exp.vignette.usable) return null;
      return exp.vignette.falloffStops - base.vignette.falloffStops;
    },
    baseHint: 'a photo with even, unvignetted corners to start from (the falloff this probe measures should be entirely the slider\'s doing)',
  },
];

// Calibration constants NOT covered here, and why:
//
//   sharpenUnit            solve.ts never reads it — nothing currently sets
//                           adj.sharpenAmount from a measurement, so there is
//                           no forward formula to invert yet. Measuring it
//                           would produce a number the solver can't use.
//
//   localTempUnit,          Drive MASK (Select Subject/Sky/Background)
//   localTintUnit,          adjustments (solve.ts:844-845, ~831). Lightroom's
//   localSaturationGain      mask XMP is AI-regenerated on import rather than
//                           a fixed block this script can probe the same way
//                           as a global slider — isolating one local control
//                           needs a real mask drawn in Lightroom, exported,
//                           and measured only within that mask's region. That
//                           is a reasonable follow-up but a different harness
//                           than this one.

function fitSlopeThroughOrigin(points: [number, number][]): number {
  let sxy = 0, sxx = 0;
  for (const [x, y] of points) { sxy += x * y; sxx += x * x; }
  return sxx > 1e-9 ? sxy / sxx : NaN;
}

function solveConstant(kind: ProbeKind, pairs: [applied: number, measured: number][]): number {
  if (kind === 'unit') return 100 * fitSlopeThroughOrigin(pairs.map(([a, m]) => [a, m]));
  if (kind === 'gain100') return fitSlopeThroughOrigin(pairs.map(([a, m]) => [m, a])) / 100;
  return fitSlopeThroughOrigin(pairs.map(([a, m]) => [m, a])); // gainRaw
}

function probeFilename(key: string, value: number): string {
  return `${key}_${value}`;
}

async function cmdProbes(basePath: string, outDir: string): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  console.log(`Base photo: ${basePath}\n`);
  console.log('For each line below: apply the .xmp to a COPY of the base photo in Lightroom,');
  console.log('export a JPEG, and name the export EXACTLY as shown (extension can be .jpg or .jpeg).\n');

  for (const probe of PROBES) {
    console.log(`── ${probe.label}  (${probe.key}) ──`);
    console.log(`   needs: ${probe.baseHint}`);
    for (const v of probe.points) {
      const adj = probe.build(v);
      const name = probeFilename(probe.key, v);
      const [file] = buildPresetFiles(adj, { name, group: 'Calibration', seed: name });
      await fs.writeFile(path.join(outDir, `${name}.xmp`), file.contents);
      console.log(`   ${name}.xmp  →  export as  ${name}.jpg`);
    }
    console.log('');
  }
  console.log(`Wrote ${PROBES.reduce((n, p) => n + p.points.length, 0)} presets to ${outDir}`);
}

async function cmdFit(basePath: string, exportsDir: string, outPath?: string): Promise<void> {
  const baseBuf = await fs.readFile(basePath);
  const base = await analysePhoto(baseBuf, path.basename(basePath), { baseline: 'native', fresh: true });

  const entries = await fs.readdir(exportsDir);
  const byKey = new Map<string, Map<number, string>>();
  for (const entry of entries) {
    const m = entry.match(/^([a-zA-Z]+)_(-?\d+(?:\.\d+)?)\.(jpe?g|png|tiff?)$/i);
    if (!m) continue;
    const [, key, valueStr] = m;
    if (!byKey.has(key)) byKey.set(key, new Map());
    byKey.get(key)!.set(Number(valueStr), entry);
  }

  const measured: Partial<Calibration> = {};
  console.log(`Base: ${basePath}  (${base.width}x${base.height})\n`);

  for (const probe of PROBES) {
    const files = byKey.get(probe.key);
    if (!files || files.size === 0) {
      console.log(`- ${probe.label} (${probe.key}): no exports found, skipping`);
      continue;
    }
    const pairs: [number, number][] = [];
    for (const [value, filename] of files) {
      const buf = await fs.readFile(path.join(exportsDir, filename));
      const exp = await analysePhoto(buf, filename, { baseline: 'native', fresh: true });
      const m = probe.measure(base, exp);
      if (m === null) {
        console.log(`  ! ${filename}: not measurable (region/band absent) — skipped`);
        continue;
      }
      pairs.push([value, m]);
    }
    if (pairs.length === 0) {
      console.log(`- ${probe.label} (${probe.key}): nothing measurable, skipping`);
      continue;
    }
    const value = solveConstant(probe.kind, pairs);
    const current = DEFAULT_CALIBRATION[probe.key];
    measured[probe.key] = value;
    const pts = pairs.map(([a, m]) => `${a}→${m.toFixed(4)}`).join('  ');
    console.log(`${probe.label} (${probe.key}): ${value.toFixed(5)}  [was ${current}]   points: ${pts}`);
  }

  const merged: Calibration = { ...DEFAULT_CALIBRATION, ...measured };
  console.log('\n─── Measured calibration ───────────────────────────────────────────────────');
  console.log(JSON.stringify(merged, null, 2));

  if (outPath) {
    await fs.writeFile(outPath, JSON.stringify(merged, null, 2) + '\n');
    console.log(`\nWrote ${outPath}`);
    console.log(
      'Paste the changed fields into DEFAULT_CALIBRATION in src/lib/match/calibration.ts by hand — ' +
        'this script does not edit source, so a measurement that looks wrong never silently lands.',
    );
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = rest.filter((a) => !a.startsWith('--'));
  const outArg = rest.find((a) => a.startsWith('--out='))?.split('=')[1];

  if (cmd === 'probes' && args[0]) {
    await cmdProbes(args[0], outArg ?? 'calibration-probes');
    return;
  }
  if (cmd === 'fit' && args[0] && args[1]) {
    await cmdFit(args[0], args[1], outArg);
    return;
  }
  console.error('usage:');
  console.error('  npx tsx scripts/match-calibrate.ts probes <base.jpg> [--out=<dir>]');
  console.error('  npx tsx scripts/match-calibrate.ts fit <base.jpg> <exportsDir> [--out=calibration.json]');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
