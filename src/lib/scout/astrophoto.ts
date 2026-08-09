/**
 * What this lens can do with the night sky.
 *
 * `galactic.ts` says where the core is and whether the sky is dark enough to
 * see it. `frame.ts` says what the lens covers. Neither answers the two
 * questions anyone standing in a field at one in the morning actually has:
 * *will it fit in the picture*, and *how long can the shutter be open before
 * the stars stop being points?* This is the join between them, the way
 * `lighting.ts` is the join for the sun.
 *
 * ## Trailing is measured, not ruled
 *
 * The two rules of thumb in circulation both hide the thing that decides the
 * answer. The **500 rule** (500 ÷ focal length) predates digital entirely and
 * knows nothing about how finely the sensor samples the image, so it gives a
 * 12 MP body and a 61 MP body the same shutter — and one of them is wrong by a
 * factor of two. The **NPF rule** does use pixel pitch, but wraps it in fitted
 * constants that came from somebody's judgement about how much trailing looks
 * acceptable, which makes its output un-reproducible for exactly the reason
 * this project refuses to publish a sunset score.
 *
 * So there is no rule here. A star at declination δ moves across the sky at
 * `15.041″/s × cos δ` — the earth's sidereal rotation, and an identity rather
 * than a fit. Project that through the focal length onto the pixel pitch and
 * the trail comes out **in pixels**, which is a thing that can be checked
 * against the file afterwards. The only judgement left is how many pixels of
 * trail are acceptable, and that is stated as a number the caller passes in
 * rather than baked into a constant.
 *
 * For reference, since everyone arrives holding one of them: at 24mm on a 33 MP
 * full frame the 500 rule says 21 s, the NPF rule at f/2.8 says 10 s, and the
 * arithmetic here puts those at 6 and 3 pixels of trail respectively.
 *
 * ## What is not modelled
 *
 *   - **Aperture, ISO and how bright the result is.** This says how long you
 *     *may* expose, never how long you *should*. That depends on the sky
 *     brightness, which needs the light pollution `galactic.ts` already refuses
 *     to invent.
 *   - **Seeing and optics.** A star is never one pixel to begin with. Trailing
 *     is reported as the smear the earth's rotation adds, on top of whatever
 *     the atmosphere and the lens were already doing.
 *   - **Tracking.** Every figure here assumes a fixed tripod.
 *   - **Field rotation and the frame's corners.** The drift rate is the one at
 *     the target's own declination; stars elsewhere in the frame trail by
 *     different amounts and in different directions.
 *
 * Angles in degrees, distances in millimetres, times in seconds — matching
 * `frame.ts`, which this leans on for everything to do with the rectangle.
 */

import {
  checkFraming,
  projectToFrame,
  type Aim,
  type FrameCheck,
  type Fov,
  type Sensor,
  type SkyTarget,
} from './frame';
import { CORE_SPAN_DEG, intervalsWhere, type Interval } from './galactic';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);

/* ── How finely the sensor samples ─────────────────────────────────────────── */

/**
 * The pixel counts worth offering, in megapixels.
 *
 * Spanning the bodies anyone would bring to this — an older 12 MP low-light
 * body at one end, a 102 MP medium format at the other — with the a7C II's 33
 * in the middle as the default, since that is the camera this whole tab was
 * built around.
 */
export const RESOLUTIONS = [12, 16, 20, 24, 26, 33, 42, 45, 50, 61, 102];

export const DEFAULT_MEGAPIXELS = 33;

/**
 * Pixel pitch in millimetres, from the sensor's size and its pixel count.
 *
 * Derived rather than tabulated, because a table would be a list of specific
 * bodies and the sensor picker offers formats. It assumes square pixels filling
 * the stated area at the stated aspect ratio, which is true of every camera
 * here and gives the a7C II 5.11 µm against its real 5.12 — a fifth of a
 * percent, well inside the pixel the answer is quoted in.
 *
 * This is the *only* place a resolution enters the arithmetic. Everything
 * downstream takes a pitch, so a caller who knows their real pixel pitch can
 * pass it and skip the assumption entirely.
 */
