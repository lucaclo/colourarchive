import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HIGH_CLOUD_BASE_M,
  blockingCover,
  cloudStructure,
  compassEighth,
  directLightFraction,
  directLightFractionFor,
  horizonReading,
  horizonSampleDistanceM,
  hourAt,
  lightQuality,
  parseForecast,
  stalenessNote,
  summariseHour,
  weatherCondition,
  type WeatherHour,
  type WeatherReport,
} from './weather.ts';

const FETCHED = Date.parse('2026-07-31T12:00:00Z');

const RESPONSE = {
  latitude: 51.5,
  longitude: -0.12,
  current: {
    time: '2026-07-31T12:00',
    temperature_2m: 21.4,
    cloud_cover: 40,
    weather_code: 2,
  },
  hourly: {
    time: ['2026-07-31T12:00', '2026-07-31T13:00', '2026-07-31T14:00'],
    temperature_2m: [21.4, 22.1, 22.8],
    cloud_cover: [40, 55, 90],
    precipitation_probability: [5, 10, 40],
    weather_code: [2, 3, 61],
    visibility: [24_000, 20_000, 8000],
  },
};

describe('weatherCondition', () => {
  it('names the codes that carry the cloud story', () => {
    assert.equal(weatherCondition(0).label, 'Clear');
    assert.equal(weatherCondition(2).icon, 'partly');
    assert.equal(weatherCondition(3).label, 'Overcast');
    assert.equal(weatherCondition(95).icon, 'thunder');
  });

  it('admits an unknown code rather than rounding it to a neighbour', () => {
    assert.equal(weatherCondition(4).label, 'Code 4');
    assert.equal(weatherCondition(null).label, 'Not known');
    assert.equal(weatherCondition(undefined).label, 'Not known');
    assert.equal(weatherCondition(NaN).label, 'Not known');
  });
});

describe('parseForecast', () => {
  it('reads the hours and the current conditions', () => {
    const report = parseForecast(RESPONSE, FETCHED);
    assert.equal(report.hours.length, 3);
    assert.equal(report.hours[0].time, Date.parse('2026-07-31T12:00:00Z'));
    assert.equal(report.hours[2].cloudCover, 90);
    assert.equal(report.current?.temperatureC, 21.4);
    assert.equal(report.fetchedAt, FETCHED);
  });

  it('treats a bare timestamp as UTC, because that is what was asked for', () => {
    const report = parseForecast(RESPONSE, FETCHED);
    assert.equal(new Date(report.hours[1].time).toISOString(), '2026-07-31T13:00:00.000Z');
  });

  it('survives a response that arrives half-shaped', () => {
    for (const body of [null, undefined, {}, { hourly: {} }, { hourly: { time: 'nonsense' } }]) {
      const report = parseForecast(body, FETCHED);
      assert.equal(report.hours.length, 0);
      assert.equal(report.current, null);
    }
  });

  it('drops a row with an unreadable time rather than shifting the rest', () => {
    const report = parseForecast(
      {
        hourly: {
          time: ['2026-07-31T12:00', 'not a time', '2026-07-31T14:00'],
          cloud_cover: [10, 20, 30],
        },
      },
      FETCHED,
    );
    assert.equal(report.hours.length, 2);
    assert.equal(report.hours[1].cloudCover, 30, 'the third row keeps its own cloud figure');
  });

  it('leaves a missing column null rather than zero', () => {
    const report = parseForecast(
      { hourly: { time: ['2026-07-31T12:00'], cloud_cover: [50] } },
      FETCHED,
    );
    assert.equal(report.hours[0].temperatureC, null);
    assert.equal(report.hours[0].cloudCover, 50);
  });
});

describe('hourAt', () => {
  const report = parseForecast(RESPONSE, FETCHED);

  it('takes the nearest hour, not the one before', () => {
    assert.equal(hourAt(report, Date.parse('2026-07-31T13:58:00Z'))?.cloudCover, 90);
    assert.equal(hourAt(report, Date.parse('2026-07-31T13:10:00Z'))?.cloudCover, 55);
  });

  it('refuses to answer beyond the end of the forecast', () => {
    assert.equal(hourAt(report, Date.parse('2026-08-04T12:00:00Z')), null);
    assert.equal(hourAt(report, Date.parse('2026-07-30T12:00:00Z')), null);
  });

  it('has nothing to say with no hours', () => {
    const empty: WeatherReport = { latitude: 0, longitude: 0, fetchedAt: FETCHED, current: null, hours: [] };
    assert.equal(hourAt(empty, FETCHED), null);
  });
});

