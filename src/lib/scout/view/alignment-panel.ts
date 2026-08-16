/**
 * The alignment finder, in the panel.
 *
 * `alignment.ts` answers "on what dates does the body meet the horizon on this
 * bearing". This is where that question gets asked and where the answer becomes
 * something you can act on — a row you press to put the whole page on that
 * evening, with the map, the shadows and the dome all following.
 *
 * **The bearing comes from the sightline target**, which is already a draggable
 * ring on the map, already means "that thing over there", and already answers
 * whether you can see it. Adding a second way to aim would be a second thing to
 * keep in agreement. With no target placed this refuses and says how to place
 * one, because a bearing nobody chose is the fabrication `lighting.ts` declines
 * to make for a photograph.
 *
 * **The horizon comes from the page** through `horizon()`, together with the
 * sentence saying where it came from. A flat 0° is a legitimate answer and it is
 * a completely different claim from a merged terrain-and-buildings profile; the
 * two must never be allowed to look alike, so the basis line is not optional and
 * is rendered whether or not there is anything to report.
 *
 * Self-contained: it owns the `#fold-align` block and nothing else on the page
 * touches it, the same contract `month-grid.ts` has.
 */

import {
  MOON,
  SUN,
  closestPass,
  findAlignments,
  withMoonPhase,
  type Alignment,
  type AlignmentSearch,
  type MoonAlignment,
} from '../alignment';
import { formatClock, formatDayLabel, isoDateIn } from '../daylight';
import { angleDelta } from '../frame';
import { initialBearing, type LatLon } from '../geo';
import { MOON_PHASE_LABEL } from '../moon';
import { $, on } from './dom';

/** A year, so both of the sun's two passes at any bearing fall inside it. */
export const SEARCH_DAYS = 365;

export type AlignBody = 'sun' | 'moon';

export interface HorizonReading {
  /** Apparent altitude of whatever is on the bearing, degrees. */
  deg: number;
  /** Where that number came from, as a whole sentence. Never empty. */
  basis: string;
}

export interface AlignmentPorts {
  centre(): LatLon | null;
  /** The sightline target, or null while it has never been placed. */
  target(): LatLon | null;
  /** What stands on a bearing, and what that reading rests on. */
  horizon(bearing: number): HorizonReading | null;
  timeZone(): string;
  /** Where the search starts — the day on screen. */
  from(): Date;
  /** Put the page on an instant. */
  goTo(instant: Date): void;
}

export interface AlignmentPanel {
  /**
   * Redraw against the current bearing and horizon.
   *
   * Cheap — a lookup and a dozen rows — and deliberately *not* a recompute. A
   * terrain tile arriving must not make a list someone is reading disappear, so
   * an answer whose inputs have since moved is marked stale and left standing.
   */
  restate(): void;
}

const round1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/**
 * "Wed 23 Sep", with the year only when the search has run into the next one.
 *
 * A year-long window crosses a new year in the middle, and two rows reading
 * "19 Mar" and "23 Sep" with no year between them are six months apart in one
 * direction and six in the other.
 */
function dayLabel(at: Date, timeZone: string, startYear: number): string {
  const iso = isoDateIn(at, timeZone);
  const label = formatDayLabel(iso, timeZone);
  const year = Number(iso.slice(0, 4));
  return year === startYear ? label : `${label} ${year}`;
}

/**
 * How far an input may drift before the answer standing on screen is stale.
 *
 * Half a degree of bearing is the ring being nudged; a tenth of a degree of
 * horizon is a fifth of the sun's disc, which is enough to move a date.
 */
const STALE_BEARING_DEG = 0.5;
const STALE_HORIZON_DEG = 0.1;

