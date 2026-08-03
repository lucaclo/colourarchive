// Style Match — shared types.
//
// The feature answers one question: "what would I have to do in Lightroom to
// make MY photo carry the REFERENCE photo's grade?" Everything here is
// measurement — no advice, no slider values. Those come later, in the solver,
// and they are *derived* from these numbers rather than guessed alongside them.

/** How a file's pixels were obtained — this is not cosmetic. A RAW rendered by
 *  Apple's pipeline sits at a slightly different starting point than the same
 *  RAW zeroed in Lightroom, and advice computed against the wrong baseline is
 *  wrong by that offset. Every measurement carries the baseline it came from so
 *  the solver can say how much to trust it. */
export type BaselineMode =
  /** File was already a rendered image (JPEG/PNG/WebP/AVIF/HEIC). */
  | 'native'
  /** RAW decoded on this Mac by sips / Image I/O. Approximates, but does not
   *  equal, Lightroom's Adobe Color baseline. */
  | 'macos'
  /** A JPEG exported from Lightroom with every slider at default. This IS
   *  Lightroom's baseline, so deltas measured against it land exactly. */
  | 'export'
  /** The full-size JPEG preview embedded in a RAW. Instant, but it carries the
   *  camera's picture profile / Creative Look, not Lightroom's baseline. */
  | 'preview';

export const BASELINE_LABEL: Record<BaselineMode, string> = {
  native: 'Rendered image',
  macos: 'RAW decoded on this Mac',
  export: 'Lightroom zero-slider export',
  preview: 'Camera preview embedded in RAW',
};

/** How closely a baseline matches what Lightroom shows at zero. Drives the
 *  confidence badge in the UI and lets the solver damp systematic offsets. */
export const BASELINE_FIDELITY: Record<BaselineMode, number> = {
  export: 1.0, // by definition exact
  native: 0.9, // rendered already; what you see is what it is
  macos: 0.8, // close, small profile-shaped offset
  preview: 0.55, // camera look baked in; direction right, magnitude soft
};

// --- Regions -----------------------------------------------------------------

/** Every region a photo is measured over. Zones are luminance bands and always
 *  exist; the rest come from segmentation and may be absent in a given frame. */
export type RegionKey =
  | 'global'
  | 'zone.shadow'
  | 'zone.midtone'
  | 'zone.highlight'
  | 'scene.sky'
  | 'scene.foliage'
  | 'scene.water'
  | 'scene.built'
  | 'scene.ground'
  | 'subject'
  | 'background'
  | 'people.skin'
  | 'people.hair'
  | 'people.clothing';

export const REGION_LABEL: Record<RegionKey, string> = {
  global: 'Whole frame',
  'zone.shadow': 'Shadows',
  'zone.midtone': 'Midtones',
  'zone.highlight': 'Highlights',
  'scene.sky': 'Sky',
  'scene.foliage': 'Foliage',
  'scene.water': 'Water',
  'scene.built': 'Buildings',
  'scene.ground': 'Ground',
  subject: 'Subject',
  background: 'Background',
  'people.skin': 'Skin',
  'people.hair': 'Hair',
  'people.clothing': 'Clothing',
};

/** Display order — broad to specific, which is also roughly the order you'd
 *  work a photo in Lightroom. */
export const REGION_ORDER: RegionKey[] = [
  'global',
  'zone.shadow',
  'zone.midtone',
  'zone.highlight',
  'subject',
  'background',
  'people.skin',
  'people.hair',
  'people.clothing',
  'scene.sky',
  'scene.foliage',
  'scene.water',
  'scene.built',
  'scene.ground',
];

// --- Statistics --------------------------------------------------------------

export interface Moments {
  mean: number;
  /** Population standard deviation — spread matters as much as centre. Two
   *  photos can share a mean lightness and look nothing alike. */
  sd: number;
}

/** Hue is circular: the mean of 350° and 10° is 0°, not 180°. Always summarise
 *  it as a resultant vector, never as an arithmetic mean of angles. */
export interface HueStats {
  /** Circular mean hue in degrees, 0..360. Meaningless when `strength` ~ 0. */
  mean: number;
  /** Resultant length 0..1. High = one coherent hue; low = hues cancel out,
   *  so `mean` should not be trusted or acted on. */
  strength: number;
}

/** Everything measured about one region of one photo. */
export interface RegionStats {
  key: RegionKey;
  /** Fraction of the frame this region covers BEFORE erosion — the honest
   *  answer to "how much of the picture is sky". */
  coverage: number;
  /** Pixels actually sampled, i.e. inside the eroded mask. Small counts make
   *  every number here noisy, so the UI degrades them. */
  sampled: number;
  /** Perceptual lightness, OKLCH L. */
  L: Moments;
  /** Chroma, OKLCH C. */
  C: Moments;
  hue: HueStats;
  /** Mean OKLab a/b. The honest average colour of the region — averaging in
   *  OKLab and converting back never invents a hue the way averaging RGB or
   *  hue angles does. */
  ab: { a: number; b: number };
  /** Luminance percentiles at 5% steps (21 values, 0..1). This is the region's
   *  tone curve shape, and it is what the curve solver matches against. */
  percentiles: number[];
}

// --- Texture -----------------------------------------------------------------

/** Why a texture measurement could not be trusted. Surfaced verbatim to the UI
 *  so a blank panel always explains itself. */
export type TextureBlock =
  | 'resolution' // too few pixels to read grain from
  | 'compression' // JPEG block artefacts dominate the high frequencies
  | 'upscaled' // no real high-frequency energy: image was enlarged
  | 'none';