describe('directLightFraction', () => {
  it('gives full sun a clear sky and nothing to a solid one', () => {
    assert.equal(directLightFraction(0), 1);
    assert.equal(directLightFraction(100), 0);
  });

  it('holds up under scattered cloud and falls away at the end', () => {
    assert.ok(directLightFraction(25) > 0.9, `${directLightFraction(25)}`);
    assert.ok(directLightFraction(90) < 0.25, `${directLightFraction(90)}`);
  });

  it('never rises with more cloud', () => {
    let previous = 1.01;
    for (let cover = 0; cover <= 100; cover += 5) {
      const value = directLightFraction(cover);
      assert.ok(value <= previous, `${cover}%: ${value} > ${previous}`);
      previous = value;
    }
  });

  it('assumes full sun when there is no forecast, rather than none', () => {
    // The geometry is what Scout is for; an absent forecast must not quietly
    // dim every shadow on the map.
    assert.equal(directLightFraction(null), 1);
    assert.equal(directLightFraction(undefined), 1);
  });

  it('clamps nonsense into range', () => {
    assert.equal(directLightFraction(-20), 1);
    assert.equal(directLightFraction(400), 0);
  });
});

describe('lightQuality', () => {
  it('says there is no light at all when the sun is down', () => {
    assert.match(lightQuality(0, -6), /sun is down/);
  });

  it('distinguishes a hard edge from a flat grey', () => {
    assert.match(lightQuality(3, 30), /Hard light/);
    assert.match(lightQuality(95, 30), /geometry, not what you will see/);
  });

  it('admits when it does not know', () => {
    assert.match(lightQuality(null, 30), /unknown/);
  });
});

describe('summariseHour', () => {
  it('reads as one line', () => {
    const report = parseForecast(RESPONSE, FETCHED);
    assert.equal(summariseHour(report.hours[0]), '21°C · 40% cloud');
    assert.equal(summariseHour(report.hours[2]), '23°C · 90% cloud · 40% rain');
  });

  it('leaves out a rain chance not worth carrying an umbrella for', () => {
    const report = parseForecast(RESPONSE, FETCHED);
    assert.ok(!summariseHour(report.hours[0]).includes('rain'));
  });

  it('says nothing when there is nothing', () => {
    assert.equal(summariseHour(null), '');
  });
});

describe('stalenessNote', () => {
  it('stays quiet while the forecast is fresh', () => {
    assert.equal(stalenessNote(FETCHED, FETCHED + 30 * 60_000), '');
  });

  it('speaks up once it is old enough to mislead', () => {
    assert.equal(stalenessNote(FETCHED, FETCHED + 5 * 3_600_000), 'forecast 5 h old');
    assert.equal(stalenessNote(FETCHED, FETCHED + 50 * 3_600_000), 'forecast 2 d old');
  });
});

/* ── The three decks ───────────────────────────────────────────────────────── */

const LAYERED = {
  hourly: {
    time: ['2026-07-31T18:00', '2026-07-31T19:00'],
    cloud_cover: [85, 90],
    cloud_cover_low: [5, 80],
    cloud_cover_mid: [10, 40],
    cloud_cover_high: [80, 20],
  },
  current: {
    time: '2026-07-31T18:00',
    cloud_cover: 85,
    cloud_cover_low: 5,
    cloud_cover_mid: 10,
    cloud_cover_high: 80,
  },
};

/** A bare hour with only the fields a test cares about. */
const hour = (over: Partial<WeatherHour> = {}): WeatherHour => ({
  time: 0,
  temperatureC: null,
  cloudCover: null,
  cloudLow: null,
  cloudMid: null,
  cloudHigh: null,
  precipitationChance: null,
  weatherCode: null,
  visibilityM: null,
  ...over,
});

