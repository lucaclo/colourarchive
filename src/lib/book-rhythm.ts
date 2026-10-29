/**
 * Sequencing help for the book (issue #141): its rhythm, and rhymes.
 *
 * Book orders each chapter along the hue, which is the archive's idea. A book
 * also has a rhythm — where it breathes, where it jolts — and pictures that
 * talk across a spread. Nothing here reorders anything. It measures what the
 * order already does, and lists photographs worth trying beside one another.
 * Pure: the spread view feeds it the pages and the colours.
 */
import type { Page } from './book-pages';

export interface Tone { L: number; C: number; H: number }

/** A page's tone: its photos' mean colour, an opener's chapter colour, or
 *  nothing for paper (a blank or the colophon). */
export function pageTone(page: Page | null, photoTone: (id: string) => Tone | undefined, chapterTone: (key: string) => Tone | undefined): Tone | null {
  if (!page) return null;
  if (page.kind === 'opener') return chapterTone(page.chapterKey) ?? null;
  if (page.kind !== 'photo') return null;
  return meanTone(page.photos.map((p) => photoTone(p.id)).filter((t): t is Tone => Boolean(t)));
}

/** Mean in OKLab, so two opposite hues average towards grey, not halfway round. */
export function meanTone(tones: Tone[]): Tone | null {
  if (!tones.length) return null;
  let L = 0, a = 0, b = 0;
  for (const t of tones) {
    const r = (t.H * Math.PI) / 180;
    L += t.L; a += t.C * Math.cos(r); b += t.C * Math.sin(r);
  }
  L /= tones.length; a /= tones.length; b /= tones.length;
  return { L, C: Math.hypot(a, b), H: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

export const JUMP_L = 0.25;
export const JUMP_HUE = 100;
const CHROMATIC = 0.05;

export interface Jump {
  /** Between spread `after` and spread `after + 1`. */
  after: number;
  reason: string;
}

const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/**
 * Where neighbouring spreads jolt: lightness past JUMP_L, or two coloured
 * spreads more than JUMP_HUE degrees apart. A spread that opens a chapter is
 * left out — the hue is meant to move there; that's the archive's order.
 */
export function spreadJumps(spreadTones: (Tone | null)[], opensChapter: boolean[] = []): Jump[] {
  const jumps: Jump[] = [];
  for (let i = 0; i + 1 < spreadTones.length; i++) {
    const a = spreadTones[i], b = spreadTones[i + 1];
    if (!a || !b || opensChapter[i + 1]) continue;
    const dL = b.L - a.L;
    if (Math.abs(dL) >= JUMP_L) {
      jumps.push({ after: i, reason: dL > 0 ? 'Jumps from dark to light' : 'Drops from light to dark' });
    } else if (a.C >= CHROMATIC && b.C >= CHROMATIC && hueGap(a.H, b.H) >= JUMP_HUE) {
      jumps.push({ after: i, reason: 'The colour swings across the hue' });
    }
  }
  return jumps;
}

export interface SimilarRow { id: string; comp: number; col: number }

/**
 * Rhymes: photos whose shape echoes the spread's (low composition distance,
 * DINOv2) but whose colour moves it on (high colour distance). Both scores
 * are 0–1 across the candidates, 0 the closest — see similar.ts.
 */
export function pickRhymes<T extends SimilarRow>(rows: T[], limit = 8): T[] {
  const strict = rows.filter((r) => r.col >= 0.4).sort((a, b) => a.comp - b.comp);
  const pool = strict.length >= 3 ? strict : rows.filter((r) => r.col >= 0.25).sort((a, b) => a.comp - b.comp);
  return pool.filter((r) => r.comp <= 0.45).slice(0, limit);
}
