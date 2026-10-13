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
import { checkPages, DEFAULT_TRIM, padToEven, paginate, placements, TRIMS, type Page, type PageChapter, type Trim, type TrimId } from './book-pages';
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
  const pages = padToEven(paginate(pageChapters, { treatment: curation.layout, blankBefore: curation.blankBefore }));
  return { trim: TRIMS[id], trimId: id, pages, inkFor, fileFor };
}

/** One page as a JPEG covering trim plus bleed (bleed 0 when not asked for). */
export async function renderPage(page: Page, trim: Trim, plan: Pick<BookPlan, 'inkFor' | 'fileFor'>): Promise<{ jpeg: Buffer; w: number; h: number }> {
  const b = trim.bleedMM;
  const W = px(trim.widthMM + 2 * b);
  const H = px(trim.heightMM + 2 * b);
  const toPx = (mm: number) => px(mm + b);

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
