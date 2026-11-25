import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppStatus } from './updates-server';
import {
  appAction,
  appStatusText,
  deviceName,
  folderLabel,
  keepPressed,
  newDeviceId,
  panelSections,
  shouldCheck,
  shouldPoll,
  validDeviceId,
  whenLabel,
  type PanelInput,
  type UpdatesReply,
} from './updates';

const app = (state: AppStatus['state'], extra: Partial<AppStatus> = {}): AppStatus => ({
  state,
  current: '0.2.9',
  latest: null,
  error: null,
  installedIn: '/Applications/Colour Archive.app',
  updatedAt: null,
  pending: false,
  ...extra,
});

const PAGE = { version: '0.2.9', builtAt: '2026-11-25T08:00:00.000Z' };
const NOW = new Date('2026-11-25T20:55:00Z');
const TZ = 'Europe/London';
const reply = (extra: Partial<UpdatesReply> = {}): UpdatesReply => ({
  build: { ...PAGE },
  app: null,
  published: null,
  devices: [],
  ...extra,
});
const sections = (input: Partial<PanelInput>) =>
  panelSections({ where: 'served', device: 'iPhone', page: PAGE, now: NOW, timeZone: TZ, ...input });

// --- device names -------------------------------------------------------------

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  bot: 'curl/8.7.1',
};

test('device names: iPad by name or by a Mac with touch, then iPhone, Android, Mac, Windows, Linux, else Browser', () => {
  assert.equal(deviceName(UA.ipadOld, 5), 'iPad');
  assert.equal(deviceName(UA.ipadDesktop, 5), 'iPad');
  assert.equal(deviceName(UA.ipadDesktop, 0), 'Mac');
  assert.equal(deviceName(UA.iphone, 5), 'iPhone');
  assert.equal(deviceName(UA.android, 5), 'Android');
  assert.equal(deviceName(UA.macChrome), 'Mac');
  assert.equal(deviceName(`${UA.macChrome} ColourArchiveMac/0.2.9`), 'Mac');
  assert.equal(deviceName(UA.windows), 'Windows');
  assert.equal(deviceName(UA.linux), 'Linux');
  assert.equal(deviceName(UA.bot), 'Browser');
  assert.equal(deviceName(''), 'Browser');
});

test('device ids: hex from random bytes, and what devices.ts would take', () => {
  const id = newDeviceId(new Uint8Array([0, 1, 15, 16, 255, 171, 205, 239]));
  assert.equal(id, '00010f10ffabcdef');
  assert.ok(validDeviceId(id));
  assert.ok(validDeviceId(newDeviceId(new Uint8Array(16).fill(7))));
  assert.equal(validDeviceId('short'), false);
  assert.equal(validDeviceId('has spaces in it'), false);
  assert.equal(validDeviceId(null), false);
  assert.equal(validDeviceId('x'.repeat(65)), false);
});

// --- dates ------------------------------------------------------------------------

test('dates: today and yesterday by the calendar, in the device’s time zone, 24-hour', () => {
  assert.equal(whenLabel('2026-11-25T20:51:00Z', NOW, TZ), 'Today, 20:51');
  assert.equal(whenLabel('2026-11-25T00:05:00Z', NOW, TZ), 'Today, 00:05');
  assert.equal(whenLabel('2026-11-24T09:12:00Z', NOW, TZ), 'Yesterday, 09:12');
  assert.equal(whenLabel('2026-11-24T00:00:00Z', NOW, TZ), 'Yesterday, 00:00');
  assert.equal(whenLabel('2026-11-23T23:59:00Z', NOW, TZ), '23 Nov, 23:59');
  // 20:20 in London in summer is 19:20 UTC.
  assert.equal(whenLabel('2026-07-18T19:20:00Z', NOW, TZ), '18 Jul, 20:20');
  assert.equal(whenLabel('2025-11-18T20:20:00Z', NOW, TZ), '18 Nov 2025, 20:20');
  assert.equal(whenLabel('2026-09-03T08:00:00Z', NOW, TZ), '3 Sep, 09:00');
});

