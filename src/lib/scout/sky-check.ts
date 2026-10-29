/**
 * Was Scout right? (issue #143)
 *
 * Sunset apps are distrusted because nothing ever checks them. Scout gives
 * words, not scores, and this keeps it honest the same way: every reading it
 * gave for a kept spot is stored, and once a photo turns up from within a
 * kilometre of the spot, taken near that sunrise or sunset, the photo's own
 * sky is measured and set against what was said. Plain counts — "Scout said
 * lit 9 times; 7 were" — and the pairs behind them, so a miss can be seen.
 *
 * The sky is measured from the pixels the scene segmentation calls sky
 * (sky-measure.ts), or, without that, the top band of the photo's colour
 * grid (signature.ts, a 4×4 OKLab grid, row-major from the top). Only warm
 * and magenta colour counts: reds, oranges, golds, pinks and purples. A clean blue sky is the
 * clear light Scout calls bare, not the lit sky it promised. Colourful when
 * that mean is past SKY_COLOUR. Coarse on purpose; a check, not a judge.
 *
 * Pure: the API supplies readings, photos and their places.
 */
import { metresBetween } from './spots';
import type { SkyEvent } from './sky-week';

export type SaidVerdict = 'lit' | 'bare' | 'blocked';

export interface StoredReading {
  iso: string;
  event: SkyEvent;
  /** The sunrise or sunset, epoch ms. */
  when: number;
  verdict: SaidVerdict;
  note: string;
}

export interface CheckPhoto {
  id: string;
  lat: number;
  lon: number;
  /** Epoch ms, in true UTC. */
  takenAt: number;
  colourGrid?: number[];
  /** The segmented sky's warm chroma: a number, null for "no sky in the
   *  frame", or absent when not measured (then the grid's top row is used). */
  sky?: number | null;
}

export const NEAR_M = 1000;
export const NEAR_MS = 45 * 60_000;
export const SKY_COLOUR = 0.05;

/** OKLab hues (degrees) that are not sunset colour: greens, cyans and blues. */
const COOL_FROM = 130, COOL_TO = 275;
export const isSunsetHue = (hue: number): boolean => hue < COOL_FROM || hue > COOL_TO;

/** Mean warm-or-magenta OKLab chroma of the grid's top row — the sky, in most
 *  photographs. A cell in a cool hue adds nothing. */
export function skyChroma(grid: readonly number[]): number | null {
  if (grid.length < 12) return null;
  let sum = 0;
  for (let cell = 0; cell < 4; cell++) {
    const a = grid[cell * 3 + 1], b = grid[cell * 3 + 2];
    const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    if (isSunsetHue(hue)) sum += Math.hypot(a, b);
  }
  return sum / 4;
}

export interface CheckedEvening {
  reading: StoredReading;
  photoIds: string[];
  /** What the photos showed. */
  sky: 'colour' | 'plain';
  /** Whether that's what the reading said: lit means colour, the others not. */
  right: boolean;
}

export interface SkyTally {
  said: Record<SaidVerdict, number>;
  were: Record<SaidVerdict, number>;
  evenings: CheckedEvening[];
}

export function skyTally(at: { lat: number; lon: number }, readings: StoredReading[], photos: CheckPhoto[]): SkyTally {
  const said: Record<SaidVerdict, number> = { lit: 0, bare: 0, blocked: 0 };
  const were: Record<SaidVerdict, number> = { lit: 0, bare: 0, blocked: 0 };
  const evenings: CheckedEvening[] = [];
  const near = photos.filter((p) => metresBetween(at, p) <= NEAR_M);
  for (const reading of readings) {
    const matched = near.filter((p) => Math.abs(p.takenAt - reading.when) <= NEAR_MS);
    const chromas = matched.map((p) => (p.sky !== undefined ? p.sky : p.colourGrid ? skyChroma(p.colourGrid) : null)).filter((c): c is number => c != null);
    if (!chromas.length) continue;
    // The most colourful frame of the evening speaks for it: one photo of a
    // lit sky is the evidence, however many plain frames were taken around it.
    const sky = Math.max(...chromas) >= SKY_COLOUR ? 'colour' : 'plain';
    const right = (reading.verdict === 'lit') === (sky === 'colour');
    said[reading.verdict]++;
    if (right) were[reading.verdict]++;
    evenings.push({ reading, photoIds: matched.map((p) => p.id), sky, right });
  }
  evenings.sort((a, b) => b.reading.when - a.reading.when);
  return { said, were, evenings };
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** "Scout said lit 9 times; 7 were." One line per verdict it has said. */
export function tallyLines(t: SkyTally): string[] {
  const out: string[] = [];
  for (const v of ['lit', 'bare', 'blocked'] as const) {
    const n = t.said[v];
    if (!n) continue;
    const m = t.were[v];
    const tail = v === 'lit'
      ? (m === n ? (n === 1 ? 'it was.' : 'all were.') : m === 0 ? (n === 1 ? 'it wasn’t.' : 'none were.') : `${m} ${m === 1 ? 'was' : 'were'}.`)
      : (m === n ? 'no colour came, as said.' : `${n - m} had colour anyway.`);
    out.push(`Scout said ${v} ${times(n)}; ${tail}`);
  }
  return out;
}
