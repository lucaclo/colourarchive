/**
 * A scouted spot, as a link.
 *
 * Until now the whole of Scout's state lived in `sessionStorage`, which means a
 * spot you found died with the tab. You could not send it to yourself, open it
 * on the iPad you were going to shoot from, or keep it in a notes file next to
 * the rest of the plan. For a tool whose entire output is "be *here* at *this
 * time*", that was the wrong place to keep the answer.
 *
 * So the state that identifies a spot — where, when, how wide — goes in the
 * query string, and the rest (basemap, which layers are on, the monolith) stays
 * in storage where it belongs. The split is deliberate: the link should carry
 * what you are looking at, not how you happen to have the map dressed.
 *
 * Everything here is pure, and everything decoded is **validated rather than
 * trusted**. A URL is the one input a stranger can hand this page, and the
 * project has already been bitten once by a restored state with no timezone
 * printing Tokyo's sunset on a London clock. A field that does not survive
 * checking is dropped, not guessed at.
 *
 * **Proof photos travel the same way — issue #66.** There is no server to
 * hold a crowd-submitted photo, so the only "opt-in, self-contained" way for
 * one to reach anyone else is to ride along in a link exactly like the rest
 * of this file's data: encoded here, validated with the very same
 * `readProof` a locally-kept spot's own proofs are checked with, and merged
 * into whichever spot it matches on arrival rather than trusted outright.
 */

import type { LatLon } from './geo';
import { readProof, type LightProof } from './spots';

export interface ScoutLink {
  centre: LatLon;
  /** The place's name, for the panel to show before any geocoding happens. */
  name?: string;
  timeZone?: string;
  radiusKm?: number;
  /** Calendar date in the spot's own zone, `YYYY-MM-DD`. */
  isoDate?: string;
  /**
   * Where the time slider sits: minutes into the *solar* day, 0–1440.
   *
   * Not minutes past local midnight. The day here starts at solar midnight —
   * `daylight.ts` anchors on the sun rather than the calendar precisely so the
   * timezone question never arises — which at Edinburgh in August is about
   * 01:19 local. That makes the number meaningful only alongside the `at` and
   * `d` it travelled with, which is exactly how it is read back, so a link is
   * stable even though the figure is not a wall-clock time.
   */
  minute?: number;
  /** Proof photos being carried along for this spot — issue #66. Capped at
   *  `MAX_PROOFS_IN_LINK`, well short of `spots.ts`'s own `MAX_PROOFS`,
   *  because these ride in the URL itself rather than in storage. */
  proofs?: LightProof[];
}

/** Fewer than `spots.ts`'s `MAX_PROOFS` on purpose — every one here costs
 *  real characters in a link meant to still be pasteable into a message. */
const MAX_PROOFS_IN_LINK = 3;

/**
 * Five decimal places, which is about a metre.
 *
 * Finer than a pin can be placed by hand and far finer than the building
 * footprints the shadows are cast from, so nothing is lost — and it keeps the
 * link short enough to paste into a message without it wrapping.
 */
const PLACES = 5;
const round = (value: number) => Number(value.toFixed(PLACES));

/** Longest name carried in a link. Long enough for any real place. */
const MAX_NAME = 120;

export function encodeScoutLink(link: ScoutLink): string {
  const params = new URLSearchParams();
  params.set('at', `${round(link.centre.lat)},${round(link.centre.lon)}`);
  if (link.radiusKm != null) params.set('r', String(Math.round(link.radiusKm)));
  if (link.isoDate) params.set('d', link.isoDate);
  if (link.minute != null) params.set('t', String(Math.round(link.minute)));
  if (link.timeZone) params.set('tz', link.timeZone);
  if (link.name) params.set('n', link.name.slice(0, MAX_NAME));
  if (link.proofs?.length) {
    params.set('pf', JSON.stringify(link.proofs.slice(0, MAX_PROOFS_IN_LINK)));
  }
  return params.toString();
}

/** Does the runtime recognise this zone? Anything else would silently shift every time. */
export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * A real calendar date, not merely a well-shaped one.
 *
 * `2026-02-31` matches any pattern you care to write and is not a day. Building
 * it and reading it back is the only check that catches that.
 */
export function isCalendarDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === text;
}

/**
 * Read a link back. Returns null when there is no usable position in it —
 * without somewhere to stand, none of the rest means anything.
 */
