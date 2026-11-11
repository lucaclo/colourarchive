// Colour Archive for the Mac.
//
// The whole job of this file: open from Applications, the Dock or Launchpad
// with no Terminal, no Node and no certificate. It asks once where the
// photographs should live, starts the archive's own server (server.mjs) in the
// background with Electron's built-in Node, opens the archive in its own
// window, and stops the server again when the app quits.
//
// Run it from the repository with `npm run app` (after `npm run app:build`);
// `npm run app:dist` packages it into a .dmg.

const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell, utilityProcess } = require('electron');
const { ensureCerts, localHostName } = require('./certs.cjs');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

app.setName('Colour Archive');
// For tests and trying things out: a separate settings folder and a different
// suggested archive, so a run never touches the real ones.
if (process.env.COLOUR_ARCHIVE_PROFILE) app.setPath('userData', process.env.COLOUR_ARCHIVE_PROFILE);

// A fixed port, not a free one picked each launch: the port is part of the
// page's origin, and the origin owns the archive's browser storage (zine
// drafts, the colour tray, the service worker's offline copy). A new port each
// time would quietly forget all of it.
const PORT = 43210;
const SPARE_PORTS = [43211, 43212, 43213];
const START_TIMEOUT_MS = 120_000;
// The home network (issue #138), fixed for the same reason as PORT: the iPad's
// home-screen app is its origin, name and port together.
const LAN_PORT = 43443;
const LAN_SETUP_PORT = 43280;
// From anywhere: the gated listener a Tailscale Funnel carries to the
// internet. Localhost only; see server.mjs and remote-gate.mjs.
const REMOTE_PORT = 43480;

const APP_ROOT = app.getAppPath();
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const MODELS_DIR = path.join(app.getPath('userData'), 'models');
const LOG_DIR = path.join(os.homedir(), 'Library', 'Logs', 'Colour Archive');
const LOG_PATH = path.join(LOG_DIR, 'server.log');
const DEFAULT_DATA = process.env.COLOUR_ARCHIVE_SUGGEST || path.join(app.getPath('pictures'), 'Colour Archive');
const CERT_DIR = path.join(app.getPath('userData'), 'certs');
const REMOTE_FILE = path.join(app.getPath('userData'), 'remote.json');

let startWindow = null;
let mainWindow = null;
let server = null;
let origin = null;
let quitting = false;
// Opened by macOS at login: serve the archive (inbox, iPad) without putting a
// window in front of whatever else is opening. The Dock icon brings it up.
let quiet = false;
// What the home-network side last said: null (off), 'ok', or why it failed.
let lanState = null;
// The same for the from-anywhere side.
let remoteState = null;
let passwordWindow = null;

// --- Settings -----------------------------------------------------------

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(next) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

const ABOUT_FOLDER = `This folder is your Colour Archive.

Photos       your original photographs, exactly as you added them
Inspiration  the reference images you add to Match
.archive     everything the app works out from them (hidden)

Keep the folder together: moving one part on its own will lose photographs.
To move the whole archive, quit Colour Archive, move this folder, then open
the app and choose it again (File > Choose Archive Folder).
`;

