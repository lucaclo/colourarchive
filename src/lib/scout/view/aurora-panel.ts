/**
 * Aurora visibility, in the panel — issue #69.
 *
 * `aurora.ts` answers the question in the abstract: given a real-time Kp/Bz/
 * solar-wind reading and the sun, moon, cloud and light-pollution arrangement
 * at some instant, is this worth stepping outside for. This is where that
 * instant is always **now** — never the slider's minute or the date picker's
 * date, because a real-time reading has no honest answer for any other one
 * — and where the arrangement becomes the lines a reader actually sees.
 *
 * Self-contained: it owns the `#fold-aurora` block, the same contract
 * `gap-panel.ts` and `go-tonight-panel.ts` keep. It fetches on its own
 * (`restate()` triggers a fetch, deduplicated the way `loadSeeing` dedupes
 * in `page.ts`) rather than waiting on a button press, because unlike
 * `go-tonight`'s burst over every kept spot this is one small, cheap,
 * server-cached request — the same automatic-load shape `loadWeather` and
 * `loadSeeing` already use.
 *
 * **Why this needs no bearing, no frame, and barely needs the pin.** Every
 * other join on this page answers a question about a *direction* — which
 * way the camera points, which way the light falls. The aurora fills the
 * whole sky, so the only thing the pin contributes is its geomagnetic
 * latitude; there is no aim to be missing, and so — unlike `lighting.ts` —
 * no `aim-unknown` among the refusals.
 */

import {
  auroraReading,
  auroraStalenessNote,
  type AuroraArrangement,
  type NoAurora,
  type SpaceWeather,
} from '../aurora';
import { sunPosition } from '../sun';
import { moonPosition } from '../moon';
import { hourAt, type WeatherReport } from '../weather';
import type { LatLon } from '../geo';
import { $, on } from './dom';

export interface AuroraPanelPorts {
  centre(): LatLon | null;
  /** The atlas zone at the pin, or null when it has not loaded / there is no
   *  centre — the same optional refinement `renderCoreDay` reads in `page.ts`. */
  lightPollutionZone(): number | null;
  /** The live 7-day forecast at the pin. Always the live forecast, never a
   *  historical read — this reading is about right now regardless of what
   *  date the slider is showing, so it must not be handed whatever the page's
   *  own `weather` variable happens to hold for a past date. Network. */
  fetchWeather(): Promise<WeatherReport | null>;
  /** Kp/Bz/solar wind. Network, cached a few minutes server-side. */
  fetchSpaceWeather(): Promise<SpaceWeather | null>;
}

export interface AuroraPanel {
  /**
   * Bring the panel up to date with the current pin, fetching only what
   * actually needs it.
   *
   * Safe to call on every centre change — the way `gapPanel.restate()` and
   * `loadSeeing()` already are — because it dedupes internally: the local
   * forecast is refetched only when the coordinate has actually moved, and
   * the space-weather reading only when it has gone past its own short TTL,
   * the same key-and-clock guards `loadSeeing`'s own `seeingKey` keeps.
   */
  restate(): void;
}

const ABSENCE_TEXT: Record<NoAurora, string> = {
  'data-unavailable': "NOAA's space-weather feed did not answer — not the same as a quiet night.",
  'not-dark': 'Not dark enough here yet for this to mean anything.',
  'moon-up': 'The moon is up — it would wash out anything but a strong display.',
};

/** Under the server's own 5-minute cache TTL, so a proactive refetch here
 *  usually finds a warm cache rather than causing a second NOAA hit. */
const SPACE_WEATHER_REFRESH_MS = 4 * 60_000;

export function createAuroraPanel(ports: AuroraPanelPorts): AuroraPanel {
  let spaceWeather: SpaceWeather | null = null;
  let spaceWeatherAt = 0;
  let weather: WeatherReport | null = null;
  let weatherKey: string | null = null;
  let loading = false;
  let loadedOnce = false;

  const note = () => $<HTMLElement>('aurora-note');
  const line = () => $<HTMLElement>('aurora-line');
  const space = () => $<HTMLElement>('aurora-space');
  const stale = () => $<HTMLElement>('aurora-stale');

  function headline(arrangement: AuroraArrangement): string {
    const positionWord =
      arrangement.position === 'inside' ? 'inside the oval' : arrangement.position === 'near' ? 'near the oval' : 'outside the oval';
    const cloudWord =
      arrangement.cloud === 'unknown' ? 'cloud unknown' : arrangement.cloud === 'clear' ? 'clear' : arrangement.cloud === 'patchy' ? 'patchy cloud' : 'overcast';
    return `Kp ${arrangement.kp.toFixed(1)} · ${positionWord} · ${cloudWord}`;
  }

  function render() {
    const centre = ports.centre();
    if (!centre) {
      line().textContent = '—';
      note().textContent = 'Type a place, or drop a pin, to check this spot against the oval.';
      space().textContent = '';
      stale().textContent = '';
      return;
    }

    if (!loadedOnce) {
      line().textContent = '—';
      note().textContent = loading ? 'Checking NOAA…' : 'Not checked yet.';
      space().textContent = '';
      stale().textContent = '';
      return;
    }

    // Always "now" — see the module note on why this cannot honestly answer
    // for the slider's minute or the date picker's date.
    const now = new Date();
    const sun = sunPosition(centre.lat, centre.lon, now);
    const moon = moonPosition(centre.lat, centre.lon, now);
    const hour = weather ? hourAt(weather, now) : null;

    const reading = auroraReading({
      latitude: centre.lat,
      longitude: centre.lon,
      sunAltitudeDeg: sun.altitude,
      moonAltitudeDeg: moon.altitude,
      cloudCoverPct: hour?.cloudCover ?? null,
      lightPollutionZone: ports.lightPollutionZone(),
      spaceWeather,
    });

    if (!reading.arrangement) {
      line().textContent = '—';
      note().textContent = ABSENCE_TEXT[reading.absence!];
      space().textContent = '';
      stale().textContent = spaceWeather ? auroraStalenessNote(spaceWeather.kpAtMs, Date.now()) : '';
      return;
    }

    line().textContent = headline(reading.arrangement);
    note().textContent = reading.arrangement.note;
    space().textContent = reading.arrangement.spaceWeatherNote;
    stale().textContent = auroraStalenessNote(reading.arrangement.kpAtMs, Date.now());
  }

  async function load(force: boolean) {
    if (loading) return;
    const centre = ports.centre();
    if (!centre) return;
    const key = `${centre.lat.toFixed(3)},${centre.lon.toFixed(3)}`;
    const needsWeather = force || key !== weatherKey;
    const needsSpaceWeather = force || !spaceWeather || Date.now() - spaceWeatherAt > SPACE_WEATHER_REFRESH_MS;
    if (!needsWeather && !needsSpaceWeather) return;

    loading = true;
    render();
    try {
      const [sw, wx] = await Promise.all([
        needsSpaceWeather ? ports.fetchSpaceWeather() : Promise.resolve(spaceWeather),
        needsWeather ? ports.fetchWeather() : Promise.resolve(weather),
      ]);
      spaceWeather = sw;
      weather = wx;
      if (needsSpaceWeather) spaceWeatherAt = Date.now();
      if (needsWeather) weatherKey = key;
    } catch {
      spaceWeather = null;
      weather = null;
    }
    loading = false;
    loadedOnce = true;
    render();
  }

  function restate() {
    render();
    void load(false);
  }

  on('aurora-refresh', 'click', () => void load(true));

  return { restate };
}
