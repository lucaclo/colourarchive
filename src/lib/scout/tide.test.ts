import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_STATION_DISTANCE_KM,
  TIDE_WINDOW_HALF_WIDTH_MIN,
  extremesForDay,
  isCoastalDistance,
  nearestStation,
  parseExtremes,
  parseStations,
  tideEventRows,
  tideOverlayGradient,
  tideOverlayMinutes,
  tideWindows,
  type TideExtreme,
} from './tide.ts';

/* ── Fixture data ──────────────────────────────────────────────────────────
   Hand-built, not fetched — the whole point of keeping tide.ts pure is that
   these tests never touch the live WorldTides API. Times chosen so the day
   has a clean low/high/low/high pattern, roughly the real semidiurnal shape. */

const DAY_START = new Date('2026-08-23T00:00:00Z');

const RAW_RESPONSE = {
  status: 200,
  station: 'North Berwick',
  extremes: [
    { dt: Date.parse('2026-08-23T02:10:00Z') / 1000, date: '2026-08-23T02:10+0000', height: -0.3, type: 'Low' },
    { dt: Date.parse('2026-08-23T08:25:00Z') / 1000, date: '2026-08-23T08:25+0000', height: 3.1, type: 'High' },
    { dt: Date.parse('2026-08-23T14:35:00Z') / 1000, date: '2026-08-23T14:35+0000', height: -0.2, type: 'Low' },
    { dt: Date.parse('2026-08-23T20:50:00Z') / 1000, date: '2026-08-23T20:50+0000', height: 3.3, type: 'High' },
  ],
};

const EXTREMES: TideExtreme[] = parseExtremes(RAW_RESPONSE);

describe('parseExtremes', () => {
  it('parses a well-formed response, sorted by time', () => {
    // Deliberately fed out of order to check the sort, not just the parse.
    const shuffled = {
      extremes: [RAW_RESPONSE.extremes[2], RAW_RESPONSE.extremes[0], RAW_RESPONSE.extremes[3], RAW_RESPONSE.extremes[1]],
    };
    const parsed = parseExtremes(shuffled);
    assert.equal(parsed.length, 4);
    assert.deepEqual(
      parsed.map((e) => e.type),
      ['low', 'high', 'low', 'high'],
    );
    assert.ok(parsed.every((e, i) => i === 0 || parsed[i - 1].at.getTime() <= e.at.getTime()));
  });

  it('reads dt as Unix seconds and height in metres', () => {
    assert.equal(EXTREMES[0].at.toISOString(), '2026-08-23T02:10:00.000Z');
    assert.equal(EXTREMES[0].heightM, -0.3);
  });

  it('drops entries with an unrecognised type', () => {
    const parsed = parseExtremes({ extremes: [{ dt: 1000, height: 1, type: 'Slack' }] });
    assert.equal(parsed.length, 0);
  });

  it('drops entries missing dt', () => {
    const parsed = parseExtremes({ extremes: [{ height: 1, type: 'High' }] });
    assert.equal(parsed.length, 0);
  });

  it('keeps an entry with no height rather than dropping it', () => {
    const parsed = parseExtremes({ extremes: [{ dt: 1000, type: 'High' }] });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].heightM, null);
  });

  it('returns empty for a malformed or missing body', () => {
    assert.deepEqual(parseExtremes(null), []);
    assert.deepEqual(parseExtremes({}), []);
    assert.deepEqual(parseExtremes({ extremes: 'not an array' }), []);
  });
});

describe('parseStations', () => {
  const RAW_STATIONS = {
    stations: [
      { id: 1, name: 'North Berwick', lat: 56.0587, lon: -2.7175, timezone: 0 },
      { id: 2, name: '  Dunbar  ', lat: 56.0011, lon: -2.5165 },
      { id: 3, lat: 55.9, lon: -3.2 }, // no name
      { id: 4, name: 'Nowhere', lat: 'north', lon: -3.2 }, // bad coordinate
    ],
  };

  it('keeps only entries with a name and finite coordinates', () => {
    const parsed = parseStations(RAW_STATIONS);
    assert.deepEqual(
      parsed.map((s) => s.name),
      ['North Berwick', 'Dunbar'],
    );
  });

  it('trims whitespace from the name', () => {
    const parsed = parseStations(RAW_STATIONS);
    assert.equal(parsed[1].name, 'Dunbar');
  });

  it('returns empty for a malformed or missing body', () => {
    assert.deepEqual(parseStations(null), []);
    assert.deepEqual(parseStations({}), []);
  });
});

