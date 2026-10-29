import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushMessage, pushPlans, skyWords, spotKey, type PushSpot } from './push-plan';
import { sunTimes } from './sun';
import { zonedNoon } from './daylight';

const london: PushSpot = { key: spotKey(51.5079, -0.0877), name: 'London Bridge', lat: 51.5079, lon: -0.0877, timeZone: 'Europe/London' };

test('sunset: only in the two hours before golden hour', () => {
  const t = sunTimes(london.lat, london.lon, zonedNoon('2026-10-29', 'Europe/London'));
  const golden = t.goldenHour.filter((w) => w.start > t.solarNoon)[0];
  const at = (msBefore: number) => pushPlans(london, new Date(+golden.start - msBefore)).filter((p) => p.event === 'sunset');
  assert.equal(at(3 * 3600_000).length, 0);
  assert.equal(at(90 * 60_000).length, 1);
  assert.equal(at(-60_000).length, 0, 'not once it has started');
  assert.equal(at(90 * 60_000)[0].iso, '2026-10-29');
});

test('sunrise: told the evening before', () => {
  const evening = pushPlans(london, new Date('2026-10-29T20:30:00Z')); // 20:30 GMT
  const sr = evening.find((p) => p.event === 'sunrise')!;
  assert.equal(sr.iso, '2026-10-30');
  assert.equal(pushPlans(london, new Date('2026-10-29T12:00:00Z')).filter((p) => p.event === 'sunrise').length, 0);
});

test('a muted spot says nothing', () => {
  assert.deepEqual(pushPlans({ ...london, muted: true }, new Date('2026-10-29T20:30:00Z')), []);
});

test('words, not a score', () => {
  assert.equal(skyWords(50, 250), 'High cloud, open to the west');
  assert.equal(skyWords(20, 92), 'Some high cloud, open to the east');
  const m = pushMessage(london, { event: 'sunset', iso: '2026-10-29', when: new Date('2026-10-29T16:38:00Z') }, { canvasCover: 50, bearing: 250 }, new Date('2026-10-29T14:00:00Z'));
  assert.deepEqual(m, { title: 'London Bridge', body: 'Sunset 16:38 · High cloud, open to the west' });
  const t = pushMessage(london, { event: 'sunrise', iso: '2026-10-30', when: new Date('2026-10-30T07:01:00Z') }, { canvasCover: 80, bearing: 110 }, new Date('2026-10-29T20:30:00Z'));
  assert.equal(t.body, 'Sunrise tomorrow 07:01 · A full sky of high cloud, open to the east');
  assert.doesNotMatch(m.body + t.body, /%/);
});
