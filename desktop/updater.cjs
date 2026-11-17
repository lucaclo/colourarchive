// Keeps the installed app on the newest GitHub release.
//
// Not electron-updater: its Mac half is Squirrel.Mac, which refuses any app
// without a Developer ID signature, and this one is signed ad hoc
// ("identity": "-" in package.json). So the same job with what macOS ships:
// read the feed electron-builder writes (latest-mac.yml), download the .zip it
// lists and check its sha512, unpack it with ditto, check the unpacked app's
// version and signature, and swap it in once the app has quit. The swap is a
// small shell script because a running bundle can't replace itself. No
// dependencies: the packaged app ships production ones only.
//
// .github/workflows/app-release.yml publishes a release for every merge to main.

const { execFile, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const FEED = 'https://github.com/lucaclo/colourarchive/releases/latest/download/latest-mac.yml';
const FIRST_CHECK_MS = 30_000;
const EVERY_MS = 4 * 60 * 60_000;
const FEED_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 60 * 60_000;

// --- The feed -------------------------------------------------------------

const unquote = (v) => {
  const s = v.trim();
  if (s.length >= 2 && s[0] === "'" && s.at(-1) === "'") return s.slice(1, -1).replaceAll("''", "'");
  if (s.length >= 2 && s[0] === '"' && s.at(-1) === '"') return s.slice(1, -1);
  return s;
};

/**
 * The .zip entry of an electron-builder latest-mac.yml, as
 * { version, url, sha512, size }, with `url` resolved against the feed's own.
 * Reads only that file's fixed shape: top-level `key: value` lines and a
 * `files:` list of `- url:` entries.
 */
function parseFeed(text, feedUrl) {
  const top = {};
  const files = [];
  let inFiles = false;
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^(\s*)(- )?([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    const [, indent, dash, key, value] = m;
    if (!indent && !dash) {
      inFiles = key === 'files';
      if (!inFiles) top[key] = unquote(value);
    } else if (inFiles) {
      if (dash) files.push({});
      if (files.length) files.at(-1)[key] = unquote(value);
    }
  }
  if (!/^\d+(\.\d+)*$/.test(top.version ?? '')) throw new Error('The update feed has no version.');
  const zip = files.find((f) => /\.zip$/i.test(f.url ?? ''));
  if (!zip?.sha512) throw new Error('The update feed lists no .zip.');
  // From this version's own release, not "latest": a release published between
  // reading the feed and downloading would otherwise fail the checksum.
  const base = String(feedUrl).replace('/releases/latest/download/', `/releases/download/v${top.version}/`);
  return {
    version: top.version,
    url: new URL(zip.url, base).href,
    sha512: zip.sha512,
    size: zip.size ? Number(zip.size) : null,
  };
}

/** -1, 0 or 1, comparing dotted numbers part by part (0.2.10 > 0.2.9). */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// --- Where the app runs from ---------------------------------------------

/** The .app a process runs from: …/Colour Archive.app/Contents/MacOS/Colour Archive. */
const bundleOf = (execPath) => path.resolve(execPath, '../../..');

/** Why the app at `bundle` can't replace itself, or null when it can. */
function installProblem(bundle) {
  if (!bundle.endsWith('.app')) return 'not-app';
  // Opened from the .dmg or straight from Downloads: macOS runs a read-only
  // copy from a random path, and the next launch would be the old app again.
  if (bundle.includes('/AppTranslocation/')) return 'translocated';
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
  } catch {
    return 'unwritable';
  }
  return null;
}

// --- The swap, after the app has quit ------------------------------------

// Arguments: the app's pid, the app to replace, the unpacked new app, 1 to
// open it afterwards, then NAME=VALUE pairs to open it with (a test profile).
const INSTALL_SCRIPT = `#!/bin/sh
# Written by Colour Archive (desktop/updater.cjs): swaps the new app in once
# the running one has quit, and puts the old one back if that fails.
pid="$1"
target="$2"
staged="$3"
relaunch="$4"
shift 4
# Quitting at logout or shutdown is when most updates go in, and macOS then
# signals what is left; the two renames below must not be split by that.
trap '' HUP INT TERM
logdir="$HOME/Library/Logs/Colour Archive"
mkdir -p "$logdir"
say() { printf '%s %s\\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$logdir/update.log"; }

n=0
while kill -0 "$pid" 2>/dev/null; do
  n=$((n + 1))
  if [ "$n" -ge 600 ]; then
    say "Still open after 60 s (pid $pid); nothing changed."
    exit 1
  fi
  sleep 0.1
done

old="$target.old-$$"
if ! mv "$target" "$old"; then
  say "Couldn’t move $target aside; nothing changed."
  exit 1
fi
status=0
if mv "$staged" "$target"; then
  rm -rf "$old"
  say "Installed $staged as $target."
else
  mv "$old" "$target"
  say "Couldn’t move $staged into place; kept the old app."
  status=1
fi
xattr -dr com.apple.quarantine "$target" 2>/dev/null
if [ "$relaunch" = 1 ]; then
  n=$#
  while [ "$n" -gt 0 ]; do
    set -- "$@" --env "$1"
    shift
    n=$((n - 1))
  done
  open -n "$@" "$target"
fi
exit $status
`;

// --- The menu --------------------------------------------------------------

/** The disabled status line in the app menu. */
function statusLabel(s) {
  switch (s.state) {
    case 'checking': return 'Checking for Updates…';
    case 'up-to-date': return `Up to Date · Version ${s.current}`;
    case 'downloading': return `Downloading Version ${s.latest}…`;
    case 'ready': return `Version ${s.latest} Ready`;
    case 'error': return 'Couldn’t Check for Updates';
    case 'cannot-install': return `Version ${s.current} · Move to Applications for Updates`;
    case 'source': return `Version ${s.current} · From Source`;
    default: return `Version ${s.current}`;
  }
}

/** The status line and its one action, for the app menu right after About. */
function menuItems(s, { check, restart }) {
  const items = [{ id: 'update-status', label: statusLabel(s), enabled: false }];
  if (s.state === 'idle' || s.state === 'up-to-date' || s.state === 'error') {
    items.push({ id: 'update-action', label: 'Check for Updates…', click: check });
  } else if (s.state === 'ready') {
    items.push({ id: 'update-action', label: 'Restart to Update', click: restart });
  }
  return items;
}

// --- The updater -------------------------------------------------------------

function run(file, args, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(file)}: ${`${stderr || err.message}`.trim()}`));
      else resolve(`${stdout}`.trim());
    });
  });
}

async function get(url, timeout) {
  const host = new URL(url).host;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  } catch (err) {
    throw new Error(err?.name === 'TimeoutError' ? `${host} didn’t answer.` : `Couldn’t reach ${host}.`, { cause: err });
  }
  if (!res.ok || !res.body) throw new Error(`${host} answered ${res.status}.`);
  return res;
}

/** Stream `url` to `file`, checking its size and sha512 (base64) on the way. */
async function download(url, file, sha512, size) {
  const res = await get(url, DOWNLOAD_TIMEOUT_MS);
  const hash = createHash('sha512');
  let bytes = 0;
  const tap = new Transform({
    transform(chunk, _enc, done) {
      hash.update(chunk);
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), tap, fs.createWriteStream(file));
  if (size != null && bytes !== size) throw new Error(`The download was ${bytes} bytes, not ${size}.`);
  if (hash.digest('base64') !== sha512) throw new Error('The download didn’t match its checksum.');
}

/** The unpacked app in `dir`, once it reports `version` and its signature holds. */
async function verifiedApp(dir, version) {
  const name = fs.readdirSync(dir).find((n) => n.endsWith('.app'));
  if (!name) throw new Error('The download has no app in it.');
  const appPath = path.join(dir, name);
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  const found = await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist]);
  if (found !== version) throw new Error(`The download is version ${found}, not ${version}.`);
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], 300_000);
  return appPath;
}

/** Remove everything in `dir` but install.sh and what belongs to `keep`. */
function tidy(dir, keep) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === 'install.sh' || name.replace(/\.zip(\.part)?$/, '') === keep) continue;
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    } catch {}
  }
}

/**
 * `app` is Electron's; `onChange(status)` runs on every state change.
 * status: { state, current, latest, error }, where state is one of idle,
 * checking, up-to-date, downloading, ready, error, cannot-install, source.
 */
function createUpdater({ app, onChange = () => {}, env = process.env }) {
  const feedUrl = env.COLOUR_ARCHIVE_UPDATE_FEED || FEED;
  const firstDelay = Number(env.COLOUR_ARCHIVE_UPDATE_DELAY_MS) || FIRST_CHECK_MS;
  let status = { state: 'idle', current: app.getVersion(), latest: null, error: null };
  let bundle = null;
  let updatesDir = null;
  let staged = null;
  let busy = false;
  let installing = false;

  const set = (next) => {
    status = { ...status, ...next };
    onChange(status);
  };
  const checkable = () => app.isPackaged && status.state !== 'cannot-install' && status.state !== 'source';

  async function alreadyStaged(version) {
    const dir = path.join(updatesDir, version);
    if (!fs.existsSync(dir)) return null;
    try {
      return await verifiedApp(dir, version);
    } catch {
      fs.rmSync(dir, { recursive: true, force: true });
      return null;
    }
  }

  async function stage(feed) {
    const dir = path.join(updatesDir, feed.version);
    const part = path.join(updatesDir, `${feed.version}.zip.part`);
    const zip = path.join(updatesDir, `${feed.version}.zip`);
    await download(feed.url, part, feed.sha512, feed.size);
    fs.renameSync(part, zip);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    try {
      await run('/usr/bin/ditto', ['-x', '-k', zip, dir], 600_000);
    } finally {
      fs.rmSync(zip, { force: true });
    }
    return verifiedApp(dir, feed.version);
  }

  /**
   * Look for a newer release and stage it. Resolves (never rejects) with what a
   * manual check should say: { kind: 'up-to-date' | 'downloading' | 'ready' |
   * 'error', version?, error? }. A manual check resolves once the download has
   * started; a background one waits for it to finish.
   */
  async function check({ manual = false } = {}) {
    if (!checkable() || status.state === 'ready' || busy) return { kind: status.state, version: status.latest };
    busy = true;
    const fail = (err) => {
      busy = false;
      set({ state: 'error', error: err.message });
      return { kind: 'error', error: err.message };
    };
    set({ state: 'checking', error: null });
    try {
      fs.mkdirSync(updatesDir, { recursive: true });
      const res = await get(feedUrl, FEED_TIMEOUT_MS);
      const feed = parseFeed(await res.text(), feedUrl);
      if (compareVersions(feed.version, status.current) <= 0) {
        tidy(updatesDir, null);
        busy = false;
        set({ state: 'up-to-date', latest: feed.version });
        return { kind: 'up-to-date', version: status.current };
      }
      tidy(updatesDir, feed.version);
      const ready = await alreadyStaged(feed.version);
      if (ready) {
        staged = ready;
        busy = false;
        set({ state: 'ready', latest: feed.version });
        return { kind: 'ready', version: feed.version };
      }
      set({ state: 'downloading', latest: feed.version });
      const job = stage(feed).then(
        (appPath) => {
          staged = appPath;
          busy = false;
          set({ state: 'ready' });
        },
        (err) => {
          tidy(updatesDir, null);
          fail(err);
        },
      );
      if (!manual) await job;
      return { kind: 'downloading', version: feed.version };
    } catch (err) {
      return fail(err);
    }
  }

  function install(relaunch) {
    installing = true;
    try {
      const script = path.join(updatesDir, 'install.sh');
      fs.writeFileSync(script, INSTALL_SCRIPT, { mode: 0o755 });
      // Carries a test profile (COLOUR_ARCHIVE_PROFILE and friends) over to the
      // relaunched app; a copy opened from Finder has none.
      const pass = Object.entries(env)
        .filter(([k, v]) => k.startsWith('COLOUR_ARCHIVE_') && v != null)
        .map(([k, v]) => `${k}=${v}`);
      const child = spawn('/bin/sh', [script, String(process.pid), bundle, staged, relaunch ? '1' : '0', ...pass], {
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', () => {});
      child.unref();
    } catch {
      installing = false;
    }
  }

  return {
    status: () => status,

    /** Decide what this copy can do, then check after a short wait and every 4 h. */
    start() {
      if (!app.isPackaged) return set({ state: 'source' });
      bundle = bundleOf(process.execPath);
      updatesDir = path.join(app.getPath('userData'), 'updates');
      if (installProblem(bundle)) return set({ state: 'cannot-install' });
      set({ state: 'idle' });
      setTimeout(() => {
        check().catch(() => {});
        setInterval(() => check().catch(() => {}), EVERY_MS);
      }, firstDelay);
    },

    check,

    /** On will-quit: swap a staged version in once this process has gone. */
    installOnQuit() {
      if (status.state === 'ready' && staged && !installing) install(false);
    },

    /** "Restart to Update". */
    restart() {
      if (status.state !== 'ready' || !staged) return;
      if (!installing) install(true);
      app.quit();
    },
  };
}

module.exports = {
  FEED,
  INSTALL_SCRIPT,
  bundleOf,
  compareVersions,
  createUpdater,
  installProblem,
  menuItems,
  parseFeed,
  statusLabel,
};