export function createAlignmentPanel(ports: AlignmentPorts): AlignmentPanel {
  let body: AlignBody = 'sun';
  let search: AlignmentSearch | null = null;
  /** The inputs the standing answer was computed from, to notice it going stale. */
  let ranWith: { bearing: number; horizonDeg: number } | null = null;
  /** Percent of the disc that has to be lit for a moon row to be shown. */
  let minLitPercent = 0;

  const list = () => $<HTMLElement>('align-list');

  function bearing(): number | null {
    const centre = ports.centre();
    const target = ports.target();
    if (!centre || !target) return null;
    return initialBearing(centre, target);
  }

  function run() {
    const centre = ports.centre();
    const aim = bearing();
    if (!centre || aim === null) {
      search = null;
      ranWith = null;
      render();
      return;
    }
    const horizonDeg = ports.horizon(aim)?.deg ?? 0;
    search = findAlignments(body === 'sun' ? SUN : MOON, centre, {
      bearing: aim,
      horizonDeg,
      from: ports.from(),
      days: SEARCH_DAYS,
    });
    ranWith = { bearing: aim, horizonDeg };
    render();
  }

  /** The rows worth showing: the passes that meet, or the nearest one that did not. */
  function rowsFor(current: AlignmentSearch): { events: Alignment[]; fallback: boolean } {
    const met = current.events.filter((event) => event.meets);
    if (met.length) return { events: met, fallback: false };
    const closest = closestPass(current);
    return { events: closest ? [closest] : [], fallback: true };
  }

  function moonRow(event: Alignment): MoonAlignment | null {
    if (body !== 'moon') return null;
    return withMoonPhase([event])[0];
  }

  function render() {
    const aim = bearing();
    const horizon = aim === null ? null : ports.horizon(aim);

    // The basis line is rendered before anything else and in every state,
    // including the states with no answer in them. What the horizon was is not a
    // footnote on the result — it is half of what the result means.
    $('align-basis').textContent =
      aim === null
        ? 'Turn on Line of sight and drag its ring onto what you want the sun behind.'
        : `On ${Math.round(aim)}° — ${horizon ? horizon.basis : 'a flat horizon, because nothing has loaded here yet.'}`;

    const phaseRow = $<HTMLElement>('align-phase-row');
    phaseRow.hidden = body !== 'moon';

    if (!search) {
      list().replaceChildren();
      $('align-note').textContent =
        aim === null ? '' : 'Press “Find dates” — a year of them takes about a tenth of a second.';
      return;
    }

    const { events, fallback } = rowsFor(search);
    const startYear = Number(isoDateIn(search.from, ports.timeZone()).slice(0, 4));

    let hiddenByPhase = 0;
    const rows: HTMLElement[] = [];
    for (const event of events) {
      const moon = moonRow(event);
      if (moon && moon.fraction * 100 < minLitPercent) {
        hiddenByPhase++;
        continue;
      }

      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'align-row';
      button.dataset.at = String(event.best.at.getTime());

      const when = document.createElement('span');
      when.className = 'align-when';
      when.textContent = `${dayLabel(event.best.at, ports.timeZone(), startYear)} · ${formatClock(
        event.best.at,
        ports.timeZone(),
      )}`;
      button.append(when);

      const what = document.createElement('span');
      what.className = 'align-what';
      const parts = [
        event.descending ? 'setting' : 'rising',
        `${round1(Math.abs(event.best.clearanceDeg))}° off`,
      ];
      if (moon) parts.push(`${Math.round(moon.fraction * 100)}% ${MOON_PHASE_LABEL[moon.phase].toLowerCase()}`);
      what.textContent = parts.join(' · ');
      button.append(what);

      const note = document.createElement('span');
      note.className = 'align-detail';
      note.textContent = event.note;
      button.append(note);

      item.append(button);

      // The other dates of the same pass, as their own rows to press. The disc
      // has width, so the shot is usually on for more than one evening, and
      // offering only the closest would be throwing the others away.
      if (event.window.length > 1) {
        const also = document.createElement('ul');
        also.className = 'align-also';
        for (const crossing of event.window) {
          if (crossing.at.getTime() === event.best.at.getTime()) continue;
          const sub = document.createElement('li');
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'align-alt';
          link.dataset.at = String(crossing.at.getTime());
          link.textContent = `also ${dayLabel(crossing.at, ports.timeZone(), startYear)} · ${formatClock(
            crossing.at,
            ports.timeZone(),
          )} · ${round1(Math.abs(crossing.clearanceDeg))}° off`;
          sub.append(link);
          also.append(sub);
        }
        item.append(also);
      }
      rows.push(item);
    }
    list().replaceChildren(...rows);

    // Say what was left out and why. A list quietly shortened by a filter reads
    // as "there were only two", which is the one thing it must not say.
    const hidden = hiddenByPhase
      ? ` ${hiddenByPhase} pass${hiddenByPhase === 1 ? '' : 'es'} hidden by the lit-fraction filter.`
      : '';
    const lead = fallback ? `${search.note} The nearest is below.` : search.note;
    $('align-note').textContent = `${staleNote(aim, horizon?.deg ?? 0)}${lead}${hidden}`;
  }

  /**
   * Whether the answer on screen was computed against something that has since
   * moved — a nudged ring, or terrain that arrived after the search ran.
   *
   * Said rather than acted on. Clearing the list would take away the thing being
   * read; leaving it unmarked would let a stale date pass for a current one.
   */
  function staleNote(aim: number | null, horizonDeg: number): string {
    if (!ranWith || aim === null) return '';
    const movedBearing = Math.abs(angleDelta(ranWith.bearing, aim)) > STALE_BEARING_DEG;
    const movedHorizon = Math.abs(horizonDeg - ranWith.horizonDeg) > STALE_HORIZON_DEG;
    if (!movedBearing && !movedHorizon) return '';
    const what = movedBearing
      ? `the ring has moved to ${Math.round(aim)}°`
      : `the skyline there now reads ${round1(horizonDeg)}°`;
    return `Found against ${Math.round(ranWith.bearing)}° at ${round1(
      ranWith.horizonDeg,
    )}° up, and ${what} — find again. `;
  }

  on('align-body', 'click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-body]');
    if (!button) return;
    const chosen = button.dataset.body as AlignBody;
    if (chosen === body) return;
    body = chosen;
    for (const other of $('align-body').querySelectorAll('button')) {
      other.classList.toggle('on', other === button);
    }
    // The old answer was about the other body. Recompute rather than clear:
    // switching is a request for the same question about the moon.
    if (search) run();
    else render();
  });

  on('align-run', 'click', run);

  on('align-phase', 'input', (event) => {
    minLitPercent = Number((event.target as HTMLInputElement).value);
    $('align-phase-out').textContent = `${minLitPercent}%`;
    render();
  });

  on('align-list', 'click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-at]');
    if (!row) return;
    ports.goTo(new Date(Number(row.dataset.at)));
  });

  render();

  return { restate: render };
}
