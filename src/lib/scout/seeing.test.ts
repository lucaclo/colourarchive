/**
 * Tests for the 7Timer ASTRO parser and the matching it does against it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeSeeing,
  describeSeeingPoint,
  describeTransparency,
  parseSeeingForecast,
  seeingAt,
  seeingForecastUrl,
  type SeeingForecast,
} from './seeing.ts';

// A trimmed but real shape, from an actual 7Timer ASTRO response.
const REAL_RESPONSE = {
  product: 'astro',
  init: '2026081618',
  dataseries: [
    { timepoint: 3, cloudcover: 9, seeing: 6, transparency: 3, lifted_index: 2 },
    { timepoint: 6, cloudcover: 9, seeing: 5, transparency: 3, lifted_index: 6 },
    { timepoint: 9, cloudcover: 9, seeing: 5, transparency: 2, lifted_index: 6 },
  ],
};

describe('seeingForecastUrl', () => {
  it('carries the coordinate and asks for the astro product as JSON', () => {
    const url = seeingForecastUrl(51.5074, -0.1278);
    assert.equal(url.searchParams.get('lat'), '51.507');
    assert.equal(url.searchParams.get('lon'), '-0.128');
    assert.equal(url.searchParams.get('product'), 'astro');
    assert.equal(url.searchParams.get('output'), 'json');
  });
});

describe('parseSeeingForecast', () => {
  it('turns init + timepoint into an absolute instant', () => {
    const forecast = parseSeeingForecast(REAL_RESPONSE, 0);
    assert.equal(forecast.points.length, 3);
    // init is 2026-08-16T18:00:00Z; timepoint 3 is three hours later.
    assert.equal(forecast.points[0].atMs, Date.UTC(2026, 7, 16, 21));
    assert.equal(forecast.points[1].atMs, Date.UTC(2026, 7, 17, 0));
  });

  it('keeps seeing and transparency as the classes 7Timer sent', () => {
    const forecast = parseSeeingForecast(REAL_RESPONSE, 0);
    assert.equal(forecast.points[0].seeing, 6);
    assert.equal(forecast.points[0].transparency, 3);
  });

  it('is empty rather than broken for a response with no usable init', () => {
    for (const bad of [null, {}, { init: 'not-a-date', dataseries: [] }, { init: '20260816', dataseries: [] }]) {
      assert.deepEqual(parseSeeingForecast(bad, 0).points, []);
    }
  });

  it('drops one bad entry without losing the well-formed ones beside it', () => {
    const forecast = parseSeeingForecast(
      {
        init: '2026081618',
        dataseries: [
          { timepoint: 3, seeing: 6, transparency: 3 },
          { timepoint: 6, seeing: 99, transparency: 3 }, // out of the 1-8 range
          { timepoint: 9, seeing: 4, transparency: 4 },
        ],
      },
      0,
    );
    assert.equal(forecast.points.length, 2);
  });

  it('refuses a class outside 1–8, and a non-integer one', () => {
    for (const bad of [0, 9, 3.5, Number.NaN]) {
      const forecast = parseSeeingForecast(
        { init: '2026081618', dataseries: [{ timepoint: 3, seeing: bad, transparency: 4 }] },
        0,
      );
      assert.equal(forecast.points.length, 0, `seeing=${bad}`);
    }
  });
});

describe('seeingAt', () => {
  const forecast: SeeingForecast = {
    fetchedAt: 0,
    points: [
      { atMs: Date.UTC(2026, 7, 16, 21), seeing: 6, transparency: 3 },
      { atMs: Date.UTC(2026, 7, 17, 0), seeing: 5, transparency: 3 },
      { atMs: Date.UTC(2026, 7, 17, 3), seeing: 5, transparency: 2 },
    ],
  };

  it('is null with no forecast', () => {
    assert.equal(seeingAt(null, Date.now()), null);
    assert.equal(seeingAt({ points: [], fetchedAt: 0 }, Date.now()), null);
  });

  it('picks the nearest point inside the forecast range', () => {
    const point = seeingAt(forecast, Date.UTC(2026, 7, 17, 1));
    assert.equal(point?.atMs, Date.UTC(2026, 7, 17, 0));
  });

  it('finds every point exactly at its own instant', () => {
    for (const point of forecast.points) {
      assert.equal(seeingAt(forecast, point.atMs), point);
    }
  });

  it('refuses a target more than half a step from anything logged', () => {
    // A week out: nowhere near any of the three points above.
    assert.equal(seeingAt(forecast, Date.UTC(2026, 7, 24)), null);
  });

  it('honours a wider tolerance when one is asked for', () => {
    const farPast = Date.UTC(2026, 7, 16, 17); // 4h before the first point
    assert.equal(seeingAt(forecast, farPast), null);
    assert.equal(seeingAt(forecast, farPast, 4)?.atMs, forecast.points[0].atMs);
  });
});

describe('describeSeeing and describeTransparency', () => {
  it('reads the published band for a valid class', () => {
    assert.equal(describeSeeing(1), '<0.5″ seeing');
    assert.equal(describeSeeing(8), '>2.5″ seeing');
    assert.equal(describeTransparency(1), '<0.3 mag/airmass transparency');
  });

  it('says nothing for a class 7Timer never sends', () => {
    assert.equal(describeSeeing(0), '');
    assert.equal(describeSeeing(9), '');
  });
});

describe('describeSeeingPoint', () => {
  it('states both bands and names the source and its resolution', () => {
    const note = describeSeeingPoint({ atMs: 0, seeing: 3, transparency: 5 });
    assert.match(note, /0\.75″–1″ seeing/);
    assert.match(note, /0\.6–0\.7 mag\/airmass transparency/);
    assert.match(note, /7Timer/);
    assert.match(note, /10 km/);
  });
});