/** Make `dir` ready to hold an archive. Throws a readable message on failure. */
function prepareFolder(dir) {
  for (const sub of ['Photos', 'Inspiration', '.archive']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  const about = path.join(dir, 'About this folder.txt');
  if (!fs.existsSync(about)) fs.writeFileSync(about, ABOUT_FOLDER);
  fs.accessSync(dir, fs.constants.W_OK);
}

const tidyPath = (p) => (p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p);

// --- The start window: first-run choice, then "opening", or what went wrong.

function showStart(state) {
  if (!startWindow || startWindow.isDestroyed()) {
    startWindow = new BrowserWindow({
      width: 560,
      height: 460,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'Colour Archive',
      backgroundColor: '#100f0e',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    startWindow.loadFile(path.join(__dirname, 'start.html'));
    startWindow.once('ready-to-show', () => startWindow?.show());
    startWindow.on('closed', () => {
      startWindow = null;
      // Closing the start window before the archive opened means "never mind".
      if (!mainWindow && !quitting) app.quit();
    });
  }
  const send = () => startWindow?.webContents.send('state', state);
  if (startWindow.webContents.isLoading()) startWindow.webContents.once('did-finish-load', send);
  else send();
}

// --- The server ---------------------------------------------------------

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function pickPort() {
  for (const p of [PORT, ...SPARE_PORTS]) if (await portFree(p)) return p;
  return null;
}

function logTail(lines = 12) {
  try {
    return fs.readFileSync(LOG_PATH, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

/** The iPad's addresses, when "Let My iPad In" is on. */
function lanAddresses() {
  const host = `${localHostName()}.local`;
  return { host, archive: `https://${host}:${LAN_PORT}/`, setup: `http://${host}:${LAN_SETUP_PORT}/` };
}

/** Environment for the server's home-network side, or {} when it's off. */
function lanEnv() {
  if (!readSettings().lan) return {};
  const { host, archive, setup } = lanAddresses();
  try {
    const certs = ensureCerts(CERT_DIR, host);
    return {
      LAN_PORT: String(LAN_PORT), LAN_SETUP_PORT: String(LAN_SETUP_PORT), LAN_HOST: host,
      LAN_TLS_KEY: certs.key, LAN_TLS_CERT: certs.cert, LAN_TLS_CA: certs.ca,
      COLOUR_ARCHIVE_LAN_URL: archive, COLOUR_ARCHIVE_LAN_SETUP: setup,
    };
  } catch (err) {
    lanState = `The certificate couldn’t be made: ${String(err.stderr ?? err.message).trim()}`;
    return {};
  }
}

/** Environment for the server's gated listener, or {} when it's off. */
function remoteEnv() {
  const s = readSettings();
  if (!s.remote || !fs.existsSync(REMOTE_FILE)) return {};
  return {
    REMOTE_PORT: String(REMOTE_PORT), REMOTE_FILE, REMOTE_HOST: s.remoteHost ?? '',
    COLOUR_ARCHIVE_REMOTE_URL: s.remoteHost ? `https://${s.remoteHost}/` : '',
  };
}

async function openArchive(dataDir) {
  if (!quiet) showStart({ kind: 'opening', folder: tidyPath(dataDir) });
  try {
    prepareFolder(dataDir);
  } catch (err) {
    showStart({ kind: 'error', title: 'This folder can’t be used', detail: `${tidyPath(dataDir)}: ${err.message}`, canChoose: true });
    return;
  }

  const port = await pickPort();
  if (!port) {
    showStart({ kind: 'error', title: 'Colour Archive couldn’t start', detail: `Ports ${PORT}–${SPARE_PORTS.at(-1)} are all in use. Restarting the Mac frees them.`, canRetry: true });
    return;
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  const log = fs.createWriteStream(LOG_PATH, { flags: 'a' });
  log.write(`\n=== ${new Date().toISOString()} opening ${dataDir} on port ${port} ===\n`);

  stopServer();
  lanState = null;
  const lan = lanEnv();
  const child = utilityProcess.fork(path.join(__dirname, 'server.mjs'), [], {
    cwd: APP_ROOT,
    stdio: 'pipe',
    serviceName: 'Colour Archive server',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      COLOUR_ARCHIVE_DATA: dataDir,
      COLOUR_ARCHIVE_MODELS: MODELS_DIR,
      ...lan,
      ...remoteEnv(),
    },
  });
  server = child;
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);

  let settled = false;
  const fail = (detail) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    stopServer();
    quiet = false;
    if (mainWindow) { mainWindow.destroy(); mainWindow = null; }
    showStart({ kind: 'error', title: 'Colour Archive couldn’t start', detail, log: logTail(), canRetry: true, canChoose: true });
  };
  const timer = setTimeout(() => fail('It took more than two minutes to start.'), START_TIMEOUT_MS);

  child.on('message', (msg) => {
    if (msg?.type === 'ready' && !settled) {
      settled = true;
      clearTimeout(timer);
      origin = `http://127.0.0.1:${msg.port}`;
      if (quiet) quiet = false; // served; the window waits for the Dock icon
      else openMainWindow();
    } else if (msg?.type === 'error') {
      fail(msg.message);
    } else if (msg?.type === 'lan') {
      lanState = msg.ok ? 'ok' : msg.message;
      buildMenu();
    } else if (msg?.type === 'remote') {
      remoteState = msg.ok ? 'ok' : msg.message;
      buildMenu();
    }
  });
  child.on('exit', (code) => {
    if (server === child) server = null;
    if (quitting) return;
    if (!settled) fail(`The archive stopped while starting (code ${code}).`);
    else if (mainWindow) {
      // It was running and died. Say so instead of leaving a dead window.
      mainWindow.destroy();
      mainWindow = null;
      showStart({ kind: 'error', title: 'Colour Archive stopped unexpectedly', detail: `Code ${code}.`, log: logTail(), canRetry: true });
    }
  });
}

function stopServer() {
  if (server) {
    const s = server;
    server = null;
    s.kill();
  }
}

// --- The archive window -------------------------------------------------

function isOurs(url) {
  try {
    return origin !== null && new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function openMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(`${origin}/`);
    return;
  }
  const saved = readSettings().bounds;
  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1400,
    height: saved?.height ?? 900,
    x: saved?.x,
    y: saved?.y,
    minWidth: 720,
    minHeight: 520,
    title: 'Colour Archive',
    backgroundColor: '#100f0e',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  const wc = mainWindow.webContents;
  // Links to anywhere else (a photographer's site, a map credit, Apple's
  // help) open in the person's browser, never inside the archive window.
  wc.setWindowOpenHandler(({ url }) => {
    if (isOurs(url) || url === 'about:blank') return { action: 'allow' };
    if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (isOurs(url)) return;
    event.preventDefault();
    if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (startWindow && !startWindow.isDestroyed()) startWindow.destroy();
  });
  mainWindow.on('close', () => {
    const s = readSettings();
    writeSettings({ ...s, bounds: mainWindow.getNormalBounds() });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadURL(`${origin}/`);
}

// --- Choosing where the archive lives ----------------------------------

async function chooseFolder(kind) {
  let dir = DEFAULT_DATA;
  if (kind === 'other') {
    const owner = startWindow && !startWindow.isDestroyed() ? startWindow : mainWindow;
    const res = await dialog.showOpenDialog(owner, {
      title: 'Choose a folder for your archive',
      buttonLabel: 'Use This Folder',
      defaultPath: app.getPath('pictures'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return false;
    dir = res.filePaths[0];
  }
  writeSettings({ ...readSettings(), dataDir: dir });
  if (mainWindow) { mainWindow.destroy(); mainWindow = null; }
  openArchive(dir);
  return true;
}

function start() {
  const { dataDir } = readSettings();
  if (!dataDir) {
    showStart({ kind: 'choose', suggested: tidyPath(DEFAULT_DATA) });
  } else if (!fs.existsSync(dataDir)) {
    quiet = false;
    // An external drive that isn't plugged in, or a folder moved in Finder.
    showStart({ kind: 'missing', folder: tidyPath(dataDir), canRetry: true, canChoose: true });
  } else {
    openArchive(dataDir);
  }
}

ipcMain.handle('choose', (_e, kind) => chooseFolder(kind === 'other' ? 'other' : 'default'));
ipcMain.handle('retry', () => start());
ipcMain.handle('show-log', () => shell.openPath(LOG_PATH));

// --- Menu ---------------------------------------------------------------

function setOpenAtLogin(on) {
  app.setLoginItemSettings({ openAtLogin: on });
  buildMenu();
}

function setLan(on) {
  writeSettings({ ...readSettings(), lan: on });
  const { dataDir } = readSettings();
  buildMenu();
  // The server reads its addresses when it starts, so start it again.
  if (dataDir && server) openArchive(dataDir);
  if (on) showIpadSetup();
}

async function showIpadSetup() {
  const { setup, archive } = lanAddresses();
  const owner = mainWindow ?? startWindow ?? undefined;
  const problem = lanState && lanState !== 'ok' ? `\n\nRight now it can’t: ${lanState}` : '';
  const { response } = await dialog.showMessageBox(owner, {
    type: 'info',
    message: 'Open this on your iPad, in Safari',
    detail: `${setup}\n\nIt walks through trusting this Mac once, then opens the archive at ${archive}. The Mac has to be awake with Colour Archive open, on the same Wi-Fi.${problem}`,
    buttons: ['Copy Address', 'Done'],
    defaultId: 1,
  });
  if (response === 0) clipboard.writeText(setup);
}

// --- From anywhere: a password, then a Tailscale Funnel ----------------
//
// Tailscale gives this Mac a fixed https address on the internet without a
// domain or a router change; the archive itself stays on 127.0.0.1 behind
// remote-gate.mjs. Tailscale is the person's own install (the app from
// tailscale.com or the App Store, signed in once), not bundled here.

const gate = () => import('./remote-gate.mjs');

const TAILSCALE_PATHS = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/local/bin/tailscale',
];

function tailscaleCli() {
  return TAILSCALE_PATHS.find((p) => fs.existsSync(p)) ?? null;
}

function runTailscale(args, timeout = 30_000) {
  const cli = tailscaleCli();
  if (!cli) return Promise.reject(new Error('Tailscale isn’t installed.'));
  return new Promise((resolve, reject) => {
    execFile(cli, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${stderr || stdout || err.message}`.trim()));
      else resolve(`${stdout}`.trim());
    });
  });
}

/** This Mac's name on the tailnet, e.g. `my-mac.tail1234.ts.net`. */
async function tailnetHost() {
  const status = JSON.parse(await runTailscale(['status', '--json']));
  const name = status?.Self?.DNSName?.replace(/\.$/, '');
  if (!name) throw new Error('Tailscale isn’t signed in.');
  return name;
}

function askPassword() {
  return new Promise((resolve) => {
    if (passwordWindow && !passwordWindow.isDestroyed()) {
      passwordWindow.focus();
      return resolve(false);
    }
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      ipcMain.removeHandler('remote-password');
      ipcMain.removeHandler('remote-cancel');
      if (passwordWindow && !passwordWindow.isDestroyed()) passwordWindow.destroy();
      passwordWindow = null;
      resolve(ok);
    };
    ipcMain.handle('remote-password', async (_e, password) => {
      try {
        await (await gate()).setPassword(REMOTE_FILE, String(password ?? ''));
        finish(true);
        return null;
      } catch (err) {
        return err.message;
      }
    });
    ipcMain.handle('remote-cancel', () => finish(false));
    passwordWindow = new BrowserWindow({
      width: 460, height: 400, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      title: 'Phone password', backgroundColor: '#100f0e', show: false,
      parent: mainWindow ?? undefined, modal: Boolean(mainWindow),
      webPreferences: { preload: path.join(__dirname, 'remote-preload.cjs'), contextIsolation: true, sandbox: true },
    });
    passwordWindow.loadFile(path.join(__dirname, 'remote.html'));
    passwordWindow.once('ready-to-show', () => passwordWindow?.show());
    passwordWindow.on('closed', () => finish(false));
  });
}

async function setRemote(on) {
  const owner = mainWindow ?? startWindow ?? undefined;
  if (!on) {
    await runTailscale(['funnel', '--https=443', 'off']).catch(() => {});
    writeSettings({ ...readSettings(), remote: false });
    fs.rmSync(path.join(app.getPath('userData'), 'remote-host'), { force: true });
    remoteState = null;
    buildMenu();
    const { dataDir } = readSettings();
    if (dataDir && server) openArchive(dataDir);
    return;
  }
  if (!tailscaleCli()) {
    buildMenu();
    const { response } = await dialog.showMessageBox(owner, {
      type: 'info',
      message: 'This needs Tailscale',
      detail: 'Tailscale gives this Mac a private, fixed address on the internet. Install it (free), sign in once, then choose this again.',
      buttons: ['Get Tailscale', 'Cancel'],
      defaultId: 0,
    });
    if (response === 0) shell.openExternal('https://tailscale.com/download/mac');
    return;
  }
  if (!fs.existsSync(REMOTE_FILE) || !(await gate()).hasPassword(REMOTE_FILE)) {
    if (!(await askPassword())) return buildMenu();
  }
  let host;
  try {
    host = await tailnetHost();
    await runTailscale(['funnel', '--bg', String(REMOTE_PORT)], 60_000);
  } catch (err) {
    buildMenu();
    // The first time, Tailscale asks for Funnel to be allowed on the account
    // and prints the page to do it on.
    const link = String(err.message).match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0];
    const { response } = await dialog.showMessageBox(owner, {
      type: 'warning',
      message: 'Tailscale couldn’t open the address',
      detail: link ? `Tailscale needs Funnel allowed once, on its website. Then choose this again.\n\n${link}` : String(err.message),
      buttons: link ? ['Open Tailscale', 'Cancel'] : ['OK'],
      defaultId: 0,
    });
    if (link && response === 0) shell.openExternal(link);
    return;
  }
  writeSettings({ ...readSettings(), remote: true, remoteHost: host });
  // So the next public build links its Mac-only tabs here (astro.config.mjs).
  fs.writeFileSync(path.join(app.getPath('userData'), 'remote-host'), `${host}\n`);
  buildMenu();
  const { dataDir } = readSettings();
  if (dataDir && server) openArchive(dataDir);
  showRemoteAddress();
}

async function showRemoteAddress() {
  const host = readSettings().remoteHost;
  if (!host) return;
  const url = `https://${host}/`;
  const owner = mainWindow ?? startWindow ?? undefined;
  const problem = remoteState && remoteState !== 'ok' ? `\n\nRight now it can’t: ${remoteState}` : '';
  const { response } = await dialog.showMessageBox(owner, {
    type: 'info',
    message: 'Open this on your phone',
    detail: `${url}\n\nSign in with your phone password, then Share › Add to Home Screen. It works anywhere while this Mac is awake with Colour Archive open.${problem}`,
    buttons: ['Copy Address', 'Done'],
    defaultId: 1,
  });
  if (response === 0) clipboard.writeText(url);
}

async function changeRemotePassword() {
  if (await askPassword()) {
    dialog.showMessageBox(mainWindow ?? undefined, { type: 'info', message: 'Password changed', detail: 'Every phone has been signed out and needs the new password.' });
  }
}

async function signOutPhones() {
  (await gate()).signOutAll(REMOTE_FILE);
  dialog.showMessageBox(mainWindow ?? undefined, { type: 'info', message: 'Every phone is signed out', detail: 'They need the password again to open the archive.' });
}

function buildMenu() {
  const lanOn = Boolean(readSettings().lan);
  const remoteOn = Boolean(readSettings().remote);
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Open at Login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (item) => setOpenAtLogin(item.checked) },
        { label: 'Let My iPad In', type: 'checkbox', checked: lanOn, click: (item) => setLan(item.checked) },
        {
          label: lanOn && lanState && lanState !== 'ok' ? 'Set Up iPad… (not reachable)' : 'Set Up iPad…',
          enabled: lanOn,
          click: () => showIpadSetup(),
        },
        { type: 'separator' },
        { label: 'Let My Phone In From Anywhere', type: 'checkbox', checked: remoteOn, click: (item) => setRemote(item.checked) },
        {
          label: remoteOn && remoteState && remoteState !== 'ok' ? 'Phone Address… (not reachable)' : 'Phone Address…',
          enabled: remoteOn,
          click: () => showRemoteAddress(),
        },
        { label: 'Change Phone Password…', enabled: remoteOn, click: () => changeRemotePassword() },
        { label: 'Sign Out All Phones', enabled: remoteOn, click: () => signOutPhones() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Show Archive Folder in Finder',
          click: () => {
            const { dataDir } = readSettings();
            if (dataDir) shell.openPath(dataDir);
          },
        },
        { label: 'Choose Archive Folder…', click: () => chooseFolder('other') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Show Server Log', click: () => shell.openPath(LOG_PATH) },
        { label: 'Developer Tools', accelerator: 'Alt+Command+I', click: (_i, win) => win?.webContents.toggleDevTools() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- Lifecycle ----------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  // Already open: the first copy brings its window forward (below).
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = mainWindow ?? startWindow;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // Lets the archive's pages know they are inside the app (src/lib/install.ts).
  app.userAgentFallback = `${app.userAgentFallback} ColourArchiveMac/${app.getVersion()}`;

  app.whenReady().then(() => {
    // Only quiet when there's an archive to serve; a first run still asks.
    quiet = Boolean(app.getLoginItemSettings().wasOpenedAtLogin && readSettings().dataDir);
    buildMenu();
    start();
  });

  // The Mac convention: closing the window leaves the app in the Dock, and
  // clicking the Dock icon brings the archive back.
  app.on('activate', () => {
    if (mainWindow || startWindow) return;
    if (server && origin) openMainWindow();
    else start();
  });
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    quitting = true;
    stopServer();
  });
}
