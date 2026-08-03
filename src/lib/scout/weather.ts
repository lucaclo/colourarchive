/**
 * Weather, and what it does to the light.
 *
 * Scout's original decision was to skip this entirely: the sun engine is pure
 * geometry, it works with the Wi-Fi off, and a forecast is the one thing on this
 * page that can be wrong in a way arithmetic cannot. That reasoning still holds,
 * and it is why the forecast is kept strictly to one side — nothing below feeds
 * back into where the sun is or where a shadow falls. Those stay geometry.
 *
 * What it does change is how much a shadow is worth *believing*. A cast shadow
 * computed for a moment with nine tenths cloud cover is a true statement about
 * the geometry and a false impression of the photograph: there will be no hard
 * shadow there, only a general grey. So the cloud figure travels with the
 * drawing and softens it, and the panel says which of the two you are looking
 * at. That is the honest way to have a forecast on a page like this — as a
 * qualifier on a claim, not as another claim.
 *
 * Open-Meteo, because it needs no key and no account, which keeps Scout's "every
 * source is keyless" property intact.
 *
 * Everything in this file is pure. The fetching and caching live in
 * `weather-client.ts`, server-side, for the same reasons the geocoder does.
 */

export type WeatherIcon =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunder';

export interface WeatherCondition {
  code: number;
  label: string;
  icon: WeatherIcon;
}

/**
 * WMO present-weather codes, as Open-Meteo reports them.
 *
 * The sparse ones matter: 0–3 is the whole cloud-cover story and is what the
 * panel shows nine days in ten.
 */
const CONDITIONS: Record<number, WeatherCondition> = {
  0: { code: 0, label: 'Clear', icon: 'clear' },
  1: { code: 1, label: 'Mainly clear', icon: 'clear' },
  2: { code: 2, label: 'Partly cloudy', icon: 'partly' },
  3: { code: 3, label: 'Overcast', icon: 'cloudy' },
  45: { code: 45, label: 'Fog', icon: 'fog' },
  48: { code: 48, label: 'Freezing fog', icon: 'fog' },
  51: { code: 51, label: 'Light drizzle', icon: 'drizzle' },
  53: { code: 53, label: 'Drizzle', icon: 'drizzle' },
  55: { code: 55, label: 'Heavy drizzle', icon: 'drizzle' },
  56: { code: 56, label: 'Freezing drizzle', icon: 'drizzle' },
  57: { code: 57, label: 'Freezing drizzle', icon: 'drizzle' },
  61: { code: 61, label: 'Light rain', icon: 'rain' },
  63: { code: 63, label: 'Rain', icon: 'rain' },
  65: { code: 65, label: 'Heavy rain', icon: 'rain' },
  66: { code: 66, label: 'Freezing rain', icon: 'rain' },
  67: { code: 67, label: 'Freezing rain', icon: 'rain' },
  71: { code: 71, label: 'Light snow', icon: 'snow' },
  73: { code: 73, label: 'Snow', icon: 'snow' },
  75: { code: 75, label: 'Heavy snow', icon: 'snow' },
  77: { code: 77, label: 'Snow grains', icon: 'snow' },
  80: { code: 80, label: 'Light showers', icon: 'rain' },
  81: { code: 81, label: 'Showers', icon: 'rain' },
  82: { code: 82, label: 'Violent showers', icon: 'rain' },
  85: { code: 85, label: 'Snow showers', icon: 'snow' },
  86: { code: 86, label: 'Snow showers', icon: 'snow' },
  95: { code: 95, label: 'Thunderstorm', icon: 'thunder' },
  96: { code: 96, label: 'Thunderstorm, hail', icon: 'thunder' },
  99: { code: 99, label: 'Thunderstorm, hail', icon: 'thunder' },
};

/**
 * A code's condition. Unknown codes come back named as unknown rather than
 * quietly rounded to the nearest one we recognise — a forecast that invents a
 * label is worse than one that admits the gap.
 */
export function weatherCondition(code: number | null | undefined): WeatherCondition {
  if (code == null || !Number.isFinite(code)) {
    return { code: -1, label: 'Not known', icon: 'cloudy' };
  }
  return CONDITIONS[code] ?? { code, label: `Code ${code}`, icon: 'cloudy' };
}

