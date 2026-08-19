import { pipeline, AutoModel, AutoProcessor, RawImage, env } from '@xenova/transformers';
import sharp from 'sharp';
import { erode } from './morphology';
import type { RegionKey, RegionMasks } from './types';

export type { RegionMasks };

// Segmentation — "rotoscope data" in the original ask.
//
// Three models, each doing what it is actually good at:
//   • SegFormer-B2 / ADE20K  — scene classes (sky, foliage, water, built, ground)
//   • SegFormer-B2 / clothes — human parsing, which is the only way to get a
//                              real SKIN mask. Skin is the single biggest tell
//                              in a colour grade, and no scene model isolates it.
//   • RMBG-1.4               — a soft foreground matte for subject/background,
//                              approximating Lightroom's Select Subject.
//
// All run locally and are offline after first download, exactly like the
// DINOv2 and CLIP models already in this pipeline.
//
// THE IMPORTANT PART IS EROSION. Segmentation edges are approximate, and a
// boundary pixel is a blend of both sides — sky pixels bleeding into a "tree"
// mask would drag the foliage measurement toward blue and produce confident,
// wrong advice. Every mask is therefore shrunk inward before a single pixel is
// sampled. We deliberately trade coverage for purity: measuring 60% of the sky
// with certainty beats measuring 100% of it with contamination. This is what
// buys large-model accuracy from mid-size models.

env.allowLocalModels = false;

/** Long edge the models see. 1536 measured at ~2.9s (scene) + ~1.2s (people) on
 *  an M-series Air, with clean mask shape. Masks return at THIS resolution, not
 *  the source's — which is what keeps a 60MP file from producing 700MB of masks. */
const SEG_EDGE = 1536;

/** Erosion radius as a fraction of the mask's long edge. ~0.8% ≈ 12px at 1536,
 *  comfortably more than SegFormer's edge uncertainty. */
const ERODE_FRACTION = 0.008;
const ERODE_MIN = 3;

/** Below this coverage a region is dropped: too little of the frame for its
 *  statistics to mean anything, and acting on it would be noise-chasing. */
const MIN_COVERAGE = 0.004; // 0.4% of the frame

const SCENE_MODEL = 'Xenova/segformer-b2-finetuned-ade-512-512';
const PEOPLE_MODEL = 'Xenova/segformer_b2_clothes';
const MATTE_MODEL = 'briaai/RMBG-1.4';

// --- ADE20K label -> our scene regions ---------------------------------------

const SCENE_GROUPS: Array<{ key: RegionKey; labels: string[] }> = [
  { key: 'scene.sky', labels: ['sky'] },
  { key: 'scene.foliage', labels: ['tree', 'grass', 'plant', 'flower', 'palm', 'field'] },
  { key: 'scene.water', labels: ['water', 'sea', 'river', 'lake', 'waterfall', 'swimming pool', 'fountain'] },
  {
    key: 'scene.built',
    labels: [
      'building', 'house', 'skyscraper', 'wall', 'ceiling', 'windowpane', 'door',
      'hovel', 'tower', 'bridge', 'column', 'stairs', 'stairway', 'railing',
      'fence', 'awning', 'booth',
    ],
  },
  {
    key: 'scene.ground',
    labels: ['road', 'sidewalk', 'earth', 'sand', 'floor', 'path', 'land', 'dirt track', 'runway', 'mountain', 'rock', 'hill'],
  },
];

// --- Human parsing label -> our people regions -------------------------------

const PEOPLE_GROUPS: Array<{ key: RegionKey; labels: string[] }> = [
  // 'Face' in this model is facial skin, not the whole head.
  { key: 'people.skin', labels: ['Face', 'Left-leg', 'Right-leg', 'Left-arm', 'Right-arm'] },
  { key: 'people.hair', labels: ['Hair'] },
  { key: 'people.clothing', labels: ['Upper-clothes', 'Skirt', 'Pants', 'Dress', 'Belt', 'Scarf', 'Hat'] },
];

// --- Model loading (lazy, once) ----------------------------------------------

let sceneP: Promise<any> | null = null;
let peopleP: Promise<any> | null = null;
let matteP: Promise<{ model: any; processor: any }> | null = null;

const getScene = () => (sceneP ??= pipeline('image-segmentation', SCENE_MODEL));
const getPeople = () => (peopleP ??= pipeline('image-segmentation', PEOPLE_MODEL));

// RMBG-1.4 has no registered architecture in transformers.js, so it is driven
// through AutoModel with an explicit processor config. These values come from
// the model card; they are not guesses and must not be "tidied".
const getMatte = () =>
  (matteP ??= (async () => {
    const model = await AutoModel.from_pretrained(MATTE_MODEL, { config: { model_type: 'custom' } as any });
    const processor = await AutoProcessor.from_pretrained(MATTE_MODEL, {
      config: {
        do_normalize: true,
        do_pad: false,
        do_rescale: true,
        do_resize: true,
        image_mean: [0.5, 0.5, 0.5],
        image_std: [1, 1, 1],
        resample: 2,
        rescale_factor: 1 / 255,
        size: { width: 1024, height: 1024 },
      },
    } as any);
    return { model, processor };
  })());

/** Warm every segmentation model. Optional; makes the first comparison fast. */
export async function warmRegionModels(): Promise<void> {
  await Promise.all([getScene(), getPeople(), getMatte()]);
}

// --- Result ---------------------------------------------------------------

const meanOf = (m: Uint8Array): number => {
  let s = 0;
  for (let i = 0; i < m.length; i++) s += m[i];
  return s / (m.length * 255);
};

