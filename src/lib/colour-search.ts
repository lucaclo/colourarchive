/**
 * Search by a colour you pick, the way Eagle, PhotoPrism and Cosmos do it.
 *
 * Every photo carries a small palette (`palette.ts`): up to six OKLCH swatches
 * with the share of the frame each covers. "Contains this shade" asks whether
 * any one swatch sits close to the query, and a swatch that covers more of the
 * frame counts for a little more, so a red wall outranks a red sign of the same
 * red. Distance is plain Euclidean in OKLab, where 0.02 is about one just
 * noticeable difference.
 *
 * Pure and dependency-free, so the archive page runs it in the browser: it
 * works offline and on the published static site, where there is no server
 * to ask.
 */

export interface Swatch {
  L: number;
  C: number;
  /** Degrees. */
  H: number;
  /** Fraction of the frame, 0–1. A palette's shares add up to about 1. */
  share: number;
}

export interface ColourQuery {
  L: number;
  C: number;
  H: number;
}

/** Inclusive ranges over the whole photo, each 0–1 on its own axis. */
export interface ToneRange {
  chroma?: [number, number];
  lightness?: [number, number];
}

/**
 * Matching is led by hue, because that is what "this colour" means to a
 * person picking from a wheel: a saturated red should find the brick reds a
 * real photograph holds, which a plain OKLab distance rejects for being
 * duller. So a chromatic swatch matches when its hue is within HUE_TOLERANCE
 * and its lightness within LIGHTNESS_TOLERANCE, and it must carry at least a
 * fraction of the query's chroma, so near-greys don't match every hue.
 * Greys match greys by lightness alone, and only when they cover a real part
 * of the frame: some grey is in almost every photograph.
 *
 * Tuned on the archive's own photos (2026-10-09): every chapter's photos are
 * found by both the chapter's colour and a vivid version of it.
 */
export const GREY_CHROMA = 0.04;
const HUE_TOLERANCE = 20;
const LIGHTNESS_TOLERANCE = 0.3;
const MIN_CHROMA_FRACTION = 0.2;
const GREY_LIGHTNESS = 0.12;
const GREY_MIN_SHARE = 0.3;
/** Coverage bonus: a swatch over a quarter of the frame gets the whole of it. */
const SHARE_WEIGHT = 0.3;
/** A score above this is not a match. */
export const MATCH_CEILING = 1.2;
/** Area-weighted chroma across this archive runs 0.02–0.09; the slider spans 0–0.12. */
export const TONE_CHROMA_SPAN = 0.12;

function swatchScore(s: Swatch, q: ColourQuery): number {
  const dL = Math.abs(s.L - q.L);
  let v: number;
  if (q.C < GREY_CHROMA) {
    if (s.C >= GREY_CHROMA * 1.5 || dL > GREY_LIGHTNESS || s.share < GREY_MIN_SHARE) return Infinity;
    v = dL / GREY_LIGHTNESS;
  } else {
    if (s.C < Math.max(0.025, q.C * MIN_CHROMA_FRACTION) || dL > LIGHTNESS_TOLERANCE) return Infinity;
    let dh = Math.abs(s.H - q.H) % 360;
    if (dh > 180) dh = 360 - dh;
    if (dh > HUE_TOLERANCE) return Infinity;
    v = dh / HUE_TOLERANCE + (0.5 * dL) / LIGHTNESS_TOLERANCE;
  }
  return v + SHARE_WEIGHT * (1 - Math.min(1, s.share * 4));
}

/**
 * Distance from a query to a palette. Lower is closer; Infinity when nothing
 * in it matches. A swatch with share 0 is an accent (the photo's dominant,
 * subject-led colour from `dominant.ts`, which k-means tends to average
 * away): it can match, at the full coverage penalty, but carries no area.
 */
export function colourScore(palette: readonly Swatch[] | undefined, query: ColourQuery): number {
  if (!palette?.length) return Infinity;
  let best = Infinity;
  for (const s of palette) best = Math.min(best, swatchScore(s, query));
  return best;
}

/** The photo's overall chroma and lightness, area-weighted over its palette. */
export function paletteTone(palette: readonly Swatch[] | undefined): { chroma: number; lightness: number } | null {
  if (!palette?.length) return null;
  let w = 0, c = 0, l = 0;
  for (const s of palette) { w += s.share; c += s.share * s.C; l += s.share * s.L; }
  if (w <= 0) return null;
  return { chroma: Math.min(1, c / w / TONE_CHROMA_SPAN), lightness: l / w };
}

export function withinTone(palette: readonly Swatch[] | undefined, range: ToneRange): boolean {
  const full = (r?: [number, number]) => !r || (r[0] <= 0 && r[1] >= 1);
  if (full(range.chroma) && full(range.lightness)) return true;
  const tone = paletteTone(palette);
  if (!tone) return false;
  const inside = (v: number, r?: [number, number]) => !r || (v >= r[0] - 1e-9 && v <= r[1] + 1e-9);
  return inside(tone.chroma, range.chroma) && inside(tone.lightness, range.lightness);
}

/**
 * One colour of a query that can hold several, the way TinEye's Multicolr
 * asks "some teal and some orange". `share` is how much of the frame it
 * should cover (0–1). Left out, any amount will do. Whatever the colours
 * don't claim is a wildcard: the rest of the photo can be anything.
 */
