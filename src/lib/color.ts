// Colour science for the archive.
//
// Everything sorts on *perceptual* hue, so we work in OKLCH — not HSL, whose
// hue angle misrepresents how colours actually relate. Pipeline per pixel:
//   sRGB 0-255  ->  linear sRGB  ->  OKLab  ->  OKLCH (L, C, H°)

export interface OKLCH {
  /** Perceptual lightness, 0..1 */
  L: number;
  /** Chroma, 0..~0.4 */
  C: number;
  /** Hue angle in degrees, 0..360 */
  H: number;
}

const srgbToLinear = (c: number): number => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};

/** Linear sRGB (0..1) -> OKLab. Björn Ottosson's matrices. */
export function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

export function srgb255ToOklch(r: number, g: number, b: number): OKLCH {
  const [L, a, bb] = linearRgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  const C = Math.sqrt(a * a + bb * bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

// --- Chapter binning ---------------------------------------------------------

/** Chroma below this reads as achromatic (greys, near-monochrome frames). */
export const ACHROMATIC_CHROMA = 0.035;

export const ACHROMATIC_KEY = 'achromatic';

// Perceptual hue anchors in OKLCH. Photos are assigned to the NEAREST anchor by
// circular hue distance — so boundaries follow perception instead of arbitrary
// equal 30° slices (OKLCH hue is very non-uniform: warm colours span a wide
// arc, blues cluster tight). Anchors are FIXED, so a photo lands in the same
// chapter forever (stable as the archive grows — never re-fit like k-means).
// Empty anchors simply never become chapters.
interface Anchor { slug: string; name: string; H: number }
const ANCHORS: Anchor[] = [
  { slug: 'red',     name: 'Red',     H: 28 },
  { slug: 'orange',  name: 'Orange',  H: 62 },
  { slug: 'yellow',  name: 'Yellow',  H: 100 },
  { slug: 'green',   name: 'Green',   H: 145 },
  { slug: 'teal',    name: 'Teal',    H: 195 },
  { slug: 'blue',    name: 'Blue',    H: 255 },
  { slug: 'violet',  name: 'Violet',  H: 305 },
  { slug: 'magenta', name: 'Magenta', H: 350 },
];

const circDist = (a: number, b: number): number => {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
};

export function nearestAnchor(H: number): Anchor {
  let best = ANCHORS[0];
  let bd = Infinity;
  for (const a of ANCHORS) {
    const d = circDist(H, a.H);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

// --- Lightness bands (for auto-split of large chapters) ----------------------
// A busy hue chapter is split into deep / mid / pale bands by fixed lightness
// thresholds (deterministic — a photo's band never drifts). A band is promoted
// to its own chapter only when it holds MORE THAN this many photos; otherwise
// its photos stay in the base (mid) chapter. Tiny chapters (<= MERGE_MAX) fold
// into a neighbour. See groupChapters() in manifest.ts.
export const SPLIT_MIN = 5;   // band becomes its own chapter when size > 5
export const MERGE_MAX = 2;   // chapter of <= 2 folds into a neighbour

export type Band = 'deep' | 'mid' | 'pale';
export function lightnessBand(L: number): Band {
  if (L < 0.45) return 'deep';
  if (L >= 0.72) return 'pale';
  return 'mid';
}
const BAND_RANK: Record<Band, number> = { deep: 0, mid: 1, pale: 2 };

/** Compose a chapter key from a base slug + band. Mid uses the bare base. */
export function chapterKey(base: string, band: Band): string {
  return band === 'mid' ? base : `${base}-${band}`;
}
export function baseKeyOf(key: string): string {
  return key.replace(/-(deep|pale)$/, '');
}
export function bandOf(key: string): Band {
  if (key.endsWith('-deep')) return 'deep';
  if (key.endsWith('-pale')) return 'pale';
  return 'mid';
}

/** Ordering rank: around the wheel (achromatic first), then dark -> light. */
export function chapterRank(key: string): number {
  const base = baseKeyOf(key);
  const hue = base === ACHROMATIC_KEY ? -1000 : (ANCHORS.find((x) => x.slug === base)?.H ?? -1);
  return hue * 10 + BAND_RANK[bandOf(key)];
}

/** Hue angle a chapter key orders by (kept for callers that want the wheel angle). */
export function keyToHue(key: string): number {
  return chapterRank(key);
}

export function defaultChapterName(key: string): string {
  const base = baseKeyOf(key);
  const band = bandOf(key);
  if (base === ACHROMATIC_KEY) {
    return band === 'deep' ? 'Charcoal' : band === 'pale' ? 'Silver' : 'Ash';
  }
  const anchor = ANCHORS.find((x) => x.slug === base);
  const name = anchor ? anchor.name : base;
  return band === 'deep' ? `Deep ${name}` : band === 'pale' ? `Pale ${name}` : name;
}

/** Default name honouring a base-key override (so renaming "orange"->"Camel"
 *  makes the bands "Deep Camel" / "Pale Camel" too). */
export function chapterName(key: string, overrideBaseName?: string): string {
  const base = baseKeyOf(key);
  const band = bandOf(key);
  if (base === ACHROMATIC_KEY || !overrideBaseName) return defaultChapterName(key);
  return band === 'deep' ? `Deep ${overrideBaseName}` : band === 'pale' ? `Pale ${overrideBaseName}` : overrideBaseName;
}

export interface Classification {
  chapter: string;
  oklch: OKLCH;
}

/** Assign a dominant OKLCH colour to a chapter (nearest perceptual anchor). */
export function classify(oklch: OKLCH): Classification {
  if (oklch.C < ACHROMATIC_CHROMA) {
    return { chapter: ACHROMATIC_KEY, oklch };
  }
  return { chapter: nearestAnchor(oklch.H).slug, oklch };
}

/** Round for compact storage / display. */
export function roundOklch(o: OKLCH): OKLCH {
  return {
    L: Math.round(o.L * 1000) / 1000,
    C: Math.round(o.C * 1000) / 1000,
    H: Math.round(o.H * 10) / 10,
  };
}

/** OKLCH -> CSS `oklch()` string for painting backgrounds/swatches. */
export function oklchCss(o: OKLCH, alpha = 1): string {
  const a = alpha === 1 ? '' : ` / ${alpha}`;
  return `oklch(${o.L.toFixed(3)} ${o.C.toFixed(3)} ${o.H.toFixed(1)}${a})`;
}
