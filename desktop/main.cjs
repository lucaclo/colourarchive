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

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, utilityProcess } = require('electron');
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

const APP_ROOT = app.getAppPath();
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const MODELS_DIR = path.join(app.getPath('userData'), 'models');
const LOG_DIR = path.join(os.homedir(), 'Library', 'Logs', 'Colour Archive');
const LOG_PATH = path.join(LOG_DIR, 'server.log');
const DEFAULT_DATA = process.env.COLOUR_ARCHIVE_SUGGEST || path.join(app.getPath('pictures'), 'Colour Archive');

let startWindow = null;
let mainWindow = null;
let server = null;
let origin = null;
let quitting = false;

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

async function openArchive(dataDir) {
  showStart({ kind: 'opening', folder: tidyPath(dataDir) });
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
    if (mainWindow) { mainWindow.destroy(); mainWindow = null; }
    showStart({ kind: 'error', title: 'Colour Archive couldn’t start', detail, log: logTail(), canRetry: true, canChoose: true });
  };
  const timer = setTimeout(() => fail('It took more than two minutes to start.'), START_TIMEOUT_MS);

  child.on('message', (msg) => {
    if (msg?.type === 'ready' && !settled) {
      settled = true;
      clearTimeout(timer);
      origin = `http://127.0.0.1:${msg.port}`;
      openMainWindow();
    } else if (msg?.type === 'error') {
      fail(msg.message);
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

function buildMenu() {
  const template = [
    { role: 'appMenu' },
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