test('dates: the day turns at the device’s midnight, not UTC’s', () => {
  // 01:30 on the 26th in Hong Kong is 17:30 UTC on the 25th.
  const hkNow = new Date('2026-11-25T17:30:00Z');
  assert.equal(whenLabel('2026-11-25T16:00:00Z', hkNow, 'Asia/Hong_Kong'), 'Today, 00:00');
  assert.equal(whenLabel('2026-11-25T15:59:00Z', hkNow, 'Asia/Hong_Kong'), 'Yesterday, 23:59');
  // New Year: yesterday is 31 Dec of last year.
  const jan1 = new Date('2027-01-01T10:00:00Z');
  assert.equal(whenLabel('2026-12-31T22:00:00Z', jan1, 'UTC'), 'Yesterday, 22:00');
  assert.equal(whenLabel('2026-12-30T22:00:00Z', jan1, 'UTC'), '30 Dec 2026, 22:00');
});

test('dates: nothing for what isn’t one', () => {
  assert.equal(whenLabel(null, NOW, TZ), null);
  assert.equal(whenLabel(undefined, NOW, TZ), null);
  assert.equal(whenLabel('not a date', NOW, TZ), null);
});

// --- where the app is ---------------------------------------------------------

test('the folder holding the app, with the home folder as ~', () => {
  assert.equal(folderLabel('/Applications/Colour Archive.app'), '/Applications');
  assert.equal(folderLabel('/Users/me/Downloads/Colour Archive.app'), '~/Downloads');
  assert.equal(folderLabel('/Users/me/Applications/Colour Archive.app/'), '~/Applications');
  assert.equal(folderLabel('/Users/me/Colour Archive.app'), '~');
  assert.equal(folderLabel('/Users/Shared/Colour Archive.app'), '/Users/Shared');
  assert.equal(folderLabel('/Volumes/Colour Archive/Colour Archive.app'), '/Volumes/Colour Archive');
  assert.equal(folderLabel('/Colour Archive.app'), '/');
});

// --- the Mac app's status and action --------------------------------------------

test('status words for every state; idle hides the row', () => {
  assert.equal(appStatusText(app('checking')), 'Checking…');
  assert.equal(appStatusText(app('up-to-date')), 'Up to date');
  assert.equal(appStatusText(app('downloading', { latest: '0.2.10' })), 'Downloading 0.2.10…');
  assert.equal(appStatusText(app('ready', { latest: '0.2.10' })), '0.2.10 ready');
  assert.equal(appStatusText(app('error', { error: 'getaddrinfo ENOTFOUND github.com' })), 'Couldn’t check');
  assert.equal(appStatusText(app('cannot-install')), 'Move to Applications to update');
  assert.equal(appStatusText(app('source')), 'From source');
  assert.equal(appStatusText(app('idle')), null);
});

test('actions: Check when settled, Update now with a version coming, Updating… once asked, none when it can’t install', () => {
  const label = (a: ReturnType<typeof appAction>) => (a ? `${a.label}${a.primary ? ' (primary)' : ''}${a.disabled ? ' (disabled)' : ''}` : null);
  assert.equal(label(appAction(app('up-to-date'))), 'Check');
  assert.equal(label(appAction(app('idle'))), 'Check');
  assert.equal(label(appAction(app('error'))), 'Check');
  assert.equal(label(appAction(app('checking'))), 'Check (disabled)');
  assert.equal(label(appAction(app('downloading', { latest: '0.2.10' }))), 'Update now (primary)');
  assert.equal(label(appAction(app('ready', { latest: '0.2.10' }))), 'Update now (primary)');
  assert.equal(label(appAction(app('ready', { latest: '0.2.10' }), true)), 'Updating… (primary) (disabled)');
  assert.equal(label(appAction(app('checking', { pending: true }))), 'Updating… (primary) (disabled)');
  assert.equal(label(appAction(app('downloading', { pending: true }))), 'Updating… (primary) (disabled)');
  assert.equal(label(appAction(app('cannot-install'))), null);
  assert.equal(label(appAction(app('source'))), null);
  assert.equal(appAction(app('ready'))?.do, 'install');
  assert.equal(appAction(app('up-to-date'))?.do, 'check');
});

