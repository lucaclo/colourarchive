/**
 * Colour for the zine: the wheel's maths, and finding combinations from
 * Wada's dictionary that suit the photographs. Pure, so it's testable.
 */
import { WADA_COLOURS, WADA_COMBINATIONS } from './wada';

import { hexToRgb, rgbHueToRyb, rgbToHex, rgbToHsv, type RGB } from '../ryb';
export { hexToRgb, rgbToHex, hsvToRgb, rgbToHsv, rgbHueToRyb, rybHueToRgb, type RGB } from '../ryb';
export type Lab = [number, number, number];

export const isHex = (s: unknown): s is `#${string}` => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

const lin = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance, 0–1. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB to CIELAB (D65). */
export function rgbToLab(rgb: RGB): Lab {
  const [r, g, b] = rgb.map(lin);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Perceptual distance (CIE76): about 2 is barely visible, 25 is clearly different. */
export const deltaE = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const WADA_LAB: Lab[] = WADA_COLOURS.map(([, hex]) => rgbToLab(hexToRgb(hex)));

/** The colour in the book nearest to this one. */
export function nearestWada(hex: string): { index: number; name: string; hex: string; distance: number } {
  const lab = rgbToLab(hexToRgb(hex));
  let best = 0;
  let bestD = Infinity;
  WADA_LAB.forEach((l, i) => {
    const d = deltaE(lab, l);
    if (d < bestD) { bestD = d; best = i; }
  });
  return { index: best, name: WADA_COLOURS[best][0], hex: WADA_COLOURS[best][1], distance: bestD };
}

/** Combination n's colours as hex, n counted from 1 as in the book. */
export function combination(n: number): string[] {
  return (WADA_COMBINATIONS[n - 1] ?? []).map((i) => WADA_COLOURS[i][1]);
}

/** Combinations that use the colour at this index. */
export function combinationsWith(index: number): number[] {
  const out: number[] = [];
  WADA_COMBINATIONS.forEach((c, i) => c.includes(index) && out.push(i + 1));
  return out;
}

export interface Swatch { lab: Lab; hex: string; weight: number }

/**
 * The main colours of a picture, from RGBA pixels: a small k-means in Lab,
 * seeded evenly through the pixels so the same photo always gives the same
 * answer. Weights add up to 1.
 */
export function dominantColours(pixels: Uint8ClampedArray, k = 5): Swatch[] {
  const pts: Lab[] = [];
  const rgbs: RGB[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const rgb: RGB = [pixels[i], pixels[i + 1], pixels[i + 2]];
    rgbs.push(rgb);
    pts.push(rgbToLab(rgb));
  }
  if (!pts.length) return [];
  k = Math.min(k, pts.length);
  // Seed from the pixels sorted by lightness, so seeds span dark to light.
  const order = pts.map((_, i) => i).sort((a, b) => pts[a][0] - pts[b][0]);
  let centres: Lab[] = Array.from({ length: k }, (_, j) => pts[order[Math.floor(((j + 0.5) * order.length) / k)]]);
  const assign = new Array<number>(pts.length).fill(0);
  for (let iter = 0; iter < 8; iter++) {
    pts.forEach((p, i) => {
      let best = 0;
      let bestD = Infinity;
      centres.forEach((c, j) => {
        const d = deltaE(p, c);
        if (d < bestD) { bestD = d; best = j; }
      });
      assign[i] = best;
    });
    centres = centres.map((c, j) => {
      const s: [number, number, number, number] = [0, 0, 0, 0];
      pts.forEach((p, i) => { if (assign[i] === j) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; } });
      return s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : c;
    });
  }
  return centres
    .map((lab, j) => {
      const members = rgbs.filter((_, i) => assign[i] === j);
      const mean = members.reduce<RGB>((s, c) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]], [0, 0, 0]);
      const n = members.length || 1;
      return { lab, hex: rgbToHex([mean[0] / n, mean[1] / n, mean[2] / n]), weight: members.length / pts.length };
    })
    .filter((s) => s.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Rank the book's combinations by how well they suit a set of photographs.
 * A combination suits them when its colours echo colours actually in the
 * pictures, the larger areas counting for more. Each combination colour is
 * scored by its distance to the nearest photo colour, discounted by how much
 * of the photos that colour covers, and the combination takes the mean.
 * A combination that is all one family scores a little worse, so the list
 * isn't just shades of whatever dominates.
 */
export function rankCombinations(photo: Swatch[], limit = 24): { n: number; score: number }[] {
  if (!photo.length) return [];
  const scored = WADA_COMBINATIONS.map((c, i) => {
    const labs = c.map((ci) => WADA_LAB[ci]);
    const fit = labs.reduce((s, l) => s + Math.min(...photo.map((p) => deltaE(l, p.lab) * (1.3 - Math.min(1, p.weight * 2) * 0.5))), 0) / labs.length;
    let spread = 0;
    for (let a = 0; a < labs.length; a++) for (let b = a + 1; b < labs.length; b++) spread = Math.max(spread, deltaE(labs[a], labs[b]));
    return { n: i + 1, score: fit + Math.max(0, 30 - spread) * 0.4 };
  });
  return scored.sort((a, b) => a.score - b.score).slice(0, limit);
}

/**
 * Who does what in a combination: the lightest is the paper, the colour that
 * reads best on it is the text, and the most vivid of the rest is the accent
 * (for cover titles).
 */
export function roles(colours: string[]): { paper: string; ink: string; accent: string } {
  const paper = [...colours].sort((a, b) => luminance(b) - luminance(a))[0];
  const rest = colours.filter((c) => c !== paper);
  const pool = rest.length ? rest : colours;
  const ink = [...pool].sort((a, b) => contrast(b, paper) - contrast(a, paper))[0];
  const chroma = (hex: string) => { const [, a, b] = rgbToLab(hexToRgb(hex)); return Math.hypot(a, b); };
  const others = pool.filter((c) => c !== ink);
  const accent = (others.length ? others : pool).sort((a, b) => chroma(b) - chroma(a))[0];
  return { paper, ink, accent };
}

// ── Colour theory ─────────────────────────────────────────────────────────
// The painter's wheel itself lives in ../ryb.ts.
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const chroma = (lab: Lab) => Math.hypot(lab[1], lab[2]);
const rybOf = (hex: string) => rgbHueToRyb(rgbToHsv(hexToRgb(hex))[0]);

export type Rule = 'complementary' | 'split-a' | 'split-b' | 'triadic' | 'analogous' | 'echo';
export const RULE_LABEL: Record<Rule, string> = {
  complementary: 'Complementary',
  'split-a': 'Split complement',
  'split-b': 'Split complement',
  triadic: 'Triadic',
  analogous: 'Analogous',
  echo: 'Echo',
};
/** Where each rule sits on the painter's wheel, from the key colour. */
const RULE_OFFSET: Record<Exclude<Rule, 'echo'>, number> = {
  complementary: 180, 'split-a': 150, 'split-b': 210, triadic: 120, analogous: 30,
};

export interface TheoryPick {
  rule: Rule;
  hex: string;
  name: string;
  contrast: number;
  /** A combination in the book that pairs this with the key colour, if any. */
  pairedIn: number | null;
}

export interface CoverReading {
  /** The photo's key colour: its main colours weighed by area and strength. */
  key: { hex: string; name: string; wada: string; neutral: boolean };
  picks: TheoryPick[];
}

/**
 * Read a photo with colour theory and suggest six title colours, all from
 * Wada's dictionary. The key colour is whichever main colour counts most for
 * area times strength (a big grey sky loses to a smaller red door). From its
 * place on the painter's wheel come the complementary, the two split
 * complements, the triadic and the analogous; the sixth echoes a colour
 * already in the photo. Each is filled with the book colour nearest that
 * hue, favouring colours Wada himself pairs with the key colour, and only
 * if it reads on `region`, the photo's average colour where the title sits
 * (contrast of 3 for large type, more preferred).
 */
export function readCover(photo: Swatch[], region: string): CoverReading | null {
  if (!photo.length) return null;
  const keySw = [...photo].sort((a, b) => b.weight * (chroma(b.lab) + 6) - a.weight * (chroma(a.lab) + 6))[0];
  const keyWada = nearestWada(keySw.hex);
  const keyHue = rybOf(keySw.hex);
  const partners = new Map<number, number>();
  for (const n of combinationsWith(keyWada.index)) {
    for (const ci of WADA_COMBINATIONS[n - 1]) if (ci !== keyWada.index && !partners.has(ci)) partners.set(ci, n);
  }
  const used = new Set<number>([keyWada.index]);
  const picks: TheoryPick[] = [];
  const pick = (rule: Rule, score: (ci: number, lab: Lab) => number | null) => {
    let best = -1;
    let bestScore = Infinity;
    WADA_COLOURS.forEach(([, hex], ci) => {
      if (used.has(ci)) return;
      const lab = WADA_LAB[ci];
      const base = score(ci, lab);
      if (base === null) return;
      const c = contrast(hex, region);
      const s = base + (c < 3 ? 60 : c < 4.5 ? 6 : 0) - Math.min(c, 8) * 1.2 - (partners.has(ci) ? 14 : 0);
      if (s < bestScore) { bestScore = s; best = ci; }
    });
    if (best < 0) return;
    used.add(best);
    const [name, hex] = WADA_COLOURS[best];
    picks.push({ rule, hex, name, contrast: contrast(hex, region), pairedIn: partners.get(best) ?? null });
  };
  for (const rule of ['complementary', 'split-a', 'split-b', 'triadic', 'analogous'] as const) {
    const target = (keyHue + RULE_OFFSET[rule]) % 360;
    // Hue only means something with some colour in it; greys are left out.
    pick(rule, (ci, lab) => (chroma(lab) < 14 ? null : hueGap(rybOf(WADA_COLOURS[ci][1]), target) * 0.9));
  }
  // The echo: a colour from the photo itself, as the book has it.
  const fromPhoto = photo.filter((p) => p !== keySw).map((p) => nearestWada(p.hex).index);
  pick('echo', (ci) => (fromPhoto.includes(ci) ? 0 : fromPhoto.length ? 40 + Math.min(...photo.map((p) => deltaE(WADA_LAB[ci], p.lab))) : 0));
  return {
    key: { hex: keySw.hex, name: keyWada.name, wada: keyWada.hex, neutral: chroma(keySw.lab) < 10 },
    picks,
  };
}
