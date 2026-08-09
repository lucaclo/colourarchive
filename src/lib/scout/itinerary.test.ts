/**
 * Tests for the day itinerary.
 *
 * The interesting properties are not "did it pick a good order" — that is a
 * matter of taste and the objective is stated in the module. They are:
 *
 * - the plan **is feasible**: every stop sits inside a lit window, every leg
 *   allows enough time, and no two stays overlap. This is checked as an
 *   invariant over whatever the solver returns rather than against a
 *   hand-written expected order, so it keeps holding when the objective is
 *   tuned;
 * - it **reports** rather than tidies: a spot that cannot be fitted is listed
 *   as dropped, and two spots peaking together are flagged even when the plan
 *   otherwise succeeds;
 * - the search really is exhaustive, checked with a case where the only
 *   feasible order is the reverse of the obvious one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_ITINERARY_SPOTS,
  bestLightMinute,
  planItinerary,
  type ItinerarySpot,
  type Itinerary,
  type LitWindow,
} from './itinerary.ts';
import type { LatLon } from './geo.ts';

/**
 * A day of sun altitudes: up from minute 360 to 1200, peaking at noon.
 *
 * A plain triangle, so "the lowest the sun gets while lit" is exact and can be
 * reasoned about by hand rather than looked up.
 */
const SAMPLES = Array.from({ length: 1441 }, (_, minute) => {
  if (minute < 360 || minute > 1200) return { altitude: -5 };
  const noon = 780;
  return { altitude: 60 - Math.abs(minute - noon) * (60 / 420) };
});

const lit = (startMinute: number, endMinute: number): LitWindow => ({
  lit: true,
  startMinute,
  endMinute,
});
const dark = (startMinute: number, endMinute: number): LitWindow => ({
  lit: false,
  startMinute,
  endMinute,
});

/** Edinburgh-ish, with an offset in metres turned into degrees. */
const EDINBURGH: LatLon = { lat: 55.9533, lon: -3.1883 };
const east = (metres: number): LatLon => ({
  lat: EDINBURGH.lat,
  lon: EDINBURGH.lon + metres / (111_320 * Math.cos(EDINBURGH.lat * (Math.PI / 180))),
});

const spot = (name: string, at: LatLon, windows: LitWindow[]): ItinerarySpot => ({
  name,
  at,
  windows,
});

const OPTIONS = { dwellMinutes: 30, speedKmh: 30 };

/** Every invariant a returned plan must satisfy, whatever the objective does. */
function assertFeasible(plan: Itinerary, options = OPTIONS) {
  let previousLeave = -Infinity;
  for (const [index, stop] of plan.stops.entries()) {
    const window = stop.spot.windows.find(
      (w) => w.lit && stop.arriveMinute >= w.startMinute && stop.leaveMinute <= w.endMinute,
    );
    assert.ok(window, `${stop.spot.name} is scheduled outside any lit window`);
    assert.equal(
      stop.leaveMinute - stop.arriveMinute,
      options.dwellMinutes,
      `${stop.spot.name} does not get its full stay`,
    );
    if (index > 0) {
      assert.ok(
        stop.arriveMinute >= previousLeave + stop.travelMinutes,
        `${stop.spot.name} is reached before there was time to travel there`,
      );
    }
    previousLeave = stop.leaveMinute;
  }
}

/* ── Best light ────────────────────────────────────────────────────────────── */

describe('the best light at a spot', () => {
  it('is the lowest the sun gets while the spot is lit', () => {
    // Lit 06:00–07:00 and 19:00–20:00. The sun is lower in the evening window.
    const best = bestLightMinute([lit(360, 420), dark(420, 1140), lit(1140, 1200)], SAMPLES);
    assert.ok(best);
    assert.ok(best.minute >= 1140, `expected the evening window, got ${best.minute}`);
    assert.ok(best.altitude < 5, `expected a low sun, got ${best.altitude}`);
  });

  it('ignores lit minutes with the sun below the horizon', () => {
    // A window entirely in the dark part of the day has no best light at all —
    // "lit" from the skyline's point of view still needs a sun to be lit by.
    assert.equal(bestLightMinute([lit(0, 300)], SAMPLES), null);
  });

  it('is null when the spot is never lit', () => {
    assert.equal(bestLightMinute([dark(0, 1440)], SAMPLES), null);
    assert.equal(bestLightMinute([], SAMPLES), null);
  });

  it('never returns a minute outside the windows it was given', () => {
    const windows = [lit(600, 660)];
    const best = bestLightMinute(windows, SAMPLES);
    assert.ok(best && best.minute >= 600 && best.minute < 660);
  });
});

