/**
 * The frame — what a given lens actually sees from the pin.
 *
 * Scout already answers where the light comes from. It does not answer the other
 * half of the same question, which is whether the sun will be *in the picture*.
 * Those are different problems and they have different answers: a sun forty
 * degrees off the aim is behind you at breakfast and side-lighting the subject,
 * and a sun four degrees off the frame edge is a veiling flare across the whole
 * exposure. The bearing readout cannot tell them apart because it does not know
 * what lens is on the body.
 *
 * So: a sensor, a focal length, an aim, and a tilt. From those the angular size
 * of the frame follows exactly — rectilinear projection, 2·atan(d/2f) — and the
 * sun's azimuth and altitude either fall inside that rectangle or they do not.
 *
 * What this deliberately does not do:
 *
 *   - **No lens distortion.** The rectilinear model is the design intent of every
 *     lens here; a real 16mm barrels a little at the corner and a fisheye is a
 *     different projection entirely. At the edges this is off by a degree or so,
 *     which is why the answer near an edge is reported as a *gap in degrees*
 *     rather than as a yes or a no.
 *   - **No flare magnitude.** Whether a sun six degrees outside the frame throws
 *     a veil across it depends on the coatings, the hood and the filter, none of
 *     which are measurable from here. The geometry is stated; the consequence is
 *     named as a risk and not as a number.
 *   - **No horizon.** Whether that patch of sky is blocked by a ridge is
 *     `skyline.ts`'s question, and it is asked separately so the two answers stay
 *     distinguishable — "outside the frame" and "behind a hill" are not the same
 *     reason to see nothing.
 *   - **No roll.** The camera is assumed level, so the frame's own horizontal is
 *     the world's. A tilted horizon rotates the rectangle and nothing here knows
 *     about it.
 *
 * Angles in degrees throughout, to match the rest of Scout. Tilt is positive up.
 */

import { destination, type LatLon } from './geo';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** Signed difference b−a, wrapped into (−180, 180]. */
export function angleDelta(a: number, b: number): number {
  const d = norm360(b - a);
  return d > 180 ? d - 360 : d;
}

/* ── Sensors ───────────────────────────────────────────────────────────────── */

export interface Sensor {
  key: string;
  label: string;
  /** Long edge of the imaging area, millimetres. */
  widthMm: number;
  /** Short edge, millimetres. */
  heightMm: number;
}

/**
 * The formats worth offering, with the full-frame one first because it is the
 * body this was built for (a7C II — 35.9 × 24.0 mm, Sony's own figure for the
 * effective area rather than the round 36 × 24 the format is named after).
 *
 * APS-C is here twice over: as the crop mode the same body shoots in, and as
 * every other camera with that sensor. Sony's APS-C is 23.5 × 15.6, which is a
 * 1.53× crop, not the 1.5 everyone quotes — small, but it is the kind of
 * rounding that turns "just inside the edge" into "just outside" it.
 */
export const SENSORS: Sensor[] = [
  { key: 'ff', label: 'Full frame (35mm)', widthMm: 35.9, heightMm: 24.0 },
  { key: 'apsc', label: 'APS-C / crop mode', widthMm: 23.5, heightMm: 15.6 },
  { key: 'mft', label: 'Micro Four Thirds', widthMm: 17.3, heightMm: 13.0 },
  { key: 'medium', label: 'Medium format (44×33)', widthMm: 43.8, heightMm: 32.9 },
  { key: 'phone', label: 'Phone main camera (1/1.28")', widthMm: 9.8, heightMm: 7.3 },
];

export const sensorByKey = (key: string): Sensor | undefined =>
  SENSORS.find((s) => s.key === key);

/** 35mm-equivalent focal length, for reading a crop-body number in familiar units. */
export function equivalentFocalLength(sensor: Sensor, focalLengthMm: number): number {
  const full = SENSORS[0];
  const cropFactor = Math.hypot(full.widthMm, full.heightMm) / Math.hypot(sensor.widthMm, sensor.heightMm);
  return focalLengthMm * cropFactor;
}

