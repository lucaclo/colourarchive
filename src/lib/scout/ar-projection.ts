/**
 * Sky direction → screen position, for the live camera AR overlay.
 *
 * `frame.ts` already answers "is this direction in the picture", built for the
 * wedge on the map and the framing readout in the panel. Issue #72 asks the same
 * question with a different destination: not a note in the panel, but a marker
 * on a `<video>` element showing the phone's own camera feed. This module is the
 * thin adapter between the two — it does not re-derive the camera-basis
 * projection, it calls straight into `projectToFrame`/`checkFraming` and turns
 * the result into `[0,1]×[0,1]` video-element coordinates.
 *
 * **The mapping from angle to screen position is `tan`, not linear.** For a
 * rectilinear lens, `projectToFrame`'s `acrossDeg`/`upDeg` are `atan2` of a
 * point's position on the image plane against the optical axis — which means
 * the image-plane offset itself is `tan(acrossDeg)`, not `acrossDeg`. The
 * frame's own edges sit at `tan(halfFovDeg)` for the same reason (see
 * `fieldOfView`'s `2·atan(d/2f)`). Treating degrees as a linear fraction of the
 * field of view would be the same small-angle mistake `fieldOfView` already
 * refuses to make at the wide end — small near the centre, and growing toward
 * the edges of a wide lens, which is exactly where an AR overlay most needs to
 * be right.
 *
 * **What lens this is projected through, in AR mode:** the phone's camera has
 * a real field of view this API cannot read — `getUserMedia`'s
 * `MediaTrackSettings` exposes resolution and facing mode, never degrees — so
 * there is nothing here to measure it against. Rather than guess one, the view
 * layer draws the overlay against the same `Fov` the rest of Scout already
 * computes from the chosen sensor and focal length (`fieldOfView` in
 * `frame.ts`), and says so on screen: the marker is honest about *that* lens,
 * and may not track the video pixel-for-pixel if the phone's real camera sees
 * a wider or narrower angle than the one selected.
 *
 * Reuses `frame.ts`'s own `Aim`, `Fov` and `SkyTarget` types rather than
 * inventing parallel ones — an aim from a live compass reading is still an
 * `Aim`, and the sun is still a `SkyTarget` whether it is bound for the map's
 * wedge or a phone's screen.
 */

import { checkFraming, projectToFrame, type Aim, type Fov, type SkyTarget } from './frame';
// The `''|left|right|top|bottom` shape already exists for `frameRegion`'s
// overflow/shortfall edges — reused rather than redeclared, same reasoning as
// reusing `Aim`/`Fov`/`SkyTarget` from `frame.ts` itself.
import type { FrameEdge } from './astrophoto';

const RAD = Math.PI / 180;

/** A target that lands inside the frame, in video-element coordinates. */
export interface OnScreenTarget {
  onScreen: true;
  /** 0 at the video's left edge, 1 at its right. */
  x: number;
  /** 0 at the video's top edge, 1 at its bottom — screen convention, not sky convention (`upDeg` is positive up; `y` grows downward). */
  y: number;
}

/**
 * A target outside the frame.
 *
 * Never silently dropped, clamped to an edge, or omitted — the issue's own
 * requirement, and the same refusal `frame.ts`'s `edgeGapDeg` already states
 * for the panel: how far outside is the answer, not whether.
 */
export interface OffScreenTarget {
  onScreen: false;
  /** Degrees past the nearest frame edge. Always positive here. */
  edgeGapDeg: number;
  /**
   * Which edge that gap is measured from — the same axis-with-the-larger-
   * overrun choice `checkFraming`'s `edgeGapDeg` itself is built from, so a
   * caller drawing an arrow toward this edge and one printing `edgeGapDeg`
   * can never point at different axes.
   */
  edge: FrameEdge;
  /** `frame.ts`'s own sentence for this placement — already names the edge. */
  note: string;
}

export type ScreenPlacement = OnScreenTarget | OffScreenTarget;

/**
 * Where a direction in the sky lands on screen, for the given aim and field of
 * view.
 *
 * `checkFraming` decides on/off screen — its `inFrame` already carries the
 * model's own edge tolerance (`EDGE_TOLERANCE_DEG`), so a target the panel
 * would call "on the edge" is drawn on screen here too, at the edge, rather
 * than the two disagreeing about the same target. The on-screen position
 * itself is read off `projectToFrame` directly rather than off `checkFraming`'s
 * `horizontalOffsetDeg`/`verticalOffsetDeg`, which are rounded to a tenth of a
 * degree for the panel's prose and would visibly step a marker moving smoothly
 * across the screen.
 */
export function projectToScreen(target: SkyTarget, aim: Aim, fov: Fov): ScreenPlacement {
  const check = checkFraming(target, aim, fov);
  const { acrossDeg, upDeg } = projectToFrame(target, aim);
  const halfH = fov.horizontalDeg / 2;
  const halfV = fov.verticalDeg / 2;

  if (!check.inFrame) {
    // Same choice `checkFraming` makes internally for `edgeGapDeg`: whichever
    // axis has escaped furthest is the one that decides which edge this is
    // "outside" of. A rectangle has two edges it could be past at once near a
    // corner, and this picks the one that actually explains the distance.
    const overH = Math.abs(acrossDeg) - halfH;
    const overV = Math.abs(upDeg) - halfV;
    const edge: FrameEdge = overH >= overV ? (acrossDeg >= 0 ? 'right' : 'left') : upDeg >= 0 ? 'top' : 'bottom';
    return { onScreen: false, edgeGapDeg: Math.max(0, check.edgeGapDeg), edge, note: check.note };
  }

  const x = 0.5 + 0.5 * (Math.tan(acrossDeg * RAD) / Math.tan(halfH * RAD));
  const y = 0.5 - 0.5 * (Math.tan(upDeg * RAD) / Math.tan(halfV * RAD));

  // A safety clamp, not a correction: `check.inFrame` already guarantees
  // |acrossDeg| ≤ halfH and |upDeg| ≤ halfV, so x and y are mathematically
  // within [0,1] already. This only catches the floating-point residue right
  // at the boundary, the same class of residue `driftRateDegPerSec` and
  // `depthOfField` already guard against elsewhere in this project.
  return { onScreen: true, x: clamp01(x), y: clamp01(y) };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
