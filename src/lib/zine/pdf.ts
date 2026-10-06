/**
 * A one-page PDF holding a single JPEG, sized to the paper exactly.
 *
 * That is all a one-sheet zine needs, so it's written by hand here rather
 * than pulling in a PDF library: a catalog, a page tree, one page, its
 * content stream and the image, with JPEG bytes passed through as DCTDecode.
 */

const enc = new TextEncoder();

export function jpegToPdf(jpeg: Uint8Array, pxW: number, pxH: number, ptW: number, ptH: number): Uint8Array<ArrayBuffer> {
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

  // The binary comment line tells readers the file holds binary data.
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  object(3, () =>
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        '/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>',
    ),
  );
  object(4, () => {
    push(`<< /Length ${enc.encode(content).length} >>\nstream\n`);
    push(content);
    push('endstream');
  });
  object(5, () => {
    push(
      `<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    );
    push(jpeg);
    push('\nendstream');
  });

  const xref = length;
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (let n = 1; n <= 5; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
