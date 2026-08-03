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
  lines.push(
    `Times are local to ${plan.timeZone}.`,
    plan.caveat
      ? `Sun and moon are computed; shadows are modelled — ${plan.caveat}`
      : 'Sun and moon are computed; shadows are modelled, not measured.',
  );

  return lines.join('\n');
}
