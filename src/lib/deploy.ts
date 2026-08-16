import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { ROOT } from './paths';

// Auto-publish: after a photo change, push the updated static site to Netlify.
//
// This runs INSIDE the local app (the dev server you launch), not a background
// launchd job — because a launchd agent is denied access to ~/Desktop by macOS
// privacy (TCC), while the app you launched yourself has it. Debounced so a
// burst of uploads collapses into a single deploy. netlify.toml pins the build
// to the correct read-only PUBLIC_STATIC snapshot.
//
// It goes through `scripts/deploy-site.ts` rather than the Netlify CLI directly,
// because these are the deploys nobody is watching: they fire from an upload and
// report to a log file. That script refuses to publish a photograph with no file
// behind it, and afterwards asks the site whether the build it sent is the one
// now being served — three deploys on 10 August died inside Netlify's API and the
// only trace was a site that stayed ten days old.
const DEBOUNCE_MS = 8000;
const LOG = '/tmp/colour-archive-deploy.log';

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let pending = false;

/** Request a publish. Coalesces rapid calls; re-runs once if changes land mid-deploy. */
export function scheduleDeploy(): void {
  if (process.env.PUBLIC_STATIC === 'true') return; // never from within a static build
  if (running) { pending = true; return; }
  if (timer) clearTimeout(timer);
  timer = setTimeout(runDeploy, DEBOUNCE_MS);
}

function runDeploy(): void {
  timer = null;
  running = true;
  pending = false;
  let out: number;
  try { out = fs.openSync(LOG, 'a'); } catch { running = false; return; }
  fs.writeSync(out, `\n=== ${new Date().toISOString()} auto-deploy ===\n`);
  const child = spawn('npx', ['--no-install', 'tsx', 'scripts/deploy-site.ts'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  const done = () => {
    running = false;
    try { fs.closeSync(out); } catch { /* already closed */ }
    if (pending) scheduleDeploy(); // a change arrived while deploying → publish again
  };
  child.on('exit', done);
  child.on('error', done);
  child.unref();
}
