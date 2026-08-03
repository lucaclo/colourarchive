/**
 * Typecheck the `<script>` blocks inside .astro pages.
 *
 * `tsc --noEmit` does not look inside .astro files at all, so every line of
 * client code in a page has been going out unchecked. That is not a theoretical
 * gap: it hid `day.dayEnd` on a type that only has `day.times.dayEnd` — which
 * threw the moment you picked a place — and a `preserveDrawingBuffer` option
 * that MapLibre v5 moved, so the map had been paying for it and the image
 * export would have come back blank.
 *
 * The fix is deliberately dumb. Each script block is written out beside its page
 * as a real .ts file, so its relative imports resolve exactly as they do in the
 * page, `tsc` is run over the project, and the temporary files are removed
 * whatever happens. No new dependency, and nothing to keep in sync.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/lib/paths.ts';

const PAGES_DIR = path.join(ROOT, 'src', 'pages');
/** Marks the throwaway files, so a crashed run leaves something recognisable. */
const PREFIX = '__typecheck__';

/** Script blocks that are actually TypeScript modules — not `is:inline` ones. */
function scriptBlocks(source: string): string[] {
  const blocks: string[] = [];
  const pattern = /<script(?![^>]*\bis:inline\b)[^>]*>\n?([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const body = match[1];
    if (body.trim()) blocks.push(body);
  }
  return blocks;
}

const written: string[] = [];

try {
  for (const entry of await fs.readdir(PAGES_DIR)) {
    if (!entry.endsWith('.astro')) continue;
    const source = await fs.readFile(path.join(PAGES_DIR, entry), 'utf8');
    const blocks = scriptBlocks(source);
    for (const [index, block] of blocks.entries()) {
      const name = `${PREFIX}${entry.replace('.astro', '')}${index ? `.${index}` : ''}.ts`;
      const target = path.join(PAGES_DIR, name);
      await fs.writeFile(target, block);
      written.push(target);
    }
  }

  if (!written.length) {
    console.log('No page scripts to check.');
    process.exit(0);
  }

  console.log(`Checking ${written.length} page script${written.length === 1 ? '' : 's'}…`);
  const result = spawnSync('npx', ['tsc', '--noEmit'], { cwd: ROOT, encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  // The temp filenames mean nothing to a reader; point at the page instead.
  const readable = output.replaceAll(PREFIX, '').replaceAll('src/pages/', 'src/pages/ (script of) ');

  if (result.status !== 0) {
    console.error(readable.trim());
    process.exitCode = 1;
  } else {
    console.log('Page scripts typecheck clean.');
  }
} finally {
  // Always, even on a throw — a stray .ts beside a page would be picked up by
  // the next build and shipped.
  await Promise.all(written.map((file) => fs.rm(file, { force: true })));
}