export interface WeatherHour {
  /** UTC instant, as milliseconds. */
  time: number;
  temperatureC: number | null;
  /** Percent, 0–100. Total sky obscured, all decks together. */
  cloudCover: number | null;
  /**
   * The three decks, each a percentage of sky, and each a different photograph.
   *
   * A single total is the one number the panel used to show and it collapses the
   * distinction that decides whether an evening is worth driving to. Low cloud —
   * stratus, the base of a front — sits between the sun and everything else and
   * takes the light out. High cloud — cirrus at five or six kilometres — is what
   * the light lands *on*, and it is the entire reason a sky goes red. Eighty
   * percent of each look identical in a total and are opposite skies.
   *
   * Open-Meteo's split follows the WMO convention: low below about 2 km, mid to
   * about 6 km, high above. The three overlap in the sense that a sky can be
   * fully covered at two levels at once, so they do not sum to `cloudCover`.
   */
  cloudLow: number | null;
  cloudMid: number | null;
  cloudHigh: number | null;
  precipitationChance: number | null;
  weatherCode: number | null;
  /** Metres. Open-Meteo only carries this in some model domains. */
  visibilityM: number | null;
}

export interface WeatherReport {
  latitude: number;
  longitude: number;
  /** When the forecast was fetched, so the UI can say how stale it is. */
  fetchedAt: number;
  current: WeatherHour | null;
  hours: WeatherHour[];
}

/**
 * The forecast hour covering an instant.
 *
 * Nearest hour rather than the one before, because the slider lands anywhere
 * and 13:58 is much better described by the 14:00 row than by the 13:00 one.
 * Returns null past the end of the forecast rather than clamping to the last
 * hour — a week out, "no forecast" is the truth and "the same as Sunday" is not.
 */
export function hourAt(report: WeatherReport, instant: Date | number): WeatherHour | null {
  const time = typeof instant === 'number' ? instant : instant.getTime();
  if (!report.hours.length) return null;
  const HOUR = 3_600_000;
  let best: WeatherHour | null = null;
  let bestGap = Infinity;
  for (const hour of report.hours) {
    const gap = Math.abs(hour.time - time);
    if (gap < bestGap) {
      bestGap = gap;
      best = hour;
    }
  }
  return bestGap <= HOUR ? best : null;
}

/* ── What it means for the light ───────────────────────────────────────────── */

/**
 * How much of the sun's own hard light survives the cloud, 0–1.
 *
 * Not linear in cover, because cloud does not work that way: a quarter sky of
 * scattered cumulus still gives full sun most of the time, while the last stretch
 * from broken to solid is where hard shadows actually disappear. The curve is
 * shaped to that — flat at the top, steep at the end.
 *
 * This is what scales the cast shadows on the map. It never moves them.
 */
export function directLightFraction(cloudCover: number | null | undefined): number {
  if (cloudCover == null || !Number.isFinite(cloudCover)) return 1;
  const cover = Math.min(100, Math.max(0, cloudCover)) / 100;
  return Math.max(0, Math.min(1, 1 - cover ** 2.2));
}

/**
 * The light, in the words a photographer would use.
 *
 * Deliberately about contrast rather than about comfort: what a scout needs to
 * know from a cloud figure is whether there will be an edge to the shadow.
 */
export function lightQuality(
  cloudCover: number | null | undefined,
  sunAltitude: number,
): string {
  if (sunAltitude <= -0.833) return 'No direct light — the sun is down.';
  if (cloudCover == null || !Number.isFinite(cloudCover)) return 'Cloud cover unknown.';
  const cover = Math.min(100, Math.max(0, cloudCover));
  if (cover < 12) return 'Hard light. Shadows will have a clean edge.';
  if (cover < 35) return 'Mostly sun, with cloud passing. The light will come and go.';
  if (cover < 65) return 'Broken cloud. Shadows soft-edged and intermittent.';
  if (cover < 88) return 'Mostly cloud. Expect weak shadows at best.';
  return 'Flat overcast. The shadows below are geometry, not what you will see.';
}

/* ── The three decks ───────────────────────────────────────────────────────── */

/**
 * The deck that decides whether there is a hard shadow, as a percentage.
 *
 * Low and mid cloud are opaque to the sun's disc; high cirrus is not, or barely.
 * A sky under thin cirrus still throws shadows with an edge, and reading the
 * *total* there says it will not. Low and mid are combined as independent
 * overlapping cover rather than added, because 60% low and 60% mid is not 120%
 * of a sky — it is 84% of one.
 *
 * Returns null when the split is unavailable, so callers can fall back to the
 * total rather than silently treating a missing deck as a clear one.
 */
