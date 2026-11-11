// The archive's server, as the Mac app runs it.
//
// Started by main.cjs in an Electron utility process (Electron's own Node, so
// the person needs no Node of their own). It is the production Astro server
// from `npm run app:build`, with one addition: photographs' derivatives are
// written to the person's archive folder as they are uploaded, and a built
// site only serves the files that existed when it was built, so `/img/*` is
// served from that folder here before anything else sees the request.
//
// Listens on 127.0.0.1 for the Mac's own window, and tells main.cjs the port
// once it is ready, or why it could not start. With "Let My iPad In" switched
// on (issue #138) it also serves the home network: the archive over HTTPS on
// LAN_PORT, and a plain-HTTP setup page on LAN_SETUP_PORT that gives the iPad
// the certificate it needs to trust the first. Nothing else is served there.
// With "Let My Phone In From Anywhere" on, a third listener on 127.0.0.1
// serves the archive behind a password (remote-gate.mjs) for a Tailscale
// Funnel to carry to the internet; it never listens on the network itself.

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGate } from './remote-gate.mjs';

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

const LAN_PORT = Number(process.env.LAN_PORT) || 0;
const LAN_SETUP_PORT = Number(process.env.LAN_SETUP_PORT) || 0;
const LAN_HOST = process.env.LAN_HOST || '';
const TLS_KEY = process.env.LAN_TLS_KEY;
const TLS_CERT = process.env.LAN_TLS_CERT;
const TLS_CA = process.env.LAN_TLS_CA;
const REMOTE_PORT = Number(process.env.REMOTE_PORT) || 0;
const REMOTE_FILE = process.env.REMOTE_FILE || '';
const REMOTE_HOST = process.env.REMOTE_HOST || '';
// The public read-only site, which asks /__ping whether this Mac is up.
const PUBLIC_SITE = 'https://colourarchive.netlify.app';

