// The archive's server, as the Mac app runs it.
//
// Started by main.cjs in an Electron utility process (Electron's own Node, so
// the person needs no Node of their own). It is the production Astro server
// from `npm run app:build`, with one addition: photographs' derivatives are
// written to the person's archive folder as they are uploaded, and a built
// site only serves the files that existed when it was built, so `/img/*` is
// served from that folder here before anything else sees the request.
//
// Listens on 127.0.0.1 only — this is one person's archive on one Mac — and
// tells main.cjs the port once it is ready, or why it could not start.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.COLOUR_ARCHIVE_DATA;
const PORT = Number(process.env.PORT);
// Matches IMG_DIR in src/lib/paths.ts when COLOUR_ARCHIVE_DATA is set.
const IMG_DIR = path.join(DATA, '.archive', 'public', 'img');

const TYPES = {
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const tell = (msg) => process.parentPort?.postMessage(msg);

function serveImage(req, res, next) {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/img/')) return next();
  let name;
  try {
    name = decodeURIComponent(url.pathname.slice('/img/'.length));
  } catch {
    res.writeHead(400).end();
    return;
  }
  // One flat folder: no subdirectories, so nothing with a slash is ever valid.
  if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) {
    res.writeHead(404).end();
    return;
  }
  const file = path.join(IMG_DIR, name);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return next();
    const modified = st.mtime.toUTCString();
    if (req.headers['if-modified-since'] === modified) {
      res.writeHead(304).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': st.size,
      'Last-Modified': modified,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

try {
  process.env.ASTRO_NODE_AUTOSTART = 'disabled';
  const { handler } = await import(pathToFileURL(path.join(here, 'build', 'server', 'entry.mjs')).href);
  const server = http.createServer((req, res) => serveImage(req, res, () => handler(req, res)));
  // Uploads of large originals take a while; never cut them off mid-request.
  server.requestTimeout = 0;
  server.on('error', (err) => {
    tell({ type: 'error', message: err.code === 'EADDRINUSE' ? `port ${PORT} is in use` : String(err.message ?? err) });
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Colour Archive serving ${DATA} at http://127.0.0.1:${PORT}/`);
    tell({ type: 'ready', port: PORT });
    // Issue #137: start reading the iCloud inbox now, whether or not a window
    // ever asks for a page. The loop then lives in this server's process.
    http.get(`http://127.0.0.1:${PORT}/api/inbox`, (res) => res.resume()).on('error', (err) => console.warn('[inbox] could not start', err.message));
  });
} catch (err) {
  console.error(err);
  tell({ type: 'error', message: String(err?.message ?? err) });
  process.exit(1);
}
