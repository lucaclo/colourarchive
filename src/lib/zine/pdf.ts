/**
 * A PDF of whole-sheet JPEGs, each page sized to the paper exactly: one for
 * an eight-page zine, two for sixteen.
 *
 * Written by hand rather than pulling in a PDF library: a catalog, a page
 * tree, and per page the page, its content stream and the image, with JPEG
 * bytes passed through as DCTDecode.
 */

const enc = new TextEncoder();

export interface PdfImage { jpeg: Uint8Array; pxW: number; pxH: number }

/** One page per JPEG, every page the same paper size. */
export function jpegsToPdf(images: readonly PdfImage[], ptW: number, ptH: number): Uint8Array<ArrayBuffer> {
  const w = ptW.toFixed(2);
  const h = ptH.toFixed(2);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`;

  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  // Objects: 1 catalog, 2 page tree, then three per page: page, contents, image.
  const pageObj = (i: number) => 3 + i * 3;
  // The binary comment line tells readers the file holds binary data.
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => push(`<< /Type /Pages /Kids [${images.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${images.length} >>`));
  images.forEach((img, i) => {
    const n = pageObj(i);
    object(n, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
          `/Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`,
      ),
    );
    object(n + 1, () => {
      push(`<< /Length ${enc.encode(content).length} >>\nstream\n`);
      push(content);
      push('endstream');
    });
    object(n + 2, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${img.pxW} /Height ${img.pxH} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`,
      );
      push(img.jpeg);
      push('\nendstream');
    });
  });

  const count = 3 + images.length * 3;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A one-page PDF holding a single JPEG. */
export function jpegToPdf(jpeg: Uint8Array, pxW: number, pxH: number, ptW: number, ptH: number): Uint8Array<ArrayBuffer> {
  return jpegsToPdf([{ jpeg, pxW, pxH }], ptW, ptH);
}