/** The focal lengths the picker offers. Primes, and the ends of the common zooms. */
export const FOCAL_LENGTHS = [12, 14, 16, 20, 24, 28, 35, 40, 50, 70, 85, 105, 135, 200, 300, 400];

/* ── The frame's angular size ──────────────────────────────────────────────── */

export type Orientation = 'landscape' | 'portrait';

export interface Fov {
  /** Across the frame, degrees. */
  horizontalDeg: number;
  /** Up the frame, degrees. */
  verticalDeg: number;
  /** Corner to corner — the number lens makers quote. */
  diagonalDeg: number;
}

/**
 * Angular field of view for a lens on a sensor.
 *
 * Rectilinear, and at the wide end that matters: the naive `d/f` small-angle
 * form is out by five degrees at 16mm, which is a whole ridge line. Portrait
 * simply swaps the two sensor edges — the lens does not change, the frame does.
 */
export function fieldOfView(
  sensor: Sensor,
  focalLengthMm: number,
  orientation: Orientation = 'landscape',
): Fov {
  if (!(focalLengthMm > 0)) throw new RangeError('focalLengthMm must be greater than zero');
  const across = orientation === 'portrait' ? sensor.heightMm : sensor.widthMm;
  const up = orientation === 'portrait' ? sensor.widthMm : sensor.heightMm;
  const angle = (edgeMm: number) => 2 * Math.atan(edgeMm / (2 * focalLengthMm)) * DEG;
  return {
    horizontalDeg: angle(across),
    verticalDeg: angle(up),
    diagonalDeg: angle(Math.hypot(across, up)),
  };
}

/* ── The wedge on the map ──────────────────────────────────────────────────── */

/**
 * The frame's footprint on the ground: a sector of `horizontalDeg` opening from
 * the pin along `bearing`, out to `rangeM`.
 *
 * A sector rather than the true ground trapezoid, because the trapezoid is only
 * honest if the camera is level and the world is flat, and neither is reliably
 * true where anyone scouts. What the sector claims is exactly what the geometry
 * supports: everything in this bearing range is across the frame somewhere.
 *
 * The arc is walked geodesically for the same reason the radius ring is — at
 * 50 km and 60°N a sector drawn in screen space visibly is not one.
 */