/* ── A plan that works ─────────────────────────────────────────────────────── */

describe('ordering a day', () => {
  it('fits three nearby spots and returns them in time order', () => {
    const plan = planItinerary(
      [
        spot('Late', east(1000), [lit(1000, 1200)]),
        spot('Early', EDINBURGH, [lit(400, 600)]),
        spot('Middle', east(500), [lit(700, 900)]),
      ],
      SAMPLES,
      OPTIONS,
    );
    assert.equal(plan.stops.length, 3);
    assert.deepEqual(
      plan.stops.map((s) => s.spot.name),
      ['Early', 'Middle', 'Late'],
    );
    assert.deepEqual(plan.dropped, []);
    assertFeasible(plan);
  });

  it('produces a feasible plan, checked as an invariant', () => {
    const plan = planItinerary(
      [
        spot('A', EDINBURGH, [lit(400, 500), lit(900, 1100)]),
        spot('B', east(3000), [lit(430, 700)]),
        spot('C', east(6000), [lit(600, 1000)]),
        spot('D', east(9000), [lit(1000, 1200)]),
      ],
      SAMPLES,
      OPTIONS,
    );
    assert.ok(plan.stops.length >= 3);
    assertFeasible(plan);
  });

  it('allows real time for the move between two distant spots', () => {
    // 30 km apart at 30 km/h is an hour each way, and neither order fits:
    // leaving Here at 630 lands at Far at 690, too late for a 30-minute stay
    // inside a window that shuts at 700; going the other way, leaving Far at
    // 680 lands Here at 740, long after 660.
    const plan = planItinerary(
      [
        spot('Here', EDINBURGH, [lit(600, 660)]),
        spot('Far', east(30_000), [lit(650, 700)]),
      ],
      SAMPLES,
      OPTIONS,
    );
    assert.equal(plan.stops.length, 1, 'both were scheduled despite an impossible move');
    assert.equal(plan.dropped.length, 1);
    assert.equal(plan.dropped[0].reason, 'no-room');
    assert.ok(plan.conflicts.some((c) => c.kind === 'unreachable'));
  });

  it('counts travel time between the stops it did schedule', () => {
    const plan = planItinerary(
      [
        spot('One', EDINBURGH, [lit(400, 700)]),
        spot('Two', east(15_000), [lit(700, 1100)]),
      ],
      SAMPLES,
      OPTIONS,
    );
    assert.equal(plan.stops.length, 2);
    // 15 km at 30 km/h is half an hour.
    assert.equal(plan.stops[1].travelMinutes, 30);
    assert.equal(plan.totalTravelMinutes, 30);
    assert.ok(plan.totalTravelM >= 14_900 && plan.totalTravelM <= 15_100);
    assertFeasible(plan);
  });
});

/* ── The search really is exhaustive ───────────────────────────────────────── */

describe('searching every order', () => {
  it('finds the only feasible order even when it is the reverse of the obvious one', () => {
    // Far opens first and closes early; Near is open all day. A greedy walk
    // that took the nearest spot first would miss Far entirely.
    const plan = planItinerary(
      [
        spot('Near', EDINBURGH, [lit(400, 1200)]),
        spot('Far', east(20_000), [lit(420, 480)]),
      ],
      SAMPLES,
      OPTIONS,
    );
    assert.equal(plan.stops.length, 2);
    assert.equal(plan.stops[0].spot.name, 'Far');
    assertFeasible(plan);
  });

  it('drops the fewest spots it can when the whole set will not fit', () => {
    const plan = planItinerary(
      [
        spot('A', EDINBURGH, [lit(600, 660)]),
        spot('B', east(40_000), [lit(600, 660)]),
        spot('C', east(80_000), [lit(600, 660)]),
      ],
      SAMPLES,
      OPTIONS,
    );
    // All three peak in the same hour and are 40 km apart: only one is possible.
    assert.equal(plan.stops.length, 1);
    assert.equal(plan.dropped.filter((d) => d.reason === 'no-room').length, 2);
    assertFeasible(plan);
  });
});

/* ── What it refuses to tidy away ──────────────────────────────────────────── */

