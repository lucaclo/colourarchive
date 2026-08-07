/**
 * The month, hour by hour.
 *
 * The slider answers one day at a time, which is the wrong resolution for
 * deciding *which* day to come back on. Same arithmetic as the panel, laid out
 * so a month of it can be read at a glance.
 *
 * Self-contained: it owns the `#monthgrid` sheet and nothing else on the page
 * touches it. What it cannot know — where the pin is, what the forecast says,
 * which instant the slider is on, and how to put the page on a new one — comes
 * in through `MonthGridPorts`, so the grid never reaches into the page's state
 * and the page never reaches into the grid's.
 */

import { altitudeColour } from '../daylight';
import type { LatLon } from '../geo';
import { formatColumn, goldenRuns, monthGrid, monthOf, shiftIsoMonth, type MonthGrid } from '../grid';
import { $, on } from './dom';

/** Half-hourly. Fine enough to see the golden hour, coarse enough to fit. */
export const GRID_STEP_MINUTES = 30;

export interface MonthGridPorts {
  /** Where the grid is centred, or null when nowhere has been chosen. */
  centre(): LatLon | null;
  /** The date on screen, which decides which month opens. */
  isoDate(): string;
  timeZone(): string;
  /**
   * How much of the sun the forecast expects to survive at an instant, 0–1.
   *
   * Null where the forecast does not reach — which is most of a month, since
   * Open-Meteo gives seven days. Drawing "no forecast" as "clear" would turn a
   * grid that is honest about three weeks of it into one that quietly promises
   * sunshine in a fortnight.
   */
  lightAt(instant: Date): number | null;
  /** The instant the slider is sitting on, so the cell for it can be marked. */
  currentInstant(): Date | null;
  /** Put the page on a cell's instant. */
  goTo(instant: Date): void;
}

export interface MonthGridView {
  open(): void;
  close(): void;
}

/**
 * Roughly how many days at the start of the month the forecast reaches.
 *
 * Stated in days because that is the unit the reader is choosing in, and
 * approximate because the forecast ends at an hour rather than at a midnight —
 * the legend says "about". A month with no forecast at all is nought rather
 * than a division by zero.
 */
export function forecastDaysCovered(forecastCells: number, days: number, columns: number): number {
  if (!days || !columns) return 0;
  return Math.round((forecastCells / (days * columns)) * days);
}

export function createMonthGrid(ports: MonthGridPorts): MonthGridView {
  let gridMonth = '';

  const sheet = () => $<HTMLElement>('monthgrid');

  function open() {
    if (!ports.centre()) return;
    gridMonth = monthOf(ports.isoDate());
    sheet().hidden = false;
    render();
  }

  function close() {
    sheet().hidden = true;
  }

  function render() {
    const centre = ports.centre();
    if (!centre || sheet().hidden) return;

    const grid: MonthGrid = monthGrid(centre, gridMonth, ports.timeZone(), {
      stepMinutes: GRID_STEP_MINUTES,
    });
    $('mg-title').textContent = new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${gridMonth}-01T12:00:00Z`));

    const body = $<HTMLElement>('mg-body');
    body.style.gridTemplateColumns = `2.6rem repeat(${grid.columns.length}, 1fr)`;

    let forecastCells = 0;
    const rows: HTMLElement[] = [];

    // A header of hours, sparse enough to read: every sixth column at half-hour
    // resolution is one label every three hours.
    const head = document.createElement('div');
    head.className = 'mg-row';
    head.append(document.createElement('span'));
    for (const [index, minute] of grid.columns.entries()) {
      const cell = document.createElement('span');
      cell.className = 'mg-day';
      cell.style.textAlign = 'left';
      cell.style.position = 'static';
      if (index % 6 === 0) cell.textContent = formatColumn(minute);
      head.append(cell);
    }
    rows.push(head);

    for (const day of grid.days) {
      const row = document.createElement('div');
      row.className = 'mg-row';

      const label = document.createElement('span');
      label.className = 'mg-day';
      label.textContent = new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${day.isoDate}T12:00:00Z`));
      row.append(label);

      const golden = goldenRuns(day);

      for (const cell of day.cells) {
        if (cell.at === null) {
          const gap = document.createElement('span');
          gap.className = 'mg-cell mg-gap';
          gap.title = `${day.isoDate} · the clocks skipped ${formatColumn(cell.minute)}`;
          row.append(gap);
          continue;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mg-cell';
        button.dataset.date = day.isoDate;
        button.dataset.minute = String(cell.minute);
        // The instant, not just the clock reading. The slider counts from solar
        // midnight and this grid counts from the local one; the instant is the
        // only thing the two agree about.
        button.dataset.at = String(cell.at.getTime());
        button.style.background = altitudeColour(cell.altitude ?? -90);

        // Cloud dims a cell, and only where there is a forecast to dim it with.
        const light = ports.lightAt(cell.at);
        if (light !== null) {
          forecastCells++;
          button.style.opacity = String(0.35 + 0.65 * light);
        }
        // Compared as instants for the same reason: "the cell you are looking
        // at" is a moment, and the two scales only meet there.
        const here = ports.currentInstant();
        if (here && Math.abs(cell.at.getTime() - here.getTime()) < (GRID_STEP_MINUTES / 2) * 60_000) {
          button.classList.add('mg-now');
        }

        const inGolden = golden.some((run) => cell.minute >= run.from && cell.minute < run.to);
        button.title = [
          `${day.isoDate} ${formatColumn(cell.minute)}`,
          `${(cell.altitude ?? 0).toFixed(0)}° ${inGolden ? '· golden' : ''}`.trim(),
          light === null ? 'no forecast' : `${Math.round(light * 100)}% direct light`,
        ].join(' · ');
        row.append(button);
      }
      rows.push(row);
    }

    body.replaceChildren(...rows);

    // The legend says what the picture cannot: which part of it is a forecast
    // and which part is arithmetic that will not change.
    const covered = forecastDaysCovered(forecastCells, grid.days.length, grid.columns.length);
    $('mg-legend').textContent = [
      'Colour is the sun’s altitude; hatching is an hour the local clock never read.',
      forecastCells
        ? `Cloud dims about the first ${covered} days — the rest is geometry, with no forecast to qualify it.`
        : 'No forecast loaded, so nothing here is dimmed by cloud.',
      // Because clicking 00:30 lands on the previous date, and that looks like
      // a bug until you know the day here starts when the sun is lowest.
      'Rows are calendar days; the slider’s day runs from solar midnight, so the small hours belong to the date before.',
    ].join(' ');
  }

  on('mg-close', 'click', close);
  on('mg-back', 'click', () => {
    gridMonth = shiftIsoMonth(gridMonth, -1);
    render();
  });
  on('mg-forward', 'click', () => {
    gridMonth = shiftIsoMonth(gridMonth, 1);
    render();
  });
  on('mg-body', 'click', (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-at]');
    if (!cell) return;
    ports.goTo(new Date(Number(cell.dataset.at)));
    close();
  });

  return { open, close };
}
