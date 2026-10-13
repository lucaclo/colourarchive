import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lightWord, nextLight, phaseRows, readableTitle } from './glance';
import type { SunEventRow } from './daylight';

const at = (hhmm: string) => new Date(`2026-10-13T${hhmm}:00Z`);

const rows: SunEventRow[] = [
  { key: 'civilDawn', label: 'First light', icon: 'firstlight', start: at('05:56') },
  { key: 'blueMorning', label: 'Blue hour', icon: 'blue', start: at('05:56'), end: at('06:04') },
  { key: 'sunrise', label: 'Sunrise', icon: 'sunrise', start: at('06:18') },
  { key: 'goldenMorning', label: 'Golden hour', icon: 'golden', start: at('06:04'), end: at('06:48') },
  { key: 'solarNoon', label: 'Solar noon', icon: 'noon', start: at('12:09') },
  { key: 'goldenEvening', label: 'Golden hour', icon: 'golden', start: at('17:30'), end: at('18:14') },
  { key: 'sunset', label: 'Sunset', icon: 'sunset', start: at('18:00') },
  { key: 'blueEvening', label: 'Blue hour', icon: 'blue', start: at('18:14'), end: at('18:22') },
  { key: 'civilDusk', label: 'Last light', icon: 'lastlight', start: at('18:22') },
];

describe('lightWord', () => {
  it('says nothing about cloud once the sun is down, or with no forecast', () => {
    assert.equal(lightWord(10, -5), null);
    assert.equal(lightWord(null, 30), null);
    assert.equal(lightWord(Number.NaN, 30), null);
  });
  it('follows the same thresholds as the sentence behind it', () => {
    assert.equal(lightWord(5, 30), 'Hard light');
    assert.equal(lightWord(20, 30), 'Light comes and goes');
    assert.equal(lightWord(52, 30), 'Soft light');
    assert.equal(lightWord(80, 30), 'Weak shadows');
    assert.equal(lightWord(95, 30), 'Flat light');
  });
});

describe('nextLight', () => {
  it('names the window the minute sits in', () => {
    assert.deepEqual(nextLight(rows, at('17:45')), { kind: 'now', label: 'Golden hour', until: at('18:14') });
  });
  it('skips solar noon as a next event', () => {
    assert.deepEqual(nextLight(rows, at('11:49')), { kind: 'next', label: 'Golden hour', at: at('17:30') });
  });
  it('finds the next instant before dawn', () => {
    assert.deepEqual(nextLight(rows, at('04:00')), { kind: 'next', label: 'First light', at: at('05:56') });
  });
  it('says the day is over after last light', () => {
    assert.deepEqual(nextLight(rows, at('20:00')), { kind: 'over' });
  });
  it('ignores rows with no time, as on a polar day', () => {
    const polar = rows.map((row) => (row.key === 'sunset' ? { ...row, start: null } : row));
    assert.deepEqual(nextLight(polar, at('18:15')), { kind: 'now', label: 'Blue hour', until: at('18:22') });
  });
});

describe('phaseRows', () => {
  it('keeps the morning up to noon before noon', () => {
    assert.deepEqual(phaseRows(rows, at('09:00')).map((r) => r.key), ['civilDawn', 'blueMorning', 'sunrise', 'goldenMorning', 'solarNoon']);
  });
  it('keeps noon onwards after noon', () => {
    assert.deepEqual(phaseRows(rows, at('15:00')).map((r) => r.key), ['solarNoon', 'goldenEvening', 'sunset', 'blueEvening', 'civilDusk']);
  });
  it('returns everything when there is no noon to split on', () => {
    const none = rows.map((row) => (row.key === 'solarNoon' ? { ...row, start: null } : row));
    assert.equal(phaseRows(none, at('09:00')).length, rows.length);
  });
});

describe('readableTitle', () => {
  it('drops camera and upload file names', () => {
    assert.equal(readableTitle('IMG_4021.jpg'), null);
    assert.equal(readableTitle('DSC00012'), null);
    assert.equal(readableTitle('13-08-hongkong-Ralf-10'), null);
    assert.equal(readableTitle('13-08-08-hongkong-by-RalfR-127.JPG'), null);
    assert.equal(readableTitle('  '), null);
    assert.equal(readableTitle(undefined), null);
  });
  it('keeps real titles, numbers and all', () => {
    assert.equal(readableTitle('Central Pier 9'), 'Central Pier 9');
    assert.equal(readableTitle("Star Ferry's Harbour Tour 12.jpg"), "Star Ferry's Harbour Tour 12");
    assert.equal(readableTitle('Hkstarferry'), 'Hkstarferry');
    assert.equal(readableTitle('AoS McDull statue'), 'AoS McDull statue');
  });
});