describe('reporting rather than reordering', () => {
  it('flags two spots peaking together even when both are scheduled', () => {
    const plan = planItinerary(
      [
        spot('Hill', EDINBURGH, [lit(400, 1200)]),
        spot('Shore', east(600), [lit(400, 1200)]),
      ],
      SAMPLES,
      OPTIONS,
    );
    // Both are lit all day, so both peak at the same low evening sun and both
    // fit comfortably — the clash is still true and still worth saying.
    assert.equal(plan.stops.length, 2);
    assert.ok(
      plan.conflicts.some((c) => c.kind === 'peaks-together'),
      'a clash that the route happened to absorb was not reported',
    );
    assertFeasible(plan);
  });

  it('drops a spot that never sees the sun, and says that is why', () => {
    const plan = planItinerary(
      [
        spot('Courtyard', EDINBURGH, [dark(0, 1440)]),
        spot('Open', east(500), [lit(600, 900)]),
      ],
      SAMPLES,
      OPTIONS,
    );
    assert.equal(plan.stops.length, 1);
    assert.equal(plan.dropped.length, 1);
    assert.equal(plan.dropped[0].reason, 'never-lit');
    assert.match(plan.dropped[0].note, /no direct sun/);
  });

  it('drops a spot whose light is shorter than the stay, with a different reason', () => {
    const plan = planItinerary(
      [
        spot('Glimpse', EDINBURGH, [lit(600, 610)]),
        spot('Open', east(500), [lit(600, 900)]),
      ],
      SAMPLES,
      OPTIONS,
    );
    const glimpse = plan.dropped.find((d) => d.spot.name === 'Glimpse');
    assert.ok(glimpse);
    assert.equal(glimpse.reason, 'never-lit');
    assert.match(glimpse.note, /long enough for 30 minutes/);
  });

  it('never silently truncates past the spot limit', () => {
    const many = Array.from({ length: MAX_ITINERARY_SPOTS + 2 }, (_, i) =>
      spot(`S${i}`, east(i * 300), [lit(400, 1200)]),
    );
    const plan = planItinerary(many, SAMPLES, OPTIONS);
    const over = plan.dropped.filter((d) => d.reason === 'over-the-limit');
    assert.equal(over.length, 2);
    assert.match(over[0].note, new RegExp(`${MAX_ITINERARY_SPOTS}-spot limit`));
  });

  it('states the travel assumption, every time', () => {
    const plan = planItinerary(
      [spot('A', EDINBURGH, [lit(600, 900)]), spot('B', east(500), [lit(600, 900)])],
      SAMPLES,
      OPTIONS,
    );
    assert.match(plan.travelAssumption, /straight-line/);
    assert.match(plan.travelAssumption, /30 km\/h/);
    assert.match(plan.travelAssumption, /lower bound/);
  });

  it('returns an empty plan rather than throwing when nothing can be planned', () => {
    const plan = planItinerary(
      [spot('A', EDINBURGH, [dark(0, 1440)]), spot('B', east(500), [dark(0, 1440)])],
      SAMPLES,
      OPTIONS,
    );
    assert.deepEqual(plan.stops, []);
    assert.equal(plan.dropped.length, 2);
    assert.equal(plan.totalTravelM, 0);
  });
});

/* ── The numbers on each stop ──────────────────────────────────────────────── */

describe('what each stop reports', () => {
  it('says how far the visit landed from that spot’s best light', () => {
    const plan = planItinerary(
      [
        spot('Only', EDINBURGH, [lit(400, 1200)]),
        spot('Other', east(300), [lit(400, 1200)]),
      ],
      SAMPLES,
      OPTIONS,
    );
    for (const stop of plan.stops) {
      assert.equal(stop.offBestMinutes, Math.abs(stop.arriveMinute - stop.bestMinute));
      assert.ok(stop.offBestMinutes >= 0);
    }
  });

  it('reports the sun’s altitude on arrival, matching the samples', () => {
    const plan = planItinerary(
      [spot('A', EDINBURGH, [lit(600, 900)]), spot('B', east(500), [lit(600, 900)])],
      SAMPLES,
      OPTIONS,
    );
    for (const stop of plan.stops) {
      assert.equal(stop.sunAltitude, SAMPLES[stop.arriveMinute].altitude);
    }
  });

  it('gives the first stop no travel', () => {
    const plan = planItinerary(
      [spot('A', EDINBURGH, [lit(600, 900)]), spot('B', east(5000), [lit(600, 900)])],
      SAMPLES,
      OPTIONS,
    );
    assert.equal(plan.stops[0].travelMinutes, 0);
    assert.equal(plan.stops[0].travelM, 0);
  });
});