describe('parseForecast — cloud decks', () => {
  it('reads the three decks alongside the total', () => {
    const report = parseForecast(LAYERED, FETCHED);
    assert.equal(report.hours[0].cloudLow, 5);
    assert.equal(report.hours[0].cloudMid, 10);
    assert.equal(report.hours[0].cloudHigh, 80);
    assert.equal(report.current?.cloudHigh, 80);
  });

  it('leaves the decks null when the response has none, rather than clear', () => {
    // A cached report written before the split existed must not read as a
    // cloudless sky — that would turn a missing measurement into a claim.
    const report = parseForecast(RESPONSE, FETCHED);
    for (const h of report.hours) {
      assert.equal(h.cloudLow, null);
      assert.equal(h.cloudMid, null);
      assert.equal(h.cloudHigh, null);
    }
    assert.equal(report.current?.cloudLow, null);
  });
});

describe('blockingCover', () => {
  it('ignores the high deck entirely', () => {
    assert.equal(blockingCover(hour({ cloudLow: 0, cloudMid: 0, cloudHigh: 100 })), 0);
  });

  it('overlaps the two lower decks instead of adding them', () => {
    // 60% and 60% is 84% of one sky, never 120%.
    const cover = blockingCover(hour({ cloudLow: 60, cloudMid: 60 }))!;
    assert.ok(Math.abs(cover - 84) < 1e-9, `got ${cover}`);
    assert.ok(cover <= 100);
  });

  it('is monotonic in each deck and never leaves 0..100', () => {
    for (let low = 0; low <= 100; low += 10) {
      let previous = -1;
      for (let mid = 0; mid <= 100; mid += 10) {
        const cover = blockingCover(hour({ cloudLow: low, cloudMid: mid }))!;
        assert.ok(cover >= previous, 'more mid cloud gave less cover');
        assert.ok(cover >= 0 && cover <= 100);
        previous = cover;
      }
    }
  });

  it('treats one missing deck as absent but two as unknown', () => {
    assert.equal(blockingCover(hour({ cloudLow: 40 })), 40);
    assert.equal(blockingCover(hour({ cloudHigh: 90 })), null);
    assert.equal(blockingCover(null), null);
  });
});

describe('directLightFractionFor', () => {
  it('keeps the shadow hard under cirrus that a total would have softened', () => {
    const cirrus = hour({ cloudCover: 85, cloudLow: 0, cloudMid: 0, cloudHigh: 85 });
    assert.equal(directLightFractionFor(cirrus), 1);
    // The old reading of the same sky.
    assert.ok(directLightFraction(85) < 0.35);
  });

  it('still takes the light out under a low deck of the same total', () => {
    // Same 85% sky as the cirrus above, and the opposite photograph.
    const stratus = hour({ cloudCover: 85, cloudLow: 85, cloudMid: 10, cloudHigh: 0 });
    const fraction = directLightFractionFor(stratus);
    assert.ok(fraction < 0.3, `got ${fraction}`);
    assert.equal(fraction, directLightFraction(blockingCover(stratus)!));
  });

  it('falls back to the total when there is no split', () => {
    const plain = hour({ cloudCover: 50 });
    assert.equal(directLightFractionFor(plain), directLightFraction(50));
  });

  it('assumes nothing when there is no forecast at all', () => {
    assert.equal(directLightFractionFor(null), 1);
    assert.equal(directLightFractionFor(hour()), 1);
  });
});

describe('cloudStructure', () => {
  it('names the dominant deck and what it does', () => {
    const cirrus = cloudStructure(hour({ cloudLow: 5, cloudMid: 10, cloudHigh: 80 }));
    assert.equal(cirrus.dominant, 'high');
    assert.match(cirrus.note, /shadows keep their edge/);

    const stratus = cloudStructure(hour({ cloudLow: 90, cloudMid: 20, cloudHigh: 0 }));
    assert.equal(stratus.dominant, 'low');
    assert.match(stratus.note, /Flat light/);
  });

  it('refuses to name one when two decks are level', () => {
    const layered = cloudStructure(hour({ cloudLow: 50, cloudMid: 46, cloudHigh: 10 }));
    assert.equal(layered.dominant, null);
  });

  it('says nothing at all when nothing was measured', () => {
    const empty = cloudStructure(hour());
    assert.equal(empty.note, '');
    assert.equal(empty.dominant, null);
    assert.equal(empty.blocking, null);
  });

  it('quotes every deck it has', () => {
    const note = cloudStructure(hour({ cloudLow: 5, cloudMid: 10, cloudHigh: 80 })).note;
    for (const n of ['5%', '10%', '80%']) assert.ok(note.includes(n), `missing ${n} in "${note}"`);
  });
});

