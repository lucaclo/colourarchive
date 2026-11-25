import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import updater from './updater.cjs';

const { FEED, INSTALL_SCRIPT, compareVersions, installProblem, menuItems, parseFeed, verifiedApp } = updater;

// What electron-builder writes for a mac build with a zip and a dmg target.
const LATEST_MAC = `version: 0.2.7
files:
  - url: Colour-Archive-arm64.zip
    sha512: emlwc2hhNTEy
    size: 198765432
    blockMapSize: 208123
  - url: Colour-Archive-arm64.dmg
    sha512: ZG1nc2hhNTEy
    size: 201363553
path: Colour-Archive-arm64.zip
sha512: emlwc2hhNTEy
releaseDate: '2026-11-17T10:47:26.404Z'
`;

test('the feed parser picks the zip, from that version’s own release', () => {
  assert.deepEqual(parseFeed(LATEST_MAC, FEED), {
    version: '0.2.7',
    url: 'https://github.com/lucaclo/colourarchive/releases/download/v0.2.7/Colour-Archive-arm64.zip',
    sha512: 'emlwc2hhNTEy',
    size: 198765432,
  });
});

test('the feed parser finds the zip after the dmg, keeps absolute urls, reads quoted versions', () => {
  const text = `version: '0.3.1'
files:
  - url: Colour-Archive-arm64.dmg
    sha512: ZG1n
    size: 10
  - url: http://127.0.0.1:8000/feed/Colour-Archive-arm64.zip
    sha512: emlw
    size: 20
path: Colour-Archive-arm64.dmg
`;
  assert.deepEqual(parseFeed(text, 'http://127.0.0.1:9000/latest-mac.yml'), {
    version: '0.3.1',
    url: 'http://127.0.0.1:8000/feed/Colour-Archive-arm64.zip',
    sha512: 'emlw',
    size: 20,
  });
});

test('the feed parser refuses a feed with no zip or no version', () => {
  const dmgOnly = `version: 0.1.0
files:
  - url: Colour-Archive-arm64.dmg
    sha512: ZG1n
    size: 201363553
path: Colour-Archive-arm64.dmg
`;
  assert.throws(() => parseFeed(dmgOnly, FEED), /no \.zip/);
  assert.throws(() => parseFeed('files:\n  - url: a.zip\n    sha512: x\n', FEED), /no version/);
  assert.throws(() => parseFeed('<html>Not Found</html>', FEED), /no version/);
});

test('versions compare as numbers, part by part', () => {
  assert.equal(compareVersions('0.2.10', '0.2.9'), 1);
  assert.equal(compareVersions('0.2.9', '0.2.10'), -1);
  assert.equal(compareVersions('0.2.0', '0.2'), 0);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareVersions('0.2.7', '0.2.7'), 0);
  assert.equal(compareVersions('0.3.1', '0.2.140'), 1);
});

test('a translocated, unwritable or bare copy cannot install', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-upd-where-'));
  const locked = path.join(dir, 'locked');
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0o555);
  try {
    assert.equal(installProblem(path.join(dir, 'Colour Archive.app')), null);
    assert.equal(
      installProblem('/private/var/folders/ab/xyz/T/AppTranslocation/1234-ABCD/d/Colour Archive.app'),
      'translocated',
    );
    assert.equal(installProblem(path.join(locked, 'Colour Archive.app')), 'unwritable');
    assert.equal(installProblem('/Volumes/Colour Archive/Colour Archive.app'), 'unwritable');
    assert.equal(installProblem(path.join(dir, 'electron')), 'not-app');
  } finally {
    fs.chmodSync(locked, 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the menu shows one status line and at most one action', () => {
  const noop = () => {};
  const labels = (s) => menuItems({ current: '0.2.7', latest: '0.2.8', error: null, ...s }, { check: noop, restart: noop }).map((i) => i.label);
  assert.deepEqual(labels({ state: 'checking' }), ['Checking for Updates…']);
  assert.deepEqual(labels({ state: 'up-to-date' }), ['Up to Date · Version 0.2.7', 'Check for Updates…']);
  assert.deepEqual(labels({ state: 'downloading' }), ['Downloading Version 0.2.8…']);
  assert.deepEqual(labels({ state: 'ready' }), ['Version 0.2.8 Ready', 'Restart to Update']);
  assert.deepEqual(labels({ state: 'error' }), ['Couldn’t Check for Updates', 'Check for Updates…']);
  assert.deepEqual(labels({ state: 'cannot-install' }), ['Version 0.2.7 · Move to Applications for Updates']);
  assert.deepEqual(labels({ state: 'source', current: '0.2.0' }), ['Version 0.2.0 · From Source']);
});

