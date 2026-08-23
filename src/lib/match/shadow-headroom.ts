/**
 * Shadow-recovery headroom — issue #70.
 *
 * READ THIS BEFORE CHANGING ANY NUMBER HERE.
 *
 * Every refuse-rather-than-guess panel in Style Match so far reports a
 * MEASURED limit: `gear-dna.ts` refuses a lens group below
 * `MIN_CHAPTER_PHOTOS`, `chapter-dna.ts` refuses a chapter with no settled
 * look, `resemble.ts`'s `CLOSE_ENOUGH`/`TOO_FAR` are measured thresholds, not
 * guesses. Shadow recovery had no such answer — this file is that answer,
 * and it is the odd one out in one respect: nothing in this codebase can
 * measure a sensor's read noise (that needs a lab, a light source and dark
 * frames at every ISO), so unlike `resemble.ts` this is necessarily a
 * REASONED ESTIMATE from published third-party characterisation, in the same
 * spirit `calibration.ts` uses for Lightroom's own opaque slider maths.
 *
 * ── The physics, briefly ─────────────────────────────────────────────────
 * A sensor's read noise is (very roughly) constant in electrons regardless of
 * ISO — but ISO is an analog gain applied BEFORE that noise is read off the
 * pixel, on most modern cameras. Raise the ISO and you amplify the signal
 * (and shot noise) ahead of the noise floor, so the floor sits at a smaller
 * FRACTION of full well the higher you push the dial. Below a camera's
 * "ISO-invariance point" — often architected around a dual-conversion-gain
 * switch — raising ISO genuinely buys you a cleaner shadow at a given
 * exposure than raising the equivalent amount in post would. Past that
 * point, further ISO gain is close to a pure digital multiply: it stops
 * buying anything, and the read-noise floor (as a fraction of the signal)
 * stops moving. That "falls steeply, then flattens" shape is the one
 * `photonstophotos.net`'s Read Noise vs ISO charts show for essentially
 * every modern camera it has measured (https://www.photonstophotos.net/Charts/RN_e.htm).
 *
 * This file reports the OTHER side of that same curve: given you already
 * shot at ISO X, how many more stops can you lift a shadow in post before
 * that (now-amplified, now-closer-to-the-signal) read noise floor becomes
 * visible at 100%. It falls with ISO for the same reason the noise-vs-ISO
 * curve falls: the higher the ISO, the less distance remains between the
 * captured signal and the floor.
 *
 * ── The numbers, and why they are what they are ─────────────────────────
 *
 *  - `BASE_HEADROOM_EV = 6.0`: at base ISO, a modern full-frame/APS-C sensor
 *    generally publishes an engineering dynamic range in the 11-14 EV range
 *    (DxOMark screen figures, photonstophotos' own DR charts), but "read
 *    noise visible at 100%" is a much stricter bar than "technically above
 *    the noise floor at all" — banding and colour noise become visible well
 *    before the sensor's absolute floor. 6 EV is a conservative, commonly
 *    cited practical figure for how far a shadow can be pushed before that
 *    becomes objectionable on a clean, modern base-ISO file. Not a claim any
 *    specific body's number is exactly 6.0 — a deliberately round estimate.
 *
 *  - `EV_LOST_PER_ISO_DOUBLING = 1.0`: the read-noise-vs-ISO curves cited
 *    above fall close to 1:1 with ISO stops in the analog-gain region on
 *    most cameras (doubling ISO roughly halves the noise floor's electron
 *    count, which is the same as saying it costs about a stop of the
 *    headroom budget above). A straight-line approximation of a curve that
 *    is, in reality, gently concave — again: honestly approximate, not
 *    fitted to any one sensor.
 *
 *  - `GENERIC_INVARIANCE_ISO = 800`: a commonly cited round figure for where
 *    a generic modern full-frame/APS-C sensor's analog gain stops helping.
 *    Real bodies vary — some (see `CAMERA_CURVES` below) invert well before
 *    this, others past it.
 *
 * ── Per-body curves ───────────────────────────────────────────────────────
 * `CAMERA_CURVES` recognises a camera family from the EXIF `camera` string
 * (`Make + Model`, see `ingest.ts`'s `parseExif`) and substitutes a different
 * invariance point when the family is known to differ meaningfully from the
 * generic curve. The one entry here today — Sony's dual-conversion-gain
 * bodies — is grounded in photonstophotos' own read-noise charts, which show
 * a sharp step in the Sony Alpha line's noise curve, and independent testing
 * (e.g. the Sony A7 III accounts) placing the practical invariance point
 * around ISO 640. This is a FAMILY-WIDE estimate, not one measured per exact
 * model — an A7 III and an A7R V do not share a sensor — but a family curve
 * beats the generic one for every Sony body this matches, and the result
 * always carries `estimated: true` regardless of which curve answered it.
 * Add an entry here, with its own reasoning, when a body's own dual-gain
 * point is worth distinguishing; do not add one on a guess.
 *
 * ── What this deliberately is not ────────────────────────────────────────
 * No pixel is read, denoised or reconstructed by this file — it prints one
 * number and a sentence. It does not know the photograph's own content (a
 * genuinely flat sky pushes cleaner than a busy, high-ISO forest floor at
 * the same nominal ISO; this model does not see the frame at all, only the
 * metadata), so treat it as a ceiling reasoned from the camera and settings,
 * not a promise about any specific push on any specific photo.
 */

