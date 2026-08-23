/**
 * The live camera AR overlay — issue #72.
 *
 * `frame.ts` already has the geometry a PhotoPills-style overlay needs: the
 * camera-basis projection that answers "is this direction in the picture".
 * `../ar-projection.ts` turns that into a screen position. This file is the
 * rest of it — the part that touches `getUserMedia`, `DeviceOrientationEvent`
 * and a `<canvas>`, none of which are unit tested here, matching the
 * precedent `dome-layer.ts` and `shadow-layer.ts` already set for this
 * project: the coordinate math is pure and tested (`ar-projection.test.ts`),
 * the DOM/sensor plumbing around it is not, because there is nothing to
 * assert against without a real device and a real camera.
 *
 * Self-contained the way `month-grid.ts` is: it owns the `#ar-view` sheet and
 * everything inside it, reached through `Ports` for the things it cannot know
 * on its own — the current sun, moon and core positions, and the field of
 * view to project them through — so this module never reaches into the
 * page's state and the page never reaches into this one's.
 *
 * ## What the aim is, in AR mode
 *
 * Everywhere else on this page, `lens.bearing`/`lens.tiltDeg` are a control
 * someone drags. That is backwards for a live camera view: the whole point is
 * that the phone tells you where it is pointed, so AR mode's aim comes from
 * the device's own compass and tilt sensors, sampled continuously, and never
 * from the manually-dragged control. It does **not** write back to
 * `lens.bearing`/`lens.tiltDeg` — those keep whatever the panel's sliders
 * last said, so closing the AR view puts the map's wedge back where it was
 * rather than wherever the phone last happened to point. What AR mode *does*
 * borrow from the panel's lens controls, through `Ports.fov()`, is the field
 * of view — `lens.sensor` and `lens.focalLengthMm`, via the same
 * `fieldOfView` the wedge and the framing readout already use, because a
 * sensor and a focal length are still a fact about the body in your hand and
 * not something a phone's own sensors can tell you.
 *
 * ## Why the field of view is the chosen lens's, not the phone's own
 *
 * `getUserMedia`'s `MediaTrackSettings` reports resolution and facing mode,
 * never an angle. There is no API that hands back the rear camera's real
 * field of view, so there is nothing to project the sky through except the
 * one this project already computes. The marker positions are therefore
 * honest about *that* lens, not about whatever angle the phone's camera
 * actually captures, and `AR_LIMITS_NOTE` says so on screen rather than
 * implying a precision the video feed cannot back up. A wider real camera
 * than the configured lens shows markers converging toward the centre of a
 * wider picture than they claim to describe; a narrower one, the reverse.
 * This is a second, separate limit from `frame.ts`'s own "no lens
 * distortion" — that one is about the shape of the projection, this one is
 * about not knowing the video's angle at all.
 *
 * ## iOS vs. everyone else
 *
 * Two incompatible ways to learn where north is, both live on
 * `DeviceOrientationEvent`, and a browser offers exactly one of them:
 *
 *   - **iOS Safari** adds a non-standard `webkitCompassHeading` to every
 *     `deviceorientation` event: degrees clockwise from north directly, no
 *     `absolute` flag required. It does not correct for device tilt in any
 *     way the page can inspect — it is Apple's own compass reading — and
 *     whether it is true or magnetic north is Apple's call, not measurable
 *     from here, so it is used as given and not corrected further.
 *   - **Everywhere else**, `alpha`/`beta`/`gamma` are the device's rotation
 *     against its own starting orientation unless the event is *absolute*
 *     (`event.absolute === true`, or the dedicated `deviceorientationabsolute`
 *     event some browsers fire instead) — only then is `alpha` anchored to
 *     the compass at all. Even anchored, `alpha` alone is only a heading when
 *     the device is flat: tilt the device — which describing a sky position
 *     is the entire point of doing — and `alpha` becomes a 2D projection of a
 *     3D rotation onto the wrong plane. The fix is the W3C DeviceOrientation
 *     Event Specification's own worked example ("compute compass heading"):
 *     build the rotation from all three angles and read the heading off its
 *     horizontal component, in `compassHeadingFromAbsolute` below. Ported
 *     from the spec's own `Vx`/`Vy` construction rather than rederived by
 *     feel.
 *
 * Device *tilt* — how far the lens points above or below level — comes from
 * `beta` alone in both branches, under the same assumption `frame.ts` already
 * states for its whole model: **no roll.** Held upright in portrait with the
 * screen facing you and the back camera facing away, `beta = 90°` is level,
 * and `tiltDeg = beta − 90` tracks the camera tipping up past that or down
 * below it. A phone rotated into landscape, or rolled sideways while
 * shooting, is exactly the case `frame.ts` already declines to model, and
 * this inherits that limit rather than pretending to correct for it.
 *
 * ## Two permission gates, both explicit
 *
 * `getUserMedia` needs a secure context (HTTPS) and a camera permission
 * grant; iOS 13+ additionally gates `DeviceOrientationEvent` behind
 * `requestPermission()`, callable only from a user gesture. Orientation is
 * requested *first*, as literally the first `await` in `open()`'s call — the
 * more narrowly-scoped of the two gestures, by report, and the one likelier
 * to reject if a microtask has already passed since the tap. Every way either
 * can fail — insecure context, no camera, permission denied, no orientation
 * sensors, orientation permission denied, the API missing entirely (desktop)
 * — sets a plain-language status message rather than leaving a blank video
 * element for someone to wonder about.
 */

