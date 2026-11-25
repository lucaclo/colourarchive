import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// First: points a public build at the real archive before publish.ts loads paths.ts.
import './src/lib/static-archive.ts';
import { publishStamp } from './src/lib/publish.ts';

// D1: the public site is built from the real archive, the Mac app's folder,
// not this repository's development copy. static-archive.ts points paths.ts
// at it for a public build on this Mac (`netlify deploy`, `npm run
// export:static`); the photographs' derivatives come from it too. Astro copies
// `publicDir` into the site, so the build reads a copy of public/ whose img/
// is the archive's, cloned (APFS, no extra space). CI has no app settings and
// keeps building the repository's copy.
const staticPublic = process.env.PUBLIC_STATIC === 'true' && process.env.COLOUR_ARCHIVE_DATA
  ? publicWithImagesFrom(path.join(process.env.COLOUR_ARCHIVE_DATA, '.archive', 'public', 'img'))
  : undefined;
function publicWithImagesFrom(imgDir) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const source = path.join(root, 'public');
  const out = path.join(root, 'node_modules', '.cache', 'public-static');
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(source, out, { recursive: true, filter: (src) => path.relative(source, src).split(path.sep)[0] !== 'img' });
  fs.mkdirSync(path.join(out, 'img'), { recursive: true });
  for (const entry of fs.readdirSync(imgDir, { withFileTypes: true })) {
    if (entry.isFile()) fs.copyFileSync(path.join(imgDir, entry.name), path.join(out, 'img', entry.name), fs.constants.COPYFILE_FICLONE);
  }
  return out;
}

// The public copy links its Mac-only tabs to the Mac's from-anywhere address
// (TabBar.astro). Written by the Mac app's "Let My Phone In From Anywhere" and
// by `npm run remote`; an explicit PUBLIC_REMOTE_URL wins, and with neither
// the tabs are simply left out.
if (process.env.PUBLIC_STATIC === 'true' && !process.env.PUBLIC_REMOTE_URL) {
  try {
    const host = fs.readFileSync(path.join(os.homedir(), 'Library', 'Application Support', 'Colour Archive', 'remote-host'), 'utf8').trim();
    if (/^[a-z0-9.-]+\.ts\.net$/i.test(host)) process.env.PUBLIC_REMOTE_URL = `https://${host}`;
  } catch {
    /* not set up: no remote tabs */
  }
}

// HTTPS over the LAN — required so the iPad will save the archive OFFLINE.
// iOS only lets a page cache itself (service worker) on a *secure* origin, and
// http://…local is treated as insecure. These certs (certs/) are signed by a
// local CA you install once on the iPad; then https://…local:4321 is trusted
// and the offline snapshot works. Falls back to plain HTTP if certs are absent.
let https;
try {
  https = {
    key: fs.readFileSync(new URL('./certs/server.key', import.meta.url)),
    cert: fs.readFileSync(new URL('./certs/server.crt', import.meta.url)),
  };
} catch {
  https = undefined;
}

// The Mac app's build (npm run app:build). Its pages describe whichever archive
// the app is pointed at, which changes with every upload, so nothing may be
// rendered ahead of time: a prerendered home page would show the build
// machine's photographs forever.
const DESKTOP = process.env.COLOUR_ARCHIVE_BUILD === 'desktop';
// Issues #137 and #142: the dev server reads the iCloud inbox and checks
// kept-spot notifications from the moment it starts, not from the first page
// someone happens to open. Loaded through Vite so it
// shares the routes' modules (and their write lock on the photo store). The
// Mac app's server does the same from desktop/server.mjs.
function background() {
  return {
    name: 'colour-archive:background',
    hooks: {
      'astro:server:start': () => {
        viteServer?.ssrLoadModule('/src/lib/background.ts')
          .then((m) => m.startBackground())
          .catch((err) => console.warn('[background] could not start', err));
      },
      'astro:server:setup': ({ server }) => { viteServer = server; },
    },
  };
}
let viteServer;

function renderOnRequest() {
  return {
    name: 'colour-archive:render-on-request',
    hooks: {
      'astro:route:setup': ({ route }) => {
        route.prerender = false;
      },
    },
  };
}

// Local-first app: server output so the upload endpoint can run the pipeline
// on this machine. Originals never leave disk; sharp runs locally = zero
// network round-trip = zero quality/colour risk.
export default defineConfig({
  // The published origin (src/lib/publish.ts's SITE_URL) — needed so
  // Astro.site can turn Layout's canonical/og:image links into real
  // absolute URLs instead of resolving against a build-time placeholder.
  site: process.env.SITE_URL ?? 'https://colourarchive.netlify.app',
  output: 'server',
  // The app build reads public/ from a copy without img/ (desktop/build.mjs):
  // Astro lists every public file in the server's manifest, and those names
  // are this Mac's photo ids.
  ...(DESKTOP ? { publicDir: './desktop/.public' } : staticPublic ? { publicDir: staticPublic } : {}),
  // The app's server is reached at http://127.0.0.1:<port>. In a production
  // build Astro ignores the Host header unless its domain is listed here, and
  // then takes every request to be for "localhost" with no port — so the
  // browser's correct Origin looks cross-site and every upload, relabel and
  // removal is refused with a 403.
  // The *.local entry is the iPad's way in (issue #138): this Mac's Bonjour
  // name over HTTPS, served by desktop/server.mjs when "Let My iPad In" is on.
  // Every build, not only the app's: since round 13 src/middleware.ts refuses
  // any /api write whose Origin isn't this server's own, so `npm run preview`
  // at localhost:4321 refused them all. Dev reads the Host header itself.
  security: {
    allowedDomains: [
      { protocol: 'http', hostname: '127.0.0.1' },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: 'localhost' },
      { protocol: 'https', hostname: '*.local' },
    ],
  },
  adapter: node({ mode: 'standalone' }),
  // Stamps the build with what it contains, and refuses to finish if a
  // photograph it lists has no file behind it. See src/lib/publish.ts.
  integrations: [publishStamp(), background(), ...(DESKTOP ? [renderOnRequest()] : [])],
  // host: true binds all interfaces so a phone on the same Wi-Fi can reach it
  // at https://<your-mac-ip>:4321 (home network only).
  server: { port: 4321, host: true },
  // Large originals: allow big request bodies for uploads.
  vite: {
    build: { assetsInlineLimit: 0 },
    // A worktree's dev server gets its own optimised-deps folder, so it doesn't
    // rewrite the shared node_modules/.vite/deps under other servers.
    ...(process.env.ASTRO_CACHE_DIR ? { cacheDir: process.env.ASTRO_CACHE_DIR } : {}),
    // Let devices reach the app by the Mac's stable Bonjour name
    // (e.g. https://Lucass-MacBook-Air.local:4321) as well as its IP —
    // the .local name survives DHCP address changes, so a Home Screen
    // icon on the iPad keeps working. Any *.local host on the LAN is fine.
    server: { allowedHosts: ['.local'], https },
  },
});
