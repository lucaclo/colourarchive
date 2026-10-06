import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PANELS, SPREADS, SLIDES, PAPER, isFlipped, panelRect, pageAspect, sheetPixels, sheetPoints,
  MAX_CANVAS_PIXELS, COVER_PANEL, BACK_PANEL,
} from './imposition';
import { jpegToPdf } from './pdf';

describe('the sheet layout', () => {
  it('holds each of the eight pages exactly once', () => {
    assert.deepEqual(PANELS.map((p) => p.page).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(PANELS.map((p) => p.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('prints the top row upside down and the bottom row upright', () => {
    assert.deepEqual(PANELS.map((p) => isFlipped(p.index)), [true, true, true, true, false, false, false, false]);
  });

  it('puts the cover and back cover side by side on the bottom row', () => {
    assert.equal(PANELS[COVER_PANEL].page, 1);
    assert.equal(PANELS[BACK_PANEL].page, 8);
    assert.equal(PANELS[COVER_PANEL].row, 1);
    assert.equal(Math.abs(PANELS[COVER_PANEL].col - PANELS[BACK_PANEL].col), 1);
  });

  it('pairs each spread as consecutive pages that sit next to each other on the sheet', () => {
    for (const s of SPREADS) {
      const l = PANELS[s.left];
      const r = PANELS[s.right];
      assert.equal(r.page, l.page + 1, s.label);
      assert.equal(l.row, r.row, s.label);
      assert.equal(Math.abs(l.col - r.col), 1, s.label);
      // Upright, the left page is to the left. Upside down, it reads from the right.
      assert.equal(l.col < r.col, l.row === 1, s.label);
    }
  });

  it('edits the zine as cover, three spreads, back', () => {
    assert.deepEqual(SLIDES.map((s) => s.label), ['Cover', 'Pages 2–3', 'Pages 4–5', 'Pages 6–7', 'Back cover']);
  });

  it('splits the sheet into four columns and two rows', () => {
    assert.deepEqual(panelRect(0, 400, 200), { x: 0, y: 0, w: 100, h: 100 });
    assert.deepEqual(panelRect(7, 400, 200), { x: 300, y: 100, w: 100, h: 100 });
  });
});

describe('paper', () => {
  it('gives tall pages on every size', () => {
    for (const id of Object.keys(PAPER) as (keyof typeof PAPER)[]) assert.ok(pageAspect(id) < 1, id);
  });

  it('renders Letter and A4 at a full 300 DPI', () => {
    assert.deepEqual(sheetPixels('letter'), { w: 3300, h: 2550, dpi: 300 });
    assert.equal(sheetPixels('a4').dpi, 300);
  });

  it('steps A3 down just enough to stay inside the mobile canvas limit', () => {
    const s = sheetPixels('a3');
    assert.ok(s.w * s.h <= MAX_CANVAS_PIXELS);
    assert.ok(s.dpi >= 280 && s.dpi < 300);
  });

  it('sizes the PDF page to the paper in points', () => {
    const a4 = sheetPoints('a4');
    assert.ok(Math.abs(a4.w - 841.89) < 0.01 && Math.abs(a4.h - 595.28) < 0.01);
  });
});

describe('jpegToPdf', () => {
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const pdf = jpegToPdf(fakeJpeg, 3300, 2550, 792, 612);
  const text = new TextDecoder('latin1').decode(pdf);

  it('writes a PDF header and footer', () => {
    assert.ok(text.startsWith('%PDF-1.4'));
    assert.ok(text.trimEnd().endsWith('%%EOF'));
  });

  it('sizes the page and the image as asked', () => {
    assert.match(text, /\/MediaBox \[0 0 792\.00 612\.00\]/);
    assert.match(text, /\/Width 3300 \/Height 2550/);
    assert.match(text, /\/Filter \/DCTDecode \/Length 9/);
  });

  it('points the xref at the real byte offset of every object', () => {
    const xrefAt = Number(text.match(/startxref\n(\d+)/)![1]);
    assert.ok(text.slice(xrefAt).startsWith('xref'));
    const offsets = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    assert.equal(offsets.length, 5);
    // Byte offsets: decode as latin1 so one char is one byte.
    offsets.forEach((o, i) => assert.ok(text.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  });
});
