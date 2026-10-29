/**
 * The book as a print-ready PDF: every page drawn at 300 dpi from the
 * originals, in the layout book-pages.ts gives the spread view, then written
 * one page at a time by pdf-pages.ts.
 *
 * Mac-only (it reads /photos), called from /api/book/pdf.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readManifest } from './manifest';
import { readBookCuration, curatedChapters } from './book';
import { checkPages, DEFAULT_TRIM, estimateSpineMM, padToEven, paginate, placements, TRIMS, withColophon, type Page, type PageChapter, type Trim, type TrimId } from './book-pages';
import { colophonLines, type ColophonPhoto } from './colophon';
import { readGpsLocations, readPlacedLocations } from './photo-locations';
import { reverseGeocode } from './scout/geocode';
import { oklchToHex } from './colour-search';
import { readableInk } from './color';
import { PdfPagesWriter } from './pdf-pages';
import { BOOK_PRINT_DIR, PHOTOS_DIR } from './paths';

const DPI = 300;
const PAPER = '#ffffff';
const px = (mm: number) => Math.round((mm * DPI) / 25.4);
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI'];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface BookPlan {
  trim: Trim;
  trimId: TrimId;
  pages: Page[];
  inkFor: Map<string, string>;
  fileFor: Map<string, string>;
  /** The colophon's lines, and the cover's year range ("2023–2026"). */
  colophon: string[];
  years: string;
}

export const BOOK_TITLE = 'Colour Archive';

/** Town names for the photos that have a place — the colophon's "In …".
 *  Cached on disk by geocode.ts, so a second build asks nobody. */
async function placeNames(ids: string[]): Promise<string[]> {
  const [placed, gps] = await Promise.all([readPlacedLocations(), readGpsLocations()]);
  const names: string[] = [];
  for (const id of ids) {
    const at = placed[id] ?? gps[id];
    if (!at) continue;
    const place = await reverseGeocode(at.lat, at.lon, 10);
    if (place.kind !== 'point') names.push(place.name);
  }
  return names;
}

/** The book as it stands in book.json, paginated for one trim. */
export async function planBook(trimId?: TrimId): Promise<BookPlan> {
  const [manifest, curation] = await Promise.all([readManifest(), readBookCuration()]);
  const id = trimId ?? curation.trim ?? DEFAULT_TRIM;
  const chapters = curatedChapters(manifest.chapters, curation);
  const inkFor = new Map<string, string>();
  const fileFor = new Map<string, string>();
  const pageChapters: PageChapter[] = chapters.map((ch) => {
    inkFor.set(ch.key, readableInk(ch.oklch));
    for (const p of ch.photos) fileFor.set(p.id, p.filename);
    return {
      key: ch.key,
      name: ch.name,
      colour: oklchToHex(ch.oklch),
      photos: ch.photos.map((p) => ({ id: p.id, width: p.width, height: p.height })),
    };
  });
  const pages = padToEven(withColophon(paginate(pageChapters, { treatment: curation.layout, blankBefore: curation.blankBefore })));
  const photos = chapters.flatMap((ch) => ch.photos);
  const colophon = colophonLines(
    photos.map((p): ColophonPhoto => ({ medium: p.medium, camera: p.exif.camera, lens: p.exif.lens, capturedAt: p.exif.capturedAt })),
    await placeNames(photos.map((p) => p.id)),
  );
  const yearsOf = photos.filter((p) => p.medium === 'digital' && p.exif.capturedAt).map((p) => p.exif.capturedAt!.slice(0, 4)).sort();
  const years = yearsOf.length ? (yearsOf[0] === yearsOf.at(-1) ? yearsOf[0] : `${yearsOf[0]}–${yearsOf.at(-1)}`) : '';
  return { trim: TRIMS[id], trimId: id, pages, inkFor, fileFor, colophon, years };
}