describe('nearestStation', () => {
  const PIN = { lat: 56.06, lon: -2.72 }; // near North Berwick

  it('picks the closest of several candidates', () => {
    const stations = [
      { name: 'North Berwick', lat: 56.0587, lon: -2.7175 },
      { name: 'Leith', lat: 55.98, lon: -3.18 },
    ];
    const best = nearestStation(PIN, stations);
    assert.equal(best?.name, 'North Berwick');
    assert.ok(best!.distanceKm < 5, `expected a close station, got ${best!.distanceKm} km`);
  });

  it('returns null for an empty list', () => {
    assert.equal(nearestStation(PIN, []), null);
  });

  it('skips a station with a non-finite coordinate', () => {
    const stations = [{ name: 'Bad', lat: NaN, lon: -2.7175 }, { name: 'Good', lat: 56.0587, lon: -2.7175 }];
    assert.equal(nearestStation(PIN, stations)?.name, 'Good');
  });
});

describe('isCoastalDistance', () => {
  it('is true at and inside the boundary', () => {
    assert.equal(isCoastalDistance(0), true);
    assert.equal(isCoastalDistance(MAX_STATION_DISTANCE_KM), true);
    assert.equal(isCoastalDistance(MAX_STATION_DISTANCE_KM - 0.01), true);
  });

  it('is false just past the boundary', () => {
    assert.equal(isCoastalDistance(MAX_STATION_DISTANCE_KM + 0.01), false);
  });

  it('is false for a negative or non-finite distance', () => {
    assert.equal(isCoastalDistance(-1), false);
    assert.equal(isCoastalDistance(NaN), false);
    assert.equal(isCoastalDistance(Infinity), false);
  });
});

describe('extremesForDay', () => {
  it('keeps only extremes inside [dayStart, dayStart+1440min)', () => {
    const spillover: TideExtreme[] = [
      { type: 'low', at: new Date('2026-08-22T23:50:00Z'), heightM: -0.1 }, // just before
      ...EXTREMES,
      { type: 'high', at: new Date('2026-08-24T00:05:00Z'), heightM: 3.0 }, // just after
    ];
    const scoped = extremesForDay(spillover, DAY_START);
    assert.equal(scoped.length, 4);
    assert.deepEqual(scoped, EXTREMES);
  });

  it('is exclusive of the end boundary', () => {
    const exact = { type: 'high' as const, at: new Date(DAY_START.getTime() + 1440 * 60_000), heightM: 1 };
    assert.equal(extremesForDay([exact], DAY_START).length, 0);
  });
});

describe('tideEventRows', () => {
  it('one row per extreme, labelled and keyed distinctly', () => {
    const rows = tideEventRows(EXTREMES);
    assert.equal(rows.length, 4);
    assert.deepEqual(
      rows.map((r) => r.label),
      ['Low tide', 'High tide', 'Low tide', 'High tide'],
    );
    assert.deepEqual(
      rows.map((r) => r.icon),
      ['tideLow', 'tideHigh', 'tideLow', 'tideHigh'],
    );
    const keys = new Set(rows.map((r) => r.key));
    assert.equal(keys.size, rows.length, 'keys must be unique even with repeated labels');
  });

  it('start is the extreme itself, not a window', () => {
    const rows = tideEventRows(EXTREMES);
    assert.equal(rows[0].start.getTime(), EXTREMES[0].at.getTime());
    assert.equal(rows[0].end, undefined);
  });

  it('returns empty for no extremes', () => {
    assert.deepEqual(tideEventRows([]), []);
  });
});

