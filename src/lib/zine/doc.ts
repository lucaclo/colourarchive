/**
 * The zine as data: paper, typeface, the eight pages and the two covers' text.
 * Pure, so the edits (swap, merge, reorder) are testable without a browser.
 */
import { SPREADS, COVER_PANEL, BACK_PANEL, type PaperId, type Spread } from './imposition';
import { isHex, luminance, roles, combination } from './colour';
import { WADA_COMBINATIONS } from './wada';

export type Fit = 'fit' | 'fill';
export type Align = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';
export type Size = 'xs' | 's' | 'm' | 'l' | 'xl';
export type InkId = 'white' | 'black' | 'red' | 'yellow' | 'blue';
/** A named ink, or any colour from the wheel as #rrggbb. */
export type Ink = InkId | `#${string}`;
export type FontId = 'serif-italic' | 'serif' | 'mono' | 'sans' | 'sans-light' | 'didone' | 'typewriter' | 'condensed';
/** What sits behind the text: nothing, a box hugging it, or a band across the page. */
export type Plate = 'none' | 'box' | 'band';
export type Case = 'normal' | 'upper';
/** How wide the paper border round the photo is. */
export type Border = 'none' | 'thin' | 'm' | 'wide';
/** Which sides get it: all alike, a deep bottom like a Polaroid, top and bottom only, or the sides only. */
export type Frame = 'even' | 'polaroid' | 'letterbox' | 'pillar';
export type ToneId = 'white' | 'cream' | 'grey' | 'kraft' | 'black';
export type Tone = ToneId | `#${string}`;
export type Rule = 'none' | 'line';

// The last four are system faces on Apple devices, with plain fallbacks
// elsewhere, so nothing extra is downloaded.
export const FONTS: readonly { id: FontId; label: string; family: string; style: string; weight: number; upper: boolean }[] = [
  { id: 'serif-italic', label: 'Fraunces italic', family: 'Fraunces, Georgia, serif', style: 'italic', weight: 600, upper: false },
  { id: 'serif', label: 'Fraunces', family: 'Fraunces, Georgia, serif', style: 'normal', weight: 600, upper: false },
  { id: 'didone', label: 'Didone', family: 'Didot, "Bodoni 72", "Bodoni MT", Georgia, serif', style: 'normal', weight: 400, upper: false },
  { id: 'typewriter', label: 'Typewriter', family: '"American Typewriter", "Courier New", Courier, monospace', style: 'normal', weight: 400, upper: false },
  { id: 'mono', label: 'Mono', family: '"JetBrains Mono", ui-monospace, monospace', style: 'normal', weight: 500, upper: true },
  { id: 'sans', label: 'Sans', family: '-apple-system, "Helvetica Neue", Arial, sans-serif', style: 'normal', weight: 800, upper: true },
  { id: 'sans-light', label: 'Sans light', family: '-apple-system, "Helvetica Neue", Arial, sans-serif', style: 'normal', weight: 300, upper: false },
  { id: 'condensed', label: 'Condensed', family: '"Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", sans-serif', style: 'normal', weight: 700, upper: true },
];

export const INKS: readonly { id: InkId; label: string; hex: string; light: boolean }[] = [
  { id: 'white', label: 'White', hex: '#ffffff', light: true },
  { id: 'black', label: 'Black', hex: '#141312', light: false },
  { id: 'red', label: 'Red', hex: '#c8321e', light: false },
  { id: 'yellow', label: 'Yellow', hex: '#f3c42f', light: true },
  { id: 'blue', label: 'Blue', hex: '#1f4a9c', light: false },
];

export const TONES: readonly { id: ToneId; label: string; hex: string; dark: boolean }[] = [
  { id: 'white', label: 'White', hex: '#fbfaf6', dark: false },
  { id: 'cream', label: 'Cream', hex: '#f2ead8', dark: false },
  { id: 'grey', label: 'Grey', hex: '#d8d5ce', dark: false },
  { id: 'kraft', label: 'Kraft', hex: '#c9a77c', dark: false },
  { id: 'black', label: 'Black', hex: '#151413', dark: true },
];

export function inkOf(id: Ink): { hex: string; light: boolean } {
  if (isHex(id)) return { hex: id, light: luminance(id) > 0.45 };
  return INKS.find((i) => i.id === id) ?? INKS[1];
}
export function toneOf(id: Tone): { hex: string; dark: boolean } {
  if (isHex(id)) return { hex: id, dark: luminance(id) < 0.18 };
  return TONES.find((t) => t.id === id) ?? TONES[0];
}
const validInk = (v: unknown): v is Ink => isHex(v) || INKS.some((i) => i.id === v);
const validTone = (v: unknown): v is Tone => isHex(v) || TONES.some((t) => t.id === v);

