/**
 * Vendor the web fonts into public/fonts and print the @font-face block.
 *
 * The archive self-hosts its type. Loading it from fonts.googleapis.com meant a
 * render-blocking stylesheet on a third-party origin before any type could
 * paint, and it was the one part of the archive that did not survive going
 * offline — the iPad snapshot fell back to Georgia the moment the Mac was
 * unreachable.
 *
 * Run this only when the type changes (a new DEFAULT_THEME needs different
 * families, or you want another weight). It downloads the latin + latin-ext
 * subsets and writes the rules to stdout; paste them over the @font-face block
 * at the top of src/styles/global.css.
 *
 *   npm run fonts
 *
 * Fraunces is requested with the optical-size axis as a RANGE (opsz@9..144), so
 * the files stay variable on opsz and `font-optical-sizing: auto` still
 * sharpens the hairlines as the chapter titles grow. Asking for a single opsz
 * value would silently flatten that.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/lib/paths';

// Exactly what the baked-in theme (Whisper) uses. Keep in sync with
// --font-display / --font-label in src/styles/global.css.
const QUERY =
  'family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500;1,9..144,600' +
  '&family=JetBrains+Mono:wght@400;500' +
  '&display=swap';

// Only the subsets this archive's text can actually reach. Cyrillic, Greek and
// Vietnamese faces would be ~40 more files that no page here ever requests.
const SUBSETS = new Set(['latin', 'latin-ext']);

// Google serves woff2 only to browsers that ask like one.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const FONT_DIR = path.join(ROOT, 'public', 'fonts');

async function main() {
  const res = await fetch(`https://fonts.googleapis.com/css2?${QUERY}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Google Fonts returned ${res.status}`);
  const css = await res.text();

  await fs.mkdir(FONT_DIR, { recursive: true });

  const blocks = [...css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{(.*?)\}/gs)];
  const rules: string[] = [];
  const written = new Map<string, string>();

  for (const [, subset, body] of blocks) {
    if (!SUBSETS.has(subset)) continue;
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
    const style = /font-style:\s*([^;]+);/.exec(body)?.[1]?.trim();
    const weight = /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim();
    const url = /url\((https:\/\/[^)]+)\)/.exec(body)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim();
    if (!family || !style || !weight || !url || !range) continue;

    const file = `${family.toLowerCase().replace(/\s+/g, '-')}-${style}-${weight.replace(/\s+/g, '')}-${subset.replace('-', '')}.woff2`;
    if (!written.has(file)) {
      const font = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!font.ok) throw new Error(`${file}: ${font.status}`);
      const bytes = Buffer.from(await font.arrayBuffer());
      await fs.writeFile(path.join(FONT_DIR, file), bytes);
      written.set(file, url);
      console.error(`  ${file.padEnd(48)} ${(bytes.length / 1024).toFixed(1)} kB`);
    }

    rules.push(
      `@font-face {\n` +
        `  font-family: '${family}';\n` +
        `  font-style: ${style};\n` +
        `  font-weight: ${weight};\n` +
        `  font-display: swap;\n` +
        `  src: url('/fonts/${file}') format('woff2');\n` +
        `  unicode-range: ${range};\n` +
        `}`,
    );
  }

  console.error(`\n${written.size} files in public/fonts. @font-face block follows on stdout.\n`);
  console.log(rules.join('\n'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