export function pixelPitchMm(sensor: Sensor, megapixels: number): number {
  if (!(megapixels > 0)) throw new RangeError('megapixels must be greater than zero');
  const aspect = sensor.widthMm / sensor.heightMm;
  const pixelsAcross = Math.sqrt(megapixels * 1e6 * aspect);
  return sensor.widthMm / pixelsAcross;
}

/* ── How fast the sky moves ────────────────────────────────────────────────── */

/**
 * The sidereal day, seconds. The earth's rotation against the stars rather than
 * against the sun — the four-minute difference is why the core rises earlier
 * each night, and using 86,400 here would put the trail out by a part in 365.
 */
export const SIDEREAL_DAY_SECONDS = 86_164.0905;

/** Degrees of sky a star on the celestial equator covers in a second. */
export const SIDEREAL_RATE_DEG_PER_SEC = 360 / SIDEREAL_DAY_SECONDS;

/**
 * How fast a star at this declination crosses the sky, degrees a second.
 *
 * Stars ride circles centred on the pole, and a circle at declination δ has
 * angular radius `90 − |δ|`, so its circumference — and the speed along it —
 * scales as `cos δ`. Exact, not fitted. At the pole it is zero and nothing
 * trails; at the equator it is the full sidereal rate; the galactic core at
 * δ −29° runs at 87% of it.
 *
 * The rate does *not* depend on latitude, altitude or hour angle. Where you are
 * changes which stars you can see and at what angle they cut the frame, not how
 * fast they move.
 *
 * The snap at the end is not an approximation, it is the removal of one:
 * `cos(90°)` in floating point is 6×10⁻¹⁷ rather than zero, and left alone that
 * residue comes back out as a shutter limit of 1.5 billion years — a number
 * with no information in it, printed with total confidence. Anything below the
 * cosine's own noise floor is the pole, where a star does not trail at all.
 */
export function driftRateDegPerSec(declinationDeg: number): number {
  const scale = Math.abs(cos(declinationDeg));
  return scale < 1e-12 ? 0 : SIDEREAL_RATE_DEG_PER_SEC * scale;
}

/** Everything the trail arithmetic needs, and nothing else. */
export interface TrailInput {
  focalLengthMm: number;
  /** Millimetres, from `pixelPitchMm` or from the body's own specification. */
  pixelPitchMm: number;
  declinationDeg: number;
}

/** How far the target smears in a given exposure, in pixels. */
export function trailPixels(seconds: number, input: TrailInput): number {
  if (seconds < 0) throw new RangeError('seconds must not be negative');
  const swept = driftRateDegPerSec(input.declinationDeg) * seconds;
  // Beyond a quarter turn the tangent stops describing a projection onto a flat
  // sensor at all. Nothing sane gets here; saying so beats returning a negative.
  if (swept >= 90) return Infinity;
  return (input.focalLengthMm * Math.tan(swept * RAD)) / input.pixelPitchMm;
}

/**
 * The longest exposure whose trail stays inside `pixels`.
 *
 * The exact inverse of `trailPixels`, so the two cannot drift apart. Returns
 * `Infinity` at the celestial poles, where a star genuinely never trails —
 * Polaris is the case, and reporting some large finite number there would be a
 * worse lie than admitting the model has no upper bound.
 */
export function shutterForTrailSeconds(pixels: number, input: TrailInput): number {
  if (!(pixels > 0)) throw new RangeError('pixels must be greater than zero');
  const rate = driftRateDegPerSec(input.declinationDeg);
  if (rate === 0) return Infinity;
  const swept = Math.atan((pixels * input.pixelPitchMm) / input.focalLengthMm) * DEG;
  return swept / rate;
}

/**
 * How much trail counts as none.
 *
 * One pixel is the honest floor — below it the smear is smaller than the sensor
 * can record, so the star is a point by any measure the file can support.
 */
export const SHARP_TRAIL_PX = 1;

