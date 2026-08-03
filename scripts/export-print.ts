/**
 * Print-ready export. Builds print.html from the manifest — one full-bleed
 * plate per photograph (originals, max quality) with a coloured chapter divider
 * before each chapter. Open it in a browser and Print → Save as PDF.
 * Page size is a sensible default; tune @page for your book.
 *
 *   npm run export:print
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { readManifest } from '../src/lib/manifest';
import { oklchCss } from '../src/lib/color';
import { ROOT } from '../src/lib/paths';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const titleFg = (L: number) => (L > 0.62 ? '#0a0a0a' : '#f6f6f4');

async function main() {
  const manifest = await readManifest();
  const roman = (n: number) =>
    ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI'][n] ?? String(n + 1);

  let pages = '';
  manifest.chapters.forEach((ch, ci) => {
    const bg = oklchCss(ch.oklch);
    const fg = titleFg(ch.oklch.L);
    pages += `<section class="page divider" style="background:${bg};color:${fg}">
      <p class="k">Chapter ${roman(ci)}</p><h1>${esc(ch.name)}</h1></section>\n`;
    for (const p of ch.photos) {
      // Originals live in /photos; referenced relative to this file at repo root.
      pages += `<section class="page plate"><img src="photos/${esc(p.filename)}" alt=""></section>\n`;
    }
  });

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Colour Archive — print</title>
<style>
  @page { size: 297mm 210mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #111112; }
  .page { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; page-break-after: always; break-after: page; }
  .plate { background: #111112; }
  .plate img { max-width: 100%; max-height: 100vh; object-fit: contain; display: block; }
  .divider { flex-direction: column; font-family: Georgia, 'Times New Roman', serif; text-align: center; }
  .divider .k { font-size: 10pt; letter-spacing: 0.3em; text-transform: uppercase; opacity: 0.65; margin-bottom: 10pt; }
  .divider h1 { font-size: 46pt; font-weight: 500; font-style: italic; }
  @media screen { .page { outline: 1px solid #333; } body { display: flex; flex-direction: column; align-items: center; } }
</style></head><body>
${pages}</body></html>`;

  const out = path.join(ROOT, 'print.html');
  await fs.writeFile(out, html);
  console.log(`Wrote ${out} — ${manifest.count} plates across ${manifest.chapters.length} chapters.`);
  console.log('Open it in a browser and Print → Save as PDF. Tune @page in the file for your book size.');
}

main().catch((err) => { console.error(err); process.exit(1); });
