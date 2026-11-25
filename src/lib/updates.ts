/**
 * The Updates panel's pure parts (components/Updates.astro wires them): which
 * sections a device sees and the words in each row, the dates, the device's
 * name (shared with the device beacon), and where the Mac app sits.
 *
 * Three places a page can be: the Mac app's own window ('mac-app'), any other
 * page the Mac serves (a phone, the iPad, a browser tab: 'served'), and the
 * published site ('published', which has no /api).
 */
import type { BuildInfo } from './build-info';
import type { DeviceName } from './devices';
import type { AppStatus } from './updates-server';

/** GET /api/updates (src/pages/api/updates.ts). */
export interface UpdatesReply {
  build: BuildInfo;
  app: AppStatus | null;
  published: { builtAt: string; count: number; behind: boolean } | null;
  devices: { name: string; standalone: boolean; seenAt: string; current: boolean }[];
}

export type Where = 'mac-app' | 'served' | 'published';

export interface Row {
  label: string;
  value?: string;
  /** The full text behind a shortened value (the app's path). */
  title?: string;
  status?: string;
  /** Trails the row with "Show in Finder". */
  reveal?: boolean;
}

export interface Action {
  label: string;
  do: 'check' | 'install' | 'reload';
  primary: boolean;
  disabled: boolean;
}

export interface Section {
  title: string;
  rows: Row[];
  actions: Action[];
}

export const UPDATES_HASH = '#updates';
export const POLL_MS = 1500;

// --- The device ----------------------------------------------------------------

/**
 * What kind of device this is, from its user agent. iPadOS asks for the
 * desktop site and says it is a Mac; touch points give it away.
 */
export function deviceName(ua: string, maxTouchPoints = 0): DeviceName {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 0)) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return 'Browser';
}

const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;

/** A kept device id, or null when it isn't one (src/lib/devices.ts takes 8–64 of A–Z, a–z, 0–9, -). */
export const validDeviceId = (id: string | null | undefined): id is string => typeof id === 'string' && DEVICE_ID.test(id);

/** A new device id from random bytes, as hex. */
export const newDeviceId = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// --- Dates and places ----------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function partsOf(date: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    time: `${get('hour').padStart(2, '0')}:${get('minute').padStart(2, '0')}`,
  };
}

/**
 * "Today, 20:51", "Yesterday, 09:12", "18 Nov, 20:20", or with the year when
 * it isn't this year, "18 Nov 2025, 20:20". 24-hour, in `timeZone` (the
 * device's own when left out). Null for anything that isn't a date.
 */
export function whenLabel(iso: string | null | undefined, now: Date = new Date(), timeZone?: string): string | null {
  if (typeof iso !== 'string') return null;
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  const p = partsOf(at, timeZone);
  const t = partsOf(now, timeZone);
  if (p.y === t.y && p.m === t.m && p.d === t.d) return `Today, ${p.time}`;
  const y = new Date(Date.UTC(t.y, t.m - 1, t.d - 1));
  if (p.y === y.getUTCFullYear() && p.m === y.getUTCMonth() + 1 && p.d === y.getUTCDate()) return `Yesterday, ${p.time}`;
  const day = `${p.d} ${MONTHS[p.m - 1]}`;
  return p.y === t.y ? `${day}, ${p.time}` : `${day} ${p.y}, ${p.time}`;
}

/**
 * The folder holding the app, with the home folder as `~`:
 * "/Applications/Colour Archive.app" → "/Applications",
 * "/Users/me/Downloads/Colour Archive.app" → "~/Downloads".
 */
export function folderLabel(bundle: string): string {
  const parent = bundle.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
  const home = parent.match(/^\/Users\/([^/]+)(\/.*)?$/);
  if (home && home[1] !== 'Shared') return `~${home[2] ?? ''}`;
  return parent;
}

// --- The Mac app ---------------------------------------------------------------

/** The Status row's words, or null when the row is hidden (idle). */
export function appStatusText(app: AppStatus): string | null {
  switch (app.state) {
    case 'checking': return 'Checking…';
    case 'up-to-date': return 'Up to date';
    case 'downloading': return app.latest ? `Downloading ${app.latest}…` : 'Downloading…';
    case 'ready': return app.latest ? `${app.latest} ready` : null;
    case 'error': return 'Couldn’t check';
    case 'cannot-install': return 'Move to Applications to update';
    case 'source': return 'From source';
    default: return null;
  }
}

/**
 * Whether "Update now", once pressed here, still reads "Updating…": until the
 * Mac says it is up to date, couldn't, or can't install at all. In between it
 * may report a check, a download, a version ready, or nothing (relaunching).
 */