// --- The signature pin, with plutil and codesign stood in for ----------------

const RUNNING = '/Applications/Colour Archive.app';
const REQ_OURS = 'identifier "com.lucaclo.colourarchive" and certificate leaf = H"cd771820c4db6212b12460d46e2cf41ce7a80ed7"';
const REQ_OTHER = 'identifier "com.lucaclo.colourarchive" and certificate leaf = H"89cf361fd4b0d27f57899b6268da71e1653fbcee"';

/**
 * A staged 0.2.2 and stand-ins for the tools: `running` is what `codesign -d
 * -r-` prints for the running app, `signedWith` the requirement the staged app
 * satisfies, `intact` whether its signature holds at all.
 */
function staging({ running, signedWith, intact = true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-upd-pin-'));
  const app = path.join(dir, 'Colour Archive.app');
  fs.mkdirSync(app);
  const calls = [];
  const cmd = async (file, args) => {
    calls.push([path.basename(file), ...args]);
    if (file === '/usr/bin/plutil') return '0.2.2';
    if (args[0] === '-d') return running;
    if (!intact) throw new Error('codesign: a sealed resource is missing or invalid');
    const r = args.indexOf('-R');
    if (r !== -1 && args[r + 1] !== `=${signedWith}`) {
      throw new Error('codesign: test-requirement: code failed to satisfy specified code requirement(s)');
    }
    return '';
  };
  const codesign = () => calls.filter((c) => c[0] === 'codesign');
  return { dir, app, cmd, codesign, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a download signed like the running app passes, checked against the requirement codesign -d -r- reads', async () => {
  const s = staging({ running: `designated => ${REQ_OURS}`, signedWith: REQ_OURS });
  try {
    assert.equal(await verifiedApp(s.dir, '0.2.2', RUNNING, s.cmd), s.app);
    assert.deepEqual(s.codesign(), [
      ['codesign', '--verify', '--deep', '--strict', s.app],
      ['codesign', '-d', '-r-', RUNNING],
      ['codesign', '--verify', '--deep', '--strict', '-R', `=${REQ_OURS}`, s.app],
    ]);
  } finally {
    s.done();
  }
});

test('a download signed by another identity is refused', async () => {
  const s = staging({ running: `designated => ${REQ_OURS}`, signedWith: REQ_OTHER });
  try {
    await assert.rejects(verifiedApp(s.dir, '0.2.2', RUNNING, s.cmd), { message: 'The download isn’t signed by Colour Archive.' });
  } finally {
    s.done();
  }
});

test('a running ad hoc app skips the pin, so the first signed release installs', async () => {
  const s = staging({ running: '# designated => cdhash H"214edf773cd5b0cea9caf20f3697a69358a53495"', signedWith: REQ_OURS });
  try {
    assert.equal(await verifiedApp(s.dir, '0.2.2', RUNNING, s.cmd), s.app);
    assert.deepEqual(s.codesign(), [
      ['codesign', '--verify', '--deep', '--strict', s.app],
      ['codesign', '-d', '-r-', RUNNING],
    ]);
  } finally {
    s.done();
  }
});

test('a broken signature fails as itself, before the pin', async () => {
  const s = staging({ running: `designated => ${REQ_OURS}`, signedWith: REQ_OURS, intact: false });
  try {
    await assert.rejects(verifiedApp(s.dir, '0.2.2', RUNNING, s.cmd), /sealed resource/);
    assert.equal(s.codesign().length, 1);
  } finally {
    s.done();
  }
});

// --- The install script, run for real in a temp folder ---------------------

function fakeApp(file, marker) {
  fs.mkdirSync(path.join(file, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(file, 'Contents', 'marker'), marker);
}

function runScript(dir, args) {
  const script = path.join(dir, 'install.sh');
  fs.writeFileSync(script, INSTALL_SCRIPT);
  // HOME points into the temp folder, so the log never lands in the real one.
  const child = spawn('/bin/sh', [script, ...args], { env: { ...process.env, HOME: dir }, stdio: 'ignore' });
  return new Promise((resolve) => child.on('exit', (code) => resolve(code)));
}

const log = (dir) => fs.readFileSync(path.join(dir, 'Library', 'Logs', 'Colour Archive', 'update.log'), 'utf8');
const leftovers = (apps) => fs.readdirSync(apps).filter((n) => n.includes('.old-'));

test('the install script waits for the app to quit, then swaps the new one in', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-upd-swap-'));
  try {
    const apps = path.join(dir, 'Applications');
    const target = path.join(apps, 'Colour Archive.app');
    const staged = path.join(dir, 'updates', '0.2.1', 'Colour Archive.app');
    fakeApp(target, 'old');
    fakeApp(staged, 'new');
    // Stands in for the quitting app: still running when the script starts.
    const app = spawn('/bin/sleep', ['0.6'], { stdio: 'ignore' });
    const started = Date.now();
    const code = await runScript(dir, [String(app.pid), target, staged, '0']);
    assert.equal(code, 0);
    assert.ok(Date.now() - started >= 500, 'swapped before the app had quit');
    assert.equal(fs.readFileSync(path.join(target, 'Contents', 'marker'), 'utf8'), 'new');
    assert.equal(fs.existsSync(staged), false);
    assert.deepEqual(leftovers(apps), []);
    assert.match(log(dir), /Installed .*0\.2\.1\/Colour Archive\.app as .*Applications\/Colour Archive\.app\./);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the install script finishes the swap when logout signals it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-upd-term-'));
  try {
    const target = path.join(dir, 'Applications', 'Colour Archive.app');
    const staged = path.join(dir, 'updates', '0.2.1', 'Colour Archive.app');
    fakeApp(target, 'old');
    fakeApp(staged, 'new');
    const app = spawn('/bin/sleep', ['0.5'], { stdio: 'ignore' });
    const script = path.join(dir, 'install.sh');
    fs.writeFileSync(script, INSTALL_SCRIPT);
    const child = spawn('/bin/sh', [script, String(app.pid), target, staged, '0'], { env: { ...process.env, HOME: dir }, stdio: 'ignore' });
    const done = new Promise((resolve) => child.on('exit', (code, signal) => resolve(signal ?? code)));
    await new Promise((r) => setTimeout(r, 200));
    child.kill('SIGTERM');
    child.kill('SIGHUP');
    assert.equal(await done, 0);
    assert.equal(fs.readFileSync(path.join(target, 'Contents', 'marker'), 'utf8'), 'new');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the install script keeps the old app when the new one is missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-upd-keep-'));
  try {
    const apps = path.join(dir, 'Applications');
    const target = path.join(apps, 'Colour Archive.app');
    fakeApp(target, 'old');
    const gone = spawn('/usr/bin/true', { stdio: 'ignore' });
    await new Promise((r) => gone.on('exit', r));
    const code = await runScript(dir, [String(gone.pid), target, path.join(dir, 'updates', '0.2.1', 'Colour Archive.app'), '0']);
    assert.equal(code, 1);
    assert.equal(fs.readFileSync(path.join(target, 'Contents', 'marker'), 'utf8'), 'old');
    assert.deepEqual(leftovers(apps), []);
    assert.match(log(dir), /kept the old app/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Quiet updates (#168) ------------------------------------------------------

const { quietDecision, quietIn, newestStaged, triedBefore } = updater;
const MIN = 60_000;
const idle = { frontNow: false, lastFrontAt: null, inflight: 0, busy: 0, lastDeviceAt: null };

/**
 * Minute by minute from t = 0, with `signalsAt(minute)`, the way the updater's
 * timer looks: the minutes it would install at (it stops looking after one).
 */
function installsOver(minutes, signalsAt) {
  const at = [];
  let installing = false;
  for (let m = 0; m <= minutes; m++) {
    const d = quietDecision({ ready: true, installing, tried: false, signals: signalsAt(m), now: m * MIN });
    if (d === 'install') { at.push(m); installing = true; }
  }
  return at;
}

test('ready, ten minutes with no window in front, nothing in flight, no device: installs once', () => {
  assert.deepEqual(installsOver(30, () => ({ ...idle, lastFrontAt: -20 * MIN })), [0]);
  assert.equal(quietIn({ now: 0, ...idle }), 0, 'never in front at all (opened at login) is quiet');
});

test('a window in front five minutes ago waits until ten have passed', () => {
  assert.deepEqual(installsOver(30, () => ({ ...idle, lastFrontAt: -5 * MIN })), [5]);
  assert.deepEqual(installsOver(30, (m) => ({ ...idle, frontNow: m < 12, lastFrontAt: m < 12 ? m * MIN : 12 * MIN })), [22], 'in front until minute 12');
});

test('an upload in flight, or the inbox scanning, waits until it ends', () => {
  assert.deepEqual(installsOver(30, (m) => ({ ...idle, lastFrontAt: -60 * MIN, inflight: m < 7 ? 1 : 0 })), [7]);
  assert.deepEqual(installsOver(30, (m) => ({ ...idle, busy: m < 3 ? 1 : 0 })), [3]);
});

test('a phone request three minutes ago waits until ten have passed', () => {
  assert.deepEqual(installsOver(30, () => ({ ...idle, lastDeviceAt: -3 * MIN })), [7]);
  assert.deepEqual(installsOver(40, (m) => ({ ...idle, lastDeviceAt: (m < 15 ? m : 15) * MIN })), [25], 'the phone in use until minute 15');
});

test('nothing installs before a version is ready, twice, or after a swap that didn’t take', () => {
  assert.equal(quietDecision({ ready: false, installing: false, tried: false, signals: idle, now: 0 }), 'wait');
  assert.equal(quietDecision({ ready: true, installing: true, tried: false, signals: idle, now: 0 }), 'wait');
  assert.equal(quietDecision({ ready: true, installing: false, tried: true, signals: idle, now: 0 }), 'wait');
});

test('at launch, the newest staged version newer than this one, unless its swap was tried', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updates-'));
  for (const v of ['0.2.3', '0.2.10', '0.2.9']) fs.mkdirSync(path.join(dir, v));
  fs.writeFileSync(path.join(dir, '0.2.11.zip.part'), '');
  fs.writeFileSync(path.join(dir, 'install.sh'), '');
  assert.equal(newestStaged(dir, '0.2.4'), '0.2.10');
  assert.equal(newestStaged(dir, '0.2.10'), null, 'nothing newer than the running copy');
  assert.equal(newestStaged(path.join(dir, 'missing'), '0.2.4'), null);
  assert.equal(triedBefore(dir, '0.2.10'), false);
  fs.writeFileSync(path.join(dir, '0.2.10.attempt'), '');
  assert.equal(triedBefore(dir, '0.2.10'), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a quiet relaunch opens in the background and carries the page to reopen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-g-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  // A stand-in `open` that writes down how it was called. printf, not echo:
  // Linux's /bin/sh (dash) takes a leading -n as echo's own flag and drops it.
  fs.writeFileSync(path.join(bin, 'open'), `#!/bin/sh\nprintf '%s\\n' "$*" > "${dir}/open-args"\n`, { mode: 0o755 });
  const apps = path.join(dir, 'apps');
  fs.mkdirSync(path.join(apps, 'Colour Archive.app'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'staged', 'Colour Archive.app'), { recursive: true });
  const script = path.join(dir, 'install.sh');
  fs.writeFileSync(script, INSTALL_SCRIPT, { mode: 0o755 });
  const child = spawn('/bin/sh', [script, '999999', path.join(apps, 'Colour Archive.app'), path.join(dir, 'staged', 'Colour Archive.app'), 'g', 'COLOUR_ARCHIVE_REOPEN=/book'], {
    env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH}` },
  });
  await new Promise((r) => child.on('exit', r));
  const args = fs.readFileSync(path.join(dir, 'open-args'), 'utf8').trim();
  assert.equal(args, `-n -g --env COLOUR_ARCHIVE_REOPEN=/book ${path.join(apps, 'Colour Archive.app')}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('download follows a redirect, checks size and checksum, and keeps going while the disk is slow', async () => {
  // 24 MB in 64 kB writes, the far side ending as soon as it has sent it all:
  // the shape that made fetch throw out of the main process.
  const body = Buffer.alloc(24 * 1024 * 1024);
  for (let i = 0; i < body.length; i += 4096) body[i] = i % 251;
  const sha512 = createHash('sha512').update(body).digest('base64');
  const server = http.createServer((req, res) => {
    if (req.url === '/release.zip') { res.writeHead(302, { location: '/storage/release.zip' }); res.end(); return; }
    if (req.url === '/storage/release.zip') {
      res.writeHead(200, { 'content-length': body.length });
      for (let i = 0; i < body.length; i += 65536) res.write(body.subarray(i, i + 65536));
      res.end();
      return;
    }
    if (req.url === '/silent') return; // never answers
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updater-dl-'));
  try {
    const file = path.join(dir, 'a.zip');
    await updater.download(`${base}/release.zip`, file, sha512, body.length);
    assert.equal(fs.statSync(file).size, body.length);
    await assert.rejects(updater.download(`${base}/release.zip`, path.join(dir, 'b.zip'), 'wrong', body.length), /checksum/);
    await assert.rejects(updater.download(`${base}/release.zip`, path.join(dir, 'c.zip'), sha512, body.length + 1), /bytes, not/);
    await assert.rejects(updater.download(`${base}/gone.zip`, path.join(dir, 'd.zip'), sha512, 1), /answered 404/);
  } finally {
    server.closeAllConnections?.();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Update Now (the Updates panel) ------------------------------------------

const { createUpdater, lastInstalledAt } = updater;

const until = async (what, fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

/**
 * A packaged copy running `current` from a temp folder, against a local feed
 * offering `latest`: the download is real (node:http), ditto, plutil and
 * codesign are stood in for (`hold` keeps the unpack waiting until
 * `release()` or `fail()`), and spawn and app.quit only write down that they
 * were called. `log(bundle)`: the update.log in its home folder.
 */
async function packaged({ current = '0.2.0', latest = '0.2.1', hold = false, log = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-upd-now-'));
  const bundle = path.join(dir, 'apps', 'Colour Archive.app');
  fs.mkdirSync(bundle, { recursive: true });
  const home = path.join(dir, 'home');
  if (log) {
    fs.mkdirSync(path.join(home, 'Library', 'Logs', 'Colour Archive'), { recursive: true });
    fs.writeFileSync(path.join(home, 'Library', 'Logs', 'Colour Archive', 'update.log'), log(bundle));
  }
  const body = Buffer.from('a release, zipped');
  const sum = createHash('sha512').update(body).digest('base64');
  const server = http.createServer((req, res) => {
    if (req.url === '/latest-mac.yml') return res.end(`version: ${latest}\nfiles:\n  - url: app.zip\n    sha512: ${sum}\n    size: ${body.length}\n`);
    if (req.url === '/app.zip') return res.end(body);
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  let release;
  let fail;
  const unpack = hold ? new Promise((res, rej) => { release = res; fail = rej; }) : Promise.resolve();
  unpack.catch(() => {}); // failed before ditto waits on it: still fails there
  const cmd = async (file, args) => {
    if (file === '/usr/bin/ditto') {
      await unpack;
      fs.mkdirSync(path.join(args.at(-1), 'Colour Archive.app'), { recursive: true });
      return '';
    }
    if (file === '/usr/bin/plutil') return latest;
    if (args[0] === '-d') return '# designated => cdhash H"214edf773cd5b0cea9caf20f3697a69358a53495"';
    return '';
  };
  const spawned = [];
  const spawnStub = (file, args) => {
    spawned.push(args);
    return { on() {}, unref() {} };
  };
  let quits = 0;
  const seen = [];
  const app = {
    isPackaged: true,
    getVersion: () => current,
    getPath: () => path.join(dir, 'profile'),
    quit: () => { quits++; },
  };
  const u = createUpdater({
    app,
    env: { COLOUR_ARCHIVE_UPDATE_FEED: `http://127.0.0.1:${server.address().port}/latest-mac.yml`, COLOUR_ARCHIVE_UPDATE_DELAY_MS: '86400000' },
    home,
    execPath: path.join(bundle, 'Contents', 'MacOS', 'Colour Archive'),
    spawn: spawnStub,
    cmd,
    onChange: (s) => seen.push(s),
    reopen: () => '/archive',
  });
  u.start();
  return {
    u, bundle, spawned, seen, release, fail,
    quits: () => quits,
    // The NAME=VALUE pairs the install script was given, and its relaunch mode.
    relaunch: (i = 0) => spawned[i][4],
    passed: (i = 0) => spawned[i].slice(5).filter((a) => /^COLOUR_ARCHIVE_REOPEN/.test(a)),
    done: () => {
      server.closeAllConnections?.();
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('Update Now with a version ready installs it once, onto the page, in front, and quits', async () => {
  const p = await packaged();
  try {
    await p.u.check();
    assert.equal(p.u.status().state, 'ready');
    assert.deepEqual(await p.u.installNow({ page: '/book#updates', front: true }), { kind: 'ready', version: '0.2.1' });
    assert.equal(p.spawned.length, 1);
    assert.equal(p.relaunch(), '1', 'relaunched at once, not in the background');
    assert.deepEqual(p.passed(), ['COLOUR_ARCHIVE_REOPEN=/book#updates', 'COLOUR_ARCHIVE_REOPEN_FRONT=1']);
    assert.equal(p.quits(), 1);
    await p.u.installNow({ page: '/book', front: true });
    p.u.restart();
    p.u.installOnQuit();
    assert.equal(p.spawned.length, 1, 'never a second install');
    assert.equal(fs.readdirSync(path.join(path.dirname(p.spawned[0][0]))).some((n) => n.endsWith('.attempt')), false, 'no one-try mark');
  } finally {
    p.done();
  }
});

test('Update Now with no page reopens the page open now, not in front', async () => {
  const p = await packaged();
  try {
    await p.u.check();
    await p.u.installNow();
    assert.deepEqual(p.passed(), ['COLOUR_ARCHIVE_REOPEN=/archive']);
    assert.equal(p.relaunch(), 'g', 'relaunched in the background');
  } finally {
    p.done();
  }
});

test('Update Now while downloading waits (pending), then installs as soon as it is ready', async () => {
  const p = await packaged({ hold: true });
  try {
    assert.equal((await p.u.check({ manual: true })).kind, 'downloading');
    assert.deepEqual(await p.u.installNow({ page: '/book#updates', front: true }), { kind: 'downloading', version: '0.2.1' });
    assert.equal(p.u.status().pending, true);
    assert.equal(p.seen.at(-1).pending, true, 'told the panel');
    assert.equal(p.spawned.length, 0);
    p.release();
    await until('the install', () => p.spawned.length > 0);
    assert.equal(p.u.status().state, 'ready');
    assert.equal(p.u.status().pending, false);
    assert.deepEqual(p.passed(), ['COLOUR_ARCHIVE_REOPEN=/book#updates', 'COLOUR_ARCHIVE_REOPEN_FRONT=1']);
    assert.equal(p.quits(), 1);
  } finally {
    p.done();
  }
});

test('Update Now with nothing staged checks, downloads, then installs', async () => {
  const p = await packaged();
  try {
    assert.equal((await p.u.installNow({ page: '/', front: true })).kind, 'downloading');
    await until('the install', () => p.spawned.length > 0);
    assert.ok(p.seen.some((s) => s.state === 'checking' && s.pending), 'pending from the start');
    assert.equal(p.quits(), 1);
  } finally {
    p.done();
  }
});

test('a download that fails clears pending and leaves the error', async () => {
  const p = await packaged({ hold: true });
  try {
    await p.u.check({ manual: true });
    await p.u.installNow({ page: '/book', front: true });
    p.fail(new Error('ditto: the archive is damaged'));
    await until('the error', () => p.u.status().state === 'error');
    assert.equal(p.u.status().pending, false);
    assert.match(p.u.status().error, /damaged/);
    assert.equal(p.spawned.length, 0);
    assert.equal(p.quits(), 0);
  } finally {
    p.done();
  }
});

test('Update Now when up to date installs nothing', async () => {
  const p = await packaged({ latest: '0.2.0' });
  try {
    assert.deepEqual(await p.u.installNow({ page: '/book', front: true }), { kind: 'up-to-date', version: '0.2.0' });
    assert.equal(p.u.status().state, 'up-to-date');
    assert.equal(p.u.status().pending, false);
    assert.equal(p.spawned.length, 0);
    assert.equal(p.quits(), 0);
  } finally {
    p.done();
  }
});

test('status says where the app is and when an update last went into it', async () => {
  const p = await packaged();
  try {
    assert.equal(p.u.status().installedIn, p.bundle);
    assert.equal(p.u.status().updatedAt, null, 'no update.log yet');
  } finally {
    p.done();
  }
  const q = await packaged({
    log: (bundle) => [
      `2026-11-24T08:00:00Z Installed /x/updates/0.1.9/Colour Archive.app as ${bundle}.`,
      `2026-11-25T08:00:00Z Installed /x/updates/0.2.0/Colour Archive.app as ${bundle}.`,
      `2026-11-25T08:00:03Z Reopened ${bundle} at /book.`,
      '',
    ].join('\n'),
  });
  try {
    assert.equal(q.u.status().updatedAt, '2026-11-25T08:00:00Z');
  } finally {
    q.done();
  }
  const source = createUpdater({ app: { isPackaged: false, getVersion: () => '0.2.0' } });
  source.start();
  assert.deepEqual(
    { ...source.status() },
    { state: 'source', current: '0.2.0', latest: null, error: null, installedIn: null, updatedAt: null, pending: false },
  );
  assert.equal((await source.installNow({ page: '/' })).kind, 'source');
});

test('lastInstalledAt: the last swap into this bundle, not a scratch copy’s, not a reopen', () => {
  const apps = '/Applications/Colour Archive.app';
  const scratch = '/private/tmp/claude-501/x/scratchpad/updater/apps/Colour Archive.app';
  const support = '/Users/me/Library/Application Support/Colour Archive/updates';
  const log = [
    `2026-11-20T09:00:00Z Installed ${support}/0.2.5/Colour Archive.app as ${apps}.`,
    `2026-11-22T09:00:00Z Installed ${support}/0.2.6/Colour Archive.app as ${apps}.`,
    `2026-11-22T09:00:04Z Reopened ${apps} at /book.`,
    `2026-11-23T10:00:00Z Installed /private/tmp/claude-501/x/scratchpad/updater/profile/updates/0.2.1/Colour Archive.app as ${scratch}.`,
    `2026-11-23T10:00:02Z Relaunched ${apps} hidden.`,
    `2026-11-24T09:00:00Z Quiet moment: installing 0.2.7 over ${apps}.`,
    `2026-11-24T09:00:01Z Couldn’t move ${support}/0.2.7/Colour Archive.app into place; kept the old app.`,
    `2026-11-24T09:30:00Z Installed ${support}/0.2.8/Colour Archive.app as ${apps}.old-123.`,
    '',
  ].join('\n');
  assert.equal(lastInstalledAt(log, apps), '2026-11-22T09:00:00Z');
  assert.equal(lastInstalledAt(log, scratch), '2026-11-23T10:00:00Z');
  assert.equal(lastInstalledAt(log, '/Users/me/Applications/Colour Archive.app'), null);
  assert.equal(lastInstalledAt('', apps), null);
  assert.equal(lastInstalledAt(log, null), null);
});
