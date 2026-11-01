/**
 * Work prints (issue #147): the book's photographs small, sixteen to an A4
 * page, each on its own white card with a short code beneath, to cut out and
 * lay on the floor. The cut lines are faint grey. The list of what was
 * printed is kept beside the PDF, so reading the floor back only has to tell
 * these photographs apart, not the whole archive.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { PdfPagesWriter } from '../pdf-pages';
import { BOOK_PRINT_DIR, PHOTOS_DIR } from '../paths';

export const A4 = { widthMM: 210, heightMM: 297 };
export const COLS = 4, ROWS = 4;
const MARGIN = 10, GAP = 4, DPI = 200;
const px = (mm: number) => Math.round((mm * DPI) / 25.4);

export interface Cell { x: number; y: number; w: number; h: number }

/** Where each card sits on a page, in millimetres. */
export function cells(): Cell[] {
  const w = (A4.widthMM - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
  const h = (A4.heightMM - 2 * MARGIN - (ROWS - 1) * GAP) / ROWS;
  const out: Cell[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) out.push({ x: MARGIN + c * (w + GAP), y: MARGIN + r * (h + GAP), w, h });
  return out;
}
/** The photograph's share of a card's height; the code goes below. */
export const PHOTO_SHARE = 0.8;

export interface WorkPrint { id: string; filename: string; code: string }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One page as a JPEG at 200 dpi. */
export async function renderWorkPage(prints: WorkPrint[], photosDir = PHOTOS_DIR): Promise<{ jpeg: Buffer; w: number; h: number }> {
  const W = px(A4.widthMM), H = px(A4.heightMM);
  const layers: sharp.OverlayOptions[] = [];
  const marks: string[] = [];
  const grid = cells();
  for (let i = 0; i < prints.length && i < grid.length; i++) {
    const c = grid[i];
    const pad = 2.5;
    const boxW = px(c.w - 2 * pad), boxH = px(c.h * PHOTO_SHARE - 2 * pad);
    const img = await sharp(path.join(photosDir, prints[i].filename), { failOn: 'none' })
      .rotate().resize(boxW, boxH, { fit: 'inside' }).toColorspace('srgb').jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
    layers.push({ input: img.data, left: px(c.x + pad) + Math.round((boxW - img.info.width) / 2), top: px(c.y + pad) + Math.round((boxH - img.info.height) / 2) });
    marks.push(`<rect x="${px(c.x)}" y="${px(c.y)}" width="${px(c.w)}" height="${px(c.h)}" fill="none" stroke="#cfcfcf" stroke-width="2"/>`);
    marks.push(`<text x="${px(c.x + c.w / 2)}" y="${px(c.y + c.h * (PHOTO_SHARE + 0.11))}" text-anchor="middle" font-family="Menlo, monospace" font-size="${px(3.2)}" fill="#333">${esc(prints[i].code)}</text>`);
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${marks.join('')}</svg>`);
  const jpeg = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
    .composite([...layers, { input: svg, left: 0, top: 0 }]).jpeg({ quality: 90 }).toBuffer();
  return { jpeg, w: W, h: H };
}

export const WORKPRINTS_LIST = () => path.join(BOOK_PRINT_DIR, 'workprints.json');

/** The PDF, and the list of what's on it. */
export async function buildWorkPrints(prints: WorkPrint[]): Promise<{ file: string; name: string; pages: number }> {
  await fs.mkdir(BOOK_PRINT_DIR, { recursive: true });
  const name = 'colour-archive-workprints.pdf';
  const file = path.join(BOOK_PRINT_DIR, name);
  const tmp = `${file}.${process.pid}.tmp`;
  const pdf = await PdfPagesWriter.open(tmp);
  const per = COLS * ROWS;
  try {
    for (let i = 0; i < prints.length; i += per) {
      const { jpeg, w, h } = await renderWorkPage(prints.slice(i, i + per));
      await pdf.addPage(jpeg, w, h, { ...A4, bleedMM: 0 });
    }
    await pdf.close();
    await fs.rename(tmp, file);
  } catch (err) {
    await pdf.abort();
    await fs.rm(tmp, { force: true });
    throw err;
  }
  await fs.writeFile(WORKPRINTS_LIST(), JSON.stringify({ at: new Date().toISOString(), ids: prints.map((p) => p.id) }));
  return { file, name, pages: Math.ceil(prints.length / per) };
}
