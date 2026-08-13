import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import fs from 'node:fs';
import { publishStamp } from './src/lib/publish.ts';

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

// Local-first app: server output so the upload endpoint can run the pipeline
// on this machine. Originals never leave disk; sharp runs locally = zero
// network round-trip = zero quality/colour risk.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // Stamps the build with what it contains, and refuses to finish if a
  // photograph it lists has no file behind it. See src/lib/publish.ts.
  integrations: [publishStamp()],
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
