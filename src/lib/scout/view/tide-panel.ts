/**
 * The tide overlay in the panel — issue #71.
 *
 * Self-contained the way `gap-panel.ts` is: it owns the `#fold-tide` block
 * and everything in it, and `page.ts` only has to construct it with a few
 * ports and call `restate()` when the pin or the date changes.
 *
 * ## What decides whether this shows at all
 *
 * Three honest states, checked in order:
 *
 * 1. **This build cannot ask.** `ports.fetchTide` returns `null` in the
 *    published static export, which has no server to hold the WorldTides key
 *    and must never call a paid, keyed API straight from the browser —
 *    `tide-client.ts` is server-only for exactly that reason. The fold stays
 *    hidden, the same way `loadSeeing` in `page.ts` silently skips 7Timer
 *    there rather than making a request that can only fail.
 * 2. **No key configured.** The one state that stays *visible* regardless of
 *    where the pin is: `needsKey`-style honesty (the Flickr adapter's own
 *    precedent, `SpotSource.needsKey` in `sources/types.ts`) means a real
 *    blocker is reported, not hidden behind a gate this build cannot even
 *    evaluate. Whether the spot would have been coastal is unknowable
 *    without asking WorldTides, so this does not try to guess — it says
 *    plainly that the key is the thing standing in the way.
 * 3. **Not coastal.** Key present, station genuinely checked, nothing within
 *    `MAX_STATION_DISTANCE_KM` — the fold stays hidden. This is the ordinary
 *    case for the overwhelming majority of spots Scout is used for, and
 *    showing an empty tide panel for a mountain ridge would be exactly the
 *    clutter the coastal gate exists to avoid.
 *
 * Any other transient failure (a timed-out request, WorldTides answering an
 * error) also hides the fold rather than showing a message — the same
 * posture `loadAir`'s failure already takes for this page's other optional,
 * network-dependent rows: a garnish that could not be fetched is absent, not
 * broken.
 */

import { MINUTES_PER_DAY, formatClock } from '../daylight';
import type { LatLon } from '../geo';
import type { TideDayResult, TideStationResult } from '../tide-client';
import {
  extremesForDay,
  isCoastalDistance,
  tideEventRows,
  tideOverlayGradient,
  tideOverlayMinutes,
  tideWindows,
  type TideExtreme,
  type TideStation,
} from '../tide';
import { $ } from './dom';

export interface TideApiResponse {
  ok: boolean;
  station?: TideStationResult;
  day?: TideDayResult;
}

export interface TidePanelPorts {
  centre(): LatLon | null;
  isoDate(): string;
  /** The visible day's solar midnight — the same anchor `minuteFor` in
   *  `page.ts` reads times against. Null before a place is chosen. */
  dayStart(): Date | null;
  timeZone(): string;
  goTo(instant: Date): void;
  /** Null in a build with no server to ask — see this file's header. */
  fetchTide(lat: number, lon: number, isoDate: string): Promise<TideApiResponse | null>;
}

export interface TidePanel {
  /** Refetch and re-render — call when the pin or the date changes. */
  restate(): void;
}

