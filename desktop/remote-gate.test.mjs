import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createGate, setPassword, signOutAll, safeNext, COOKIE } from './remote-gate.mjs';

const PASSWORD = 'correct horse battery';
const HOST = 'mac.tail1234.ts.net';

async function harness({ now } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-gate-'));
  const file = path.join(dir, 'remote.json');
  await setPassword(file, PASSWORD);
  const reached = [];
  const seen = [];
  const app = (req, res) => {
    reached.push(`${req.method} ${req.url}`);
    seen.push({ host: req.headers.host, origin: req.headers.origin, xfh: req.headers['x-forwarded-host'] });
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('archive');
  };
  const server = http.createServer(createGate(app, {
    file, publicHost: HOST, pingOrigins: ['https://colourarchive.netlify.app'], now,
    forward: { host: '127.0.0.1:43210', origin: 'http://127.0.0.1:43210' },
  }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (p, { method = 'GET', headers = {}, body } = {}) =>
    fetch(base + p, { method, headers, body, redirect: 'manual' });
  const login = (password, headers = {}) =>
    send('/__login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `https://${HOST}`, ...headers },
      body: new URLSearchParams({ password, next: '/book' }).toString(),
    });
  const close = () => new Promise((r) => server.close(r));
  return { file, reached, seen, send, login, close };
}

const cookieOf = (res) => res.headers.get('set-cookie')?.split(';')[0];

test('nothing of the archive is served without signing in', async () => {
  const h = await harness();
  try {
    const page = await h.send('/book', { headers: { accept: 'text/html' } });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/__login?next=%2Fbook');
    for (const p of ['/api/photos', '/img/a.avif', '/api/original/abc', '/sw.js', '/inspiration']) {
      assert.equal((await h.send(p)).status, 401, p);
    }
    const write = await h.send('/api/upload', { method: 'POST', headers: { origin: `https://${HOST}` } });
    assert.equal(write.status, 401);
    assert.deepEqual(h.reached, []);
  } finally {
    await h.close();
  }
});

test('the right password signs in, and the cookie then opens everything', async () => {
  const h = await harness();
  try {
    const res = await h.login(PASSWORD);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/book');
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Lax/);
    const cookie = cookieOf(res);
    assert.equal((await h.send('/api/photos', { headers: { cookie } })).status, 200);
    assert.equal((await h.send('/img/a.avif', { headers: { cookie } })).status, 200);
    const write = await h.send('/api/upload', { method: 'POST', headers: { cookie, origin: `https://${HOST}` } });
    assert.equal(write.status, 200);
    // The token itself is never stored, only its hash.
    assert.ok(!fs.readFileSync(h.file, 'utf8').includes(cookie.split('=')[1]));
  } finally {
    await h.close();
  }
});

test('a wrong password, a forged cookie and a cross-site sign-in are all refused', async () => {
  const h = await harness();
  try {
    assert.equal((await h.login('not it')).status, 401);
    assert.equal((await h.send('/api/photos', { headers: { cookie: `${COOKIE}=forged` } })).status, 401);
    assert.equal((await h.login(PASSWORD, { origin: 'https://evil.example' })).status, 403);
    assert.deepEqual(h.reached, []);
  } finally {
    await h.close();
  }
});

test('a signed-in browser still cannot be made to write from another site', async () => {
  const h = await harness();
  try {
    const cookie = cookieOf(await h.login(PASSWORD));
    const forged = await h.send('/api/remove', { method: 'POST', headers: { cookie, origin: 'https://evil.example' } });
    assert.equal(forged.status, 403);
    const noOrigin = await h.send('/api/remove', { method: 'POST', headers: { cookie } });
    assert.equal(noOrigin.status, 403);
    assert.deepEqual(h.reached, []);
  } finally {
    await h.close();
  }
});

test('five wrong tries lock the address out, even for the right password', async () => {
  let t = 1_000_000;
  const h = await harness({ now: () => t });
  try {
    for (let i = 0; i < 5; i++) await h.login('wrong');
    assert.equal((await h.login(PASSWORD)).status, 429);
    t += 16 * 60 * 1000;
    assert.equal((await h.login(PASSWORD)).status, 303);
  } finally {
    await h.close();
  }
});

test('signing everyone out ends existing sessions', async () => {
  const h = await harness();
  try {
    const cookie = cookieOf(await h.login(PASSWORD));
    signOutAll(h.file);
    assert.equal((await h.send('/api/photos', { headers: { cookie } })).status, 401);
  } finally {
    await h.close();
  }
});

test('ping answers without a session, with CORS only for the public site', async () => {
  const h = await harness();
  try {
    const ok = await h.send('/__ping', { headers: { origin: 'https://colourarchive.netlify.app' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://colourarchive.netlify.app');
    const other = await h.send('/__ping', { headers: { origin: 'https://evil.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    // Home-screen icons are fetched without cookies.
    assert.equal((await h.send('/site.webmanifest')).status, 200);
  } finally {
    await h.close();
  }
});

test('after sign-in it only ever goes somewhere on this site', () => {
  assert.equal(safeNext('/book?x=1'), '/book?x=1');
  assert.equal(safeNext('//evil.example'), '/');
  assert.equal(safeNext('https://evil.example'), '/');
  assert.equal(safeNext('/\\evil.example'), '/');
  assert.equal(safeNext('/__logout'), '/');
  assert.equal(safeNext(undefined), '/');
});

test('a checked write reaches the archive as its own, so Astro does not refuse it', async () => {
  const h = await harness();
  try {
    const cookie = cookieOf(await h.login(PASSWORD));
    const res = await h.send('/api/upload', {
      method: 'POST',
      headers: { cookie, origin: `https://${HOST}`, 'x-forwarded-host': HOST, 'x-forwarded-proto': 'https' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(h.seen.at(-1), { host: '127.0.0.1:43210', origin: 'http://127.0.0.1:43210', xfh: undefined });
  } finally {
    await h.close();
  }
});
