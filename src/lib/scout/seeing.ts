/**
 * Seeing and transparency — the two things a cloud forecast cannot say.
 *
 * "Seeing" is atmospheric turbulence: how much a star shimmers, and so how
 * much resolution a telescope or a long lens can actually deliver whatever
 * its optics promise. "Transparency" is haze and humidity attenuating the
 * sky's own brightness. Both are specialised derived products, distinct from
 * ordinary cloud cover, and Open-Meteo — everything else in Scout's weather —
 * does not publish either.
 *
 * 7Timer's ASTRO product does, free and keyless, which is the whole reason
 * this exists rather than staying an unmodelled gap like light pollution:
 * https://www.7timer.info/doc.php?lang=en §2.3.4. Three caveats worth being
 * plain about, because they are real limits on what this can honestly say:
 *
 *   - **~10 km grid.** Fine for "is this region's air steady tonight", not
 *     for choosing between two ridges a kilometre apart.
 *   - **Unpublished rate limits.** 7Timer documents no quota. Cached hard on
 *     the server side (see `seeing-client.ts`) so Scout is never the reason
 *     one gets hit.
 *   - **Three-day horizon, three-hour steps.** Past 72 hours from the model's
 *     own last run there is nothing to report, and `seeingAt` says so rather
 *     than extrapolating.
 *
 * Never a required dependency. Every function here returns null or throws
 * rather than guess, and the panel that reads this is built the same way —
 * see `page.ts`'s `renderSeeing`, which omits the line entirely rather than
 * blocking or erroring the rest of the astrophotography plan.
 */

const ENDPOINT = 'https://www.7timer.info/bin/api.pl';

/**
 * The URL for a coordinate's ASTRO forecast.
 *
 * Coordinates to three decimals, matching the precision 7Timer's own docs say
 * it honours (§2.2.3) — a fourth decimal would be rounded server-side anyway.
 */
export function seeingForecastUrl(lat: number, lon: number): URL {
  const url = new URL(ENDPOINT);
  url.searchParams.set('lon', lon.toFixed(3));
  url.searchParams.set('lat', lat.toFixed(3));
  url.searchParams.set('product', 'astro');
  url.searchParams.set('output', 'json');
  url.searchParams.set('unit', 'metric');
  // No altitude correction: Scout has no notion of "this pin is a mountain
  // top" independent of the terrain model, and guessing wrongly here would
  // bias every reading, not just widen its uncertainty.
  url.searchParams.set('ac', '0');
  url.searchParams.set('tzshift', '0');
  return url;
}

/**
 * One forecast entry: a moment, and how good the air is then.
 *
 * `seeing` and `transparency` are 7Timer's own 1–8 classes, kept as the
 * integers they arrived as rather than converted to a point estimate —
 * `describeSeeing`/`describeTransparency` hold the published band each class
 * means, and a class is what 7Timer is actually claiming to know.
 */
export interface SeeingPoint {
  /** Epoch millis, UTC. */
  atMs: number;
  /** 1 (<0.5″ FWHM) to 8 (>2.5″). Smaller is steadier air. */
  seeing: number;
  /** 1 (<0.3 mag/airmass) to 8 (>1 mag/airmass). Smaller is clearer air. */
  transparency: number;
}

export interface SeeingForecast {
  points: SeeingPoint[];
  fetchedAt: number;
}

/**
 * The seeing scale, 7Timer's own published bands, index 0 = class 1.
 * https://www.7timer.info/doc.php?lang=en §2.3.4.
 */
const SEEING_BAND = [
  '<0.5″',
  '0.5″–0.75″',
  '0.75″–1″',
  '1″–1.25″',
  '1.25″–1.5″',
  '1.5″–2″',
  '2″–2.5″',
  '>2.5″',
];

/** The transparency scale, magnitudes of extinction per air mass. */
const TRANSPARENCY_BAND = ['<0.3', '0.3–0.4', '0.4–0.5', '0.5–0.6', '0.6–0.7', '0.7–0.85', '0.85–1', '>1'];