export function keepPressed(app: AppStatus | null, pressed: boolean): boolean {
  if (!pressed || !app) return pressed;
  return !['idle', 'up-to-date', 'error', 'cannot-install', 'source'].includes(app.state) || app.pending;
}

/** The one action under the Mac's rows, or null when there is none. */
export function appAction(app: AppStatus, pressed = false): Action | null {
  if (app.state === 'cannot-install' || app.state === 'source') return null;
  if (app.pending || keepPressed(app, pressed)) return { label: 'Updating…', do: 'install', primary: true, disabled: true };
  switch (app.state) {
    case 'downloading':
    case 'ready':
      return { label: 'Update now', do: 'install', primary: true, disabled: false };
    case 'checking':
      return { label: 'Check', do: 'check', primary: false, disabled: true };
    default:
      return { label: 'Check', do: 'check', primary: false, disabled: false };
  }
}

/** On opening the panel, ask the Mac to check once when it isn't already busy. */
export const shouldCheck = (app: AppStatus | null | undefined): boolean =>
  !!app && (app.state === 'idle' || app.state === 'up-to-date' || app.state === 'error');

/** Keep asking every POLL_MS while something is moving, or "Updating…" shows. */
export const shouldPoll = (app: AppStatus | null | undefined, pressed = false): boolean =>
  pressed || (!!app && (app.state === 'checking' || app.state === 'downloading' || app.pending));

// --- The panel -----------------------------------------------------------------

export interface PanelInput {
  where: Where;
  device: DeviceName;
  /** The build this page came from (build-info.ts). */
  page: BuildInfo;
  /** GET /api/updates, or null before the first answer. */
  reply?: UpdatesReply | null;
  /** The published site: the live /publish.json's builtAt, null when it couldn't be read, undefined before asking. */
  live?: string | null;
  /** "Update now" was pressed here. */
  pressed?: boolean;
  now?: Date;
  timeZone?: string;
}

const RELOAD: Action = { label: 'Reload', do: 'reload', primary: false, disabled: false };

/** The panel's sections, top to bottom. */
export function panelSections(input: PanelInput): Section[] {
  const { where, device, page, reply = null, live, pressed = false, now = new Date(), timeZone } = input;
  const when = (iso: string | null | undefined) => whenLabel(iso, now, timeZone) ?? undefined;
  const thisDevice = `This ${device}`;

  if (where === 'published') {
    const status = live === undefined ? undefined : live === null ? 'Offline' : live === page.builtAt ? 'Up to date' : 'Newer build';
    return [{ title: thisDevice, rows: [{ label: 'Built', value: when(page.builtAt), status }], actions: [RELOAD] }];
  }

  // The Mac app's window says nothing until the Mac has answered, rather than
  // showing a page row it would swap away a moment later.
  if (where === 'mac-app' && !reply) return [];

  const app = reply?.app ?? null;
  const macRows = (a: AppStatus, here: boolean): Row[] => {
    const rows: Row[] = [{ label: 'Version', value: a.current }];
    const status = appStatusText(a);
    if (status) rows.push({ label: 'Status', status });
    if (here && a.installedIn) rows.push({ label: 'Installed in', value: folderLabel(a.installedIn), title: a.installedIn, reveal: true });
    const updated = when(a.updatedAt);
    if (updated) rows.push({ label: 'Updated', value: updated });
    return rows;
  };
  const macActions = (a: AppStatus): Action[] => {
    const action = appAction(a, pressed);
    return action ? [action] : [];
  };

  const out: Section[] = [];
  if (where === 'mac-app' && app) {
    out.push({ title: 'This Mac', rows: macRows(app, true), actions: macActions(app) });
  } else {
    const status = reply ? (reply.build.builtAt === page.builtAt ? 'Up to date' : 'Newer page') : undefined;
    out.push({ title: thisDevice, rows: [{ label: 'Page', value: page.version, status }], actions: [RELOAD] });
    if (app) out.push({ title: 'Mac', rows: macRows(app, false), actions: macActions(app) });
  }

  if (reply && (reply.published || reply.devices.length)) {
    const rows: Row[] = [
      reply.published
        ? { label: 'Published', value: when(reply.published.builtAt), status: reply.published.behind ? 'Behind' : 'Up to date' }
        : { label: 'Published', status: 'Couldn’t check' },
    ];
    const devices = [...reply.devices].sort((a, b) => (Date.parse(b.seenAt) || 0) - (Date.parse(a.seenAt) || 0));
    for (const d of devices) rows.push({ label: d.name, value: when(d.seenAt), status: d.current ? 'Up to date' : 'Old page' });
    out.push({ title: 'Phones and iPads', rows, actions: [] });
  }
  return out;
}
