/**
 * The painter's colour wheel (red, yellow, blue primaries) and the harmony
 * rules that live on it. Shared by the zine's cover titles and the archive's
 * colour search, and kept apart from zine/colour.ts so the archive doesn't
 * load Wada's dictionary to rotate a hue.
 *
 * Harmonies are worked out on the painter's wheel, where blue's opposite is
 * orange and red's is green, rather than on the screen's RGB wheel, where
 * blue's opposite is yellow. Screen hues are mapped onto it piecewise,
 * through Itten's primaries and secondaries.
 */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** h 0–360, s and v 0–1. */
export function hsvToRgb(h: number, s: number, v: number): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

export function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

const RGB_STOPS = [0, 30, 60, 120, 240, 285, 360];
const RYB_STOPS = [0, 60, 120, 180, 240, 300, 360];
const remap = (h: number, from: number[], to: number[]) => {
  h = ((h % 360) + 360) % 360;
  for (let i = 1; i < from.length; i++) {
    if (h <= from[i]) return to[i - 1] + ((h - from[i - 1]) / (from[i] - from[i - 1])) * (to[i] - to[i - 1]);
  }
  return h;
};
/** A screen hue (HSV, 0–360) placed on the painter's wheel. */
export const rgbHueToRyb = (h: number) => remap(h, RGB_STOPS, RYB_STOPS);
export const rybHueToRgb = (h: number) => remap(h, RYB_STOPS, RGB_STOPS);

/**
 * Adobe Color's harmony rules, as the partners they give a colour: each turn
 * on the painter's wheel once, in wheel order. A rule's colours are offered
 * one at a time, because a search that has to find three colours in one
 * photograph almost never does (on this archive, triads and splits found
 * nothing for any chapter colour).
 */
export const PARTNERS = [
  { key: 'analogous+', rule: 'Analogous', turn: 30 },
  { key: 'triad+', rule: 'Triad', turn: 120 },
  { key: 'split-', rule: 'Split complementary', turn: 150 },
  { key: 'complementary', rule: 'Complementary', turn: 180 },
  { key: 'split+', rule: 'Split complementary', turn: 210 },
  { key: 'triad-', rule: 'Triad', turn: 240 },
  { key: 'analogous-', rule: 'Analogous', turn: 330 },
] as const;

/**
 * `hex` turned `turn` degrees on the painter's wheel, at the same saturation
 * and brightness. A grey has no hue to turn, so it gets null.
 */
export function turnOnWheel(hex: string, turn: number): string | null {
  const [h, s, v] = rgbToHsv(hexToRgb(hex));
  if (s < 0.12) return null;
  return rgbToHex(hsvToRgb(rybHueToRgb(rgbHueToRyb(h) + turn), s, v));
}
