// The password in front of the archive when it is reached from anywhere.
//
// Everything behind this — the upload pipeline, the originals, the book, the
// photographers you follow — was written for one person on their own Mac and
// has no auth of its own. The static Netlify copy was the security boundary
// (see netlify.toml). Serving the real archive to the open internet, through a
// tunnel, moves that boundary here, so this wraps the whole Node handler
// rather than living in Astro middleware: `/img/*`, `sw.js` and the originals
// are served before Astro ever sees the request, and they need the gate too.
//
// One owner, one password. Stored as a scrypt hash next to the app's other
// settings, never in the repository (which is public). A signed-in phone holds
// a random session token in an HttpOnly cookie; only the token's hash is kept,
// so the file on disk cannot be replayed as a cookie.
//
// Plain JavaScript, because the Mac app's server (server.mjs) runs it in
// Electron's own Node without a build step, and `scripts/remote.ts` reuses it
// in front of the dev server.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const COOKIE = 'ca_remote';
const SESSION_DAYS = 90;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;
export const MIN_PASSWORD = 10;

// Five wrong tries from one address in fifteen minutes locks that address for
// fifteen minutes. The global ceiling is for an attacker who varies the
// address: it locks everyone out for a while, which is the right trade for an
// archive with one owner.
const WINDOW_MS = 15 * 60 * 1000;
const PER_IP = 5;
const GLOBAL = 30;

// Fetched without the session cookie by design: a web app manifest is
// requested with credentials omitted, so Add to Home Screen would get a login
// page instead of the icons. None of these say anything about the archive.
const PUBLIC_FILES = new Set([
  '/site.webmanifest', '/favicon.svg', '/favicon-32.png', '/favicon-180.png',
  '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/robots.txt',
]);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function scrypt(password, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, KEY_LEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** A stored hash for `password`: `{ salt, key }`, both hex. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password).normalize('NFC'), salt);
  return { salt: salt.toString('hex'), key: key.toString('hex') };
}

export async function verifyPassword(password, stored) {
  if (!stored?.salt || !stored?.key) return false;
  const want = Buffer.from(stored.key, 'hex');
  const got = await scrypt(String(password).normalize('NFC'), Buffer.from(stored.salt, 'hex'));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

function readStore(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { password: raw.password ?? null, sessions: raw.sessions ?? {} };
  } catch {
    return { password: null, sessions: {} };
  }
}

