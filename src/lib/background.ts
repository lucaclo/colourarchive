import { startInbox } from './inbox';
import { startPush } from './push';

// What the archive's server does on its own while it runs: read the iCloud
// inbox (#137) and send kept-spot notifications (#142). Started by the dev
// server's integration (astro.config.mjs) and the Mac app's server
// (desktop/server.mjs, through /api/background). Both are safe to call twice.
export function startBackground(): void {
  startInbox();
  startPush();
}
