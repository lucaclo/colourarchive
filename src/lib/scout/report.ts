/**
 * The day, as something you can paste somewhere else.
 *
 * Everything Scout knows is on screen, and none of it leaves. A plan made here
 * has to be copied out by hand into whatever the shoot is actually organised
 * in — a note, a message, a call sheet. This turns it into one block of text.
 *
 * Two rules, both from the project's ethos rather than from formatting taste:
 *
 * - **An absent event is listed as absent.** A row with no time still appears,
 *   with a dash against it. "No sunrise today" is an answer, and a plan that
 *   silently omitted the row would leave the reader to notice a gap.
 * - **The plan says what it is.** Pasted somewhere else it loses the map, the
 *   caveats in the panel and every visual cue that these are modelled shadows
 *   over inferred building heights. So it carries a closing line saying so.
 *   A photographer standing in the wrong street at 06:00 deserves to have been
 *   told which parts were arithmetic and which were a guess.
 */

import type { SunEventRow } from './daylight';
import { formatClock } from './daylight';
import type { LatLon } from './geo';
import type { Itinerary } from './itinerary';

export interface ShootPlan {
  /** What the panel calls this place. */
  name: string;
  centre: LatLon;
  /** Already formatted for the reader, e.g. "Sat 1 Aug". */
  dayLabel: string;
  timeZone: string;
  events: SunEventRow[];
  /** The per-spot sentence, when a horizon has been worked out for the pin. */
  light?: string;
  /** One line about the moon, when it is being shown. */
  moon?: string;
  /**
   * A reading true only of the instant the slider is on — the light quality
   * under the current cloud, say.
   *
   * **It must name its own moment.** Everything else here is about the whole
   * day, and dropped among those lines a momentary note reads as a claim about
   * all of it: "no direct light, the sun is down" directly under a sunrise time
   * looks like a contradiction rather than a remark about 04:05.
   */
  moment?: string;
  /** How the building shadows were qualified — heights known or inferred. */
  caveat?: string;
}

const PLACES = 5;

/** Pad to the widest label so the times line up in a monospaced note. */
function column(rows: Array<[string, string]>): string[] {
  const width = rows.reduce((wide, [label]) => Math.max(wide, label.length), 0);
  return rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`);
}

/**
 * One event as a time or a span — or a dash, when the day does not have it.
 *
 * `end` is set only for the windows, golden and blue, and only those read as a
 * range. Everything else is an instant.
 */
function eventTime(row: SunEventRow, timeZone: string): string {
  if (!row.start) return '—';
  const start = formatClock(row.start, timeZone);
  if (row.end === undefined || row.end === null) return start;
  return `${start}–${formatClock(row.end, timeZone)}`;
}

/**
 * The two lines every pasted plan ends with.
 *
 * Shared rather than repeated so a second kind of report cannot quietly ship
 * without them — which is the whole failure this file's header is about.
 */
function closing(timeZone: string, caveat?: string): string[] {
  return [
    `Times are local to ${timeZone}.`,
    caveat
      ? `Sun and moon are computed; shadows are modelled — ${caveat}`
      : 'Sun and moon are computed; shadows are modelled, not measured.',
  ];
}

export function shootPlan(plan: ShootPlan): string {
  const lines: string[] = [];

  lines.push(`${plan.name} — ${plan.dayLabel}`);
  lines.push(`${plan.centre.lat.toFixed(PLACES)}, ${plan.centre.lon.toFixed(PLACES)}`);
  lines.push('');

  if (plan.events.length) {
    lines.push(...column(plan.events.map((row) => [row.label, eventTime(row, plan.timeZone)])));
    lines.push('');
  }

  const notes = [plan.light, plan.moon, plan.moment].filter(Boolean) as string[];
  if (notes.length) {
    lines.push(...notes);
    lines.push('');
  }

  // The closing line is not optional. See this file's header.
  lines.push(...closing(plan.timeZone, plan.caveat));

  return lines.join('\n');
}

/* ── A day across several spots ────────────────────────────────────────────── */

export interface ItineraryReport {
  dayLabel: string;
  timeZone: string;
  itinerary: Itinerary;
  /** Turns a minute index into a clock time in the spot's zone. */
  clock: (minute: number) => string;
  caveat?: string;
}

/**
 * The itinerary, as something you can paste into a message.
 *
 * Written through the same door as `shootPlan` and closing with the same two
 * lines, for the same reason: pasted elsewhere this loses the map and every
 * caveat around it, and a route of six times and places reads far more like a
 * timetable than a single day's events do. The travel assumption is printed in
 * full rather than summarised — it is the number most likely to be wrong, and
 * the one a reader would otherwise take for a measurement.
 *
 * **Everything that did not fit is printed.** A plan that listed only its
 * successes would be a different document from the one the solver produced.
 */
export function itineraryReport(report: ItineraryReport): string {
  const { itinerary, clock } = report;
  const lines: string[] = [];

  lines.push(`Day plan — ${report.dayLabel}`);
  lines.push('');

  if (itinerary.stops.length) {
    lines.push(
      ...column(
        itinerary.stops.map((stop) => [
          `${clock(stop.arriveMinute)}–${clock(stop.leaveMinute)}`,
          stop.travelMinutes
            ? `${stop.spot.name}  (${stop.travelMinutes} min travel, sun ${Math.round(stop.sunAltitude)}°)`
            : `${stop.spot.name}  (sun ${Math.round(stop.sunAltitude)}°)`,
        ]),
      ),
    );
    lines.push('');
    lines.push(
      `${itinerary.stops.length} spot${itinerary.stops.length === 1 ? '' : 's'} · ` +
        `${itinerary.totalTravelMinutes} min travelling · ` +
        `${(itinerary.totalTravelM / 1000).toFixed(1)} km`,
    );
    lines.push('');
  } else {
    lines.push('Nothing could be planned for this day.');
    lines.push('');
  }

  // An absent event is listed as absent — the rule this file already follows
  // for a sunrise that does not happen. A spot that did not fit is one of those.
  if (itinerary.dropped.length) {
    lines.push('Left out:');
    lines.push(...itinerary.dropped.map((drop) => `  ${drop.note}`));
    lines.push('');
  }

  if (itinerary.conflicts.length) {
    lines.push('Clashes:');
    lines.push(...itinerary.conflicts.map((conflict) => `  ${conflict.note}`));
    lines.push('');
  }

  lines.push(itinerary.travelAssumption);
  lines.push(...closing(report.timeZone, report.caveat));

  return lines.join('\n');
}