test('Updating… lasts until the Mac settles', () => {
  assert.equal(keepPressed(app('ready'), true), true);
  assert.equal(keepPressed(app('downloading'), true), true);
  assert.equal(keepPressed(app('checking'), true), true);
  assert.equal(keepPressed(null, true), true, 'the Mac relaunching: no answer yet');
  assert.equal(keepPressed(app('up-to-date'), true), false);
  assert.equal(keepPressed(app('error'), true), false);
  assert.equal(keepPressed(app('idle'), true), false, 'relaunched onto the new version');
  assert.equal(keepPressed(app('ready'), false), false);
  // After an install the panel shows Check again, not a stale Updating….
  assert.equal(appAction(app('up-to-date'), keepPressed(app('up-to-date'), true))?.label, 'Check');
});

test('check once on opening when settled; poll while it moves', () => {
  assert.equal(shouldCheck(app('idle')), true);
  assert.equal(shouldCheck(app('up-to-date')), true);
  assert.equal(shouldCheck(app('error')), true);
  for (const s of ['checking', 'downloading', 'ready', 'cannot-install', 'source'] as const) assert.equal(shouldCheck(app(s)), false, s);
  assert.equal(shouldCheck(null), false);
  assert.equal(shouldPoll(app('checking')), true);
  assert.equal(shouldPoll(app('downloading')), true);
  assert.equal(shouldPoll(app('ready', { pending: true })), true);
  assert.equal(shouldPoll(app('ready')), false);
  assert.equal(shouldPoll(app('up-to-date')), false);
  assert.equal(shouldPoll(app('ready'), true), true);
  assert.equal(shouldPoll(null), false);
});

// --- which sections show --------------------------------------------------------

const flat = (s: ReturnType<typeof panelSections>) =>
  s.map((sec) => ({
    title: sec.title,
    rows: sec.rows.map((r) => [r.label, r.value ?? '', r.status ?? (r.reveal ? 'Show in Finder' : '')].join(' | ')),
    actions: sec.actions.map((a) => `${a.label}${a.disabled ? ' (disabled)' : ''}`),
  }));

test('the Mac app: This Mac with version, status, where it is and when it was updated', () => {
  const s = sections({
    where: 'mac-app',
    device: 'Mac',
    reply: reply({ app: app('up-to-date', { installedIn: '/Users/me/Downloads/Colour Archive.app', updatedAt: '2026-11-24T09:12:00Z' }) }),
  });
  assert.deepEqual(flat(s), [
    {
      title: 'This Mac',
      rows: ['Version | 0.2.9 | ', 'Status |  | Up to date', 'Installed in | ~/Downloads | Show in Finder', 'Updated | Yesterday, 09:12 | '],
      actions: ['Check'],
    },
  ]);
  assert.equal(s[0].rows[2].title, '/Users/me/Downloads/Colour Archive.app');
});

test('the Mac app: idle hides Status, no path hides Installed in, no date hides Updated', () => {
  const s = sections({ where: 'mac-app', device: 'Mac', reply: reply({ app: app('idle', { installedIn: null }) }) });
  assert.deepEqual(flat(s), [{ title: 'This Mac', rows: ['Version | 0.2.9 | '], actions: ['Check'] }]);
});

