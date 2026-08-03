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
 */

import type { LatLon } from './geo';

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
}

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

  return link;
}