import type { Fov, SkyTarget } from '../frame';
import { projectToScreen, type ScreenPlacement } from '../ar-projection';
import { $, on } from './dom';

/* ── Compass heading from a tilted device ─────────────────────────────────
   The W3C DeviceOrientation Event Specification's own worked example for
   "compute compass heading", ported as-is rather than approximated. `alpha`
   alone is only a heading when beta and gamma are both zero; this is the
   general form for an arbitrarily tilted device. */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * Degrees clockwise from north, from an *absolute* orientation reading.
 *
 * Only meaningful when the event's `alpha` is actually anchored to the
 * compass — callers gate this on `event.absolute === true` or on receiving a
 * `deviceorientationabsolute` event, never on a plain relative
 * `deviceorientation` event, where `alpha` starts at zero wherever the page
 * happened to load.
 */
function compassHeadingFromAbsolute(alphaDeg: number, betaDeg: number, gammaDeg: number): number {
  const x = betaDeg * RAD;
  const y = gammaDeg * RAD;
  const z = alphaDeg * RAD;
  // No `cos(x)` term: the spec's own Vx/Vy construction never uses one — the
  // rotation's x-component drops out when reading the heading off the
  // horizontal plane alone, which is the whole reason this needs beta and
  // gamma at all rather than just being `90 − alpha`.
  const cY = Math.cos(y);
  const cZ = Math.cos(z);
  const sX = Math.sin(x);
  const sY = Math.sin(y);
  const sZ = Math.sin(z);

  // The compass vector's components in the world's horizontal plane.
  const vx = -cZ * sY - sZ * sX * cY;
  const vy = -sZ * sY + cZ * sX * cY;

  let heading = Math.atan(vx / vy);
  if (vy < 0) heading += Math.PI;
  else if (vx < 0) heading += 2 * Math.PI;
  return heading * DEG;
}

/** Camera tilt from level. See the header for why this is `beta` alone. */
const tiltFromBeta = (betaDeg: number): number => betaDeg - 90;

/**
 * The sentence the AR view states once, on open, and leaves on screen — the
 * two limits this module cannot get around: `frame.ts`'s own rectilinear
 * model, and not knowing the phone's real field of view.
 */
export const AR_LIMITS_NOTE =
  'Rectilinear projection, no lens distortion — same model as the frame wedge on the map. ' +
  'Markers are positioned for the sensor and focal length chosen in the frame panel, not the ' +
  "phone's actual camera angle, which this page cannot measure.";

/**
 * How long to wait for a first orientation event before calling the sensor
 * missing rather than merely slow.
 *
 * Some browsers accept the `deviceorientation` listener silently and then
 * never fire it — no error, no rejected promise, nothing distinguishing "this
 * device has no compass" from "the event has not arrived yet". A dead
 * listener would leave the status stuck on "starting" forever, which reads
 * as a hang rather than the refusal it actually is.
 */
