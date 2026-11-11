import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishStamp } from './src/lib/publish.ts';

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
  ...(DESKTOP ? { publicDir: './desktop/.public' } : {}),
  // The app's server is reached at http://127.0.0.1:<port>. Astro ignores the
  // Host header unless its domain is listed here, and then takes every request
  // to be for "localhost" — so the browser's correct Origin looks cross-site
  // and every upload, relabel and removal is refused with a 403.
  // The second entry is the iPad's way in (issue #138): this Mac's Bonjour
  // name over HTTPS, served by desktop/server.mjs when "Let My iPad In" is on.
  ...(DESKTOP ? { security: { allowedDomains: [{ protocol: 'http', hostname: '127.0.0.1' }, { protocol: 'https', hostname: '*.local' }] } } : {}),
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
    // Let devices reach the app by the Mac's stable Bonjour name
    // (e.g. https://Lucass-MacBook-Air.local:4321) as well as its IP —
    // the .local name survives DHCP address changes, so a Home Screen
    // icon on the iPad keeps working. Any *.local host on the LAN is fine.
    server: { allowedHosts: ['.local'], https },
  },
});
