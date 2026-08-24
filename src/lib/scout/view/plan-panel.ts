/**
 * The day plan, in the panel — issue #21.
 *
 * Every other answer on this page is about one coordinate; a day of shooting
 * is several, and the two constraints come from different places and do not
 * negotiate — the light is fixed by the sun, the travel by geography.
 * `itinerary.ts` holds the solver and is pure; everything here is choosing
 * the spots, feeding it the same windows the panel already draws, and
 * putting the route on the map.
 *
 * Self-contained: it owns the `#fold-plan` block and every `plan-*` id, the
 * same contract `alignment-panel.ts`/`month-grid.ts` already keep. Its one
 * touch outside that is `PLAN_SOURCE` on the map — a GeoJSON source created
 * once, in page.ts's own init block alongside every other overlay layer;
 * this only ever calls `setData` on it, never creates or restyles it.
 */

import type maplibregl from 'maplibre-gl';
import { formatDayLabel, formatDuration, formatMinute, type ScoutDay } from '../daylight';
import { formatDistance, type LatLon } from '../geo';
import { MAX_ITINERARY_SPOTS, MIN_ITINERARY_SPOTS, planItinerary, type Itinerary } from '../itinerary';
import { itineraryReport } from '../report';
import type { LightWindow } from '../skyline';
import type { SavedSpot } from '../spots';
import { formatCoords, shadowCaveat } from './format';
import { $, on } from './dom';

/** A GeoJSON source created once, in page.ts's own map-init block, alongside
 *  every other overlay layer — exported so that one `addSource` call and
 *  this panel's own `setData` calls stay in agreement about the id. */
export const PLAN_SOURCE = 'scout-plan-src';

/**
 * The day plan's two assumptions, named here so they are one edit apart from
 * the sentence that states them to the reader.
 *
 * Half an hour at a spot is a working figure — long enough to set up, wait
 * out a cloud and shoot; short enough that a plan built on it is not absurd.
 * 30 km/h over straight-line distance is deliberately pessimistic for a car
 * and optimistic for a bus, which is the honest middle for "can I get there".
 * Both are printed with every plan; neither is a measurement.
 */
const PLAN_DWELL_MINUTES = 30;
const PLAN_SPEED_KMH = 30;

export interface PlanPanelPorts {
  day(): ScoutDay | null;
  keptSpots(): SavedSpot[];
  isoDate(): string;
  timeZone(): string;
  buildingsShown(): boolean;
  shadowStats(): { cast: number; estimated: number };
  /** The same per-coordinate light computation the hotspots and the pin's own
   *  timeline already use, so a stop's light in the plan is the light the
   *  rest of the page would show for that coordinate. */
  dayLightAt(at: LatLon, samples: ScoutDay['samples']): { windows: LightWindow[] };
  planSource(): maplibregl.GeoJSONSource | undefined;
  toClipboard(id: string, text: string): Promise<void>;
}

export interface PlanPanel {
  /** Recompute the plan from the current picks, redraw the route on the map
   *  and the panel's own list. */
  rebuild(): void;
  /** Redraw the panel's own DOM from current state without recomputing —
   *  the init-time call, before there is anything to recompute yet. */
  render(): void;
  /** Drop any pick whose spot is no longer kept, then rebuild. Unkeeping a
   *  place has to take it out of the plan as well — left behind, the pick
   *  would keep a stop in the route for a spot the notebook no longer has. */
  forgetUnkept(): void;
}