/** "1″–1.25″ seeing" for a valid class, or "" for one 7Timer never sends. */
export function describeSeeing(value: number): string {
  const band = SEEING_BAND[value - 1];
  return band ? `${band} seeing` : '';
}

/** "0.4–0.5 mag/airmass transparency" for a valid class, or "" otherwise. */
export function describeTransparency(value: number): string {
  const band = TRANSPARENCY_BAND[value - 1];
  return band ? `${band} mag/airmass transparency` : '';
}

/** 7Timer's `init`, "YYYYMMDDHH" UTC, as the instant it names — or null. */
function parseInit(init: unknown): Date | null {
  if (typeof init !== 'string' || !/^\d{10}$/.test(init)) return null;
  const year = Number(init.slice(0, 4));
  const month = Number(init.slice(4, 6));
  const day = Number(init.slice(6, 8));
  const hour = Number(init.slice(8, 10));
  const at = Date.UTC(year, month - 1, day, hour);
  return Number.isFinite(at) ? new Date(at) : null;
}

/**
 * The forecast, from 7Timer's own JSON — or a forecast with no points, when
 * the response is not one this can trust.
 *
 * `init` missing or unparsable invalidates the whole response: every point's
 * time is `init + timepoint hours`, so a bad `init` is not a bad point, it is
 * every point silently mistimed. One bad entry inside an otherwise good
 * `dataseries`, on the other hand, costs only that entry — the same rule
 * `spots.ts` reads stored data by.
 */
export function parseSeeingForecast(json: unknown, fetchedAt: number): SeeingForecast {
  const empty: SeeingForecast = { points: [], fetchedAt };
  if (!json || typeof json !== 'object') return empty;
  const raw = json as Record<string, unknown>;

  const init = parseInit(raw.init);
  if (!init || !Array.isArray(raw.dataseries)) return empty;

  const points: SeeingPoint[] = [];
  for (const entry of raw.dataseries) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const timepoint = Number(e.timepoint);
    const seeing = Number(e.seeing);
    const transparency = Number(e.transparency);
    if (!Number.isFinite(timepoint) || timepoint < 0) continue;
    if (!Number.isInteger(seeing) || seeing < 1 || seeing > 8) continue;
    if (!Number.isInteger(transparency) || transparency < 1 || transparency > 8) continue;
    points.push({ atMs: init.getTime() + timepoint * 3_600_000, seeing, transparency });
  }
  return { points, fetchedAt };
}

/**
 * The forecast point nearest a target instant, or null when nothing is close
 * enough to trust.
 *
 * `toleranceHours` defaults to half the 3-hour step 7Timer publishes at, so
 * any instant genuinely inside the forecast's own 72-hour range lands within
 * tolerance of exactly one point, and an instant outside that range — the
 * date picker set five nights out, say — correctly finds nothing rather than
 * reporting a point three days away as though it applied to tonight.
 */
export function seeingAt(
  forecast: SeeingForecast | null,
  targetMs: number,
  toleranceHours = 1.5,
): SeeingPoint | null {
  if (!forecast?.points.length) return null;
  let best = forecast.points[0];
  let bestDiff = Math.abs(best.atMs - targetMs);
  for (const point of forecast.points.slice(1)) {
    const diff = Math.abs(point.atMs - targetMs);
    if (diff < bestDiff) {
      best = point;
      bestDiff = diff;
    }
  }
  return bestDiff <= toleranceHours * 3_600_000 ? best : null;
}

/** Whole sentence, for the panel — both bands, with the caveat stated plainly. */
export function describeSeeingPoint(point: SeeingPoint): string {
  return (
    `${describeSeeing(point.seeing)}, ${describeTransparency(point.transparency)} ` +
    `(7Timer, ~10 km grid).`
  );
}