/**
 * How much trail counts as acceptable.
 *
 * A convention, and named as one. Three pixels is invisible at any normal
 * viewing size and is roughly what the NPF rule permits, which makes it the
 * number most people are already shooting to without knowing it. It is a
 * parameter rather than a constant everywhere it is used.
 */
export const TOLERABLE_TRAIL_PX = 3;

export interface TrailLimit {
  /** How fast the target moves, in the units star charts use. */
  driftArcsecPerSec: number;
  pixelPitchUm: number;
  /** Shutter at which the smear reaches one pixel. */
  sharpSeconds: number;
  /** Shutter at `tolerancePixels`. */
  tolerantSeconds: number;
  tolerancePixels: number;
  /** Whole sentence, for the panel. */
  note: string;
}

/**
 * Both shutter limits and the sentence that says where they came from.
 *
 * Two numbers rather than one because there is no single right answer and
 * offering one would imply there was. The gap between them is the judgement
 * call, and printing both puts it where the photographer can make it.
 */
export function trailLimit(input: TrailInput, tolerancePixels = TOLERABLE_TRAIL_PX): TrailLimit {
  const sharpSeconds = shutterForTrailSeconds(SHARP_TRAIL_PX, input);
  const tolerantSeconds = shutterForTrailSeconds(tolerancePixels, input);
  const pixelPitchUm = input.pixelPitchMm * 1000;

  return {
    driftArcsecPerSec: driftRateDegPerSec(input.declinationDeg) * 3600,
    pixelPitchUm,
    sharpSeconds,
    tolerantSeconds,
    tolerancePixels,
    note: Number.isFinite(sharpSeconds)
      ? `At ${input.focalLengthMm}mm on ${pixelPitchUm.toFixed(2)} µm pixels, ` +
        `${formatShutter(sharpSeconds)} trails a single pixel and ` +
        `${formatShutter(tolerantSeconds)} trails ${tolerancePixels}.`
      : 'At the celestial pole, where nothing trails however long the shutter is open.',
  };
}

/** Shutters read differently either side of a second, and both matter here. */
export function formatShutter(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'no limit';
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  if (seconds >= 10) return `${Math.round(seconds)} s`;
  if (seconds >= 1) return `${seconds.toFixed(1)} s`;
  return `${seconds.toFixed(2)} s`;
}

/* ── A region in the frame ─────────────────────────────────────────────────── */

export { CORE_SPAN_DEG };

/**
 * A point on the sky at an angular distance and position angle from another.
 *
 * The great-circle destination formula, in altitude and azimuth rather than
 * latitude and longitude. It is deliberately *not* `geo.destination`: that one
 * works in metres on the earth's surface, and routing a sky angle through an
 * earth radius to get it back out again would be an invitation to leave a
 * kilometre somewhere. `positionAngle` runs from up-the-frame, clockwise.
 */
function offsetOnSky(from: SkyTarget, positionAngle: number, radiusDeg: number): SkyTarget {
  const altitude =
    Math.asin(
      sin(from.altitude) * cos(radiusDeg) + cos(from.altitude) * sin(radiusDeg) * cos(positionAngle),
    ) * DEG;
  const dAz =
    Math.atan2(
      sin(positionAngle) * sin(radiusDeg) * cos(from.altitude),
      cos(radiusDeg) - sin(from.altitude) * sin(altitude),
    ) * DEG;
  return { azimuth: from.azimuth + dAz, altitude };
}

export type FrameEdge = '' | 'left' | 'right' | 'top' | 'bottom';

export interface RegionFraming {
  /** The centre, from `frame.ts` — which stays the sole owner of the point test. */
  centre: FrameCheck;
  /** Every part of the region is inside the rectangle. */
  whollyInFrame: boolean;
  /** Some of it is, even if the centre is not. */
  partlyInFrame: boolean;
  /** What the region spans as a fraction of the frame's width and height. */
  spanOfWidth: number;
  spanOfHeight: number;
  /**
   * How far past an edge the *furthest* of it reaches, degrees — how much is
   * being cut off. Zero when it all fits.
   */
  overflowDeg: number;
  /** Which edge that is. Empty when nothing overflows. */
  overflowEdge: FrameEdge;
  /**
   * How far the *nearest* of it is from getting in, degrees — how much the
   * camera would have to move. Zero unless the region misses the frame
   * altogether, which is the only case where it is a different question from
   * `overflowDeg`.
   */
  shortfallDeg: number;
  shortfallEdge: FrameEdge;
  note: string;
}

