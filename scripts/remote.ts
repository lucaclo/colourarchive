/**
 * The archive from anywhere, in front of the dev server.
 *
 *   npm run remote                 gate + Tailscale Funnel in front of https://localhost:4321
 *   npm run remote -- --password   set (or change) the phone password first
 *   npm run remote -- --off        turn the Funnel off again
 *   REMOTE_NO_FUNNEL=1 npm run remote   the gate alone on 127.0.0.1:43480, for trying it locally
 *
 * The Mac app does the same from its menu (Let My Phone In From Anywhere); this
 * is that for `npm run dev`. Both use desktop/remote-gate.mjs and the same
 * password file, so a phone signed in to one is signed in to the other.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createGate, hasPassword, setPassword, MIN_PASSWORD } from '../desktop/remote-gate.mjs';

const TARGET = new URL(process.env.REMOTE_TARGET ?? 'https://localhost:4321');
const PORT = 43480;
const FILE = process.env.REMOTE_FILE ?? path.join(os.homedir(), 'Library', 'Application Support', 'Colour Archive', 'remote.json');
const PUBLIC_SITE = 'https://colourarchive.netlify.app';
const argv = process.argv.slice(2);
const NO_FUNNEL = process.env.REMOTE_NO_FUNNEL === '1';

const TAILSCALE = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/local/bin/tailscale',
].find((p) => fs.existsSync(p));

function tailscale(args: string[]): string {
  if (!TAILSCALE) throw new Error('Tailscale isn’t installed — https://tailscale.com/download/mac, sign in once, then run this again.');
  return execFileSync(TAILSCALE, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Read a line without echoing it. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    let value = '';
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function choosePassword() {
  for (;;) {
    const a = await askHidden(`Phone password (at least ${MIN_PASSWORD} characters): `);
    const b = await askHidden('Again: ');
    if (a !== b) { console.log('The two don’t match.'); continue; }
    try {
      await setPassword(FILE, a);
      console.log('Set. Every phone has been signed out.');
      return;
    } catch (err) {
      console.log((err as Error).message);
    }
  }
}

if (argv.includes('--off')) {
  tailscale(['funnel', '--https=443', 'off']);
  fs.rmSync(path.join(path.dirname(FILE), 'remote-host'), { force: true });
  console.log('The Funnel is off. The archive is no longer reachable from outside.');
  process.exit(0);
}

if (argv.includes('--password') || !hasPassword(FILE)) await choosePassword();

const host = NO_FUNNEL ? `127.0.0.1:${PORT}` : (JSON.parse(tailscale(['status', '--json']))?.Self?.DNSName ?? '').replace(/\.$/, '');
if (!host) throw new Error('Tailscale isn’t signed in.');

// The archive, as the gate sees it: every request passed on to the dev server.
const proxy = (req: http.IncomingMessage, res: http.ServerResponse) => {
  const upstream = https.request(
    {
      hostname: TARGET.hostname,
      port: TARGET.port,
      path: req.url,
      method: req.method,
      headers: req.headers,
      // The dev server's certificate is for this Mac's own CA (certs/).
      rejectUnauthorized: false,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`The dev server isn’t answering at ${TARGET.origin}: ${err.message}`);
  });
  req.pipe(upstream);
};

const gate = createGate(proxy, {
  file: FILE,
  publicHost: host,
  pingOrigins: [PUBLIC_SITE],
  forward: { host: TARGET.host, origin: TARGET.origin },
});
const server = http.createServer((req, res) => {
  gate(req, res).catch((err: Error) => {
    console.warn('[remote]', err.message);
    if (!res.headersSent) res.writeHead(500).end();
  });
});
server.requestTimeout = 0;
server.listen(PORT, '127.0.0.1', () => {
  if (NO_FUNNEL) {
    console.log(`The gate alone, at http://${host}/ (no Funnel). Note: its cookie is Secure, so a browser keeps it only over https.`);
    return;
  }
  try {
    tailscale(['funnel', '--bg', String(PORT)]);
  } catch (err) {
    console.error(`Tailscale couldn’t open the address:\n${(err as Error).message}`);
    process.exit(1);
  }
  // So the next public build links its Mac-only tabs here (astro.config.mjs).
  fs.writeFileSync(path.join(path.dirname(FILE), 'remote-host'), `${host}\n`);
  console.log(`\nYour archive, from anywhere: https://${host}/`);
  console.log(`Behind the password, in front of ${TARGET.origin}. Ctrl-C stops answering (npm run remote -- --off closes the Funnel too).`);
});