export function frameWedge(
  centre: LatLon,
  bearing: number,
  horizontalDeg: number,
  rangeM: number,
  steps = 48,
): GeoJSON.Feature<GeoJSON.Polygon> {
  if (!(rangeM > 0)) throw new RangeError('rangeM must be greater than zero');
  if (!(horizontalDeg > 0) || horizontalDeg >= 360) {
    throw new RangeError('horizontalDeg must be in (0, 360)');
  }
  if (!Number.isInteger(steps) || steps < 2) throw new RangeError('steps must be an integer ≥ 2');

  const half = horizontalDeg / 2;
  const ring: [number, number][] = [[centre.lon, centre.lat]];
  let previousLon = centre.lon;
  for (let i = 0; i <= steps; i++) {
    const point = destination(centre, bearing - half + (i / steps) * horizontalDeg, rangeM);
    // Keep the run continuous across the antimeridian, as `circleRing` does.
    let lon = point.lon;
    while (lon - previousLon > 180) lon -= 360;
    while (previousLon - lon > 180) lon += 360;
    previousLon = lon;
    ring.push([lon, point.lat]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return {
    type: 'Feature',
    properties: { horizontalDeg, rangeM, bearing: norm360(bearing) },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

/** The centre line of the frame — where the lens is actually pointed. */
export function frameAxis(
  centre: LatLon,
  bearing: number,
  rangeM: number,
): GeoJSON.Feature<GeoJSON.LineString> {
  const far = destination(centre, bearing, rangeM);
  return {
    type: 'Feature',
    properties: { bearing: norm360(bearing) },
    geometry: { type: 'LineString', coordinates: [[centre.lon, centre.lat], [far.lon, far.lat]] },
  };
}

/* ── Is it in the picture? ─────────────────────────────────────────────────── */

export interface Aim {
  /** Where the lens points, degrees clockwise from true north. */
  bearing: number;
  /** How far up from level, degrees. Positive up. */
  tiltDeg: number;
}

export interface SkyTarget {
  azimuth: number;
  altitude: number;
}

export type FramePlacement =
  /** Inside the rectangle, and not near an edge. */
  | 'in-frame'
  /** Inside, but within a couple of degrees of an edge — the model's own error. */
  | 'edge'
  /** Outside, but close enough to throw light across the front element. */
  | 'just-outside'
  /** Outside the frame, still in front of the camera. */
  | 'outside'
  /** More than 90° off the aim — behind the photographer. */
  | 'behind';

/**
 * How close to an edge counts as "on" it.
 *
 * Set from this model's own error rather than from taste: ignoring distortion
 * costs about a degree at the corner of a wide lens, so anything inside that is
 * a claim the arithmetic cannot support.
 */
export const EDGE_TOLERANCE_DEG = 1.5;

/**
 * How far outside the frame the sun still reaches the front element.
 *
 * Not a lens measurement — it cannot be one from here. It is the width of the
 * band where photographers habitually get veiling flare, which is worth flagging
 * precisely because the frame test alone says "no" and the photograph says
 * otherwise.
 */
export const FLARE_BAND_DEG = 12;

/* ── Onto the image plane ──────────────────────────────────────────────────── */

const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);

export interface FrameOffsets {
  /** Across the frame from its centre, degrees. Positive right. */
  acrossDeg: number;
  /** Up the frame from its centre, degrees. Positive up. */
  upDeg: number;
  /** In front of the camera at all. Everything else is meaningless without it. */
  ahead: boolean;
}

/**
 * Where a direction in the sky lands on the frame, as two angles from its centre.
 *
 * The naive version of this — difference the azimuths, difference the altitudes —
 * is what the frame test used to do, and it is only right for a level camera
 * looking at something near the horizon. Two things break it:
 *
 *   - **Azimuth is not a distance.** Meridians converge, so a degree of azimuth
 *     is `cos(altitude)` of a degree of sky. Point a 10° lens at a subject 85°
 *     up and things ninety degrees away in azimuth are *five degrees* across the
 *     frame, not out of the picture. That is not an exotic case: it is the
 *     Milky Way core from anywhere it is worth photographing.
 *   - **Tilt swings the frame's own axes.** Tilt up 45° and the horizon 20° off
 *     the aim sits 27° across the frame, because the frame's horizontal is no
 *     longer a line of constant altitude.
 *
 * So the aim is turned into a camera basis — forward, right, up — the target
 * into a unit vector, and the two angles read off the image plane the way the
 * lens actually projects them. Exact for a rectilinear lens with no roll, which
 * is the model this module already declares.
 */
export function projectToFrame(target: SkyTarget, aim: Aim): FrameOffsets {
  const dAz = angleDelta(aim.bearing, target.azimuth);
  const ch = cos(target.altitude);
  const sh = sin(target.altitude);
  const ct = cos(aim.tiltDeg);
  const st = sin(aim.tiltDeg);

  // Components of the target in the camera's own frame. `right` stays level —
  // that is the no-roll assumption, and the only place it enters.
  const right = ch * sin(dAz);
  const forward = ct * ch * cos(dAz) + st * sh;
  const up = ct * sh - st * ch * cos(dAz);

  return {
    acrossDeg: Math.atan2(right, forward) * DEG,
    upDeg: Math.atan2(up, forward) * DEG,
    ahead: forward > 0,
  };
}

export interface FrameCheck {
  placement: FramePlacement;
  inFrame: boolean;
  /** Signed offset across the frame; positive is right of centre. */
  horizontalOffsetDeg: number;
  /** Signed offset up the frame; positive is above centre. */
  verticalOffsetDeg: number;
  /**
   * Degrees from the nearest frame edge. Negative inside, positive outside —
   * so the sign alone answers the question and the magnitude says how safely.
   */
  edgeGapDeg: number;
  /**
   * The tilt that would just bring the target onto the top or bottom edge, or
   * null when no tilt can (it is outside the frame horizontally, so the camera
   * would have to turn, not tilt).
   */
  tiltToIncludeDeg: number | null;
  /** Outside the frame but inside the flare band. */
  flareRisk: boolean;
  /** Whole sentence, for the panel. */
  note: string;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Round a tilt to a tenth of a degree in the direction that keeps its promise.
 *
 * A tilt is offered as "do this and the sun is in shot". Rounded to the nearest
 * tenth it can land a hundredth of a degree short, and then the number the panel
 * printed is one that does not work — the one failure mode this whole function
 * exists to prevent. So it always rounds *further* into the frame.
 */
const roundTiltInward = (v: number, upward: boolean) =>
  upward ? Math.ceil(v * 10) / 10 : Math.floor(v * 10) / 10;

/**
 * Where a body in the sky falls relative to the frame.
 *
 * The offsets come from `projectToFrame`, so the rectangle is tested on the
 * image plane rather than on the azimuth grid — see that function for why the
 * difference is not academic. Horizontal and vertical are then tested
 * independently, because the rectangle is a rectangle and not a cone, which is
 * why the reported gap is the larger of the two overruns and not their
 * hypotenuse.
 */
export function checkFraming(target: SkyTarget, aim: Aim, fov: Fov): FrameCheck {
  const { acrossDeg, upDeg, ahead } = projectToFrame(target, aim);
  const halfH = fov.horizontalDeg / 2;
  const halfV = fov.verticalDeg / 2;

  // Overrun past each edge: negative means inside on that axis.
  const overH = Math.abs(acrossDeg) - halfH;
  const overV = Math.abs(upDeg) - halfV;
  const inside = ahead && overH <= 0 && overV <= 0;
  // Inside, the gap to the nearest edge is whichever axis is tightest, so the
  // less negative of the two. Outside, it is whichever axis has escaped
  // furthest — clearing one edge is enough to be out of the picture.
  const edgeGapDeg = Math.max(overH, overV);

  const tiltToIncludeDeg = inside ? null : tiltToInclude(target, aim, fov, upDeg);

  let placement: FramePlacement;
  if (inside) placement = edgeGapDeg > -EDGE_TOLERANCE_DEG ? 'edge' : 'in-frame';
  else if (!ahead) placement = 'behind';
  else if (edgeGapDeg <= FLARE_BAND_DEG) placement = 'just-outside';
  else placement = 'outside';

  return {
    placement,
    inFrame: inside,
    horizontalOffsetDeg: round1(acrossDeg),
    verticalOffsetDeg: round1(upDeg),
    edgeGapDeg: round1(edgeGapDeg),
    tiltToIncludeDeg,
    flareRisk: placement === 'just-outside' || placement === 'edge',
    note: framingNote(placement, acrossDeg, upDeg, edgeGapDeg, overH >= overV, tiltToIncludeDeg),
  };
}

/**
 * The tilt that would just bring the target onto the top or bottom edge — or
 * null, when no tilt can.
 *
 * Solved rather than searched. Writing the up-angle as `atan2(y, z)` with the
 * tilt's sine and cosine pulled out gives `tan(t) = (B − kA)/(A + kB)`, where
 * `A` and `B` are the target's components in and out of the horizontal plane
 * and `k` is the tangent of the edge being aimed for.
 *
 * Then it is **checked before it is offered**, which the closed form alone does
 * not settle: tilting also swings the frame's horizontal axis, so a tilt that
 * fixes the vertical can leave the target outside sideways. Rather than reason
 * about when that happens, apply the answer and look. A tilt this function
 * returns is one that demonstrably works.
 */
function tiltToInclude(target: SkyTarget, aim: Aim, fov: Fov, upDeg: number): number | null {
  const dAz = angleDelta(aim.bearing, target.azimuth);
  const A = cos(target.altitude) * cos(dAz);
  const B = sin(target.altitude);
  const upward = upDeg >= 0;
  const k = Math.tan(((upward ? 1 : -1) * fov.verticalDeg) / 2 * RAD);

  const exact = Math.atan2(B - k * A, A + k * B) * DEG;
  if (!Number.isFinite(exact)) return null;
  const rounded = roundTiltInward(exact, upward);

  const { acrossDeg, upDeg: landedUp, ahead } = projectToFrame(target, {
    bearing: aim.bearing,
    tiltDeg: rounded,
  });
  const fits =
    ahead && Math.abs(acrossDeg) <= fov.horizontalDeg / 2 && Math.abs(landedUp) <= fov.verticalDeg / 2;
  return fits ? rounded : null;
}

const side = (d: number) => (d >= 0 ? 'right' : 'left');

/**
 * `horizontalEscape` says which axis the target left the frame by, and the note
 * names *that* edge. It used to always name a side, which read as nonsense for
 * a sun straight above the frame — and with the projection fixed the vertical
 * axis is now the one that overruns more often than not.
 */
function framingNote(
  placement: FramePlacement,
  acrossDeg: number,
  upDeg: number,
  gap: number,
  horizontalEscape: boolean,
  tilt: number | null,
): string {
  const across = `${Math.abs(round1(acrossDeg))}° ${side(acrossDeg)} of centre`;
  const edge = horizontalEscape
    ? `past the ${side(acrossDeg)} edge`
    : `${upDeg >= 0 ? 'above the top' : 'below the bottom'} edge`;
  const tiltTo = tilt == null ? '' : ` Tilt to ${tilt >= 0 ? '+' : ''}${tilt}° to include it.`;
  switch (placement) {
    case 'in-frame':
      return `In frame — ${across}, ${Math.abs(round1(upDeg))}° ${upDeg >= 0 ? 'above' : 'below'} it, with ${Math.abs(round1(gap))}° to the nearest edge.`;
    case 'edge':
      return `On the frame edge — inside by ${Math.abs(round1(gap))}°, which is inside this model's own error. Treat it as either.`;
    case 'just-outside':
      return tilt == null
        ? `Just outside, ${round1(gap)}° ${edge}. Close enough to flare across the frame.`
        : `Just outside by ${round1(gap)}°, ${edge}.${tiltTo} Or leave it there to flare.`;
    case 'outside':
      return tilt == null
        ? `Out of frame, ${round1(gap)}° ${edge}. It lights the scene without being in it.`
        : `Out of frame, ${round1(gap)}° ${edge}.${tiltTo}`;
    case 'behind':
      // Deliberately says nothing about the *kind* of light any more. It used
      // to add "front-lighting whatever you are pointed at", which is a claim
      // about the light rather than about the frame, made off this function's
      // 90° behind-the-camera test. `lighting.ts` now answers that question on
      // its own three-way split, and prints its answer on the very next line —
      // so at 132° off aim the two sat one above the other saying "front" and
      // "side" about the same sun. One question, one owner.
      return `Behind you — ${Math.abs(round1(acrossDeg))}° off the aim, so it is not in the picture.`;
  }
}

/* ── Presentation ──────────────────────────────────────────────────────────── */

/** "24mm · 74° × 53°" — the lens, and what it actually covers. */
export function describeLens(sensor: Sensor, focalLengthMm: number, fov: Fov): string {
  const equivalent = equivalentFocalLength(sensor, focalLengthMm);
  const head =
    sensor.key === 'ff'
      ? `${focalLengthMm}mm`
      : `${focalLengthMm}mm (${Math.round(equivalent)}mm equiv.)`;
  return `${head} · ${Math.round(fov.horizontalDeg)}° × ${Math.round(fov.verticalDeg)}°`;
}

/**
 * How wide the frame is on the ground at a distance — "at 2.4 km this covers
 * 3.6 km across".
 *
 * The flat-earth chord, which is what a frame across a valley actually spans.
 * Curvature would matter at a hundred kilometres and nothing is composed at a
 * hundred kilometres.
 */
export function frameWidthAt(fov: Fov, distanceM: number): number {
  return 2 * distanceM * Math.tan((fov.horizontalDeg / 2) * RAD);
}