test('the Mac app: nothing until the Mac answers; a window with no updater shows its page', () => {
  assert.deepEqual(sections({ where: 'mac-app', device: 'Mac', reply: null }), []);
  const s = sections({ where: 'mac-app', device: 'Mac', reply: reply() });
  assert.deepEqual(flat(s), [{ title: 'This Mac', rows: ['Page | 0.2.9 | Up to date'], actions: ['Reload'] }]);
});

test('a phone served by the Mac: its page, the Mac, and the phones and iPads', () => {
  const s = sections({
    reply: reply({
      build: { version: '0.2.10', builtAt: '2026-11-25T19:00:00.000Z' },
      app: app('downloading', { latest: '0.2.10', updatedAt: '2025-11-18T20:20:00Z' }),
      published: { builtAt: '2026-11-25T20:51:00Z', count: 110, behind: true },
      devices: [
        { name: 'iPad', standalone: true, seenAt: '2026-11-24T09:12:00Z', current: false },
        { name: 'iPhone', standalone: true, seenAt: '2026-11-25T20:50:00Z', current: true },
      ],
    }),
  });
  assert.deepEqual(flat(s), [
    { title: 'This iPhone', rows: ['Page | 0.2.9 | Newer page'], actions: ['Reload'] },
    { title: 'Mac', rows: ['Version | 0.2.9 | ', 'Status |  | Downloading 0.2.10…', 'Updated | 18 Nov 2025, 20:20 | '], actions: ['Update now'] },
    {
      title: 'Phones and iPads',
      rows: ['Published | Today, 20:51 | Behind', 'iPhone | Today, 20:50 | Up to date', 'iPad | Yesterday, 09:12 | Old page'],
      actions: [],
    },
  ]);
});

test('a served page before the Mac answers shows its page without a status; no app, no Mac section', () => {
  assert.deepEqual(flat(sections({ device: 'iPad', reply: null })), [{ title: 'This iPad', rows: ['Page | 0.2.9 | '], actions: ['Reload'] }]);
  assert.deepEqual(flat(sections({ device: 'Mac', reply: reply() })), [{ title: 'This Mac', rows: ['Page | 0.2.9 | Up to date'], actions: ['Reload'] }]);
});

test('Phones and iPads: shown when there is anything to list; the published site that couldn’t be read says so', () => {
  const devices = [{ name: 'iPhone', standalone: false, seenAt: '2026-11-25T20:00:00Z', current: true }];
  const s = sections({ reply: reply({ devices }) });
  assert.deepEqual(flat(s)[1], { title: 'Phones and iPads', rows: ['Published |  | Couldn’t check', 'iPhone | Today, 20:00 | Up to date'], actions: [] });
  const up = sections({ reply: reply({ published: { builtAt: '2026-11-18T20:20:00Z', count: 3, behind: false } }) });
  assert.deepEqual(flat(up)[1], { title: 'Phones and iPads', rows: ['Published | 18 Nov, 20:20 | Up to date'], actions: [] });
});

test('Update now pressed on a phone reads Updating… in the Mac section', () => {
  const s = sections({ reply: reply({ app: app('ready', { latest: '0.2.10' }) }), pressed: true });
  assert.deepEqual(flat(s)[1].actions, ['Updating… (disabled)']);
});

test('the published site: when it was built, against the live build', () => {
  const at = (live: string | null | undefined) => flat(sections({ where: 'published', live }));
  assert.deepEqual(at(PAGE.builtAt), [{ title: 'This iPhone', rows: ['Built | Today, 08:00 | Up to date'], actions: ['Reload'] }]);
  assert.deepEqual(at('2026-11-25T21:00:00.000Z')[0].rows, ['Built | Today, 08:00 | Newer build']);
  assert.deepEqual(at(null)[0].rows, ['Built | Today, 08:00 | Offline']);
  assert.deepEqual(at(undefined)[0].rows, ['Built | Today, 08:00 | ']);
  // Nothing else, whatever else is passed.
  assert.equal(sections({ where: 'published', reply: reply({ app: app('ready') }) }).length, 1);
});
