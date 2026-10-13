/**
 * A many-page PDF where every page is one JPEG, written straight to disk.
 *
 * The book can run to a hundred pages at 300 dpi, so nothing is held in
 * memory past the page being written: each page's image, content stream and
 * page object go out as soon as they're added, and the page tree and xref
 * table are written at the end, when the offsets are known. Same hand-written
 * approach as the zine's one-page writer (zine/pdf.ts), plus TrimBox and
 * BleedBox so a print service knows where to cut.
 *
 * Colour: JPEG bytes pass through as DCTDecode in DeviceRGB, which readers and
 * print services treat as sRGB. That's what the pages are rendered in.
 */
import fs from 'node:fs/promises';

const enc = new TextEncoder();
const pt = (mm: number) => (mm * 72) / 25.4;
const n2 = (v: number) => v.toFixed(2);

export interface PdfPageSize {
  /** Trimmed page, millimetres. */
  widthMM: number;
  heightMM: number;
  /** Bleed on every edge, millimetres; the image covers trim + 2 × bleed. */
  bleedMM: number;
}

export class PdfPagesWriter {
  private offset = 0;
  private offsets: number[] = [];
  private kids: number[] = [];
  private next = 3; // 1 = catalog, 2 = page tree (written last)

  private constructor(private file: fs.FileHandle) {}

  static async open(path: string): Promise<PdfPagesWriter> {
    const w = new PdfPagesWriter(await fs.open(path, 'w'));
    await w.push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    await w.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    return w;
  }

  private async push(chunk: string | Uint8Array) {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    await this.file.write(bytes);
    this.offset += bytes.length;
  }

  private async object(n: number, body: string, stream?: Uint8Array) {
    this.offsets[n] = this.offset;
    await this.push(`${n} 0 obj\n${body}`);
    if (stream) {
      await this.push('\nstream\n');
      await this.push(stream);
      await this.push('\nendstream');
    }
    await this.push('\nendobj\n');
  }

  async addPage(jpeg: Uint8Array, pxW: number, pxH: number, size: PdfPageSize) {
    const b = pt(size.bleedMM);
    const W = pt(size.widthMM) + 2 * b;
    const H = pt(size.heightMM) + 2 * b;
    const img = this.next++, content = this.next++, page = this.next++;
    await this.object(
      img,
      `<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
      jpeg,
    );
    const ops = enc.encode(`q ${n2(W)} 0 0 ${n2(H)} 0 0 cm /Im0 Do Q\n`);
    await this.object(content, `<< /Length ${ops.length} >>`, ops);
    const trim = `[${n2(b)} ${n2(b)} ${n2(W - b)} ${n2(H - b)}]`;
    await this.object(
      page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(W)} ${n2(H)}] /BleedBox [0 0 ${n2(W)} ${n2(H)}] /TrimBox ${trim} ` +
        `/Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`,
    );
    this.kids.push(page);
  }

  async close() {
    await this.object(2, `<< /Type /Pages /Kids [${this.kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${this.kids.length} >>`);
    const xref = this.offset;
    let table = `xref\n0 ${this.next}\n0000000000 65535 f \n`;
    for (let i = 1; i < this.next; i++) table += `${String(this.offsets[i]).padStart(10, '0')} 00000 n \n`;
    await this.push(table);
    await this.push(`trailer\n<< /Size ${this.next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    await this.file.close();
  }

  /** Give up: close the handle without finishing the file. */
  async abort() {
    await this.file.close().catch(() => {});
  }
}
