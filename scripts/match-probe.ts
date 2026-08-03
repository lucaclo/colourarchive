import fs from 'node:fs/promises';
import path from 'node:path';
import { analysePhoto } from '../src/lib/match/analyze';
import { textureComparable } from '../src/lib/match/texture';
import { solveMatch, type MatchSolution } from '../src/lib/match/solve';
import { atStrength, type Adjustments } from '../src/lib/match/adjustments';
import { buildPresetFiles } from '../src/lib/match/xmp';
import {
  BASELINE_LABEL,
  HSL_BANDS,
  REGION_LABEL,
  REGION_ORDER,
  type PhotoAnalysis,
  type RegionKey,
} from '../src/lib/match/types';

// Checkpoint tool for the measurement core. Prints everything the solver will
// later consume, so the numbers can be eyeballed against the actual photographs
// before any of them turn into advice.
//
//   npx tsx scripts/match-probe.ts <reference> <yours> [--baseline=macos|export|preview]

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const padL = (s: string, n: number): string => (s.length >= n ? s : ' '.repeat(n - s.length) + s);
const f = (v: number, d = 3): string => (Number.isFinite(v) ? v.toFixed(d) : '—');
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** Signed delta, formatted so the direction reads at a glance. */
const delta = (a: number, b: number, d = 3): string => {
  const v = b - a;
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(d)}`;
};

function hueDelta(a: number, b: number): string {
  let v = b - a;
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(1)}°`;
}

function header(a: PhotoAnalysis, role: string): void {
  console.log(`\n${role}: ${a.filename}`);
  console.log(`  ${a.width}x${a.height}  ·  baseline: ${BASELINE_LABEL[a.baseline]}  ·  sampled at ${a.sampledAt}px`);
  if (a.baselineNote) console.log(`  note: ${a.baselineNote}`);
  const t = Object.entries(a.timings)
    .filter(([k]) => k !== 'total')
    .map(([k, v]) => `${k} ${v.toFixed(1)}s`)
    .join('  ');
  console.log(`  ${t}  →  total ${a.timings.total?.toFixed(1)}s`);
  for (const w of a.warnings) console.log(`  ! ${w}`);
}

function regionTable(ref: PhotoAnalysis, mine: PhotoAnalysis): void {
  console.log('\n─── REGIONS ──────────────────────────────────────────────────────────────────');
  console.log('  "move" = what YOURS must change by to reach the REFERENCE (reference − yours).');
  console.log(
    `${pad('region', 14)}${pad('cover', 14)}${pad('lightness L', 22)}${pad('chroma C', 22)}${pad('hue', 20)}`,
  );
  console.log(
    `${pad('', 14)}${pad('ref / yours', 14)}${pad('ref  yours  move', 22)}${pad('ref  yours  move', 22)}${pad('ref  yours  move', 20)}`,
  );
  console.log('─'.repeat(92));

  for (const key of REGION_ORDER) {
    const r = ref.regions[key as RegionKey];
    const m = mine.regions[key as RegionKey];
    if (!r && !m) continue;

    const label = REGION_LABEL[key as RegionKey];
    if (!r || !m) {
      const which = r ? 'reference only' : 'yours only';
      console.log(`${pad(label, 14)}${pad(which, 14)}${pad('— not comparable —', 64)}`);
      continue;
    }

    const cover = `${(r.coverage * 100).toFixed(0)}/${(m.coverage * 100).toFixed(0)}%`;
    const lum = `${f(r.L.mean)} ${f(m.L.mean)} ${padL(delta(m.L.mean, r.L.mean), 7)}`;
    const chr = `${f(r.C.mean)} ${f(m.C.mean)} ${padL(delta(m.C.mean, r.C.mean), 7)}`;
    // Hue is only meaningful when both resultants are strong.
    const weak = r.hue.strength < 0.3 || m.hue.strength < 0.3;
    const hue = weak
      ? `weak (${f(r.hue.strength, 2)}/${f(m.hue.strength, 2)})`
      : `${r.hue.mean.toFixed(0)}° ${m.hue.mean.toFixed(0)}° ${padL(hueDelta(m.hue.mean, r.hue.mean), 8)}`;

    console.log(`${pad(label, 14)}${pad(cover, 14)}${pad(lum, 22)}${pad(chr, 22)}${pad(hue, 20)}`);
  }
}