/** Base ISO the estimate is anchored to. */
const BASE_ISO = 100;

/** EV of shadow lift available at base ISO before read noise reads as visible
 *  at 100% — see file header for where this figure comes from. */
const BASE_HEADROOM_EV = 6.0;

/** Stops of that headroom given up per doubling of ISO above base, while
 *  still in the sensor's analog-gain (pre-invariance) region. */
const EV_LOST_PER_ISO_DOUBLING = 1.0;

/** Generic invariance point used when the camera isn't recognised below. */
const GENERIC_INVARIANCE_ISO = 800;

interface CameraNoiseCurve {
  /** Shown in the result so the UI/tests can tell which curve answered. */
  label: string;
  /** Matched case-insensitively against the EXIF `camera` string. */
  match: RegExp;
  /** Where this family's read-noise-vs-ISO curve flattens. */
  invarianceIso: number;
}

/** Recognised camera families with a documented invariance point that
 *  differs meaningfully from the generic curve. See file header. */
const CAMERA_CURVES: CameraNoiseCurve[] = [
  {
    label: 'Sony (dual conversion gain)',
    match: /sony|ilce|alpha/i,
    invarianceIso: 640,
  },
];

export interface ShadowHeadroomResult {
  /** ISO the estimate was computed for. */
  iso: number;
  /** Stops of shadow lift before read noise reads as visible at 100%. */
  ev: number;
  /** "+X.X EV of shadow lift before read noise is visible at 100%." */
  sentence: string;
  /** Always true — this is a reasoned estimate, never a measurement. See the
   *  file header before treating this as anything more precise. */
  estimated: true;
  /** Which noise curve produced the number — a recognised camera family, or
   *  the generic fallback. */
  curve: string;
  /** True when a per-body curve matched; false when the generic curve had
   *  to be used because the camera was missing or unrecognised. */
  cameraMatched: boolean;
}

/**
 * How many stops a shadow can be pushed, given the ISO it was shot at,
 * before read noise reads as visible at 100% — a diagnostic, not a fix.
 *
 * Refuses (returns null) when there is no ISO to reason from, the same
 * refusal `gear-dna.ts` applies below `MIN_CHAPTER_PHOTOS`: guessing an EV
 * number with no ISO behind it would be indistinguishable from a fabricated
 * one.
 */
export function shadowHeadroom(iso: number | null | undefined, camera?: string): ShadowHeadroomResult | null {
  if (iso == null || !Number.isFinite(iso) || iso <= 0) return null;

  const matched = camera ? CAMERA_CURVES.find((c) => c.match.test(camera)) : undefined;
  const invarianceIso = matched?.invarianceIso ?? GENERIC_INVARIANCE_ISO;
  const curve = matched?.label ?? 'generic full-frame/APS-C';

  // ISO below base isn't modelled — extrapolating extra headroom for pulled
  // ISOs would be a second guess stacked on the first, so it's clamped to
  // the base-ISO figure rather than projected further.
  const doublingsFromBase = Math.max(0, Math.log2(iso / BASE_ISO));
  const doublingsToInvariance = Math.max(0, Math.log2(invarianceIso / BASE_ISO));
  // Past the invariance point the curve is flat: no more of the budget is
  // spent, however far past it the ISO goes.
  const spentDoublings = Math.min(doublingsFromBase, doublingsToInvariance);

  const ev = Math.max(0, BASE_HEADROOM_EV - spentDoublings * EV_LOST_PER_ISO_DOUBLING);

  return {
    iso,
    ev,
    sentence: `+${ev.toFixed(1)} EV of shadow lift before read noise is visible at 100%.`,
    estimated: true,
    curve,
    cameraMatched: Boolean(matched),
  };
}