export function decodeScoutLink(search: string): ScoutLink | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }

  const at = params.get('at');
  if (!at) return null;
  const [latText, lonText, ...rest] = at.split(',');
  if (rest.length) return null;
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Mercator cannot draw the poles and the engines are not asked to try.
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;

  const link: ScoutLink = { centre: { lat, lon } };

  const radius = Number(params.get('r'));
  if (Number.isFinite(radius) && radius >= 1 && radius <= 50) link.radiusKm = Math.round(radius);

  const date = params.get('d');
  if (date && isCalendarDate(date)) link.isoDate = date;

  const minuteText = params.get('t');
  const minute = Number(minuteText);
  if (minuteText !== null && Number.isFinite(minute) && minute >= 0 && minute <= 1440) {
    link.minute = Math.round(minute);
  }

  const zone = params.get('tz');
  if (zone && isKnownTimeZone(zone)) link.timeZone = zone;

  const name = params.get('n');
  if (name) {
    const trimmed = name.trim().slice(0, MAX_NAME);
    if (trimmed) link.name = trimmed;
  }

  const proofsText = params.get('pf');
  if (proofsText) {
    try {
      const parsed: unknown = JSON.parse(proofsText);
      if (Array.isArray(parsed)) {
        const proofs = parsed
          .map(readProof)
          .filter((proof): proof is LightProof => proof !== null)
          .slice(0, MAX_PROOFS_IN_LINK);
        if (proofs.length) link.proofs = proofs;
      }
    } catch {
      // Malformed JSON in a hand-edited or truncated link costs the proofs,
      // not the spot underneath them.
    }
  }

  return link;
}

/* ── Plan this shot again (issue #160) ─────────────────────────────────────── */

/** The lens a photo was made with, as a link carries it: `l=ff,35,8,33`. */
export interface LinkLens {
  sensor: string;
  focalLengthMm: number;
  aperture?: number;
  megapixels?: number;
}

/**
 * A photograph to plan again: which one, the lens, and when it was taken as
 * the camera's own clock read it, with the camera's offset when the file
 * knows it. Separate from `ScoutLink` because it can arrive without a place
 * (the static publish doesn't know where a photo was taken), and then Scout
 * asks for one.
 */
export interface PlanAgain {
  photo?: string;
  lens?: LinkLens;
  /** Wall-clock capture time, `YYYY-MM-DDTHH:MM(:SS)`. */
  taken?: string;
  /** The camera's UTC offset, `+02:00`. */
  offset?: string;
}

const SENSOR_KEY = /^[a-z]{2,8}$/;

export function encodePlanAgain(plan: PlanAgain): string {
  const params = new URLSearchParams();
  if (plan.photo) params.set('pa', plan.photo);
  if (plan.lens) {
    const l = plan.lens;
    params.set('l', [l.sensor, l.focalLengthMm, l.aperture ?? '', l.megapixels ?? ''].join(',').replace(/,+$/, ''));
  }
  if (plan.taken) params.set('pt', plan.taken);
  if (plan.offset) params.set('po', plan.offset);
  return params.toString();
}

/** Read the plan-again fields back, each checked; null when there are none. */
export function decodePlanAgain(search: string): PlanAgain | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const plan: PlanAgain = {};
  const photo = params.get('pa');
  if (photo && /^[\w-]{1,64}$/.test(photo)) plan.photo = photo;
  const l = params.get('l');
  if (l) {
    const [sensor, focal, aperture, mp] = l.split(',');
    const f = Number(focal);
    if (SENSOR_KEY.test(sensor ?? '') && f > 0 && f <= 2000) {
      plan.lens = { sensor, focalLengthMm: f };
      const a = Number(aperture);
      if (aperture && a > 0 && a <= 64) plan.lens.aperture = a;
      const m = Number(mp);
      if (mp && m > 0 && m <= 400) plan.lens.megapixels = m;
    }
  }
  const taken = params.get('pt');
  if (taken && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(taken) && isCalendarDate(taken.slice(0, 10))) plan.taken = taken;
  const offset = params.get('po');
  if (offset && /^[+-]\d{2}:\d{2}$/.test(offset)) plan.offset = offset;
  return plan.photo || plan.lens || plan.taken ? plan : null;
}

/**
 * A wall-clock time to a real instant: with the camera's offset when known,
 * else in the place's own time zone (a camera set to local time, the usual
 * case, in the place it was used).
 */
export function wallClockToInstant(wall: string, offset: string | undefined, timeZone: string): Date {
  const base = wall.length === 16 ? `${wall}:00` : wall;
  if (offset) return new Date(`${base}${offset}`);
  // Guess the zone's offset at that wall time, then correct once for DST edges.
  const asUtc = Date.parse(`${base}Z`);
  const zoneOffset = (t: number) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t));
    const v = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - t;
  };
  const first = asUtc - zoneOffset(asUtc);
  return new Date(asUtc - zoneOffset(first));
}
