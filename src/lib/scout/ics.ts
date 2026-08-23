/**
 * A minimal RFC 5545 (iCalendar) writer — issue #63.
 *
 * Deliberately small: one `VEVENT` per instant, no recurrence, no `VTIMEZONE`
 * component. Every date Scout computes is an absolute instant (a JS `Date`),
 * so writing it in UTC (`...Z`) is always correct without one — the calendar
 * app converts to whatever zone it is already showing, the same way any
 * other UTC-stamped event does.
 *
 * This is a one-time downloadable file, not a hosted, subscribable feed:
 * `/scout` is SSR-only and stays out of the static export (see
 * SCOUT-HANDOFF.md), so there is nowhere public for a calendar app to poll.
 * `UID`s are still built to be stable across repeated downloads of the same
 * alignment, so re-importing an updated file after a return visit does not
 * create a second copy of an evening already on the calendar.
 */

export interface IcsEvent {
  /** Stable across regenerations of the same event, so a calendar app that
   *  dedupes by UID does not create a second copy of the same evening. */
  uid: string;
  at: Date;
  summary: string;
  description?: string;
  location?: string;
  /** Defaults to 30 — long enough to say "be there", never claimed as the
   *  length of the light itself, which this file does not model. */
  durationMinutes?: number;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** `YYYYMMDDTHHMMSSZ` — UTC, per RFC 5545 §3.3.5. */
function icsDate(at: Date): string {
  return (
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  );
}

/** Escapes the characters RFC 5545 §3.3.11 reserves in a TEXT value. Order
 *  matters: the backslash itself must be escaped first, or the escapes added
 *  for the other three characters would be escaped a second time. */
function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Folds one content line at 75 octets, as RFC 5545 §3.1 requires — anything
 * longer continues on the next physical line behind a single leading space.
 *
 * Counts UTF-16 code units rather than true UTF-8 octets, so a line heavy
 * with non-ASCII text (an accented place name, say) folds a little earlier
 * than the spec strictly demands. Short of the octet budget is always safe;
 * over it is what would actually break a strict reader.
 */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  parts.push(rest);
  return parts.join('\r\n');
}

const DEFAULT_DURATION_MINUTES = 30;

/**
 * Serializes a list of instants as a `.ics` calendar. Every event gets its
 * own `VEVENT` — there is no recurrence rule, because the dates an alignment
 * meets are not periodic; they are whatever `alignment.ts` actually found.
 */
export function buildIcs(
  events: IcsEvent[],
  opts: { prodId?: string; calendarName?: string } = {},
): string {
  const stamp = icsDate(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${opts.prodId ?? '-//Colour Archive//Scout//EN'}`, 'CALSCALE:GREGORIAN'];
  if (opts.calendarName) lines.push(fold(`X-WR-CALNAME:${icsText(opts.calendarName)}`));
  for (const event of events) {
    const start = new Date(event.at);
    const end = new Date(start.getTime() + (event.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60_000);
    lines.push('BEGIN:VEVENT');
    lines.push(fold(`UID:${icsText(event.uid)}`));
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${icsDate(start)}`);
    lines.push(`DTEND:${icsDate(end)}`);
    lines.push(fold(`SUMMARY:${icsText(event.summary)}`));
    if (event.description) lines.push(fold(`DESCRIPTION:${icsText(event.description)}`));
    if (event.location) lines.push(fold(`LOCATION:${icsText(event.location)}`));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