describe('tideWindows', () => {
  it('is symmetric around each extreme by the half-width', () => {
    const windows = tideWindows(EXTREMES, 90);
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      assert.equal(w.extremeAt.getTime(), EXTREMES[i].at.getTime());
      assert.equal(w.start.getTime(), w.extremeAt.getTime() - 90 * 60_000);
      assert.equal(w.end.getTime(), w.extremeAt.getTime() + 90 * 60_000);
      assert.equal(w.type, EXTREMES[i].type);
      assert.equal(w.heightM, EXTREMES[i].heightM);
    }
  });

  it('defaults to TIDE_WINDOW_HALF_WIDTH_MIN', () => {
    const windows = tideWindows(EXTREMES);
    const span = windows[0].end.getTime() - windows[0].start.getTime();
    assert.equal(span, TIDE_WINDOW_HALF_WIDTH_MIN * 2 * 60_000);
  });

  it('rejects a non-positive half-width', () => {
    assert.throws(() => tideWindows(EXTREMES, 0), RangeError);
    assert.throws(() => tideWindows(EXTREMES, -5), RangeError);
  });
});

describe('tideOverlayMinutes', () => {
  it('converts each window to a minute-of-day range', () => {
    const windows = tideWindows(EXTREMES, 90);
    const ranges = tideOverlayMinutes(windows, DAY_START);
    assert.equal(ranges.length, 4);
    // First low is 02:10 UTC == minute 130; window is 00:40..03:40.
    assert.equal(ranges[0].startMinute, 40);
    assert.equal(ranges[0].endMinute, 220);
    assert.equal(ranges[0].type, 'low');
  });

  it('clamps a window that starts before the day begins', () => {
    const windows = tideWindows([{ type: 'low', at: new Date(DAY_START.getTime() + 20 * 60_000), heightM: 0 }], 90);
    const ranges = tideOverlayMinutes(windows, DAY_START);
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].startMinute, 0);
    assert.equal(ranges[0].endMinute, 110);
  });

  it('clamps a window that ends after the day does', () => {
    const windows = tideWindows(
      [{ type: 'high', at: new Date(DAY_START.getTime() + 1430 * 60_000), heightM: 0 }],
      90,
    );
    const ranges = tideOverlayMinutes(windows, DAY_START);
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].startMinute, 1340);
    assert.equal(ranges[0].endMinute, 1440);
  });

  it('drops a window entirely outside the day', () => {
    const windows = tideWindows([{ type: 'low', at: new Date(DAY_START.getTime() - 3 * 60 * 60_000), heightM: 0 }], 90);
    assert.deepEqual(tideOverlayMinutes(windows, DAY_START), []);
  });
});

describe('tideOverlayGradient', () => {
  it('is fully transparent with no ranges', () => {
    assert.equal(tideOverlayGradient([]), 'linear-gradient(to right, transparent, transparent)');
  });

  it('paints a tinted band at the range and transparent elsewhere', () => {
    const css = tideOverlayGradient([{ type: 'low', startMinute: 100, endMinute: 300 }], 1440);
    assert.ok(css.startsWith('linear-gradient(to right, transparent 0.000%'), css);
    assert.ok(css.includes('rgba(196,151,92,0.55) 6.944%'), css); // 100/1440
    assert.ok(css.includes('rgba(196,151,92,0.55) 20.833%'), css); // 300/1440
    assert.ok(css.includes('transparent 100%)'), css);
  });

  it('uses a different tint for a high-tide range', () => {
    const css = tideOverlayGradient([{ type: 'high', startMinute: 0, endMinute: 1440 }], 1440);
    assert.match(css, /rgba\(45,92,138,0\.5\)/);
    assert.doesNotMatch(css, /rgba\(196,151,92/);
  });

  it('handles adjacent ranges without a spurious transparent gap', () => {
    const css = tideOverlayGradient(
      [
        { type: 'low', startMinute: 0, endMinute: 100 },
        { type: 'high', startMinute: 100, endMinute: 200 },
      ],
      1440,
    );
    // No "transparent" stop should appear between the two coloured bands.
    const betweenBands = css.slice(css.indexOf('6.944%'), css.indexOf('13.889%'));
    assert.doesNotMatch(betweenBands, /transparent/);
  });
});