/* ── The horizon reading ───────────────────────────────────────────────────── */

describe('horizonSampleDistanceM', () => {
  it('puts cirrus at very nearly three hundred kilometres', () => {
    const d = horizonSampleDistanceM(HIGH_CLOUD_BASE_M);
    assert.ok(d > 290_000 && d < 310_000, `got ${Math.round(d)} m`);
  });

  it('grows as the square root of the deck height', () => {
    const a = horizonSampleDistanceM(2000);
    const b = horizonSampleDistanceM(8000);
    assert.ok(Math.abs(b / a - 2) < 1e-9, 'four times the height is twice the distance');
  });

  it('refuses a deck that is not above the ground', () => {
    for (const bad of [0, -100, NaN]) assert.throws(() => horizonSampleDistanceM(bad), RangeError);
  });
});

describe('horizonReading', () => {
  const D = horizonSampleDistanceM();
  const clearGate = hour({ cloudLow: 5, cloudMid: 5 });
  const shutGate = hour({ cloudLow: 80, cloudMid: 30 });
  const canvas = hour({ cloudMid: 20, cloudHigh: 55 });
  const bareCanvas = hour({ cloudMid: 0, cloudHigh: 3 });

  it('calls a shut horizon blocked however clear it is overhead', () => {
    const reading = horizonReading(shutGate, canvas, 295, D);
    assert.equal(reading.verdict, 'blocked');
    assert.match(reading.note, /sun's own horizon/);
  });

  it('calls an open horizon with nothing overhead bare, not bad', () => {
    const reading = horizonReading(clearGate, bareCanvas, 295, D);
    assert.equal(reading.verdict, 'bare');
    assert.match(reading.note, /nothing for it to land on/);
  });

  it('calls the arrangement colour needs lit, and still refuses to promise it', () => {
    const reading = horizonReading(clearGate, canvas, 295, D);
    assert.equal(reading.verdict, 'lit');
    assert.match(reading.note, /not a promise/);
  });

  it('never emits a score', () => {
    for (const [g, c] of [[shutGate, canvas], [clearGate, bareCanvas], [clearGate, canvas]] as const) {
      const reading = horizonReading(g, c, 295, D);
      assert.ok(!/\b(?:score|out of 100|\/100|rating)\b/i.test(reading.note), reading.note);
    }
  });

  it('quotes both measurements and where the far one came from', () => {
    const reading = horizonReading(clearGate, canvas, 295, D);
    assert.match(reading.note, /WNW|W\b/); // 295° is west-north-west; eighths call it W
    assert.match(reading.note, /\d+ km out/);
    assert.ok(reading.gateCover != null && reading.canvasCover != null);
  });

  it('says unknown rather than guessing when a sample is missing', () => {
    assert.equal(horizonReading(null, canvas, 295, D).verdict, 'unknown');
    assert.equal(horizonReading(clearGate, null, 295, D).verdict, 'unknown');
    assert.equal(horizonReading(hour(), canvas, 295, D).verdict, 'unknown');
    assert.match(horizonReading(null, null, 295, D).note, /unanswered/);
  });

  it('moves from lit to blocked as the horizon fills in, and only once', () => {
    let flips = 0;
    let previous = horizonReading(hour({ cloudLow: 0, cloudMid: 0 }), canvas, 270, D).verdict;
    for (let low = 5; low <= 100; low += 5) {
      const verdict = horizonReading(hour({ cloudLow: low, cloudMid: 0 }), canvas, 270, D).verdict;
      if (verdict !== previous) flips++;
      previous = verdict;
    }
    assert.equal(flips, 1);
    assert.equal(previous, 'blocked');
  });
});

describe('compassEighth', () => {
  it('rounds to eight points and wraps', () => {
    assert.equal(compassEighth(0), 'N');
    assert.equal(compassEighth(359), 'N');
    assert.equal(compassEighth(-90), 'W');
    assert.equal(compassEighth(225), 'SW');
    assert.equal(compassEighth(720 + 90), 'E');
  });
});
