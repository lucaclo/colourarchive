/**
 * The book as pages and spreads, the way a printer sees it.
 *
 * `book.ts` decides which photographs are in and in what order. This decides
 * how they land on paper: a chapter opener, then each photograph on its own
 * page (with a border, or full bleed), or two of them sharing a page, with a
 * blank page wherever you ask for one. Page 1 is a right-hand page, as in
 * every printed book, so spreads run [–, 1], [2, 3], [4, 5]…
 *
 * Pure, no DOM and no files: the spread view on /book and the PDF built by
 * /api/book/pdf both call it, so the preview is the print.
 */

export type Treatment = 'border' | 'bleed' | 'pair';
export const TREATMENTS: readonly Treatment[] = ['border', 'bleed', 'pair'];

export type TrimId = 'blurb-land' | 'blurb-port' | 'blurb-sq-s' | 'blurb-sq-l' | 'a4-port' | 'a4-land' | 'a5-port';

export interface Trim {
  label: string;
  widthMM: number;
  heightMM: number;
  bleedMM: number;
  /** Page-count limits a print service enforces, when it is one. */
  minPages?: number;
  maxPages?: number;
  service?: string;
}

const INCH = 25.4;
/** Blurb's bleed is an eighth of an inch on every edge. */
const BLURB_BLEED = INCH / 8;

export const TRIMS: Record<TrimId, Trim> = {
  'blurb-land': { label: 'Blurb landscape 10 × 8 in', widthMM: 10 * INCH, heightMM: 8 * INCH, bleedMM: BLURB_BLEED, minPages: 20, maxPages: 240, service: 'Blurb' },
  'blurb-port': { label: 'Blurb portrait 8 × 10 in', widthMM: 8 * INCH, heightMM: 10 * INCH, bleedMM: BLURB_BLEED, minPages: 20, maxPages: 240, service: 'Blurb' },
  'blurb-sq-s': { label: 'Blurb square 7 × 7 in', widthMM: 7 * INCH, heightMM: 7 * INCH, bleedMM: BLURB_BLEED, minPages: 20, maxPages: 240, service: 'Blurb' },
  'blurb-sq-l': { label: 'Blurb square 12 × 12 in', widthMM: 12 * INCH, heightMM: 12 * INCH, bleedMM: BLURB_BLEED, minPages: 20, maxPages: 240, service: 'Blurb' },
  'a4-port': { label: 'A4 portrait', widthMM: 210, heightMM: 297, bleedMM: 3 },
  'a4-land': { label: 'A4 landscape', widthMM: 297, heightMM: 210, bleedMM: 3 },
  'a5-port': { label: 'A5 portrait', widthMM: 148, heightMM: 210, bleedMM: 3 },
};
export const DEFAULT_TRIM: TrimId = 'blurb-land';
export const isTrimId = (v: unknown): v is TrimId => typeof v === 'string' && v in TRIMS;
export const isTreatment = (v: unknown): v is Treatment => typeof v === 'string' && (TREATMENTS as readonly string[]).includes(v);

export interface PagePhoto {
  id: string;
  width: number;
  height: number;
}

export interface PageChapter {
  key: string;
  name: string;
  /** CSS colour for the opener. */
  colour: string;
  photos: PagePhoto[];
}

export type Page =
  | { kind: 'opener'; chapterKey: string; name: string; colour: string; index: number }
  | { kind: 'photo'; chapterKey: string; photos: PagePhoto[]; treatment: 'border' | 'bleed' | 'two-up'; note?: string }
  | { kind: 'blank'; reason: 'asked' | 'even' };

export interface Layout {
  treatment?: Record<string, Treatment>;
  blankBefore?: readonly string[];
}

export function paginate(chapters: readonly PageChapter[], layout: Layout = {}): Page[] {
  const pages: Page[] = [];
  const blanks = new Set(layout.blankBefore ?? []);
  chapters.forEach((ch, index) => {
    pages.push({ kind: 'opener', chapterKey: ch.key, name: ch.name, colour: ch.colour, index });
    for (let i = 0; i < ch.photos.length; i++) {
      const p = ch.photos[i];
      if (blanks.has(p.id)) pages.push({ kind: 'blank', reason: 'asked' });
      const t = layout.treatment?.[p.id] ?? 'border';
      if (t === 'pair') {
        const next = ch.photos[i + 1];
        if (next) {
          pages.push({ kind: 'photo', chapterKey: ch.key, photos: [p, next], treatment: 'two-up' });
          i++;
          continue;
        }
        pages.push({ kind: 'photo', chapterKey: ch.key, photos: [p], treatment: 'border', note: 'Last in its chapter, so nothing to pair with' });
        continue;
      }
      pages.push({ kind: 'photo', chapterKey: ch.key, photos: [p], treatment: t });
    }
  });
  return pages;
}