export function createTidePanel(ports: TidePanelPorts): TidePanel {
  // Guards against a slow request for a place that has since been left —
  // the same shape `loadWeather`/`loadAir` in page.ts already use, just
  // local to this panel instead of a shared module-level `centre` check.
  let requestId = 0;

  const fold = () => $<HTMLDetailsElement>('fold-tide');
  const hide = () => {
    fold().hidden = true;
  };
  const show = () => {
    fold().hidden = false;
  };

  function renderKeyMissing() {
    show();
    $('tide-note').textContent =
      "Tide data needs a WorldTides API key (WORLDTIDES_API_KEY), which isn't configured for this deployment.";
    $('tide-events').replaceChildren();
    $<HTMLElement>('tide-strip').hidden = true;
  }

  function heightFor(extremes: TideExtreme[], at: Date): number | null {
    return extremes.find((e) => e.at.getTime() === at.getTime())?.heightM ?? null;
  }

  function renderRows(extremes: TideExtreme[], dayStart: Date | null) {
    const tz = ports.timeZone();
    $('tide-events').replaceChildren(
      ...tideEventRows(extremes).map((row) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';

        const label = document.createElement('span');
        label.className = 'ev-label';
        label.textContent = row.label;

        const when = document.createElement('span');
        when.className = 'ev-time';
        const heightM = heightFor(extremes, row.start);
        when.textContent = `${formatClock(row.start, tz)}${heightM != null ? ` · ${heightM.toFixed(1)} m` : ''}`;
        // Same dataset convention `renderEvents` in page.ts writes, so the
        // page's own `markCurrentEvent` pass — which queries `.events
        // .ev-time` document-wide — highlights whichever tide row the
        // slider is sitting in for free, with no second highlighter to keep
        // in sync.
        if (dayStart) {
          const minute = Math.round((row.start.getTime() - dayStart.getTime()) / 60_000);
          if (minute >= 0 && minute <= MINUTES_PER_DAY) {
            when.dataset.from = String(minute);
            when.dataset.to = String(minute);
          }
        }

        button.append(label, when);
        button.addEventListener('click', () => ports.goTo(row.start));
        li.append(button);
        return li;
      }),
    );
  }

  function renderStrip(extremes: TideExtreme[], dayStart: Date | null) {
    const strip = $<HTMLElement>('tide-strip');
    if (!dayStart || !extremes.length) {
      strip.hidden = true;
      return;
    }
    const ranges = tideOverlayMinutes(tideWindows(extremes), dayStart);
    strip.style.background = tideOverlayGradient(ranges);
    strip.hidden = false;
  }

  function renderCoastal(station: TideStation, extremes: TideExtreme[] | null, extra: string) {
    show();
    const km = station.distanceKm.toFixed(station.distanceKm < 10 ? 1 : 0);
    $('tide-note').textContent =
      `Nearest tide station: ${station.name}, ${km} km away — heights are relative to the station's own datum.` +
      (extra ? ` ${extra}` : '');

    const dayStart = ports.dayStart();
    if (!extremes) {
      $('tide-events').replaceChildren();
      $<HTMLElement>('tide-strip').hidden = true;
      return;
    }
    renderRows(extremes, dayStart);
    renderStrip(extremes, dayStart);
  }

  async function load() {
    const centre = ports.centre();
    if (!centre) {
      hide();
      return;
    }
    const isoDate = ports.isoDate();
    const id = ++requestId;

    let response: TideApiResponse | null;
    try {
      response = await ports.fetchTide(centre.lat, centre.lon, isoDate);
    } catch {
      response = null;
    }
    // A later call to `restate()` — a moved pin, a changed date — has already
    // started its own request. This one's answer no longer describes the
    // screen, so it must not paint over whatever that one finds.
    if (id !== requestId) return;

    if (!response?.ok || !response.station || !response.day) {
      hide();
      return;
    }
    const { station: stationResult, day: dayResult } = response;

    if (stationResult.status === 'no-key' || dayResult.status === 'no-key') {
      renderKeyMissing();
      return;
    }
    if (stationResult.status === 'error') {
      console.warn('[scout] tide station lookup failed:', stationResult.message);
      hide();
      return;
    }
    const station = stationResult.station;
    if (!station || !isCoastalDistance(station.distanceKm)) {
      hide();
      return;
    }

    if (dayResult.status === 'error') {
      console.warn('[scout] tide day fetch failed:', dayResult.message);
      renderCoastal(station, null, "This date's predictions could not be loaded.");
      return;
    }

    const dayStart = ports.dayStart();
    const restored = dayResult.extremes.map((e) => ({ ...e, at: new Date(e.at) }));
    const extremes = dayStart ? extremesForDay(restored, dayStart) : restored;
    renderCoastal(station, extremes, extremes.length ? '' : 'No high or low tide predicted for this date.');
  }

  return { restate: () => void load() };
}
