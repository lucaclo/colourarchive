import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMacApp, MAX_DEVICES, parseReport, readDevices, recordDevice, rememberDevice, type Device } from './devices';

const BUILT = '2026-11-25T08:00:00.000Z';
const at = (iso: string) => new Date(iso);
const report = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: 'iPhone', standalone: true, builtAt: BUILT, ...extra });

test('a device is recorded with only its report and when it was seen', () => {
  const r = parseReport({ ...report('phone-0001'), userAgent: 'Mozilla/5.0 (iPhone…)', ip: '192.168.1.20' });
  assert.ok(r);
  const list = recordDevice([], r, at('2026-11-25T09:00:00Z'));
  assert.deepEqual(list, [{ id: 'phone-0001', name: 'iPhone', standalone: true, builtAt: BUILT, seenAt: '2026-11-25T09:00:00.000Z' }]);
});

test('the same device is updated in place, and the newest comes first', () => {
  let list: Device[] = [];
  list = recordDevice(list, parseReport(report('phone-0001'))!, at('2026-11-25T09:00:00Z'));
  list = recordDevice(list, parseReport(report('ipad-00001', { name: 'iPad' }))!, at('2026-11-25T09:05:00Z'));
  list = recordDevice(list, parseReport(report('phone-0001', { standalone: false, builtAt: '2026-11-25T10:00:00.000Z' }))!, at('2026-11-25T10:01:00Z'));
  assert.deepEqual(list.map((d) => [d.id, d.standalone, d.builtAt, d.seenAt]), [
    ['phone-0001', false, '2026-11-25T10:00:00.000Z', '2026-11-25T10:01:00.000Z'],
    ['ipad-00001', true, BUILT, '2026-11-25T09:05:00.000Z'],
  ]);
});

test('at most twelve devices: the one seen longest ago goes', () => {
  let list: Device[] = [];
  for (let i = 0; i < MAX_DEVICES + 1; i++) {
    list = recordDevice(list, parseReport(report(`device-${String(i).padStart(4, '0')}`))!, at(`2026-11-25T09:${String(i).padStart(2, '0')}:00Z`));
  }
  assert.equal(list.length, 12);
  assert.equal(list[0].id, 'device-0012');
  assert.ok(!list.some((d) => d.id === 'device-0000'));
});

test('a device not seen for 90 days is dropped', () => {
  const old: Device = { ...report('old-device', { name: 'Android' }), seenAt: '2026-08-26T08:59:00.000Z' } as Device;
  const recent: Device = { ...report('recent-dev'), seenAt: '2026-08-27T09:01:00.000Z' } as Device;
  const list = recordDevice([old, recent], parseReport(report('phone-0001'))!, at('2026-11-25T09:00:00Z'));
  assert.deepEqual(list.map((d) => d.id), ['phone-0001', 'recent-dev']);
});

test('the Mac app’s own window is not a device', () => {
  assert.equal(isMacApp('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) colour-archive/0.2.1 Chrome/138.0 Electron/37.2.0 Safari/537.36 ColourArchiveMac/0.2.1'), true);
  assert.equal(isMacApp('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'), false);
  assert.equal(isMacApp(null), false);
});

test('a report that isn’t one is refused', () => {
  for (const bad of [
    null,
    'phone',
    [],
    report('short'),
    report('x'.repeat(65)),
    report('has space!'),
    report('phone-0001', { name: 'Toaster' }),
    report('phone-0001', { name: undefined }),
    report('phone-0001', { standalone: 'yes' }),
    report('phone-0001', { builtAt: 'yesterday' }),
    report('phone-0001', { builtAt: '2026-13-40T99:00:00Z' }),
    report('phone-0001', { builtAt: 1764057600000 }),
  ]) {
    assert.equal(parseReport(bad), null, JSON.stringify(bad));
  }
  assert.ok(parseReport(report('0123456789abcdef-ABCDEF', { builtAt: '2026-11-25T08:00:00Z' })));
});

test('the store keeps the list across reads, written whole', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-devices-'));
  const file = path.join(dir, '.archive', 'devices.json');
  try {
    assert.deepEqual(await readDevices(file), []);
    await Promise.all([
      rememberDevice(parseReport(report('phone-0001'))!, at('2026-11-25T09:00:00Z'), file),
      rememberDevice(parseReport(report('ipad-00001', { name: 'iPad' }))!, at('2026-11-25T09:01:00Z'), file),
    ]);
    assert.deepEqual((await readDevices(file)).map((d) => d.id), ['ipad-00001', 'phone-0001'], 'both writes kept');
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['devices.json'], 'no temp file left');
    fs.writeFileSync(file, '{ not json');
    assert.deepEqual(await readDevices(file), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