/**
 * How many points around the rim to test — every 10° of position angle.
 *
 * The extreme of the projected region can fall between two samples, and the
 * most that can hide there is `r·(1 − cos 5°)`: under 0.03° for a region this
 * size, which is a third of the tenth of a degree anything is reported to.
 */
const RIM_SAMPLES = 36;

/**
 * A patch of sky with a size, against the frame.
 *
 * `checkFraming` answers for a direction, which is right for the sun — half a
 * degree across, smaller than the model's own error. It is the wrong question
 * for the Milky Way core, which is fifteen degrees of sky and can perfectly
 * well have its centre in the picture and its best half outside the top edge.
 *
 * The rim is walked as a circle *on the sky* and each point projected through
 * `projectToFrame`, rather than adding the radius to the frame offsets. Those
 * are two different things: near the zenith, ten degrees of sky is a hundred
 * degrees of azimuth, and only the projected rim knows that. A circle on the
 * sphere projects to a conic, so its rim really does bound it — the extremes
 * below are the region's extremes and not a sample that might have missed.
 *
 * A region straddling the image plane is refused rather than guessed at: past
 * that boundary the projection sends points off to infinity and the extremes
 * stop meaning anything.
 */
export function frameRegion(
  centre: SkyTarget,
  radiusDeg: number,
  aim: Aim,
  fov: Fov,
): RegionFraming {
  if (!(radiusDeg > 0)) throw new RangeError('radiusDeg must be greater than zero');
  const check = checkFraming(centre, aim, fov);
  const halfH = fov.horizontalDeg / 2;
  const halfV = fov.verticalDeg / 2;

  let acrossMin = Infinity;
  let acrossMax = -Infinity;
  let upMin = Infinity;
  let upMax = -Infinity;
  let anyInside = check.inFrame;
  let allAhead = projectToFrame(centre, aim).ahead;

  for (let i = 0; i < RIM_SAMPLES; i++) {
    const point = projectToFrame(offsetOnSky(centre, (i / RIM_SAMPLES) * 360, radiusDeg), aim);
    if (!point.ahead) {
      allAhead = false;
      continue;
    }
    acrossMin = Math.min(acrossMin, point.acrossDeg);
    acrossMax = Math.max(acrossMax, point.acrossDeg);
    upMin = Math.min(upMin, point.upDeg);
    upMax = Math.max(upMax, point.upDeg);
    anyInside ||= Math.abs(point.acrossDeg) <= halfH && Math.abs(point.upDeg) <= halfV;
  }

  if (!allAhead) {
    return {
      centre: check,
      whollyInFrame: false,
      partlyInFrame: anyInside,
      spanOfWidth: 0,
      spanOfHeight: 0,
      overflowDeg: 0,
      overflowEdge: '',
      shortfallDeg: 0,
      shortfallEdge: '',
      note: 'Part of the region is level with the camera or behind it, so how much of it lands in the picture is not a question this model can answer.',
    };
  }

  // Two different distances, and conflating them was the first version's bug.
  // The *overflow* is how far the furthest part reaches past an edge — what is
  // being cut off. The *shortfall* is how far the nearest part still is from
  // getting in, and it is only non-zero when the region misses the frame
  // completely. "Overflows the top by 4°" and "starts 4° above the top" are
  // opposite situations and the furthest extreme answers only the first.
  const overflow = worst([
    { edge: 'left', by: -halfH - acrossMin },
    { edge: 'right', by: acrossMax - halfH },
    { edge: 'bottom', by: -halfV - upMin },
    { edge: 'top', by: upMax - halfV },
  ]);
  const shortfall = worst([
    { edge: 'left', by: -halfH - acrossMax },
    { edge: 'right', by: acrossMin - halfH },
    { edge: 'bottom', by: -halfV - upMax },
    { edge: 'top', by: upMin - halfV },
  ]);

  const whollyInFrame = overflow.by <= 0;
  const spanOfWidth = (acrossMax - acrossMin) / fov.horizontalDeg;
  const spanOfHeight = (upMax - upMin) / fov.verticalDeg;

  return {
    centre: check,
    whollyInFrame,
    partlyInFrame: anyInside,
    spanOfWidth,
    spanOfHeight,
    overflowDeg: whollyInFrame ? 0 : round1(overflow.by),
    overflowEdge: whollyInFrame ? '' : overflow.edge,
    shortfallDeg: shortfall.by > 0 ? round1(shortfall.by) : 0,
    shortfallEdge: shortfall.by > 0 ? shortfall.edge : '',
    note: regionNote(whollyInFrame, anyInside, overflow, shortfall, spanOfWidth, spanOfHeight),
  };
}