function contrastTable(ref: PhotoAnalysis, mine: PhotoAnalysis): void {
  console.log('\n─── TONE (global luminance percentiles — the curve to fit) ───────────────────');
  const r = ref.regions.global;
  const m = mine.regions.global;
  if (!r || !m) return;
  const marks = [0, 2, 4, 6, 10, 14, 16, 18, 20]; // 0,10,20,30,50,70,80,90,100%
  console.log(`${pad('percentile', 12)}${marks.map((i) => padL(`${i * 5}%`, 8)).join('')}`);
  console.log(`${pad('reference', 12)}${marks.map((i) => padL(f(r.percentiles[i], 3), 8)).join('')}`);
  console.log(`${pad('yours', 12)}${marks.map((i) => padL(f(m.percentiles[i], 3), 8)).join('')}`);
  console.log(`${pad('Δ', 12)}${marks.map((i) => padL(delta(m.percentiles[i], r.percentiles[i]), 8)).join('')}`);
  console.log(
    `\n  spread (sd of L):  reference ${f(r.L.sd)}   yours ${f(m.L.sd)}   Δ ${delta(m.L.sd, r.L.sd)}`,
  );
}

function hslTable(ref: PhotoAnalysis, mine: PhotoAnalysis): void {
  console.log('\n─── HSL BANDS (Lightroom’s own eight) ────────────────────────────────────────');
  console.log(
    `${pad('band', 10)}${pad('presence ref/yours', 22)}${pad('chroma ref  yours  Δ', 26)}${pad('lightness ref yours Δ', 26)}`,
  );
  console.log('─'.repeat(84));
  for (let i = 0; i < ref.hslBands.length; i++) {
    const r = ref.hslBands[i];
    const m = mine.hslBands[i];
    // A band present in neither photo is not advice, it is noise.
    if (r.weight < 0.01 && m.weight < 0.01) continue;
    // A band that is essentially absent from one photo still has a mean chroma,
    // computed from a handful of pixels. Differencing those two means would be
    // meaningless — the real signal is the presence gap, not the chroma gap.
    const sparse = r.weight < 0.02 || m.weight < 0.02;
    const presence = `${pct(r.weight)} / ${pct(m.weight)}${sparse ? ' ·sparse' : ''}`;
    const chr = sparse
      ? '— presence-driven —'
      : `${f(r.chroma)} ${f(m.chroma)} ${padL(delta(m.chroma, r.chroma), 8)}`;
    const lum = sparse ? '' : `${f(r.L)} ${f(m.L)} ${padL(delta(m.L, r.L), 8)}`;
    console.log(`${pad(r.key, 10)}${pad(presence, 22)}${pad(chr, 26)}${pad(lum, 26)}`);
  }
}

function textureTable(ref: PhotoAnalysis, mine: PhotoAnalysis): void {
  console.log('\n─── TEXTURE & OPTICS ─────────────────────────────────────────────────────────');
  for (const [role, a] of [['reference', ref], ['yours', mine]] as const) {
    const t = a.texture;
    if (!t.usable) {
      console.log(`  ${pad(role, 11)} texture UNAVAILABLE (${t.blocked})`);
      console.log(`              ${t.reason}`);
    } else {
      const scale = t.normalised
        ? `@${t.measuredAt.width}x${t.measuredAt.height} (native ${t.nativeSize.width}x${t.nativeSize.height})`
        : `@${t.measuredAt.width}x${t.measuredAt.height} native`;
      console.log(
        `  ${pad(role, 11)} grain ${f(t.grain, 4)}  size ~${t.grainSize.toFixed(1)}px  acutance ${f(t.acutance, 4)}  flat/edge ${f(t.flatToEdge, 3)}   ${scale}`,
      );
    }
  }
  if (textureComparable(ref.texture, mine.texture)) {
    console.log(
      `  ${pad('move', 11)} grain ${delta(mine.texture.grain, ref.texture.grain, 4)}   acutance ${delta(mine.texture.acutance, ref.texture.acutance, 4)}`,
    );
  } else if (ref.texture.usable && mine.texture.usable) {
    console.log(
      `  ${pad('move', 11)} NOT COMPARABLE — measured at different scales ` +
        `(${Math.max(ref.texture.measuredAt.width, ref.texture.measuredAt.height)}px vs ` +
        `${Math.max(mine.texture.measuredAt.width, mine.texture.measuredAt.height)}px). Grain and sharpening advice will be withheld.`,
    );
  }

  for (const [role, a] of [['reference', ref], ['yours', mine]] as const) {
    const v = a.vignette;
    const verdict = v.usable
      ? 'usable'
      : 'IGNORED — corners disagree, so this is scene content rather than the lens';
    console.log(
      `  ${pad(role, 11)} vignette ${f(v.falloffStops, 2)} stops   symmetry ${f(v.symmetry, 2)}   ${verdict}`,
    );
  }
}