function writeStore(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Set (or replace) the password. Replacing it signs every phone out. */
export async function setPassword(file, password) {
  if (String(password).length < MIN_PASSWORD) throw new Error(`At least ${MIN_PASSWORD} characters.`);
  writeStore(file, { password: await hashPassword(password), sessions: {} });
}

/** Sign every phone out, keeping the password. */
export function signOutAll(file) {
  const store = readStore(file);
  writeStore(file, { ...store, sessions: {} });
}

export const hasPassword = (file) => Boolean(readStore(file).password);

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function clientIp(req) {
  // The gate only ever listens on 127.0.0.1, so every request arrives through
  // the tunnel, which names the real client in X-Forwarded-For. It can be
  // forged by prepending; the global ceiling covers that.
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress ?? '?';
}

/** Where to go after signing in: a path on this site, nothing else. */
export function safeNext(next) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next.startsWith('/__')) return '/';
  return next;
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function loginPage({ next = '/', note = '' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#100f0e"><meta name="robots" content="noindex">
<link rel="manifest" href="/site.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>Colour Archive</title>
<style>
  :root { color-scheme: dark; --fg: #efebe4; --bg: #100f0e; --muted: #a39d94; --rule: #34302b; --field: #1c1a18; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100svh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 17px/1.5 -apple-system, system-ui, sans-serif; padding: 1.25rem; }
  main { width: 100%; max-width: 22rem; }
  h1 { font: italic 500 2rem/1.1 Georgia, serif; margin: 0 0 1.5rem; }
  label { display: block; color: var(--muted); font-size: 0.9rem; margin-bottom: 0.4rem; }
  input { width: 100%; font: inherit; font-size: 16px; color: var(--fg); background: var(--field); border: 1px solid var(--rule);
          border-radius: 12px; padding: 0.75rem 0.9rem; min-height: 44px; }
  input:focus-visible { outline: 2px solid #e0603a; outline-offset: 2px; }
  button { margin-top: 1rem; width: 100%; min-height: 44px; font: inherit; font-weight: 600; color: var(--bg); background: var(--fg);
           border: 0; border-radius: 999px; cursor: pointer; }
  button:focus-visible { outline: 2px solid #e0603a; outline-offset: 3px; }
  .note { margin: 1rem 0 0; color: #e8a07a; font-size: 0.9rem; min-height: 1.4em; }
</style></head><body><main>
<h1>Colour Archive</h1>
<form method="post" action="/__login">
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <label for="pw">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus
         ${note ? 'aria-describedby="note" aria-invalid="true"' : ''}>
  <button type="submit">Open the archive</button>
  <p class="note" id="note" role="status">${escapeHtml(note)}</p>
</form>
</main></body></html>`;
}

/**
 * Wrap `app` so only a signed-in browser reaches it.
 *
 * @param {(req, res) => void} app  the archive's own handler
 * @param {object} opts
 * @param {string} opts.file           the remote.json that holds the hash and sessions
 * @param {string[]} [opts.pingOrigins] origins allowed to ask /__ping whether the Mac is up
 * @param {string} [opts.publicHost]   the tunnel's own host name (e.g. mac.tail1234.ts.net),
 *                                     in case the tunnel hands requests on with a local Host
 * @param {{ host: string, origin: string }} [opts.forward]
 *                                     what the archive should see as its own Host and Origin
 *                                     once the gate has checked the real ones — see `inward`
 * @param {() => number} [opts.now]
 */
export function createGate(app, { file, pingOrigins = [], publicHost = '', forward = null, now = Date.now }) {
  const failures = new Map(); // ip → timestamps
  let globalFailures = [];

  const recent = (list) => list.filter((t) => now() - t < WINDOW_MS);
  const locked = (ip) => recent(failures.get(ip) ?? []).length >= PER_IP || recent(globalFailures).length >= GLOBAL;
  const fail = (ip) => {
    failures.set(ip, [...recent(failures.get(ip) ?? []), now()]);
    globalFailures = [...recent(globalFailures), now()];
  };

  function sessionOf(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const store = readStore(file);
    const expires = store.sessions[sha256(token)];
    return expires && expires > now() ? token : null;
  }

  function startSession(res) {
    const token = crypto.randomBytes(32).toString('base64url');
    const store = readStore(file);
    const sessions = Object.fromEntries(Object.entries(store.sessions).filter(([, exp]) => exp > now()));
    sessions[sha256(token)] = now() + SESSION_DAYS * 86400_000;
    writeStore(file, { ...store, sessions });
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
  }

  function endSession(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const store = readStore(file);
      delete store.sessions[sha256(token)];
      writeStore(file, store);
    }
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  }

  const html = (res, status, body) => {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    res.end(body);
  };

  /** Same-origin writes only: a page elsewhere cannot post with our cookie. */
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return false;
    const hosts = [publicHost, req.headers['x-forwarded-host'], req.headers.host].filter(Boolean);
    try {
      return hosts.includes(new URL(origin).host);
    } catch {
      return false;
    }
  }

  /**
   * Astro trusts a Host header only for the domains listed in astro.config,
   * and otherwise takes the request to be for "localhost" — so the phone's
   * true Origin (the tunnel's https address) would look cross-site and every
   * upload would be refused with a 403. The gate has already done that check
   * against the real headers, so the archive is handed a request that is
   * plainly its own.
   */
  function inward(req) {
    if (!forward) return req;
    req.headers.host = forward.host;
    delete req.headers['x-forwarded-host'];
    delete req.headers['x-forwarded-proto'];
    delete req.headers['x-forwarded-port'];
    if (req.headers.origin) req.headers.origin = forward.origin;
    return req;
  }

  return async function gate(req, res) {
    const url = new URL(req.url, 'http://x');
    const method = req.method ?? 'GET';
    const reading = method === 'GET' || method === 'HEAD';

    if (url.pathname === '/__ping') {
      const origin = req.headers.origin;
      if (origin && pingOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end('{"ok":true}');
    }

    if (url.pathname === '/__login') {
      if (!hasPassword(file)) return html(res, 503, loginPage({ note: 'No password is set on the Mac yet.' }));
      if (reading) {
        if (sessionOf(req)) {
          res.writeHead(302, { Location: safeNext(url.searchParams.get('next')) });
          return res.end();
        }
        return html(res, 200, loginPage({ next: safeNext(url.searchParams.get('next')) }));
      }
      if (method !== 'POST' || !sameOrigin(req)) return html(res, 403, loginPage({ note: 'That sign-in came from somewhere else.' }));
      const ip = clientIp(req);
      let form;
      try {
        form = new URLSearchParams(await readBody(req));
      } catch {
        return html(res, 413, loginPage());
      }
      const next = safeNext(form.get('next'));
      if (locked(ip)) return html(res, 429, loginPage({ next, note: 'Too many tries. Wait fifteen minutes.' }));
      const ok = await verifyPassword(form.get('password') ?? '', readStore(file).password);
      if (!ok) {
        fail(ip);
        return html(res, 401, loginPage({ next, note: locked(ip) ? 'Too many tries. Wait fifteen minutes.' : 'That isn’t the password.' }));
      }
      failures.delete(ip);
      startSession(res);
      res.writeHead(303, { Location: next, 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (url.pathname === '/__logout') {
      if (method !== 'POST' || !sameOrigin(req)) {
        res.writeHead(405).end();
        return;
      }
      endSession(req, res);
      res.writeHead(303, { Location: '/__login' });
      return res.end();
    }

    if (reading && PUBLIC_FILES.has(url.pathname)) return app(inward(req), res);

    if (!sessionOf(req)) {
      const wantsPage = reading && /text\/html/.test(req.headers.accept ?? '');
      if (wantsPage) {
        res.writeHead(302, { Location: `/__login?next=${encodeURIComponent(url.pathname + url.search)}`, 'Cache-Control': 'no-store' });
        return res.end();
      }
      res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end('{"error":"Sign in to your archive first."}');
    }

    if (!reading && !sameOrigin(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end('{"error":"That request came from somewhere else."}');
    }

    return app(inward(req), res);
  };
}