export interface QueryColour extends ColourQuery {
  share?: number;
}

/** Why a photo passed, per query colour: which swatches matched it, and how
 *  much of the frame they cover together. An accent counts as matched but
 *  covers nothing. */
export interface MatchPart {
  colour: number;
  covered: number;
  swatches: number[];
}

export interface ColourHit {
  id: string;
  score: number;
  parts: MatchPart[];
}

export const MAX_QUERY_COLOURS = 3;
/** Score added per unit of share missed. Wanting half the frame and finding a
 *  tenth costs 0.8, which still passes but ranks low; wanting half and finding
 *  only an accent costs 1.0 on top of the accent's 0.3, which doesn't. */
const SHARE_MISS = 2;

/**
 * Does a palette hold every colour of the query? Null when any is missing.
 *
 * Each colour is scored like a single-colour search (`colourScore`, the
 * tuned path), plus a penalty for missing a requested share. The photo's
 * score is the mean, so one colour scores exactly as it always has.
 */
export function matchPalette(palette: readonly Swatch[] | undefined, query: readonly QueryColour[]): { score: number; parts: MatchPart[] } | null {
  if (!palette?.length || !query.length) return null;
  const parts: MatchPart[] = [];
  let total = 0;
  for (let q = 0; q < query.length; q++) {
    const colour = query[q];
    let best = Infinity;
    let covered = 0;
    const swatches: number[] = [];
    for (let i = 0; i < palette.length; i++) {
      const s = swatchScore(palette[i], colour);
      if (s === Infinity) continue;
      best = Math.min(best, s);
      covered += palette[i].share;
      swatches.push(i);
    }
    if (best > MATCH_CEILING) return null;
    covered = Math.min(1, covered);
    const miss = colour.share == null ? 0 : Math.abs(covered - colour.share) * SHARE_MISS;
    if (best + miss > MATCH_CEILING) return null;
    total += best + miss;
    parts.push({ colour: q, covered, swatches });
  }
  return { score: total / query.length, parts };
}

/**
 * Photos that pass, closest first. With no colour, only the tone ranges
 * filter and the input order is kept. A query is one colour or up to
 * MAX_QUERY_COLOURS of them, all of which must be present.
 */
export function searchByColour<T extends { id: string; palette?: Swatch[] }>(
  items: readonly T[],
  query: ColourQuery | readonly QueryColour[] | null,
  range: ToneRange = {},
): ColourHit[] {
  // A lone colour is "any amount", whatever else the object carries (a Swatch
  // passed in has a share of its own that isn't a request).
  const lone = query as ColourQuery;
  const colours: QueryColour[] = query == null ? [] : Array.isArray(query) ? query.slice(0, MAX_QUERY_COLOURS) : [{ L: lone.L, C: lone.C, H: lone.H }];
  const out: ColourHit[] = [];
  for (const it of items) {
    if (!withinTone(it.palette, range)) continue;
    if (!colours.length) { out.push({ id: it.id, score: 0, parts: [] }); continue; }
    const m = matchPalette(it.palette, colours);
    if (m) out.push({ id: it.id, score: m.score, parts: m.parts });
  }
  if (colours.length) out.sort((a, b) => a.score - b.score);
  return out;
}

/** A photo's palette plus its dominant colour as a zero-share accent (see `colourScore`). */
export function searchPalette(palette: readonly Swatch[] | undefined, dominant: ColourQuery): Swatch[] {
  return [...(palette ?? []), { L: dominant.L, C: dominant.C, H: dominant.H, share: 0 }];
}

/** Compact form for a data attribute: "L,C,H,share;…" at 3 decimals. */
export function encodePalette(p: readonly Swatch[] | undefined): string {
  if (!p?.length) return '';
  const r = (n: number) => String(Math.round(n * 1000) / 1000);
  return p.map((s) => [r(s.L), r(s.C), String(Math.round(s.H)), r(s.share)].join(',')).join(';');
}

export function decodePalette(s: string | undefined | null): Swatch[] {
  if (!s) return [];
  const out: Swatch[] = [];
  for (const part of s.split(';')) {
    const [L, C, H, share] = part.split(',').map(Number);
    if ([L, C, H, share].every(Number.isFinite)) out.push({ L, C, H, share });
  }
  return out;
}

const HEX = /^#?([0-9a-f]{6})$/i;

/** "#rrggbb" to OKLCH, for the hex field and the native colour input. */
export function hexToOklch(hex: string): ColourQuery | null {
  const m = hex.trim().match(HEX);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s;
  const H = (Math.atan2(B, A) * 180) / Math.PI;
  return { L, C: Math.hypot(A, B), H: H < 0 ? H + 360 : H };
}

const lab = (c: { L: number; C: number; H: number }): [number, number, number] => {
  const h = (c.H * Math.PI) / 180;
  return [c.L, c.C * Math.cos(h), c.C * Math.sin(h)];
};

/** OKLCH to "#rrggbb", clipped into sRGB. */
export function oklchToHex(c: { L: number; C: number; H: number }): string {
  const [L, a, b] = lab(c);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const enc = (v: number) => {
    v = Math.max(0, Math.min(1, v));
    return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
  };
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(enc);
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}