export function blockingCover(hour: WeatherHour | null | undefined): number | null {
  if (!hour) return null;
  const low = hour.cloudLow;
  const mid = hour.cloudMid;
  if (low == null && mid == null) return null;
  const l = Math.min(100, Math.max(0, low ?? 0)) / 100;
  const m = Math.min(100, Math.max(0, mid ?? 0)) / 100;
  return (1 - (1 - l) * (1 - m)) * 100;
}

/**
 * `directLightFraction`, reading the deck split where the forecast carries it.
 *
 * This is what should scale a drawn shadow. The plain total is kept for the
 * cases that only have one — an older cached report, a model domain without the
 * split — and the two agree whenever the sky is single-decked.
 */
export function directLightFractionFor(hour: WeatherHour | null | undefined): number {
  if (!hour) return 1;
  return directLightFraction(blockingCover(hour) ?? hour.cloudCover);
}

/** Which deck dominates, when one does. */
export type Deck = 'low' | 'mid' | 'high';

export interface CloudStructure {
  low: number | null;
  mid: number | null;
  high: number | null;
  /** Low and mid combined — what stands between the sun and the ground. */
  blocking: number | null;
  /** The deck with the most sky, or null when they are level or unknown. */
  dominant: Deck | null;
  /** Whole sentence naming what is where. Empty when nothing was measured. */
  note: string;
}

const DECK_WORD: Record<Deck, string> = {
  low: 'Low cloud',
  mid: 'Mid-level cloud',
  high: 'High cloud',
};

/**
 * The sky, deck by deck, in a sentence that says what each one does.
 *
 * Written to be readable next to the total rather than instead of it: the number
 * a scout acts on is which layer is thick, and the sentence names the layer and
 * its consequence rather than scoring the sky.
 */
export function cloudStructure(hour: WeatherHour | null | undefined): CloudStructure {
  const low = hour?.cloudLow ?? null;
  const mid = hour?.cloudMid ?? null;
  const high = hour?.cloudHigh ?? null;
  const blocking = blockingCover(hour ?? null);
  if (low == null && mid == null && high == null) {
    return { low, mid, high, blocking, dominant: null, note: '' };
  }

  const decks: Array<[Deck, number]> = [];
  if (low != null) decks.push(['low', low]);
  if (mid != null) decks.push(['mid', mid]);
  if (high != null) decks.push(['high', high]);
  decks.sort((a, b) => b[1] - a[1]);
  const [topDeck, topCover] = decks[0];
  // A deck only counts as dominant if it is clearly ahead — two decks within
  // ten points of each other is a layered sky, and naming one of them is a
  // claim the numbers do not make.
  const dominant =
    topCover >= 10 && (decks.length === 1 || topCover - decks[1][1] >= 10) ? topDeck : null;

  const parts = decks.map(([deck, cover]) => `${DECK_WORD[deck].toLowerCase()} ${Math.round(cover)}%`);
  let consequence = '';
  if (dominant === 'high' && (blocking ?? 0) < 30) {
    consequence = ' Cirrus over a clear sun — shadows keep their edge, and there is something up there to take colour.';
  } else if (dominant === 'low') {
    consequence = ' The sun is behind the lowest deck. Flat light, whatever the total says.';
  } else if ((blocking ?? 0) >= 70) {
    consequence = ' Enough low and mid cloud to take the direct sun out.';
  } else if ((blocking ?? 100) < 20) {
    consequence = ' Nothing much between the sun and the ground.';
  }
  const head = parts.join(', ').replace(/^./, (c) => c.toUpperCase());
  return { low, mid, high, blocking, dominant, note: `${head}.${consequence}` };
}

/* ── The light at the horizon ──────────────────────────────────────────────── */

/**
 * Effective earth radius, metres — the 7/6 allowance for refraction, same as the
 * terrain horizon uses. Duplicated rather than imported so this file stays free
 * of the elevation machinery; the constant is the standard one and does not
 * drift.
 */
const EFFECTIVE_EARTH_RADIUS_M = (7 / 6) * 6_371_008.8;

/** Typical cirrus base at mid-latitudes, metres. */
export const HIGH_CLOUD_BASE_M = 6000;