const ORIENTATION_TIMEOUT_MS = 2500;

export interface ArCameraPorts {
  /** The lens's angular size, from `fieldOfView` — see the header for why
   * this is the configured lens's, not the phone camera's own. */
  fov(): Fov;
  sun(): SkyTarget | null;
  moon(): SkyTarget | null;
  core(): SkyTarget | null;
}

export interface ArCameraView {
  /** Must be called from a user gesture — both permission prompts need one. */
  open(): void;
  close(): void;
  /** Call when the sun/moon/core positions or the field of view change while open. */
  refresh(): void;
}

interface Aim {
  bearing: number;
  tiltDeg: number;
}

const MARKER_STYLE: Record<'sun' | 'moon' | 'core', { colour: string; label: string; radius: number }> = {
  sun: { colour: '#ffb300', label: 'Sun', radius: 16 },
  moon: { colour: '#c9d6e3', label: 'Moon', radius: 12 },
  core: { colour: '#7b6ee0', label: 'Core', radius: 10 },
};

export function createArCamera(ports: ArCameraPorts): ArCameraView {
  const view = () => $<HTMLElement>('ar-view');
  const video = () => $<HTMLVideoElement>('ar-video');
  const canvas = () => $<HTMLCanvasElement>('ar-canvas');
  const statusEl = () => $<HTMLElement>('ar-status');

  let stream: MediaStream | null = null;
  let orientationHandler: ((event: DeviceOrientationEvent) => void) | null = null;
  let orientationEventName: 'deviceorientationabsolute' | 'deviceorientation' = 'deviceorientation';
  let resizeObserver: ResizeObserver | null = null;
  let aim: Aim | null = null;
  let running = false;
  /** True between `open()` being called and it settling, either way. */
  let starting = false;
  /**
   * Bumped by `close()` to invalidate an `open()` still in flight — see
   * `close()`'s own comment for why a boolean is not enough here.
   */
  let openToken = 0;
  /**
   * Redraws on its own, independent of a sensor event.
   *
   * `Ports.sun()`/`moon()`/`core()` are computed for the real "now" at every
   * `draw()`, not for the slider's chosen minute — the whole reason for this
   * view existing is that it points at the real sky, not a simulated one. An
   * orientation event already invalidates on every reading, but a phone held
   * still sends no such event, and the sun does not hold still to match — a
   * few minutes of a fixed shot would otherwise show a marker frozen at the
   * moment the view opened. Five seconds, not sixty: the same reasoning
   * `page.ts`'s own "Now" ticker gives for its ten — a beat that lags
   * noticeably reads as broken, not as economical.
   */
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  /* ── One frame, one pass — the same dirty-flag/rAF batching page.ts's
     `invalidate`/`runFrame` uses for the slider. Orientation events can fire
     far faster than the screen refreshes (some devices push 60 a second);
     redrawing the canvas synchronously on every one would be the identical
     mistake that once stuck the time slider, for the identical reason: the
     work does not need to happen more often than the screen can show it. */
  let frameHandle = 0;
  function invalidate() {
    if (!frameHandle) frameHandle = requestAnimationFrame(runFrame);
  }
  function runFrame() {
    frameHandle = 0;
    draw();
  }

  function setStatus(message: string) {
    statusEl().textContent = message;
    statusEl().hidden = !message;
  }

  function stopTracks() {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    video().srcObject = null;
  }

  function removeOrientationListener() {
    if (orientationHandler) window.removeEventListener(orientationEventName, orientationHandler as EventListener);
    orientationHandler = null;
  }

  function close() {
    // Invalidates any `open()` still awaiting a permission prompt: when it
    // resumes it will find `token !== openToken`, tear down whatever it just
    // acquired instead of declaring itself running, and leave `starting`
    // clear on its own. Without this, closing mid-prompt and reopening could
    // still leave the *first* attempt's camera stream live in the
    // background once its `getUserMedia` finally resolved — the light stays
    // on with nothing on screen to explain why.
    openToken++;
    view().hidden = true;
    running = false;
    stopTracks();
    removeOrientationListener();
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (frameHandle) cancelAnimationFrame(frameHandle);
    frameHandle = 0;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    aim = null;
  }

  /** Camera permission and the video feed. Explicit about every failure. */
  async function startCamera(): Promise<void> {
    if (!window.isSecureContext) {
      throw new Error('Camera access needs HTTPS — this page was not loaded over a secure connection.');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser has no camera API. Try a recent Chrome or Safari on a phone.');
    }
    try {
      // Not `{ exact: 'environment' }`: a laptop with no rear camera would
      // refuse outright rather than falling back to whatever camera it has,
      // and a webcam preview is still more useful than a hard failure here.
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError') {
        throw new Error('Camera permission was denied. Allow it in your browser settings and try again.', { cause: err });
      }
      if (name === 'NotFoundError') throw new Error('No camera was found on this device.', { cause: err });
      if (name === 'OverconstrainedError') {
        throw new Error('No camera on this device satisfies the request.', { cause: err });
      }
      throw new Error(`Camera access failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    video().srcObject = stream;
    await video().play();

    // The rear-camera request is a preference, not a guarantee — a device
    // with only a front camera silently receives that instead, and someone
    // holding the phone up to the sky would otherwise have no idea why the
    // markers do not agree with the picture.
    const track = stream.getVideoTracks()[0];
    const facing = track?.getSettings().facingMode;
    if (facing && facing !== 'environment') {
      setStatus(`This device gave the "${facing}" camera, not the rear one — the overlay will not point where the picture does.`);
    }
  }

  /** Orientation permission (iOS 13+) and the live heading/tilt. */
  async function startOrientation(): Promise<void> {
    const ctor = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof ctor?.requestPermission === 'function') {
      let permission: 'granted' | 'denied';
      try {
        permission = await ctor.requestPermission();
      } catch (err) {
        throw new Error(`Orientation permission request failed: ${err instanceof Error ? err.message : String(err)}`, {
          cause: err,
        });
      }
      if (permission !== 'granted') {
        throw new Error('Orientation permission was denied — the overlay needs the compass to know where the phone is pointed.');
      }
    } else if (typeof DeviceOrientationEvent === 'undefined') {
      throw new Error('This browser has no orientation sensors API. AR mode needs a phone.');
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        removeOrientationListener();
        reject(new Error('No orientation reading arrived — this device may have no compass, or the browser is blocking it.'));
      }, ORIENTATION_TIMEOUT_MS);

      const handle = (event: DeviceOrientationEvent) => {
        // iOS: `webkitCompassHeading` is a direct compass reading, degrees
        // clockwise from north, and needs no `absolute` flag — see the header.
        const webkitHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
          .webkitCompassHeading;
        let heading: number | null = null;
        if (typeof webkitHeading === 'number' && Number.isFinite(webkitHeading)) {
          heading = webkitHeading;
        } else if (event.absolute && event.alpha != null && event.beta != null && event.gamma != null) {
          heading = compassHeadingFromAbsolute(event.alpha, event.beta, event.gamma);
        }
        if (heading == null || event.beta == null) return; // Not yet anchored to the compass — wait for one that is.

        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve();
        }
        aim = { bearing: ((heading % 360) + 360) % 360, tiltDeg: tiltFromBeta(event.beta) };
        invalidate();
      };

      orientationHandler = handle;
      // `deviceorientationabsolute` is Chrome/Android's dedicated event for
      // exactly this — a plain `deviceorientation` there is not guaranteed to
      // be earth-anchored at all. iOS has neither the event nor `absolute`
      // set true, and is caught by `webkitCompassHeading` above regardless of
      // which event name is listened for, so trying the absolute event first
      // and falling back costs nothing on iOS and gains the guarantee
      // everywhere else.
      orientationEventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
      window.addEventListener(orientationEventName, handle as EventListener);
    });
  }

  function open() {
    // A second tap while the first is still requesting permissions would
    // attach a second orientation listener on top of the first's — the guard
    // that matters here is not cosmetic, it is the difference between one
    // compass reading driving the overlay and two racing to overwrite `aim`.
    if (running || starting) return;
    starting = true;
    const token = ++openToken;
    view().hidden = false;
    setStatus('Starting…');
    void (async () => {
      try {
        // Orientation first — see the header for why the ordering matters.
        await startOrientation();
        if (token !== openToken) throw new Error('cancelled');
        await startCamera();
        if (token !== openToken) throw new Error('cancelled');
        if (!resizeObserver) {
          resizeObserver = new ResizeObserver(() => {
            canvas().width = video().clientWidth * devicePixelRatio;
            canvas().height = video().clientHeight * devicePixelRatio;
            invalidate();
          });
          resizeObserver.observe(video());
        }
        running = true;
        setStatus('');
        invalidate();
        refreshTimer = setInterval(invalidate, 5000);
      } catch (err) {
        running = false;
        if (token === openToken) {
          setStatus(err instanceof Error ? err.message : String(err));
        } else {
          // Cancelled by a `close()` during startup, not a real failure —
          // tear down whatever this attempt just acquired rather than
          // leaving a camera stream or a compass listener running behind a
          // view the user already dismissed.
          stopTracks();
          removeOrientationListener();
        }
      } finally {
        starting = false;
      }
    })();
  }

  function refresh() {
    invalidate();
  }

  function draw() {
    const ctx = canvas().getContext('2d');
    const w = canvas().width;
    const h = canvas().height;
    if (!ctx || !w || !h) return;
    ctx.clearRect(0, 0, w, h);
    if (!aim || !running) return;

    drawCrosshair(ctx, w, h);

    const fov = ports.fov();
    const bodies: Array<['sun' | 'moon' | 'core', SkyTarget | null]> = [
      ['sun', ports.sun()],
      ['moon', ports.moon()],
      ['core', ports.core()],
    ];
    for (const [name, target] of bodies) {
      if (!target || !(fov.horizontalDeg > 0)) continue;
      drawMarker(ctx, w, h, name, projectToScreen(target, aim, fov));
    }
  }

  on('ar-close', 'click', close);
  // Static, and stated once — see `AR_LIMITS_NOTE`'s own comment for why this
  // is the one place that sentence is written.
  $<HTMLElement>('ar-note').textContent = AR_LIMITS_NOTE;

  return { open, close, refresh };
}

/** A small crosshair at the exact centre — where the aim itself points. */
function drawCrosshair(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.02;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = Math.max(1, w * 0.0015);
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  body: 'sun' | 'moon' | 'core',
  placement: ScreenPlacement,
) {
  const style = MARKER_STYLE[body];
  ctx.fillStyle = style.colour;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.font = `${Math.round(Math.min(w, h) * 0.03)}px sans-serif`;
  ctx.textBaseline = 'middle';

  if (placement.onScreen) {
    const x = placement.x * w;
    const y = placement.y * h;
    const r = style.radius * (w / 1000);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillText(style.label, x + r + 6, y);
    return;
  }

  // Off screen: a chevron at the edge nearest the target, pointing toward it,
  // labelled with the gap in degrees — never a silent omission. The gap is
  // `frame.ts`'s own `edgeGapDeg`, unrounded here only by the canvas's own
  // pixel rounding.
  const margin = Math.min(w, h) * 0.06;
  let x = w / 2;
  let y = h / 2;
  let rotation = 0;
  if (placement.edge === 'left') {
    x = margin;
    rotation = Math.PI;
  } else if (placement.edge === 'right') {
    x = w - margin;
    rotation = 0;
  } else if (placement.edge === 'top') {
    y = margin;
    rotation = -Math.PI / 2;
  } else if (placement.edge === 'bottom') {
    y = h - margin;
    rotation = Math.PI / 2;
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  const s = Math.min(w, h) * 0.02;
  ctx.beginPath();
  ctx.moveTo(-s, -s);
  ctx.lineTo(s, 0);
  ctx.lineTo(-s, s);
  ctx.closePath();
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const label = `${style.label} ${Math.round(placement.edgeGapDeg)}°`;
  ctx.textAlign = placement.edge === 'left' ? 'left' : placement.edge === 'right' ? 'right' : 'center';
  const labelX = placement.edge === 'left' ? x + s * 2 : placement.edge === 'right' ? x - s * 2 : x;
  const labelY = y + (placement.edge === 'top' ? s * 3 : placement.edge === 'bottom' ? -s * 3 : 0);
  ctx.fillText(label, labelX, labelY);
  ctx.textAlign = 'left';
}