const sig = (v: number, d = 0): string => {
  const r = Number(v.toFixed(d));
  return (r > 0 ? '+' : '') + r.toFixed(d);
};

function solutionTable(sol: MatchSolution): void {
  const cols: Array<[string, Adjustments]> = [
    ['restrained (50%)', sol.restrained],
    ['faithful (100%)', sol.faithful],
  ];

  console.log('\n─── SOLVED LIGHTROOM VALUES ──────────────────────────────────────────────────');
  console.log(
    `  measurement confidence ${(sol.confidence * 100).toFixed(0)}%   ·   gap closable ${(sol.reachability * 100).toFixed(0)}%` +
      `   ·   colour residual ${sol.colourResidual.toFixed(5)} (lower is better)   ·   calibration: estimated`,
  );
  console.log(`${pad('', 26)}${cols.map(([n]) => padL(n, 20)).join('')}`);
  console.log('─'.repeat(66));

  const row = (label: string, get: (a: Adjustments) => string): void => {
    const vals = cols.map(([, a]) => padL(get(a), 20)).join('');
    if (vals.trim().replace(/[+\-0. ]/g, '') === '' && !/curve|grain size|blend/i.test(label)) return;
    console.log(`${pad(label, 26)}${vals}`);
  };

  console.log('LIGHT   (authoritative tone move)');
  row('  Exposure', (a) => sig(a.exposure, 2));
  // Curves are long; print them on their own lines rather than in the columns.
  for (const [name, a] of cols) {
    console.log(`  ${pad(`Curve · ${name}`, 24)}${a.curve.map((p) => `${p.x},${p.y}`).join('  ')}`);
  }
  console.log('  ─ Basic sliders below are a DESCRIPTION of that curve, not extra moves ─');
  row('  ~ Contrast', (a) => sig(a.contrast));
  row('  ~ Highlights', (a) => sig(a.highlights));
  row('  ~ Shadows', (a) => sig(a.shadows));
  row('  ~ Whites', (a) => sig(a.whites));
  row('  ~ Blacks', (a) => sig(a.blacks));

  console.log('COLOUR');
  row('  Vibrance', (a) => sig(a.vibrance));
  row('  Saturation', (a) => sig(a.saturation));
  row('  ~ Temp (manual alt.)', (a) => sig(a.temp));
  row('  ~ Tint (manual alt.)', (a) => sig(a.tint));

  console.log('COLOUR MIXER');
  for (const band of HSL_BANDS) {
    row(`  ${band.label} hue`, (a) => sig(a.hsl[band.key].hue));
    row(`  ${band.label} sat`, (a) => sig(a.hsl[band.key].sat));
    row(`  ${band.label} lum`, (a) => sig(a.hsl[band.key].lum));
  }

  console.log('COLOUR GRADING');
  for (const w of ['global', 'shadows', 'midtones', 'highlights'] as const) {
    row(`  ${w} H/S`, (a) => {
      const g = a.grading[w];
      return g.sat < 0.5 ? '—' : `${g.hue.toFixed(0)}° / ${g.sat.toFixed(0)}`;
    });
  }
  row('  Balance', (a) => sig(a.grading.balance));

  console.log('EFFECTS & DETAIL');
  row('  Texture', (a) => sig(a.texture));
  row('  Vignette', (a) => sig(a.vignette));
  row('  Grain amount', (a) => sig(a.grainAmount));
  row('  Grain size', (a) => (a.grainAmount > 0.5 ? a.grainSize.toFixed(0) : '—'));
  row('  Noise reduction', (a) => sig(a.noiseReduction));

  const allMasks = new Set([...sol.restrained.masks, ...sol.faithful.masks].map((m) => m.region));
  if (allMasks.size > 0) {
    console.log('MASKS');
    for (const region of allMasks) {
      const fm = sol.faithful.masks.find((m) => m.region === region);
      if (!fm) continue;
      const auto = fm.kind === 'manual' ? 'draw yourself' : `auto: Select ${fm.kind}`;
      console.log(`  ${fm.label} (${auto})`);
      row(`    exposure`, (a) => {
        const m = a.masks.find((x) => x.region === region);
        return m ? sig(m.exposure, 2) : '—';
      });
      row(`    temp`, (a) => {
        const m = a.masks.find((x) => x.region === region);
        return m ? sig(m.temp) : '—';
      });
      row(`    tint`, (a) => {
        const m = a.masks.find((x) => x.region === region);
        return m ? sig(m.tint) : '—';
      });
      row(`    saturation`, (a) => {
        const m = a.masks.find((x) => x.region === region);
        return m ? sig(m.saturation) : '—';
      });
      console.log(`    ${fm.rationale}`);
    }
  }

  if (sol.notes.length > 0) {
    console.log('\n─── WHAT THE SOLVER DECLINED TO DO, AND WHY ──────────────────────────────────');
    for (const n of sol.notes) {
      const mark = n.severity === 'caution' ? '!' : '·';
      console.log(`  ${mark} [${n.panel}] ${n.text}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--'));
  const baselineArg = args.find((a) => a.startsWith('--baseline='))?.split('=')[1];
  const baseline = (baselineArg as any) ?? 'macos';

  if (files.length < 2) {
    console.error('usage: npx tsx scripts/match-probe.ts <reference> <yours> [--baseline=macos|export|preview]');
    process.exit(1);
  }

  const outDir = args.find((a) => a.startsWith('--out='))?.split('=')[1];
  const strengthArg = args.find((a) => a.startsWith('--strength='))?.split('=')[1];

  const [refPath, minePath] = files;
  console.log('Analysing… (first run downloads the segmentation models)');

  const refBuf = await fs.readFile(refPath);
  const mineBuf = await fs.readFile(minePath);

  const ref = await analysePhoto(refBuf, path.basename(refPath), { baseline: 'native', fresh: true });
  const mine = await analysePhoto(mineBuf, path.basename(minePath), { baseline, fresh: true });

  header(ref, 'REFERENCE');
  header(mine, 'YOURS');
  regionTable(ref, mine);
  contrastTable(ref, mine);
  hslTable(ref, mine);
  textureTable(ref, mine);
  const solution = solveMatch(ref, mine);
  solutionTable(solution);

  if (outDir) {
    const strength = strengthArg ? Number(strengthArg) : 0.5;
    const adj = atStrength(solution.restrained, solution.faithful, strength);
    // Strip the content-hash suffix the archive appends to filenames, so the
    // preset shows up in Lightroom with a readable name.
    const clean = (p: string): string =>
      path.basename(p, path.extname(p)).replace(/\.[0-9a-f]{8,}$/i, '');
    const label = `${clean(minePath)} as ${clean(refPath)}`;
    const presets = buildPresetFiles(adj, {
      name: label.slice(0, 60),
      group: 'Colour Archive',
      seed: `${ref.id}:${mine.id}:${strength}`,
    });
    await fs.mkdir(outDir, { recursive: true });
    console.log(`\n─── PRESET FILES (strength ${(strength * 100).toFixed(0)}%) ────────────────────────────────────`);
    for (const p of presets) {
      const dest = path.join(outDir, p.filename);
      await fs.writeFile(dest, p.contents);
      console.log(`  ${dest}`);
      console.log(`    ${p.description}`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
