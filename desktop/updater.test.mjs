import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import updater from './updater.cjs';

const { FEED, INSTALL_SCRIPT, compareVersions, installProblem, menuItems, parseFeed } = updater;

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
