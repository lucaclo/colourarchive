/**
 * The one-sheet, eight-page zine: where each page sits on the printed sheet.
 *
 * The sheet prints landscape, four panels across and two down. The top row
 * prints upside down, so that after the long fold, the cut and the collapse
 * (see FOLD_STEPS) every page faces the right way. This is the same layout and
 * fold Dirty Little Zine uses (dirtylittlezine.com), so their fold video and
 * diagram apply here too.
 *
 *   ┌──────┬──────┬──────┬──────┐
 *   │  7 ↻ │  6 ↻ │  5 ↻ │  4 ↻ │   ← printed upside down
 *   ├──────┼──────┴──────┼──────┤   ← cut the middle two panels along here
 *   │ back │ cover│  2   │  3   │
 *   └──────┴──────┴──────┴──────┘
 *
 * Pure: no DOM, so the layout is testable without a browser.
 */

export type PaperId = 'letter' | 'a4' | 'a3';

/** Landscape sheet sizes in millimetres. */
export const PAPER: Record<PaperId, { label: string; widthMM: number; heightMM: number }> = {
  letter: { label: 'Letter', widthMM: 279.4, heightMM: 215.9 },
  a4: { label: 'A4', widthMM: 297, heightMM: 210 },
  a3: { label: 'A3', widthMM: 420, heightMM: 297 },
};

export type PageRole = 'front' | 'back' | 'inner';

export interface Panel {
  /** Position on the sheet: 0–3 are the top row, 4–7 the bottom, left to right. */
  index: number;
  row: 0 | 1;
  col: 0 | 1 | 2 | 3;
  role: PageRole;
  /** Reading-order page number, 1 = cover, 8 = back cover. */
  page: number;
  label: string;
}

export const PANELS: readonly Panel[] = [
  { index: 0, row: 0, col: 0, role: 'inner', page: 7, label: 'Page 7' },
  { index: 1, row: 0, col: 1, role: 'inner', page: 6, label: 'Page 6' },
  { index: 2, row: 0, col: 2, role: 'inner', page: 5, label: 'Page 5' },
  { index: 3, row: 0, col: 3, role: 'inner', page: 4, label: 'Page 4' },
  { index: 4, row: 1, col: 0, role: 'back', page: 8, label: 'Back cover' },
  { index: 5, row: 1, col: 1, role: 'front', page: 1, label: 'Cover' },
  { index: 6, row: 1, col: 2, role: 'inner', page: 2, label: 'Page 2' },
  { index: 7, row: 1, col: 3, role: 'inner', page: 3, label: 'Page 3' },
];

/** The three spreads you see when the zine is open, as panel indices. */
export interface Spread {
  id: 'p23' | 'p45' | 'p67';
  left: number;
  right: number;
  label: string;
}

export const SPREADS: readonly Spread[] = [
  { id: 'p23', left: 6, right: 7, label: 'Pages 2–3' },
  { id: 'p45', left: 3, right: 2, label: 'Pages 4–5' },
  { id: 'p67', left: 1, right: 0, label: 'Pages 6–7' },
];

export const COVER_PANEL = 5;
export const BACK_PANEL = 4;

/** What you edit, in reading order: the cover, three spreads, the back. */
export type Slide =
  | { kind: 'single'; panel: number; label: string; role: 'front' | 'back' }
  | { kind: 'spread'; spread: Spread; label: string };

export const SLIDES: readonly Slide[] = [
  { kind: 'single', panel: COVER_PANEL, label: 'Cover', role: 'front' },
  ...SPREADS.map((spread) => ({ kind: 'spread' as const, spread, label: spread.label })),
  { kind: 'single', panel: BACK_PANEL, label: 'Back cover', role: 'back' },
];

export function panelAt(index: number): Panel {
  const p = PANELS[index];
  if (!p) throw new RangeError(`No panel ${index}`);
  return p;
}

/** True when the panel prints upside down. */
export function isFlipped(index: number): boolean {
  return panelAt(index).row === 0;
}

export interface Rect { x: number; y: number; w: number; h: number }

/** A panel's rectangle on a sheet of the given pixel size. */
export function panelRect(index: number, sheetW: number, sheetH: number): Rect {
  const p = panelAt(index);
  const w = sheetW / 4;
  const h = sheetH / 2;
  return { x: p.col * w, y: p.row * h, w, h };
}

/** A single page's aspect ratio (width / height) on this paper. */
export function pageAspect(paper: PaperId): number {
  const s = PAPER[paper];
  return s.widthMM / 4 / (s.heightMM / 2);
}

/**
 * Pixel size of the sheet for printing. 300 DPI where the device allows it.
 * Mobile Safari refuses a canvas above about 16.7 million pixels, which A3 at
 * 300 DPI exceeds, so the resolution steps down just enough to fit.
 */
export const MAX_CANVAS_PIXELS = 16_000_000;

export function sheetPixels(paper: PaperId, dpi = 300): { w: number; h: number; dpi: number } {
  const s = PAPER[paper];
  const inW = s.widthMM / 25.4;
  const inH = s.heightMM / 25.4;
  const fit = Math.sqrt(MAX_CANVAS_PIXELS / (inW * inH));
  const used = Math.min(dpi, Math.floor(fit));
  return { w: Math.round(inW * used), h: Math.round(inH * used), dpi: used };
}

/** Sheet size in PDF points (1/72 in). */
export function sheetPoints(paper: PaperId): { w: number; h: number } {
  const s = PAPER[paper];
  return { w: (s.widthMM / 25.4) * 72, h: (s.heightMM / 25.4) * 72 };
}

/** Swap two spreads' contents is done on the document; this finds a spread by id. */
export function spreadById(id: Spread['id']): Spread {
  const s = SPREADS.find((x) => x.id === id);
  if (!s) throw new RangeError(`No spread ${id}`);
  return s;
}

export const FOLD_STEPS: readonly { title: string; body: string }[] = [
  { title: 'Fold it long', body: 'Printed side out, fold the sheet in half top edge to bottom edge. Crease it hard, then open it out.' },
  { title: 'Fold it short', body: 'Now fold it in half the other way, left edge to right edge. Crease, and open it out again.' },
  { title: 'Fold the ends in', body: 'Fold each short end in to meet the middle crease, like closing a pair of doors. Crease, then open it all the way. You should see eight rectangles.' },
  { title: 'Make one cut', body: 'Fold it short way again. From the folded edge, cut along the middle crease for one panel only, and stop.' },
  { title: 'Open the slit', body: 'Open it flat and fold it the long way again. Push the two ends towards each other so the slit opens into a plus sign.' },
  { title: 'Flatten it into a book', body: 'Press the pages flat so the cover ends up on top and the back cover underneath. That’s it: eight pages from one sheet.' },
];