export function createPlanPanel(ports: PlanPanelPorts): PlanPanel {
  /** Which kept spots are in the plan, by their `spotKey`. */
  const planPicks = new Set<string>();
  let planned: Itinerary | null = null;

  /** A saved spot's identity, stable across reloads and independent of name. */
  const spotKey = (spot: { lat: number; lon: number }) => `${spot.lat.toFixed(5)},${spot.lon.toFixed(5)}`;

  /** A day-minute as a clock time in the spot's own zone. */
  const planClock = (minute: number) => {
    const day = ports.day();
    return day ? formatMinute(day.dayStart, minute, ports.timeZone()) : String(minute);
  };

  /**
   * The stops and the legs between them, on the map.
   *
   * Straight lines, because straight lines are exactly what the travel
   * estimate assumes. Drawing a road route over a great-circle estimate
   * would show a precision the number underneath does not have.
   */
  function drawPlanRoute() {
    const source = ports.planSource();
    if (!source) return;
    const stops = planned?.stops ?? [];
    if (!stops.length) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const line = {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: stops.map((stop) => [stop.spot.at.lon, stop.spot.at.lat]),
      },
    };
    source.setData({
      type: 'FeatureCollection',
      features: [
        line,
        ...stops.map((stop, index) => ({
          type: 'Feature' as const,
          properties: { order: index + 1 },
          geometry: {
            type: 'Point' as const,
            coordinates: [stop.spot.at.lon, stop.spot.at.lat],
          },
        })),
      ],
    });
  }

  /**
   * Rebuild the plan from the current picks.
   *
   * The per-spot windows come from `dayLightAt` — the same call the hotspots
   * and the pin's own timeline go through — so a stop's light in the plan is
   * the light the rest of the page would show for that coordinate.
   */
  function rebuildPlan() {
    const day = ports.day();
    if (!day || planPicks.size < MIN_ITINERARY_SPOTS) {
      planned = null;
      drawPlanRoute();
      return;
    }
    const samples = day.samples.slice(0, 1440);
    const chosen = ports.keptSpots().filter((spot) => planPicks.has(spotKey(spot)));
    planned = planItinerary(
      chosen.map((spot) => {
        const light = ports.dayLightAt({ lat: spot.lat, lon: spot.lon }, samples);
        return {
          name: spot.name || formatCoords({ lat: spot.lat, lon: spot.lon }),
          at: { lat: spot.lat, lon: spot.lon },
          windows: light.windows,
        };
      }),
      samples,
      { dwellMinutes: PLAN_DWELL_MINUTES, speedKmh: PLAN_SPEED_KMH },
    );
    drawPlanRoute();
  }

  function renderPlan() {
    const keptSpots = ports.keptSpots();
    const fold = $<HTMLElement>('fold-plan');
    // Nothing to order with fewer than two places kept. Showing an empty
    // picker would advertise a feature that cannot yet do anything.
    fold.hidden = keptSpots.length < MIN_ITINERARY_SPOTS;
    if (fold.hidden) return;

    const atLimit = planPicks.size >= MAX_ITINERARY_SPOTS;
    $('plan-pick').replaceChildren(
      ...keptSpots.map((spot) => {
        const key = spotKey(spot);
        const picked = planPicks.has(key);
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = picked;
        // At the ceiling the unpicked boxes go dead rather than silently
        // refusing on click — the cap is stated by the control itself.
        box.disabled = !picked && atLimit;
        box.addEventListener('change', () => {
          if (box.checked) planPicks.add(key);
          else planPicks.delete(key);
          rebuildPlan();
          renderPlan();
        });
        label.append(box, document.createTextNode(spot.name || formatCoords(spot)));
        return label;
      }),
    );

    $('plan-help').textContent = atLimit
      ? `${MAX_ITINERARY_SPOTS} is the most that can be ordered — unpick one to swap it.`
      : `Choose ${MIN_ITINERARY_SPOTS} to ${MAX_ITINERARY_SPOTS} kept spots.`;

    const stops = planned?.stops ?? [];
    $('plan-stops').replaceChildren(
      ...stops.map((stop) => {
        const li = document.createElement('li');
        const when = document.createElement('span');
        when.className = 'plan-when';
        when.textContent = `${planClock(stop.arriveMinute)}–${planClock(stop.leaveMinute)}`;

        const where = document.createElement('span');
        where.className = 'plan-where';
        where.textContent = stop.spot.name;
        const leg = document.createElement('span');
        leg.className = 'plan-leg';
        const parts = [`sun ${Math.round(stop.sunAltitude)}°`];
        if (stop.travelMinutes) {
          parts.unshift(`${stop.travelMinutes} min from the last · ${formatDistance(stop.travelM)}`);
        }
        // How far off this spot's own best light the visit landed is the cost
        // of fitting the rest of the day in, and it is the number a
        // photographer would otherwise have to work out for themselves.
        if (stop.offBestMinutes > 0) {
          parts.push(`${formatDuration(stop.offBestMinutes)} off its best light`);
        } else {
          parts.push('at its best light');
        }
        leg.textContent = parts.join(' · ');
        where.append(leg);

        li.append(when, where);
        return li;
      }),
    );

    $('plan-total').textContent = stops.length
      ? `${stops.length} spot${stops.length === 1 ? '' : 's'} · ${formatDuration(planned!.totalTravelMinutes)} travelling · ${formatDistance(planned!.totalTravelM)}`
      : planPicks.size >= MIN_ITINERARY_SPOTS
        ? 'Nothing could be planned for this day.'
        : '';

    // Everything that did not fit, as loud as the plan itself. A day plan
    // that showed only its successes would be a different answer from the
    // one the solver gave.
    const trouble = [
      ...(planned?.dropped ?? []).map((drop) => drop.note),
      ...(planned?.conflicts ?? []).map((conflict) => conflict.note),
    ];
    $('plan-trouble').replaceChildren(
      ...trouble.map((note) => {
        const li = document.createElement('li');
        li.textContent = `— ${note}`;
        return li;
      }),
    );

    $('plan-assume').textContent = planned?.travelAssumption ?? '';
    $<HTMLElement>('plan-copy').hidden = !stops.length;
  }

  /**
   * Drop any pick whose spot is no longer kept, then redraw.
   *
   * Unkeeping a place has to take it out of the plan as well. Left behind,
   * the pick would keep a stop in the route for a spot the notebook no
   * longer has — an itinerary to somewhere you deleted.
   */
  function forgetUnkeptPicks() {
    const alive = new Set(ports.keptSpots().map(spotKey));
    for (const key of planPicks) if (!alive.has(key)) planPicks.delete(key);
    rebuildPlan();
    renderPlan();
  }

  on('plan-copy', 'click', () => {
    const day = ports.day();
    if (!planned || !day) return;
    void ports.toClipboard(
      'plan-copy',
      itineraryReport({
        dayLabel: formatDayLabel(ports.isoDate(), ports.timeZone()),
        timeZone: ports.timeZone(),
        itinerary: planned,
        clock: planClock,
        caveat: shadowCaveat({
          showing: ports.buildingsShown(),
          cast: ports.shadowStats().cast,
          estimated: ports.shadowStats().estimated,
        }),
      }),
    );
  });

  return {
    rebuild: () => {
      rebuildPlan();
      renderPlan();
    },
    render: renderPlan,
    forgetUnkept: forgetUnkeptPicks,
  };
}