/** Union two masks by per-pixel maximum (a pixel belongs if either claims it). */
function unionInto(target: Uint8Array, add: Uint8Array): void {
  for (let i = 0; i < target.length; i++) if (add[i] > target[i]) target[i] = add[i];
}

/**
 * Segment one image into every region we can find.
 *
 * `imagePath` should be the lossless working file from decode.ts. Failures in
 * any single model degrade that model's regions only — matching the existing
 * pipeline's behaviour, where a missing model skips a feature rather than
 * failing ingest.
 */
export async function segmentRegions(imagePath: string): Promise<RegionMasks> {
  const warnings: string[] = [];
  const timings: Record<string, number> = {};

  // One resized copy feeds all three models. PNG so nothing is re-compressed
  // lossily on the way in.
  const resized = await sharp(imagePath)
    .resize({ width: SEG_EDGE, height: SEG_EDGE, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });

  const width = resized.info.width;
  const height = resized.info.height;
  const n = width * height;
  const image = await RawImage.fromBlob(new Blob([new Uint8Array(resized.data)]));

  const masks: Partial<Record<RegionKey, Uint8Array>> = {};
  const full: Partial<Record<RegionKey, Uint8Array>> = {};
  const coverage: Partial<Record<RegionKey, number>> = {};
  const raw: Partial<Record<RegionKey, Uint8Array>> = {};

  const ensure = (key: RegionKey): Uint8Array => (raw[key] ??= new Uint8Array(n));

  // --- Scene ------------------------------------------------------------------
  let personHint: Uint8Array | null = null;
  try {
    const t0 = Date.now();
    const scene = await getScene();
    const out = (await scene(image)) as Array<{ label: string; mask: { data: Uint8Array } }>;
    for (const seg of out) {
      const label = String(seg.label).toLowerCase();
      if (label === 'person') {
        personHint = Uint8Array.from(seg.mask.data);
        continue;
      }
      const group = SCENE_GROUPS.find((g) => g.labels.includes(label));
      if (group) unionInto(ensure(group.key), seg.mask.data);
    }
    timings.scene = (Date.now() - t0) / 1000;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    warnings.push(`Scene segmentation unavailable (${message}). Sky, foliage, water, buildings and ground were not measured.`);
  }

  // --- People -----------------------------------------------------------------
  try {
    const t0 = Date.now();
    const people = await getPeople();
    const out = (await people(image)) as Array<{ label: string; mask: { data: Uint8Array } }>;
    for (const seg of out) {
      const group = PEOPLE_GROUPS.find((g) => g.labels.includes(String(seg.label)));
      if (group) unionInto(ensure(group.key), seg.mask.data);
    }
    timings.people = (Date.now() - t0) / 1000;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    warnings.push(`Human parsing unavailable (${message}). Skin, hair and clothing were not measured separately.`);
  }

  // --- Subject matte ----------------------------------------------------------
  try {
    const t0 = Date.now();
    const { model, processor } = await getMatte();
    const { pixel_values } = await processor(image);
    const { output } = await model({ input: pixel_values });

    // RMBG returns a fixed 1024x1024 alpha regardless of input aspect (its
    // processor squashes to a square), so resize it back to the mask grid.
    const side = Math.round(Math.sqrt(output.data.length));
    const alpha = new Uint8Array(output.data.length);
    for (let i = 0; i < output.data.length; i++) {
      alpha[i] = Math.max(0, Math.min(255, Math.round(output.data[i] * 255)));
    }
    const fitted = await sharp(alpha, { raw: { width: side, height: side, channels: 1 } })
      .resize(width, height, { fit: 'fill' })
      .raw()
      .toBuffer();

    const subject = new Uint8Array(fitted);
    const background = new Uint8Array(n);
    for (let i = 0; i < n; i++) background[i] = 255 - subject[i];
    raw.subject = subject;
    raw.background = background;
    timings.matte = (Date.now() - t0) / 1000;
  } catch (e) {
    // Fall back to the scene model's person class — worse than a real matte,
    // but far better than having no subject/background split at all.
    if (personHint) {
      const background = new Uint8Array(n);
      for (let i = 0; i < n; i++) background[i] = 255 - personHint[i];
      raw.subject = personHint;
      raw.background = background;
      warnings.push('Subject matte unavailable; fell back to the scene model’s person class for subject/background.');
    } else {
      const message = e instanceof Error ? e.message : 'unknown error';
      warnings.push(`Subject matte unavailable (${message}). Subject and background were not measured separately.`);
    }
  }

  // --- Erode + prune ----------------------------------------------------------
  const t0 = Date.now();
  const radius = Math.max(ERODE_MIN, Math.round(Math.max(width, height) * ERODE_FRACTION));
  for (const [key, mask] of Object.entries(raw) as Array<[RegionKey, Uint8Array]>) {
    const before = meanOf(mask);
    coverage[key] = before;
    if (before < MIN_COVERAGE) continue; // too small to be worth measuring
    const eroded = erode(mask, width, height, radius);
    // Erosion can consume a thin region entirely (a distant railing, a sliver of
    // sky between buildings). That is the correct outcome — there were never
    // enough uncontaminated pixels there to measure honestly.
    if (meanOf(eroded) < MIN_COVERAGE / 2) continue;
    masks[key] = eroded;
    full[key] = mask;
  }
  timings.erode = (Date.now() - t0) / 1000;

  return { width, height, masks, full, coverage, warnings, timings };
}
