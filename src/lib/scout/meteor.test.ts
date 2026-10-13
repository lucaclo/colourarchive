import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateAtSolarLongitude, isActive, meteorNight, SHOWERS, siteLimitingMagnitude, solarLongitude, upcomingShowers, zhrAt } from './meteor';

const by = (code: string) => SHOWERS.find((s) => s.code === code)!;
const day = (d: Date) => d.toISOString().slice(0, 10);

test('peaks land on their usual dates', () => {
  // Published IMO peak dates for 2026, give or take the hours either side of UTC midnight.
  const near = (code: string, iso: string) => {
    const got = dateAtSolarLongitude(by(code).peak, 2026).getTime();
    assert.ok(Math.abs(got - Date.parse(iso)) < 1.5 * 864e5, `${code} ${day(new Date(got))} vs ${iso}`);
  };
  near('PER', '2026-08-12T20:00Z');
  near('GEM', '2026-12-14T07:00Z');
  near('QUA', '2026-01-03T17:00Z');
  near('LYR', '2026-04-22T12:00Z');
});

test('solar longitude round-trips', () => {
  for (const l of [0, 45.5, 140, 283.15, 359.9]) {
    const back = solarLongitude(dateAtSolarLongitude(l, 2026));
    assert.ok(Math.abs(((back - l + 540) % 360) - 180) < 0.01, `${l} -> ${back}`);
  }
});

test('activity falls away from the peak and stops outside the range', () => {
  const per = by('PER');
  const peak = dateAtSolarLongitude(per.peak, 2026);
  assert.ok(Math.abs(zhrAt(per, peak) - 100) < 0.5);
  const week = new Date(peak.getTime() - 7 * 864e5);
  assert.ok(zhrAt(per, week) < 10 && zhrAt(per, week) > 0);
  assert.equal(zhrAt(per, new Date(Date.UTC(2026, 9, 1))), 0);
});

test('the Quadrantid range crosses New Year', () => {
  assert.ok(isActive(by('QUA'), new Date(Date.UTC(2026, 0, 3))));
  assert.ok(isActive(by('QUA'), new Date(Date.UTC(2025, 11, 31))));
  assert.ok(!isActive(by('QUA'), new Date(Date.UTC(2026, 0, 20))));
});

test('Perseid peak night from a dark site in England: radiant up all night, rate is tens an hour', () => {
  const per = by('PER');
  const peak = dateAtSolarLongitude(per.peak, 2026);
  const n = meteorNight(per, 51.5, -1.0, new Date(Date.UTC(2026, 7, 12, 12)), 1);
  assert.ok(n.best && n.best.rate > 30 && n.best.rate <= 100, `best ${n.best?.rate}`);
  assert.ok(!n.neverUp);
  assert.ok(n.window && n.window.end > n.window.start);
  // The radiant climbs through the night, so the best hour is after midnight.
  const bestHourUTC = n.best!.at.getUTCHours();
  assert.ok(bestHourUTC >= 0 && bestHourUTC <= 4, `best at ${n.best!.at.toISOString()}`);
  assert.ok(peak);
});

test('a bright sky cuts the rate', () => {
  const per = by('PER');
  const dark = meteorNight(per, 51.5, -1.0, new Date(Date.UTC(2026, 7, 12, 12)), 1).best!.rate;
  const city = meteorNight(per, 51.5, -1.0, new Date(Date.UTC(2026, 7, 12, 12)), 11).best!.rate;
  assert.ok(city < dark / 3, `${city} vs ${dark}`);
  assert.equal(siteLimitingMagnitude(null), 6.5);
});

test('a far-northern radiant never rises from far south', () => {
  const n = meteorNight(by('URS'), -45, 170, new Date(Date.UTC(2026, 11, 22, 1)));
  assert.ok(n.neverUp);
  assert.equal(n.best, null);
});

test('upcoming lists active showers first, then the soonest', () => {
  const list = upcomingShowers(new Date(Date.UTC(2026, 7, 10)));
  assert.equal(list[0].shower.code, 'PER');
  assert.ok(list[0].active);
  const inactive = list.filter((u) => !u.active);
  for (let i = 1; i < inactive.length; i++) assert.ok(inactive[i].days >= inactive[i - 1].days);
  assert.ok(inactive.every((u) => u.days > 0));
});