export function fontOf(id: FontId) {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

/** A photograph placed on a page. `pan` runs -1..1 and only matters when it fills. */
export interface PhotoRef {
  kind: 'archive' | 'local';
  /** Archive photo id, or the key of a local file in IndexedDB. */
  id: string;
  /** Screen-sized source. For a local file this is filled in at load time. */
  thumb: string;
  /** Print-sized source. */
  full: string;
  w: number;
  h: number;
  panX: number;
  panY: number;
}

export interface TextStyle {
  align: Align;
  valign: VAlign;
  size: Size;
  ink: Ink;
  plate: Plate;
  case: Case;
}

/** The paper round a photo. */
export interface FrameStyle {
  border: Border;
  frame: Frame;
  tone: Tone;
  rule: Rule;
}

export interface PageDoc extends TextStyle, FrameStyle {
  photo: PhotoRef | null;
  fit: Fit;
  caption: string;
}

export interface CoverDoc extends TextStyle {
  title: string;
  subtitle: string;
  author: string;
}

export interface MergeDoc extends TextStyle, FrameStyle {
  on: boolean;
  photo: PhotoRef | null;
  caption: string;
}

export interface ZineDoc {
  v: 1;
  paper: PaperId;
  font: FontId;
  /** The Wada combination the zine is coloured from (1–348), or none. */
  palette: number | null;
  pages: PageDoc[];
  cover: CoverDoc;
  back: CoverDoc;
  merged: Record<Spread['id'], MergeDoc>;
}

const PLAIN_TEXT = { plate: 'none', case: 'normal' } as const;
const BLEED: FrameStyle = { border: 'none', frame: 'even', tone: 'white', rule: 'none' };

export function freshPage(): PageDoc {
  return { photo: null, fit: 'fit', caption: '', align: 'center', valign: 'bottom', size: 'm', ink: 'black', ...PLAIN_TEXT, ...BLEED, border: 'm' };
}

function freshCover(): CoverDoc {
  return { title: '', subtitle: '', author: '', align: 'center', valign: 'middle', size: 'l', ink: 'white', ...PLAIN_TEXT };
}

function freshMerge(): MergeDoc {
  return { on: false, photo: null, caption: '', align: 'center', valign: 'bottom', size: 'm', ink: 'white', ...PLAIN_TEXT, ...BLEED };
}

/**
 * Switch a page between fitted and filling. A fitted page has always had a
 * margin and a filling one none, so the border follows along unless it has
 * been set to something else.
 */
export function setFit(page: PageDoc, fit: Fit): void {
  if (page.fit === fit) return;
  page.fit = fit;
  if (fit === 'fill' && page.border === 'm') page.border = 'none';
  else if (fit === 'fit' && page.border === 'none') page.border = 'm';
}

export function freshDoc(paper: PaperId = 'a4'): ZineDoc {
  const pages = Array.from({ length: 8 }, freshPage);
  for (const p of [pages[COVER_PANEL], pages[BACK_PANEL]]) Object.assign(p, { fit: 'fill', border: 'none' });
  return {
    v: 1,
    paper,
    font: 'serif-italic',
    palette: null,
    pages,
    cover: freshCover(),
    back: { ...freshCover(), valign: 'bottom', size: 's' },
    merged: { p23: freshMerge(), p45: freshMerge(), p67: freshMerge() },
  };
}

/** Accept whatever came out of storage, falling back field by field. */
export function reviveDoc(raw: unknown): ZineDoc {
  const base = freshDoc();
  if (!raw || typeof raw !== 'object' || (raw as ZineDoc).v !== 1) return base;
  const doc = reviveFields(raw as Partial<ZineDoc>, base);
  // Covers used to carry a wash over the photo; it's gone.
  for (const c of [doc.cover, doc.back]) delete (c as Partial<Record<'overlay', unknown>>).overlay;
  // A colour that isn't one we know falls back to the default for its place.
  const fix = (o: { ink?: Ink; tone?: Tone }, d: { ink?: Ink; tone?: Tone }) => {
    if ('ink' in o && !validInk(o.ink)) o.ink = d.ink;
    if ('tone' in o && !validTone(o.tone)) o.tone = d.tone;
  };
  doc.pages.forEach((p, i) => fix(p, base.pages[i]));
  fix(doc.cover, base.cover);
  fix(doc.back, base.back);
  for (const k of Object.keys(doc.merged) as (keyof ZineDoc['merged'])[]) fix(doc.merged[k], base.merged[k]);
  return doc;
}

function reviveFields(r: Partial<ZineDoc>, base: ZineDoc): ZineDoc {
  return {
    v: 1,
    paper: r.paper === 'letter' || r.paper === 'a4' || r.paper === 'a3' ? r.paper : base.paper,
    font: FONTS.some((f) => f.id === r.font) ? (r.font as FontId) : base.font,
    palette: typeof r.palette === 'number' && r.palette >= 1 && r.palette <= WADA_COMBINATIONS.length ? r.palette : null,
    pages: base.pages.map((p, i) => {
      const saved = (Array.isArray(r.pages) ? r.pages[i] : undefined) as Partial<PageDoc> | undefined;
      const page = { ...p, ...saved };
      // Saved before borders existed: keep how it looked.
      if (saved && !saved.border) page.border = page.fit === 'fill' ? 'none' : 'm';
      return page;
    }),
    cover: { ...base.cover, ...r.cover },
    back: { ...base.back, ...r.back },
    merged: {
      p23: { ...base.merged.p23, ...r.merged?.p23 },
      p45: { ...base.merged.p45, ...r.merged?.p45 },
      p67: { ...base.merged.p67, ...r.merged?.p67 },
    },
  };
}

/** Swap the two pages of a spread. */
export function swapPages(doc: ZineDoc, spread: Spread): void {
  [doc.pages[spread.left], doc.pages[spread.right]] = [doc.pages[spread.right], doc.pages[spread.left]];
}

/** Move one spread's contents to another slot, everything else shifting along. */
export function moveSpread(doc: ZineDoc, from: number, to: number): void {
  if (from === to) return;
  const contents = SPREADS.map((s) => ({ left: doc.pages[s.left], right: doc.pages[s.right], merged: doc.merged[s.id] }));
  const [moved] = contents.splice(from, 1);
  contents.splice(to, 0, moved);
  SPREADS.forEach((s, i) => {
    doc.pages[s.left] = contents[i].left;
    doc.pages[s.right] = contents[i].right;
    doc.merged[s.id] = contents[i].merged;
  });
}

/**
 * Join a spread into one picture across both pages. The first photo found
 * comes across, as do both captions. Splitting again leaves the pages as they
 * were before the merge.
 */
export function mergeSpread(doc: ZineDoc, spread: Spread): void {
  const m = doc.merged[spread.id];
  const l = doc.pages[spread.left];
  const r = doc.pages[spread.right];
  m.on = true;
  m.photo ??= l.photo ?? r.photo ? { ...(l.photo ?? r.photo)!, panX: 0, panY: 0 } : null;
  if (!m.caption) m.caption = [l.caption, r.caption].map((c) => c.trim()).filter(Boolean).join(' ');
}

export function splitSpread(doc: ZineDoc, spread: Spread): void {
  doc.merged[spread.id].on = false;
}

/** Photos that will be printed, in reading order (for loading before export). */
export function photosInDoc(doc: ZineDoc): PhotoRef[] {
  const out: PhotoRef[] = [];
  const add = (p: PhotoRef | null) => p && out.push(p);
  add(doc.pages[COVER_PANEL].photo);
  for (const s of SPREADS) {
    if (doc.merged[s.id].on) add(doc.merged[s.id].photo);
    else {
      add(doc.pages[s.left].photo);
      add(doc.pages[s.right].photo);
    }
  }
  add(doc.pages[BACK_PANEL].photo);
  return out;
}

/** Pages in reading order, cover first: where "fill from the book" puts photos. */
export const READING_ORDER: readonly number[] = [COVER_PANEL, 6, 7, 3, 2, 1, 0, BACK_PANEL];

export function isEmpty(doc: ZineDoc): boolean {
  return (
    photosInDoc(doc).length === 0 &&
    !doc.cover.title && !doc.cover.subtitle && !doc.cover.author &&
    doc.pages.every((p) => !p.caption)
  );
}

/**
 * Colour the whole zine from one of Wada's combinations: its lightest colour
 * becomes the paper, the one that reads best on it the text, and the most
 * vivid the cover titles. Text that sits over a full-bleed photo keeps its
 * colour, since the paper colour isn't behind it.
 */
export function applyCombination(doc: ZineDoc, n: number): void {
  const colours = combination(n);
  if (!colours.length) return;
  const { paper, ink, accent } = roles(colours);
  doc.palette = n;
  const asInk = ink as Ink;
  doc.pages.forEach((p, i) => {
    p.tone = paper as Tone;
    if (i === COVER_PANEL || i === BACK_PANEL) return;
    if (p.fit === 'fit' || p.border !== 'none') p.ink = asInk;
  });
  for (const m of Object.values(doc.merged)) {
    m.tone = paper as Tone;
    if (m.border !== 'none') m.ink = asInk;
  }
  doc.cover.ink = accent as Ink;
  doc.back.ink = accent as Ink;
}
