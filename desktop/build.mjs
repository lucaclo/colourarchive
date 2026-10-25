// npm run app:build — the archive's server, built for the Mac app.
//
// Two things make this different from `npm run build`:
//
// - It builds against an empty archive, never this repository's. Whatever the
//   build reads ends up inside the app, and the app is handed to other people;
//   none of this Mac's photographs, notes or Scout locations may go with it.
//   Pages render on request instead (astro.config.mjs, COLOUR_ARCHIVE_BUILD),
//   from whichever folder the person chose.
// - It leaves public/img out of the build for the same reason, then checks the
//   result for any photograph id from src/data/photos.json and refuses to
//   finish if one is there.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'desktop', 'build');

const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'colour-archive-empty-'));
fs.rmSync(OUT, { recursive: true, force: true });

// public/ without img/, where this Mac's derivatives live. See astro.config.mjs.
const PUBLIC_COPY = path.join(ROOT, 'desktop', '.public');
fs.rmSync(PUBLIC_COPY, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), PUBLIC_COPY, {
  recursive: true,
  filter: (src) => path.relative(path.join(ROOT, 'public'), src).split(path.sep)[0] !== 'img',
});

const res = spawnSync('npx', ['--no-install', 'astro', 'build', '--outDir', OUT], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, COLOUR_ARCHIVE_DATA: empty, COLOUR_ARCHIVE_BUILD: 'desktop' },
});
fs.rmSync(empty, { recursive: true, force: true });
fs.rmSync(PUBLIC_COPY, { recursive: true, force: true });
if (res.status !== 0) process.exit(res.status ?? 1);

fs.rmSync(path.join(OUT, 'client', 'img'), { recursive: true, force: true });

// The leak check. Photo ids are long and distinctive, so finding one in the
// build means real data was baked in.
let ids = [];
try {
  ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'photos.json'), 'utf8')).map((p) => p.id).filter(Boolean);
} catch {
  /* no archive in this checkout: nothing that could leak */
}
const leaks = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(m?js|html|json|css|txt)$/.test(entry.name)) {
      const text = fs.readFileSync(p, 'utf8');
      const hit = ids.find((id) => text.includes(id));
      if (hit) leaks.push(`${path.relative(ROOT, p)} (photo ${hit})`);
    }
  }
};
walk(OUT);
if (leaks.length) {
  console.error(`\nThe app build contains this Mac's photographs:\n  ${leaks.join('\n  ')}\nNothing was packaged.`);
  process.exit(1);
}
console.log(`\nApp build ready in ${path.relative(ROOT, OUT)} — checked against ${ids.length} photo ids, none found.`);
