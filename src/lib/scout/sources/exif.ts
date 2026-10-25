/**
 * How a spot photograph was made: aperture, shutter, ISO and focal length.
 *
 * The one field Atlas Photo puts on a spot that a photographer actually
 * uses — "f/8, 1/500, 24 mm" says what lens to bring and whether a tripod is
 * needed in a way no caption does. Read from the file's own EXIF, so it is
 * what the camera recorded rather than what anybody remembered; and a field
 * that is missing stays missing. Most phone pictures and every scan have none.
 *
 * Same shape as `wikimedia.ts` and `flickr.ts`: URL builders and parsers,
 * no I/O. Fetched only when a spot's sheet is opened, and only for the
 * photographs that will be on screen — EXIF blocks are large and nobody looks
 * at the settings of a spot they did not open.
 */

import { COMMONS_API, type UrlOptions } from './wikimedia';
import { FLICKR_API } from './flickr';

export interface ExposureSettings {
  /** "Make Model", tidied — see `cameraName`. */
  camera?: string;
  fNumber?: number;
  /** As a photographer writes it: "1/500", "2 s". */
  shutter?: string;
  iso?: number;
  focalMm?: number;
  /** The 35 mm-equivalent focal length, when the camera recorded it. */
  focal35Mm?: number;
}

/** Commons takes up to 50 page ids a request. */
export const EXIF_BATCH = 50;

export function commonsExifUrl(pageIds: string[], options?: UrlOptions): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo',
    iiprop: 'metadata',
    pageids: pageIds.join('|'),
  });
  if (options?.cors) params.set('origin', '*');
  return `${COMMONS_API}?${params}`;
}

export function flickrExifUrl(photoId: string, key: string): string {
  const params = new URLSearchParams({
    method: 'flickr.photos.getExif',
    api_key: key,
    photo_id: photoId,
    format: 'json',
    nojsoncallback: '1',
  });
  return `${FLICKR_API}/?${params}`;
}

const RATIO = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/;
const LEADING_NUMBER = /^(\d+(?:\.\d+)?)/;