/**
 * How far away the sky is that decides your sunset.
 *
 * At the moment the sun sets *for you*, the light reaching the cloud above your
 * head left the sun travelling nearly horizontally and passed low over the
 * ground a long way in the sun's direction. That distance is not a matter of
 * taste: for a deck at height h it is the tangent length √(2·R·h), which for
 * cirrus at six kilometres is very nearly three hundred kilometres.
 *
 * This is why a forecast *for where you are standing* cannot answer whether the
 * sunset will have colour. The sky at your feet is not the sky the light came
 * through, and asking the only place you thought to ask is how you end up with a
 * clear evening and a grey horizon.
 */
export function horizonSampleDistanceM(cloudBaseM = HIGH_CLOUD_BASE_M): number {
  if (!(cloudBaseM > 0)) throw new RangeError('cloudBaseM must be greater than zero');
  return Math.sqrt(2 * EFFECTIVE_EARTH_RADIUS_M * cloudBaseM);
}

/**
 * Above this much low-and-mid cloud on the sun's horizon, the light does not get
 * out. A threshold on a measured quantity, and the reading always quotes the
 * quantity beside it so it can be disagreed with.
 */
export const HORIZON_BLOCKED_PCT = 65;

/** Below this much mid-and-high cloud overhead, there is nothing for the light to land on. */
export const CANVAS_BARE_PCT = 12;

export type HorizonVerdict =
  /** Cloud on the sun's own horizon: the light never leaves. */
  | 'blocked'
  /** Horizon open, but no cloud overhead to catch it. Clean, and plain. */
  | 'bare'
  /** Horizon open and cloud overhead. The arrangement colour needs. */
  | 'lit'
  /** One of the two samples is missing. */
  | 'unknown';

export interface HorizonReading {
  verdict: HorizonVerdict;
  /** Low + mid cover at the far sample, percent — the gate the light passes. */
  gateCover: number | null;
  /** Mid + high cover overhead, percent — the surface the light would land on. */
  canvasCover: number | null;
  /** Where the far sample was taken. */
  bearing: number;
  distanceM: number;
  note: string;
}

const overlap = (a: number | null, b: number | null): number | null => {
  if (a == null && b == null) return null;
  const x = Math.min(100, Math.max(0, a ?? 0)) / 100;
  const y = Math.min(100, Math.max(0, b ?? 0)) / 100;
  return (1 - (1 - x) * (1 - y)) * 100;
};

/**
 * Whether the light will reach the sky above you, and whether there is anything
 * up there to take it.
 *
 * Two measurements and no score. Every app that sells a sunset forecast reduces
 * this to a number out of a hundred, and that number is not reproducible from
 * anything the user can see — it is a model's opinion wearing a percentage. What
 * *is* reproducible is the arrangement: cloud on the sun's horizon three hundred
 * kilometres away, and cloud overhead. Both come straight off the forecast, both
 * are quoted, and the verdict is only a name for their combination.
 *
 * `gate` is the forecast hour at the far sample, `canvas` the hour overhead.
 */
export function horizonReading(
  gate: WeatherHour | null,
  canvas: WeatherHour | null,
  bearing: number,
  distanceM: number,
): HorizonReading {
  const gateCover = overlap(gate?.cloudLow ?? null, gate?.cloudMid ?? null);
  const canvasCover = overlap(canvas?.cloudMid ?? null, canvas?.cloudHigh ?? null);
  const where = `${compassEighth(bearing)}, ${Math.round(distanceM / 1000)} km out`;

  if (gateCover == null || canvasCover == null) {
    return {
      verdict: 'unknown',
      gateCover,
      canvasCover,
      bearing,
      distanceM,
      note: 'No cloud-layer forecast for one of the two samples, so this stays unanswered.',
    };
  }

  if (gateCover >= HORIZON_BLOCKED_PCT) {
    return {
      verdict: 'blocked',
      gateCover,
      canvasCover,
      bearing,
      distanceM,
      note: `${Math.round(gateCover)}% low and mid cloud on the sun's own horizon (${where}). The light is unlikely to get out from under it, however clear it is overhead.`,
    };
  }

  if (canvasCover < CANVAS_BARE_PCT) {
    return {
      verdict: 'bare',
      gateCover,
      canvasCover,
      bearing,
      distanceM,
      note: `Horizon open — ${Math.round(gateCover)}% low and mid cloud ${where} — but only ${Math.round(canvasCover)}% mid and high cloud overhead. Clean light, nothing for it to land on.`,
    };
  }

  return {
    verdict: 'lit',
    gateCover,
    canvasCover,
    bearing,
    distanceM,
    note: `Horizon open (${Math.round(gateCover)}% low and mid cloud ${where}) with ${Math.round(canvasCover)}% mid and high cloud overhead. That is the arrangement colour comes from — it is not a promise of one.`,
  };
}

