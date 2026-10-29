import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describeGap, parseOffset, readPhoneShots, suggestPlaces, LibraryProblem } from './phone-places';

const KYOTO = { lat: 35.0116, lon: 135.7681 };
const utc = (s: string) => Date.parse(s);

test('parseOffset', () => {
  assert.equal(parseOffset('+09:00'), 540);
  assert.equal(parseOffset('-05:30'), -330);
  assert.equal(parseOffset('+0100'), 60);
  assert.equal(parseOffset('nonsense'), undefined);
  assert.equal(parseOffset(undefined), undefined);
});

test('suggestPlaces compares in UTC when the camera wrote its offset — even left on home time abroad', () => {
  // Camera on UK summer time (+01:00) in Kyoto: wall clock 03:00 = 02:00 UTC.
  const shots = [{ id: 'a', capturedAt: '2025-03-14T03:00:00.000Z', offsetMin: 60 }];
  const phone = [
    { utcMs: utc('2025-03-14T02:06:00Z'), ...KYOTO, tzOffsetSec: 9 * 3600 },
    { utcMs: utc('2025-03-14T03:00:00Z'), lat: 51.5, lon: -0.1, tzOffsetSec: 0 }, // same wall clock, wrong instant
  ];
  const [s] = suggestPlaces(shots, phone);
  assert.equal(s.basis, 'utc');
  assert.equal(s.gapMin, 6);
  assert.deepEqual([s.lat, s.lon], [KYOTO.lat, KYOTO.lon]);
});

test('suggestPlaces falls back to wall clocks without a camera offset', () => {
  const shots = [{ id: 'a', capturedAt: '2025-03-14T11:00:00.000Z' }];
  const phone = [{ utcMs: utc('2025-03-14T01:55:00Z'), ...KYOTO, tzOffsetSec: 9 * 3600 }]; // 10:55 in Kyoto
  const [s] = suggestPlaces(shots, phone);
  assert.equal(s.basis, 'local');
  assert.equal(s.gapMin, -5);
});

test('suggestPlaces: nothing outside the window, and null island is no place', () => {
  const shots = [{ id: 'a', capturedAt: '2025-03-14T03:00:00.000Z', offsetMin: 0 }];
  assert.deepEqual(suggestPlaces(shots, [{ utcMs: utc('2025-03-14T03:25:00Z'), ...KYOTO }]), []);
  assert.deepEqual(suggestPlaces(shots, [{ utcMs: utc('2025-03-14T03:01:00Z'), lat: 0, lon: 0 }]), []);
  assert.equal(suggestPlaces(shots, [{ utcMs: utc('2025-03-14T03:19:00Z'), ...KYOTO }]).length, 1);
});

test('suggestPlaces picks the nearest in time', () => {
  const shots = [{ id: 'a', capturedAt: '2025-03-14T03:00:00.000Z', offsetMin: 0 }];
  const phone = [
    { utcMs: utc('2025-03-14T02:50:00Z'), lat: 1, lon: 1 },
    { utcMs: utc('2025-03-14T03:02:00Z'), lat: 2, lon: 2 },
    { utcMs: utc('2025-03-14T03:15:00Z'), lat: 3, lon: 3 },
  ];
  assert.equal(suggestPlaces(shots, phone)[0].lat, 2);
});

test('describeGap', () => {
  assert.equal(describeGap(6), 'iPhone photo 6 min later');
  assert.equal(describeGap(-3), 'iPhone photo 3 min earlier');
  assert.equal(describeGap(0), 'iPhone photo the same minute');
});

test('readPhoneShots reads a Photos-shaped library, skipping the trashed and unlocated', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photos-lib-'));
  const file = path.join(dir, 'Photos.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE ZASSET (Z_PK INTEGER PRIMARY KEY, ZDATECREATED REAL, ZLATITUDE REAL, ZLONGITUDE REAL, ZTRASHEDSTATE INTEGER);
           CREATE TABLE ZADDITIONALASSETATTRIBUTES (Z_PK INTEGER PRIMARY KEY, ZASSET INTEGER, ZTIMEZONEOFFSET INTEGER);`);
  const cd = (s: string) => Date.parse(s) / 1000 - 978_307_200;
  const ins = db.prepare('INSERT INTO ZASSET VALUES (?, ?, ?, ?, ?)');
  ins.run(1, cd('2025-03-14T02:06:00Z'), KYOTO.lat, KYOTO.lon, 0);
  ins.run(2, cd('2025-03-14T02:07:00Z'), -180, -180, 0); // no location
  ins.run(3, cd('2025-03-14T02:08:00Z'), 10, 10, 1); // trashed
  ins.run(4, cd('2026-01-01T00:00:00Z'), 10, 10, 0); // out of range
  db.prepare('INSERT INTO ZADDITIONALASSETATTRIBUTES VALUES (1, 1, 32400)').run();
  db.close();
  const shots = await readPhoneShots(Date.parse('2025-03-13T00:00:00Z'), Date.parse('2025-03-15T00:00:00Z'), file);
  assert.equal(shots.length, 1);
  assert.equal(shots[0].utcMs, Date.parse('2025-03-14T02:06:00Z'));
  assert.equal(shots[0].tzOffsetSec, 32400);
  await assert.rejects(readPhoneShots(0, 1, path.join(dir, 'missing.sqlite')), LibraryProblem);
  fs.rmSync(dir, { recursive: true, force: true });
});
