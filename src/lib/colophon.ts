/**
 * The book's last page (issue #140): what it was made with, read from the
 * photographs themselves. Cameras and lenses, how many frames were film and
 * how many digital, when they were taken, and where, set as a few short
 * lines in the book's own type. Pure; book-print.ts supplies place names.
 */

export interface ColophonPhoto {
  medium: 'film' | 'digital';
  camera?: string;
  lens?: string;
  capturedAt?: string;
}

// The EXIF Make + Model as a person would say it.
const CAMERA_NAMES: [RegExp, string][] = [
  [/ILCE-7CM2/i, 'Sony a7C II'],
  [/ILCE-7CM?$|ILCE-7C\b/i, 'Sony a7C'],
  [/ILCE-7M4/i, 'Sony a7 IV'],
  [/ILCE-7M3/i, 'Sony a7 III'],
  [/ILCE-6400/i, 'Sony a6400'],
  [/GR IIIx/i, 'Ricoh GR IIIx'],
  [/GR III\b/i, 'Ricoh GR III'],
];
const SCANNER = /noritsu|frontier|scanner|qss|ez controller/i;

export function cameraName(raw: string): string {
  for (const [re, name] of CAMERA_NAMES) if (re.test(raw)) return name;
  // "NIKON CORPORATION NIKON Z 6" → "Nikon Z 6": drop a repeated make, soften capitals.
  const words = raw.replace(/\b(CORPORATION|IMAGING COMPANY|CO\.?|LTD\.?|,)\b/gi, ' ').split(/\s+/).filter(Boolean);
  const out = words.filter((w, i) => words.findIndex((x) => x.toLowerCase() === w.toLowerCase()) === i);
  return out.map((w) => (/^[A-Z]{3,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w)).join(' ');
}

const MONTH = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Most-used first, then by name. */
function tally(values: (string | undefined)[]): string[] {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
}

/** "A, B and C", or "A, B, C, D and others" past `max`. */
function list(xs: string[], max = 4, rest = 'others'): string {
  const shown = xs.slice(0, max);
  if (xs.length > max) return `${shown.join(', ')} and ${rest}`;
  return shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

export function colophonLines(photos: ColophonPhoto[], places: string[] = []): string[] {
  const film = photos.filter((p) => p.medium === 'film').length;
  const digital = photos.length - film;
  const lines: string[] = [];
  const count = [digital && `${digital} digital`, film && `${film} on film`].filter(Boolean).join(', ');
  lines.push(`${photos.length} photograph${photos.length === 1 ? '' : 's'}${count ? `, ${count}` : ''}.`);

  const cameras = tally(photos.filter((p) => p.medium === 'digital').map((p) => p.camera && cameraName(p.camera)));
  if (cameras.length) lines.push(`Made with the ${list(cameras)}.`);
  const lenses = tally(photos.map((p) => p.lens?.trim()).filter((l) => l && !/^-+$/.test(l)));
  if (lenses.length) lines.push(`Lenses: ${list(lenses)}.`);
  const scanners = tally(photos.filter((p) => p.medium === 'film').map((p) => p.camera && SCANNER.test(p.camera) ? cameraName(p.camera.replace(/ (EZ Controller|QSS.*)$/i, '')) : undefined));
  if (film && scanners.length) lines.push(`Film scanned on a ${list(scanners)}.`);

  // Film carries the scan date, not the day it was shot, so dates are digital's.
  const dates = photos.filter((p) => p.medium === 'digital' && p.capturedAt).map((p) => p.capturedAt!).sort();
  if (dates.length) {
    const a = MONTH(dates[0]), b = MONTH(dates.at(-1)!);
    lines.push(a === b ? `Taken in ${a}.` : `Taken between ${a} and ${b}.`);
  }
  const where = tally(places);
  if (where.length) lines.push(`In ${list(where, 6, 'elsewhere')}.`);
  return lines;
}