export interface TextureStats {
  usable: boolean;
  blocked: TextureBlock;
  /** Human-readable reason, shown when `usable` is false. */
  reason?: string;
  /** True when the measurement was taken on a downsampled copy so it could be
   *  compared like-for-like against a differently-sized photo. See
   *  TEXTURE_NORM_EDGE in texture.ts for why this is necessary. */
  normalised: boolean;
  /** The file's own resolution — what the honesty gates ran against. */
  nativeSize: { width: number; height: number };
  /** RMS high-frequency energy in flat areas — grain / noise amplitude.
   *  Measured in luminance units (0..1). */
  grain: number;
  /** Mean spatial period of that noise in pixels. Fine digital noise sits near
   *  1-2px; film grain and heavy NR-then-grain looks run coarser. */
  grainSize: number;
  /** Edge acutance — mean gradient magnitude across detected edges, normalised.
   *  Proxy for capture sharpening + Lightroom Sharpening/Texture. */
  acutance: number;
  /** Ratio of high-frequency energy in flat regions vs edge regions. Low means
   *  noise reduction has been applied (flats smoothed, edges kept). */
  flatToEdge: number;
  /** Pixel dimensions the reported numbers were measured at. Equals
   *  `nativeSize` unless `normalised` is true. */
  measuredAt: { width: number; height: number };
}

// --- Vignette ----------------------------------------------------------------

export interface VignetteStats {
  /** Corner-ring luminance relative to centre, in stops, measured in LINEAR
   *  light. Negative = darkened corners. */
  falloffStops: number;
  /** How consistent the falloff is around the frame, 0..1. Real optical
   *  vignetting is near-identical in all four corners; one dark building in
   *  frame left is not. Decays smoothly with the spread between quadrants. */
  symmetry: number;
  /** Whether this reading should be allowed to move a slider. False when the
   *  corners disagree enough that we are almost certainly measuring scene
   *  content rather than the lens. */
  usable: boolean;
}

/** Below this symmetry, corner darkness is treated as composition rather than
 *  optics and must not drive the Vignetting slider. */
export const VIGNETTE_MIN_SYMMETRY = 0.62;

// --- The whole analysis of one photo -----------------------------------------

export interface PhotoAnalysis {
  /** Content hash of the source bytes — the cache key. */
  id: string;
  filename: string;
  baseline: BaselineMode;
  /** Set when the baseline is a compromise, e.g. camera preview used. */
  baselineNote?: string;
  width: number;
  height: number;
  /** Resolution statistics were sampled at (long edge). */
  sampledAt: number;
  regions: Partial<Record<RegionKey, RegionStats>>;
  texture: TextureStats;
  vignette: VignetteStats;
  /** Hue histogram over Lightroom's own 8 HSL bands — mean saturation and
   *  lightness per band, plus how much of the frame sits in each. Indexed by
   *  HSL_BANDS order. This is what the HSL solver reads. */
  hslBands: HslBandStats[];
  /** Seconds spent, per stage — shown in the UI so a slow run explains itself. */
  timings: Record<string, number>;
  warnings: string[];
}

/** Lightroom's eight HSL bands, with the OKLCH hue angle each is centred on.
 *  These are the bands the app actually exposes, so advice must be expressed in
 *  them — not in arbitrary bins of our own. */
export interface HslBand {
  key: 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';
  label: string;
  /** Centre of the band in OKLCH hue degrees. */
  H: number;
}

export const HSL_BANDS: HslBand[] = [
  { key: 'red', label: 'Red', H: 28 },
  { key: 'orange', label: 'Orange', H: 62 },
  { key: 'yellow', label: 'Yellow', H: 100 },
  { key: 'green', label: 'Green', H: 145 },
  { key: 'aqua', label: 'Aqua', H: 195 },
  { key: 'blue', label: 'Blue', H: 255 },
  { key: 'purple', label: 'Purple', H: 305 },
  { key: 'magenta', label: 'Magenta', H: 350 },
];

/** Segmentation output. Lives here rather than in regions.ts so the pure
 *  measurement core can reference it without pulling in sharp or the model
 *  runtime — the browser path has neither. */
export interface RegionMasks {
  width: number;
  height: number;
  masks: Partial<Record<RegionKey, Uint8Array>>;
  full: Partial<Record<RegionKey, Uint8Array>>;
  coverage: Partial<Record<RegionKey, number>>;
  warnings: string[];
  timings: Record<string, number>;
}

/** An empty mask set — what the browser path measures against, where the
 *  luminance zones still apply but no segmentation has run. */
export const NO_MASKS = (width = 1, height = 1): RegionMasks => ({
  width,
  height,
  masks: {},
  full: {},
  coverage: {},
  warnings: [],
  timings: {},
});

/** Decoded pixels, in whatever produced them. Both sharp and a canvas can
 *  supply this shape, which is the whole point. */
export interface RgbImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  /** 3 for RGB, 4 for RGBA. Canvas always gives 4. */
  channels: number;
}

export interface HslBandStats {
  key: HslBand['key'];
  /** Fraction of chromatic pixels falling in this band. Near zero means the
   *  band is absent from the photo and must not be advised on — moving a
   *  slider for a colour that isn't there is noise. */
  weight: number;
  /** Mean chroma of pixels in this band. */
  chroma: number;
  /** Mean lightness of pixels in this band. */
  L: number;
  /** Circular mean hue within the band — reveals hue rotation inside a band,
   *  which is exactly what the HSL Hue slider controls. */
  hue: number;
}
