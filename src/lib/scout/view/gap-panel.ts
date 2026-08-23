/**
 * The archive's missing colours, in the panel.
 *
 * `gaps.ts` says which hue anchors the archive has never shot, or has barely
 * shot. `gap-shoots.ts` turns each into a recipe — an atmosphere, a sun
 * altitude, and every date this point reaches it in the year ahead — or the
 * honest refusal when the colour is not one daylight makes. This is where
 * that recipe becomes rows you can press, the same contract `alignment-
 * panel.ts` keeps for its own dated list: press a row, the page goes there.
 *
 * The gap list itself is baked at build time from the archive's own manifest
 * (`scout.astro`'s frontmatter) — a snapshot of the same kind `index.astro`
 * already bakes for its chapters, not a runtime fetch. Only the *search* —
 * which dates this point reaches the matched altitude — runs live, against
 * whatever place is on screen.
 *
 * Self-contained: it owns the `#fold-gaps` block, the same contract
 * `alignment-panel.ts` and `month-grid.ts` keep.
 */

import type { LatLon } from '../geo';
import { suggestShootsForGaps, type GapOccurrence, type GapShoot } from '../gap-shoots';
import type { ColourGap } from '../../gaps';
import { formatClock, formatDayLabel, isoDateIn } from '../daylight';
import { $, on } from './dom';

/** A year, so a gap whose match only happens once a year is still found. */
export const SEARCH_DAYS = 365;
/** Rows shown per gap before the rest collapse into a count. */
const MAX_ROWS = 4;

export interface GapPanelPorts {
  centre(): LatLon | null;
  timeZone(): string;
  from(): Date;
  goTo(instant: Date): void;
}

export interface GapPanel {
  /** Re-render (e.g. after the `?gap=` deep link resolves against a place chosen later). */
  restate(): void;
}

function occurrenceLabel(occ: GapOccurrence, timeZone: string, startYear: number): string {
  const iso = isoDateIn(occ.at, timeZone);
  const label = formatDayLabel(iso, timeZone);
  const year = Number(iso.slice(0, 4));
  const day = year === startYear ? label : `${label} ${year}`;
  const side = occ.ascending ? 'sunrise side' : 'sunset side';
  return `${day} · ${formatClock(occ.at, timeZone)} · ${side}`;
}

export function createGapPanel(gaps: ColourGap[], ports: GapPanelPorts): GapPanel {
  const params = new URLSearchParams(location.search);
  const requestedGap = params.get('gap');

  const list = () => $<HTMLElement>('gap-list');

  function rowFor(shoot: GapShoot, highlight: boolean): HTMLElement {
    const item = document.createElement('li');
    item.className = 'gap-row';
    if (highlight) item.classList.add('gap-highlight');

    const head = document.createElement('p');
    head.className = 'gap-head';
    head.textContent = `${shoot.gap.anchorName} — ${shoot.gap.kind === 'missing' ? 'never shot' : `${shoot.gap.photoCount} only`}`;
    item.append(head);

    const note = document.createElement('p');
    note.className = 'gap-detail';
    note.textContent = shoot.note;
    item.append(note);

    if (shoot.occurrences.length) {
      const startYear = shoot.occurrences[0].at.getUTCFullYear();
      const rows = document.createElement('ul');
      rows.className = 'gap-occurrences';
      for (const occ of shoot.occurrences.slice(0, MAX_ROWS)) {
        const row = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gap-occ';
        button.dataset.at = String(occ.at.getTime());
        button.textContent = occurrenceLabel(occ, ports.timeZone(), startYear);
        row.append(button);
        rows.append(row);
      }
      item.append(rows);
      const extra = shoot.occurrences.length - MAX_ROWS;
      if (extra > 0) {
        const more = document.createElement('p');
        more.className = 'gap-more';
        more.textContent = `+${extra} more this year`;
        item.append(more);
      }
    }
    return item;
  }

  function render() {
    const centre = ports.centre();
    if (!centre) {
      list().replaceChildren();
      $('gap-note').textContent = 'Type a place, or drop a pin, to see when it could fill one of these.';
      return;
    }
    const shoots = suggestShootsForGaps(gaps, centre, ports.from(), SEARCH_DAYS);
    // Reachable-with-real-dates first, then reachable-but-not-here, then the
    // colours pure daylight cannot make at all — the ones worth acting on
    // first, in the order they are worth acting on.
    const ranked = [...shoots].sort((a, b) => {
      const score = (s: GapShoot) => (s.occurrences.length > 0 ? 0 : s.match ? 1 : 2);
      return score(a) - score(b);
    });
    list().replaceChildren(...ranked.map((s) => rowFor(s, s.gap.anchorKey === requestedGap)));
    $('gap-note').textContent = gaps.length
      ? `${gaps.length} colour${gaps.length === 1 ? '' : 's'} thin or missing from the archive.`
      : 'Every hue anchor is already represented — nothing missing to chase.';

    if (requestedGap) {
      const fold = $<HTMLDetailsElement>('fold-gaps');
      fold.open = true;
      list().querySelector('.gap-highlight')?.scrollIntoView({ block: 'nearest' });
    }
  }

  on('gap-run', 'click', render);
  on('gap-list', 'click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-at]');
    if (!button) return;
    ports.goTo(new Date(Number(button.dataset.at)));
  });

  render();

  return { restate: render };
}