/** Pad to an even count, which every bound book needs. */
export function padToEven(pages: Page[]): Page[] {
  return pages.length % 2 ? [...pages, { kind: 'blank', reason: 'even' }] : pages;
}

/** Page 1 is a right-hand page: [null, 1], [2, 3], … with the last left page alone if odd. */
export function spreads<T>(pages: readonly T[]): [T | null, T | null][] {
  const out: [T | null, T | null][] = [[null, pages[0] ?? null]];
  for (let i = 1; i < pages.length; i += 2) out.push([pages[i], pages[i + 1] ?? null]);
  return pages.length ? out : [];
}

export interface PageCheck {
  pages: number;
  ok: boolean;
  /** One short line for the page header. */
  message: string;
}

export function checkPages(count: number, trim: Trim): PageCheck {
  if (trim.minPages && count < trim.minPages) {
    return { pages: count, ok: false, message: `${count} pages · ${trim.service} needs at least ${trim.minPages}` };
  }
  if (trim.maxPages && count > trim.maxPages) {
    return { pages: count, ok: false, message: `${count} pages · ${trim.service} takes at most ${trim.maxPages}` };
  }
  return { pages: count, ok: true, message: trim.service ? `${count} pages · fits ${trim.service}` : `${count} pages` };
}

/** A rectangle in millimetres from the trimmed page's top-left corner. Bleed lies outside 0…width. */
export interface Rect { x: number; y: number; w: number; h: number }

export interface Placement {
  id: string;
  /** Where the image is drawn. For a full-bleed page it is larger than the clip. */
  box: Rect;
  /** What is visible of it. */
  clip: Rect;
}

/** Margin around bordered photos, as a fraction of the page's shorter side. */
export const MARGIN = 0.09;
/** Gap between two photos on one page, as a fraction of the shorter side. */
export const GUTTER = 0.035;

function fit(ar: number, area: Rect): Rect {
  const w = Math.min(area.w, area.h * ar);
  const h = w / ar;
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

/** Where each photograph sits on a photo page. */
export function placements(page: Extract<Page, { kind: 'photo' }>, trim: Trim): Placement[] {
  const W = trim.widthMM, H = trim.heightMM;
  const m = Math.min(W, H) * MARGIN;
  const inner: Rect = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
  const ar = (p: PagePhoto) => (p.width > 0 && p.height > 0 ? p.width / p.height : 1.5);

  if (page.treatment === 'bleed') {
    const p = page.photos[0];
    const b = trim.bleedMM;
    const clip: Rect = { x: -b, y: -b, w: W + 2 * b, h: H + 2 * b };
    // Cover the bleed box, centred, cropping the long side.
    const a = ar(p);
    const w = Math.max(clip.w, clip.h * a);
    const h = w / a;
    return [{ id: p.id, box: { x: clip.x + (clip.w - w) / 2, y: clip.y + (clip.h - h) / 2, w, h }, clip }];
  }

  if (page.treatment === 'two-up') {
    const g = Math.min(W, H) * GUTTER;
    const [a, b] = page.photos;
    // Side by side or stacked, whichever gives the photographs more area.
    const side = (): Rect[] => {
      const half = (inner.w - g) / 2;
      return [{ ...inner, w: half }, { ...inner, x: inner.x + half + g, w: half }];
    };
    const stack = (): Rect[] => {
      const half = (inner.h - g) / 2;
      return [{ ...inner, h: half }, { ...inner, y: inner.y + half + g, h: half }];
    };
    const area = (cells: Rect[]) => cells.reduce((s, c, i) => { const f = fit(ar([a, b][i]), c); return s + f.w * f.h; }, 0);
    const cells = area(side()) >= area(stack()) ? side() : stack();
    return [a, b].map((p, i) => { const r = fit(ar(p), cells[i]); return { id: p.id, box: r, clip: r }; });
  }

  const p = page.photos[0];
  const r = fit(ar(p), inner);
  return [{ id: p.id, box: r, clip: r }];
}