interface Overrun {
  edge: FrameEdge;
  by: number;
}

const worst = (overruns: Overrun[]): Overrun => overruns.reduce((a, b) => (b.by > a.by ? b : a));

const round1 = (v: number) => Math.round(v * 10) / 10;
const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

function regionNote(
  wholly: boolean,
  anyInside: boolean,
  overflow: Overrun,
  shortfall: Overrun,
  spanOfWidth: number,
  spanOfHeight: number,
): string {
  const fills = `It fills ${percent(spanOfWidth)} of the frame's width and ${percent(spanOfHeight)} of its height.`;
  if (wholly) return `The whole bright region is in the picture. ${fills}`;
  if (anyInside) {
    return `The bright region runs ${round1(overflow.by)}° past the ${overflow.edge} edge. ${fills}`;
  }
  return `None of the bright region is in the picture — the nearest of it is ${round1(shortfall.by)}° outside the ${shortfall.edge} edge.`;
}

/**
 * The Milky Way core against the frame, at its stated size.
 *
 * The one-liner the panel wants, and the reason `CORE_SPAN_DEG` lives in
 * `galactic.ts` and not here: the size of the thing belongs with the thing.
 */
export function frameTheCore(core: SkyTarget, aim: Aim, fov: Fov): RegionFraming {
  return frameRegion(core, CORE_SPAN_DEG / 2, aim, fov);
}

/* ── When it is in the picture ─────────────────────────────────────────────── */

/**
 * The stretches of a window during which a moving target is inside the frame.
 *
 * The useful form of the framing question for anything on a tripod: the sky
 * turns fifteen degrees an hour, so a composition that holds the core now will
 * not hold it in ninety minutes, and on a long lens it will not hold for twenty
 * minutes. That number decides how many frames there are to stack.
 *
 * Borrowed wholesale from `galactic.ts`'s interval sampler rather than scanning
 * a track: it bisects each crossing down to the second, so the answer does not
 * inherit the five-minute step of whatever produced the positions. The sign
 * flip *is* the edge of the picture.
 *
 * The signed quantity is the distance to the nearest edge, taken off the
 * projection directly rather than from `checkFraming.edgeGapDeg`. Same
 * rectangle, same two comparisons — but that field is rounded to a tenth of a
 * degree for printing, and bisecting a staircase finds the step rather than the
 * crossing.
 */
export function inFrameWindows(
  from: Date,
  to: Date,
  positionAt: (at: Date) => SkyTarget,
  aim: Aim,
  fov: Fov,
  stepMinutes = 5,
): Interval[] {
  return intervalsWhere(from, to, stepMinutes, (t) => {
    const point = projectToFrame(positionAt(new Date(t)), aim);
    if (!point.ahead) return -1;
    return Math.min(
      fov.horizontalDeg / 2 - Math.abs(point.acrossDeg),
      fov.verticalDeg / 2 - Math.abs(point.upDeg),
    );
  });
}