const EIGHTHS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Eight-point compass name — coarse on purpose, for a sample this far out. */
export const compassEighth = (bearing: number): string =>
  EIGHTHS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];

/** "18°C · 42% cloud" — the one-line summary beside the condition. */
export function summariseHour(hour: WeatherHour | null): string {
  if (!hour) return '';
  const parts: string[] = [];
  if (hour.temperatureC != null) parts.push(`${Math.round(hour.temperatureC)}°C`);
  if (hour.cloudCover != null) parts.push(`${Math.round(hour.cloudCover)}% cloud`);
  if (hour.precipitationChance != null && hour.precipitationChance >= 20) {
    parts.push(`${Math.round(hour.precipitationChance)}% rain`);
  }
  return parts.join(' · ');
}

/**
 * How old the forecast is, in words, or empty while it is still fresh.
 *
 * A forecast is the only thing on this page with a shelf life. Once it is a few
 * hours old it should say so rather than sit there looking as authoritative as
 * the arithmetic beside it.
 */
export function stalenessNote(fetchedAt: number, now: number): string {
  const minutes = Math.floor((now - fetchedAt) / 60_000);
  if (minutes < 90) return '';
  if (minutes < 60 * 24) return `forecast ${Math.round(minutes / 60)} h old`;
  return `forecast ${Math.round(minutes / (60 * 24))} d old`;
}

/* ── Parsing ───────────────────────────────────────────────────────────────── */

interface OpenMeteoResponse {
  latitude?: number;
  longitude?: number;
  current?: Record<string, unknown>;
  hourly?: Record<string, unknown>;
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Open-Meteo hands back times as `2026-07-31T14:00` in the zone we asked for. */
const parseUtc = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const stamp = Date.parse(/[Zz]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(stamp) ? stamp : null;
};

/**
 * Turn a response into a report, dropping anything malformed.
 *
 * Written defensively on purpose. This is the only data in Scout that comes from
 * a third party at request time, and a forecast that arrives half-shaped should
 * cost the weather row, not the page.
 */
export function parseForecast(body: unknown, fetchedAt: number): WeatherReport {
  const data = (body ?? {}) as OpenMeteoResponse;
  const hourly = data.hourly ?? {};
  const times = Array.isArray(hourly.time) ? (hourly.time as unknown[]) : [];
  const column = (name: string): unknown[] =>
    Array.isArray(hourly[name]) ? (hourly[name] as unknown[]) : [];

  const temperature = column('temperature_2m');
  const cloud = column('cloud_cover');
  const low = column('cloud_cover_low');
  const mid = column('cloud_cover_mid');
  const high = column('cloud_cover_high');
  const precipitation = column('precipitation_probability');
  const codes = column('weather_code');
  const visibility = column('visibility');

  const hours: WeatherHour[] = [];
  for (let i = 0; i < times.length; i++) {
    const time = parseUtc(times[i]);
    if (time == null) continue;
    hours.push({
      time,
      temperatureC: numberOrNull(temperature[i]),
      cloudCover: numberOrNull(cloud[i]),
      cloudLow: numberOrNull(low[i]),
      cloudMid: numberOrNull(mid[i]),
      cloudHigh: numberOrNull(high[i]),
      precipitationChance: numberOrNull(precipitation[i]),
      weatherCode: numberOrNull(codes[i]),
      visibilityM: numberOrNull(visibility[i]),
    });
  }

  const currentRaw = data.current ?? {};
  const currentTime = parseUtc(currentRaw.time);
  const current: WeatherHour | null =
    currentTime == null
      ? null
      : {
          time: currentTime,
          temperatureC: numberOrNull(currentRaw.temperature_2m),
          cloudCover: numberOrNull(currentRaw.cloud_cover),
          cloudLow: numberOrNull(currentRaw.cloud_cover_low),
          cloudMid: numberOrNull(currentRaw.cloud_cover_mid),
          cloudHigh: numberOrNull(currentRaw.cloud_cover_high),
          precipitationChance: null,
          weatherCode: numberOrNull(currentRaw.weather_code),
          visibilityM: null,
        };

  return {
    latitude: numberOrNull(data.latitude) ?? 0,
    longitude: numberOrNull(data.longitude) ?? 0,
    fetchedAt,
    current,
    hours,
  };
}