// The setup page, in the archive's plain words. Inline: it has to work before
// the iPad trusts anything this Mac serves.
function setupPage() {
  const archive = `https://${LAN_HOST}:${LAN_PORT}/get`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Colour Archive on this Mac</title>
<style>
  :root { color-scheme: light dark; --fg: #1b1a18; --bg: #f6f3ee; --muted: #6d675f; --rule: #d9d3ca; }
  @media (prefers-color-scheme: dark) { :root { --fg: #efebe4; --bg: #100f0e; --muted: #a39d94; --rule: #34302b; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.5 -apple-system, system-ui, sans-serif; }
  main { max-width: 34rem; margin: 0 auto; padding: 3rem 1.25rem; }
  h1 { font: italic 500 2rem/1.1 Georgia, serif; margin: 0 0 1.5rem; }
  ol { padding-left: 1.3rem; } li { margin: 0 0 0.9rem; }
  a.btn { display: inline-block; padding: 0.6rem 1.1rem; border-radius: 999px; background: var(--fg); color: var(--bg); text-decoration: none; font-weight: 600; }
  code { font-size: 0.9em; word-break: break-all; }
  a { color: inherit; }
  p.small { color: var(--muted); font-size: 0.85rem; border-top: 1px solid var(--rule); padding-top: 1rem; margin-top: 2rem; }
</style></head><body><main>
<h1>Colour Archive on this Mac</h1>
<p>Once per iPad or iPhone, so it trusts this Mac:</p>
<ol>
  <li><a class="btn" href="/colour-archive.crt">Download the certificate</a><br>Tap <b>Allow</b>, then <b>Close</b>.</li>
  <li>In <b>Settings</b>, tap <b>Profile Downloaded</b> near the top, then <b>Install</b>.</li>
  <li>In <b>Settings › General › About › Certificate Trust Settings</b>, turn on <b>Colour Archive on ${LAN_HOST.replace(/\.local$/, '')}</b>.</li>
  <li>Open <a href="${archive}"><code>${archive}</code></a> and add it to your Home Screen.</li>
</ol>
<p class="small">The Mac has to be awake with Colour Archive open, on the same Wi-Fi.</p>
</main></body></html>`;
}

function serveSetup(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/colour-archive.crt' && TLS_CA) {
    res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="Colour Archive.crt"' });
    return res.end(fs.readFileSync(TLS_CA));
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(setupPage());
  }
  // Anything else is the archive's, and the archive is only served over HTTPS.
  res.writeHead(302, { Location: `https://${LAN_HOST}:${LAN_PORT}${url.pathname}${url.search}` }).end();
}

/** The home-network side. Its failure never takes the Mac's own window down. */
function listenLan(app) {
  if (!LAN_PORT || !TLS_KEY || !TLS_CERT) return;
  const fail = (what) => (err) => {
    console.warn(`[lan] ${what}:`, err.message);
    tell({ type: 'lan', ok: false, message: err.code === 'EADDRINUSE' ? `Port ${err.port ?? ''} is in use.` : String(err.message ?? err) });
  };
  try {
    const secure = https.createServer({ key: fs.readFileSync(TLS_KEY), cert: fs.readFileSync(TLS_CERT) }, app);
    secure.requestTimeout = 0;
    secure.on('error', fail('archive'));
    secure.listen(LAN_PORT, '0.0.0.0', () => {
      console.log(`Colour Archive serving the home network at https://${LAN_HOST}:${LAN_PORT}/`);
      tell({ type: 'lan', ok: true });
    });
    if (LAN_SETUP_PORT) {
      const setup = http.createServer(serveSetup);
      setup.on('error', fail('setup page'));
      setup.listen(LAN_SETUP_PORT, '0.0.0.0');
    }
  } catch (err) {
    fail('certificate')(err);
  }
}

/** From anywhere: the archive behind its password, for the tunnel to carry. */
function listenRemote(app) {
  if (!REMOTE_PORT || !REMOTE_FILE) return;
  const gated = createGate(app, {
    file: REMOTE_FILE,
    publicHost: REMOTE_HOST,
    pingOrigins: [PUBLIC_SITE],
    // The Mac window's own origin, which astro.config's allowedDomains trusts.
    forward: { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` },
  });
  const remote = http.createServer((req, res) => {
    gated(req, res).catch((err) => {
      console.warn('[remote]', err.message);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  remote.requestTimeout = 0;
  remote.on('error', (err) => {
    console.warn('[remote]', err.message);
    tell({ type: 'remote', ok: false, message: err.code === 'EADDRINUSE' ? `Port ${REMOTE_PORT} is in use.` : String(err.message ?? err) });
  });
  // Localhost only: the funnel is the one way in from outside.
  remote.listen(REMOTE_PORT, '127.0.0.1', () => {
    console.log(`Colour Archive serving the remote gate at http://127.0.0.1:${REMOTE_PORT}/`);
    tell({ type: 'remote', ok: true });
  });
}

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
  const app = (req, res) => serveImage(req, res, () => handler(req, res));
  const server = http.createServer(app);
  // Uploads of large originals take a while; never cut them off mid-request.
  server.requestTimeout = 0;
  server.on('error', (err) => {
    tell({ type: 'error', message: err.code === 'EADDRINUSE' ? `port ${PORT} is in use` : String(err.message ?? err) });
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Colour Archive serving ${DATA} at http://127.0.0.1:${PORT}/`);
    tell({ type: 'ready', port: PORT });
    // Issues #137 and #142: start the iCloud inbox and the kept-spot
    // notifications now, whether or not a window ever asks for a page. The
    // loops then live in this server's process.
    http.get(`http://127.0.0.1:${PORT}/api/background`, (res) => res.resume()).on('error', (err) => console.warn('[background] could not start', err.message));
    listenLan(app);
    listenRemote(app);
  });
} catch (err) {
  console.error(err);
  tell({ type: 'error', message: String(err?.message ?? err) });
  process.exit(1);
}