/** One page as a JPEG covering trim plus bleed (bleed 0 when not asked for). */
export async function renderPage(page: Page, trim: Trim, plan: Pick<BookPlan, 'inkFor' | 'fileFor' | 'colophon'>): Promise<{ jpeg: Buffer; w: number; h: number }> {
  const b = trim.bleedMM;
  const W = px(trim.widthMM + 2 * b);
  const H = px(trim.heightMM + 2 * b);
  const toPx = (mm: number) => px(mm + b);

  if (page.kind === 'colophon') {
    // Set low on the page, small, in the openers' serif.
    const short = Math.min(W, H);
    const size = short * 0.018;
    const lead = size * 1.6;
    const x = toPx(Math.min(trim.widthMM, trim.heightMM) * 0.12);
    const lines = plan.colophon;
    const y0 = H - toPx(Math.min(trim.widthMM, trim.heightMM) * 0.12) - lead * (lines.length - 1);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="100%" height="100%" fill="${PAPER}"/>
      <text x="${x}" y="${y0 - lead * 1.6}" fill="#1b1a18" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="${size * 1.3}">${esc(BOOK_TITLE)}</text>
      ${lines.map((l, i) => `<text x="${x}" y="${y0 + i * lead}" fill="#4a4640" font-family="Georgia, 'Times New Roman', serif" font-size="${size}">${esc(l)}</text>`).join('')}
    </svg>`;
    return { jpeg: await sharp(Buffer.from(svg)).flatten({ background: PAPER }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer(), w: W, h: H };
  }

  if (page.kind === 'opener') {
    const ink = plan.inkFor.get(page.chapterKey) ?? '#0a0a0a';
    const short = Math.min(W, H);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="100%" height="100%" fill="${page.colour}"/>
      <text x="50%" y="${H / 2 - short * 0.06}" text-anchor="middle" fill="${ink}" fill-opacity="0.65"
        font-family="Georgia, 'Times New Roman', serif" font-size="${short * 0.022}" letter-spacing="${short * 0.006}">CHAPTER ${ROMAN[page.index] ?? page.index + 1}</text>
      <text x="50%" y="${H / 2 + short * 0.05}" text-anchor="middle" fill="${ink}"
        font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="${short * 0.09}">${esc(page.name)}</text>
    </svg>`;
    const jpeg = await sharp(Buffer.from(svg)).flatten({ background: page.colour }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
    return { jpeg, w: W, h: H };
  }

  const canvas = sharp({ create: { width: W, height: H, channels: 3, background: PAPER } });
  if (page.kind === 'blank') {
    return { jpeg: await canvas.jpeg({ quality: 92 }).toBuffer(), w: W, h: H };
  }

  const layers: sharp.OverlayOptions[] = [];
  for (const pl of placements(page, trim)) {
    const file = plan.fileFor.get(pl.id);
    if (!file) continue;
    const boxW = Math.max(1, px(pl.box.w)), boxH = Math.max(1, px(pl.box.h));
    // Clip, in canvas pixels, kept inside the canvas.
    const cx0 = Math.max(0, toPx(pl.clip.x)), cy0 = Math.max(0, toPx(pl.clip.y));
    const cx1 = Math.min(W, toPx(pl.clip.x + pl.clip.w)), cy1 = Math.min(H, toPx(pl.clip.y + pl.clip.h));
    const bx0 = toPx(pl.box.x), by0 = toPx(pl.box.y);
    const img = sharp(path.join(PHOTOS_DIR, file), { failOn: 'none' })
      .rotate()
      .resize(boxW, boxH, { fit: 'cover' })
      .toColorspace('srgb');
    const left = cx0 - bx0, top = cy0 - by0;
    const w = Math.min(cx1 - cx0, boxW - left), h = Math.min(cy1 - cy0, boxH - top);
    if (w <= 0 || h <= 0) continue;
    const input = await img.extract({ left: Math.max(0, left), top: Math.max(0, top), width: w, height: h }).jpeg({ quality: 95 }).toBuffer();
    layers.push({ input, left: cx0, top: cy0 });
  }
  const jpeg = await canvas.composite(layers).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  return { jpeg, w: W, h: H };
}

export interface PrintProgress { done: number; total: number }

/**
 * Build the PDF for a trim. `bleed: false` prints at the trimmed size (for a
 * home printer or a PDF to look at); `true` adds the trim's bleed all round.
 * Returns the file's path and the page check.
 */
export async function buildBookPdf(
  opts: { trim?: TrimId; bleed: boolean },
  onProgress?: (p: PrintProgress) => void,
): Promise<{ file: string; name: string; check: ReturnType<typeof checkPages> }> {
  const plan = await planBook(opts.trim);
  const trim: Trim = opts.bleed ? plan.trim : { ...plan.trim, bleedMM: 0 };
  await fs.mkdir(BOOK_PRINT_DIR, { recursive: true });
  const name = `colour-archive-${plan.trimId}${opts.bleed ? '-bleed' : ''}.pdf`;
  const file = path.join(BOOK_PRINT_DIR, name);
  // Unique per build: two builds at once must not share a temporary file.
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  const pdf = await PdfPagesWriter.open(tmp);
  try {
    for (let i = 0; i < plan.pages.length; i++) {
      const { jpeg, w, h } = await renderPage(plan.pages[i], trim, plan);
      await pdf.addPage(jpeg, w, h, trim);
      onProgress?.({ done: i + 1, total: plan.pages.length });
    }
    await pdf.close();
    await fs.rename(tmp, file);
  } catch (err) {
    await pdf.abort();
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return { file, name, check: checkPages(plan.pages.length, plan.trim) };
}

/**
 * The cover as one spread — back, spine, front — for services that print a
 * wrap-around cover from its own file (issue #140). The front carries the
 * title and the years the photographs span; the spine carries them too,
 * reading top to bottom, when it is wide enough to hold type.
 */
export async function buildCoverPdf(opts: { trim?: TrimId; bleed: boolean; spineMM?: number }): Promise<{ file: string; name: string; spineMM: number }> {
  const plan = await planBook(opts.trim);
  const t = plan.trim;
  const b = opts.bleed ? t.bleedMM : 0;
  const spineMM = opts.spineMM && opts.spineMM > 0 && opts.spineMM < 120 ? opts.spineMM : estimateSpineMM(plan.pages.length);
  const fullW = t.widthMM * 2 + spineMM;
  const W = px(fullW + 2 * b), H = px(t.heightMM + 2 * b);
  const X = (mm: number) => px(mm + b);
  const short = px(Math.min(t.widthMM, t.heightMM));
  const ground = '#14120f', ink = '#efebe4';
  const frontX = X(t.widthMM + spineMM + t.widthMM / 2);
  const spineX = X(t.widthMM + spineMM / 2);
  const spineText = spineMM >= 5
    ? `<text transform="translate(${spineX} ${H / 2}) rotate(90)" text-anchor="middle" dominant-baseline="central" fill="${ink}"
         font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="${Math.min(px(spineMM) * 0.5, short * 0.04)}">${esc(BOOK_TITLE)}${plan.years ? `  ·  ${esc(plan.years)}` : ''}</text>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="${ground}"/>
    <text x="${frontX}" y="${H / 2}" text-anchor="middle" fill="${ink}" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="${short * 0.09}">${esc(BOOK_TITLE)}</text>
    ${plan.years ? `<text x="${frontX}" y="${H / 2 + short * 0.08}" text-anchor="middle" fill="${ink}" fill-opacity="0.65" font-family="Georgia, 'Times New Roman', serif" font-size="${short * 0.025}" letter-spacing="${short * 0.004}">${esc(plan.years)}</text>` : ''}
    ${spineText}
  </svg>`;
  const jpeg = await sharp(Buffer.from(svg)).flatten({ background: ground }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  await fs.mkdir(BOOK_PRINT_DIR, { recursive: true });
  const name = `colour-archive-${plan.trimId}-cover${opts.bleed ? '-bleed' : ''}.pdf`;
  const file = path.join(BOOK_PRINT_DIR, name);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const pdf = await PdfPagesWriter.open(tmp);
  try {
    await pdf.addPage(jpeg, W, H, { widthMM: fullW, heightMM: t.heightMM, bleedMM: b });
    await pdf.close();
    await fs.rename(tmp, file);
  } catch (err) {
    await pdf.abort();
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return { file, name, spineMM };
}