/** "71/10" → 7.1, "8" → 8, "35.0 mm" → 35. Undefined for anything else. */
export function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  const ratio = text.match(RATIO);
  if (ratio) {
    const n = Number(ratio[1]) / Number(ratio[2]);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const plain = text.match(LEADING_NUMBER);
  const n = plain ? Number(plain[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * A shutter speed the way it is said: "1/500" and "2 s", never "0.002".
 *
 * Under a second it is a fraction with a whole denominator; a second or more
 * is seconds.
 */
export function formatShutter(value: unknown): string | undefined {
  const seconds = readNumber(value);
  if (!seconds) return undefined;
  if (seconds >= 1) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
  return `1/${Math.round(1 / seconds)}`;
}

const PLACEHOLDER = /^(tba|unknown|n\/a|-)$/i;
const CORPORATE = /\b(imaging corp\.?|corporation|corp\.?|company|co\.?,? ltd\.?|inc\.?)/gi;

/**
 * "Canon" + "Canon EOS-1D X" → "Canon EOS-1D X"; "OLYMPUS IMAGING CORP." +
 * "E-M5MarkII" → "Olympus E-M5MarkII". Placeholders like "TBA" are dropped.
 */
export function cameraName(make: unknown, model: unknown): string | undefined {
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  let m = clean(model);
  let k = clean(make).replace(CORPORATE, '').replace(/\s+/g, ' ').trim();
  if (PLACEHOLDER.test(m)) m = '';
  if (PLACEHOLDER.test(k)) k = '';
  if (!m) return undefined;
  // Shouting makers to title case, so a row of cameras reads as one list.
  if (k && k === k.toUpperCase()) k = k.charAt(0) + k.slice(1).toLowerCase();
  // "EASTMAN KODAK" + "KODAK EASYSHARE…": any of the maker's words leading
  // the model means the model already says who made it.
  const lead = m.toLowerCase().split(' ')[0];
  if (!k || k.toLowerCase().split(' ').includes(lead)) return m;
  return `${k} ${m}`;
}

const hasAny = (s: ExposureSettings) =>
  s.fNumber != null || s.shutter != null || s.iso != null || s.focalMm != null || s.focal35Mm != null;

/** Commons `imageinfo` metadata, by page id. Pages with no exposure fields are left out. */
export function parseCommonsExif(payload: unknown): Map<string, ExposureSettings> {
  const out = new Map<string, ExposureSettings>();
  const pages = (payload as { query?: { pages?: unknown } })?.query?.pages;
  if (!Array.isArray(pages)) return out;
  for (const page of pages as Array<{ pageid?: unknown; imageinfo?: Array<{ metadata?: unknown }> }>) {
    const list = page.imageinfo?.[0]?.metadata;
    if (page.pageid == null || !Array.isArray(list)) continue;
    const field = new Map<string, unknown>();
    for (const entry of list as Array<{ name?: unknown; value?: unknown }>) {
      if (typeof entry?.name === 'string') field.set(entry.name, entry.value);
    }
    const settings: ExposureSettings = {
      camera: cameraName(field.get('Make'), field.get('Model')),
      fNumber: readNumber(field.get('FNumber')),
      shutter: formatShutter(field.get('ExposureTime')),
      iso: readNumber(field.get('ISOSpeedRatings') ?? field.get('PhotographicSensitivity')),
      focalMm: readNumber(field.get('FocalLength')),
      focal35Mm: readNumber(field.get('FocalLengthIn35mmFilm')),
    };
    if (hasAny(settings)) out.set(String(page.pageid), settings);
  }
  return out;
}

/**
 * Flickr's `getExif`, per its documented response:
 * `{ photo: { camera, exif: [{ tag, raw: { _content } }] } }`. An owner who
 * hides EXIF gets `stat: "fail"`; that is an answer — no settings — not an
 * error worth surfacing.
 */
export function parseFlickrExif(payload: unknown): ExposureSettings | null {
  const photo = (payload as { photo?: { camera?: unknown; exif?: unknown } })?.photo;
  if (!photo || !Array.isArray(photo.exif)) return null;
  const field = new Map<string, unknown>();
  for (const entry of photo.exif as Array<{ tag?: unknown; raw?: { _content?: unknown } }>) {
    if (typeof entry?.tag === 'string') field.set(entry.tag, entry.raw?._content);
  }
  const settings: ExposureSettings = {
    camera:
      typeof photo.camera === 'string' && photo.camera.trim()
        ? photo.camera.trim()
        : cameraName(field.get('Make'), field.get('Model')),
    fNumber: readNumber(field.get('FNumber')),
    shutter: formatShutter(field.get('ExposureTime')),
    iso: readNumber(field.get('ISO')),
    focalMm: readNumber(field.get('FocalLength')),
    focal35Mm: readNumber(field.get('FocalLengthIn35mmFormat')),
  };
  return hasAny(settings) ? settings : null;
}

/**
 * One line: "f/7.1 · 1/500 · ISO 200 · 70 mm". The 35 mm-equivalent focal
 * length is preferred where the camera gave one, and says so, since "20 mm"
 * on a Micro Four Thirds body is a 40 mm view.
 */
export function formatSettings(s: ExposureSettings): string {
  const parts: string[] = [];
  if (s.fNumber) parts.push(`f/${Number(s.fNumber.toFixed(1))}`);
  if (s.shutter) parts.push(s.shutter);
  if (s.iso) parts.push(`ISO ${Math.round(s.iso)}`);
  if (s.focal35Mm) parts.push(`${Math.round(s.focal35Mm)} mm eq.`);
  else if (s.focalMm) parts.push(`${Number(s.focalMm.toFixed(1))} mm`);
  return parts.join(' · ');
}
