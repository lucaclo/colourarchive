/**
 * The presentation layer over the sun engine: the coloured bands behind the
 * time slider, the words for each phase, and clock formatting in the *scouted*
 * place's timezone rather than the reader's.
 *
 * Deliberately separate from `sun.ts`. That file is pure astronomy and should
 * stay that way — it has no opinion about what colour blue hour is, or whether
 * a photographer would rather read "18:42" than an ISO string.
 */

import { dayTrack, phaseForAltitude, sunTimes, type SunPhase, type SunSample } from './sun';

export const MINUTES_PER_DAY = 1440;

/** Palette for the slider track. Tuned to sit inside the archive's dark theme. */
export const PHASE_COLOUR: Record<SunPhase, string> = {
  night: '#0a0a0c',
  astronomical: '#12162b',
  nautical: '#1b2751',
  blue: '#2f5286',
  golden: '#c1863c',
  day: '#dcd7cb',
};

export const PHASE_LABEL: Record<SunPhase, string> = {
  night: 'Night',
  astronomical: 'Astronomical twilight',
  nautical: 'Nautical twilight',
  blue: 'Blue hour',
  golden: 'Golden hour',
  day: 'Daylight',
};

/** A run of consecutive minutes sharing one phase. */
export interface DaySegment {
  phase: SunPhase;
  /** Minutes from the start of the solar day, inclusive. */
  startMinute: number;
  /** Minutes from the start of the solar day, exclusive. */
  endMinute: number;
}

/**
 * Split a solar day into phase bands.
 *
 * Built by sampling rather than by solving for each threshold crossing. The
 * exact crossings are already available from `sunTimes` and that is what the
 * readout quotes; this is only ever painted onto a slider a few hundred pixels
 * wide, where a minute is a fraction of a pixel. Sampling also has no polar
 * special cases — a day with no sunrise is just a day whose samples never
 * change phase.
 */
export function daySegments(samples: SunSample[]): DaySegment[] {
  if (!samples.length) return [];
  const segments: DaySegment[] = [];
  let current: DaySegment = { phase: samples[0].phase, startMinute: 0, endMinute: 1 };

  for (let i = 1; i < samples.length; i++) {
    if (samples[i].phase === current.phase) {
      current.endMinute = i + 1;
      continue;
    }
    current.endMinute = i;
    segments.push(current);
    current = { phase: samples[i].phase, startMinute: i, endMinute: i + 1 };
  }
  segments.push(current);
  return segments;
}

/**
 * The segments as a CSS `linear-gradient(...)` with hard stops, so the track
 * reads as bands rather than a smear. Blue hour is eleven minutes long at some
 * latitudes; blurred into its neighbours it would disappear entirely.
 */
export function trackGradient(segments: DaySegment[], totalMinutes = MINUTES_PER_DAY): string {
  if (!segments.length) return PHASE_COLOUR.night;
  const stops = segments.flatMap((segment) => {
    const from = (segment.startMinute / totalMinutes) * 100;
    const to = (segment.endMinute / totalMinutes) * 100;
    const colour = PHASE_COLOUR[segment.phase];
    return [`${colour} ${from.toFixed(3)}%`, `${colour} ${to.toFixed(3)}%`];
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/* ── The track, as a continuous gradient ───────────────────────────────────── */

/**
 * The same palette, keyed on the sun's altitude instead of on a phase name.
 *
 * `PHASE_COLOUR` gives one colour per band, which is what banded stops need.
 * This places those colours at the altitude each band is *centred* on and
 * interpolates between them, so the track becomes what the sky actually is —
 * something that changes continuously — rather than six flat blocks with seams.
 */
const ALTITUDE_STOPS: Array<{ altitude: number; colour: string }> = [
  { altitude: -24, colour: PHASE_COLOUR.night },
  { altitude: -15, colour: PHASE_COLOUR.astronomical },
  { altitude: -9, colour: PHASE_COLOUR.nautical },
  { altitude: -5, colour: PHASE_COLOUR.blue },
  { altitude: 1, colour: PHASE_COLOUR.golden },
  { altitude: 12, colour: PHASE_COLOUR.day },
  { altitude: 90, colour: PHASE_COLOUR.day },
];

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const rgbToHex = (rgb: [number, number, number]) =>
  `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;

/** The track colour for a sun altitude, interpolated between the band centres. */
export function altitudeColour(altitude: number): string {
  const first = ALTITUDE_STOPS[0];
  const last = ALTITUDE_STOPS[ALTITUDE_STOPS.length - 1];
  if (altitude <= first.altitude) return first.colour;
  if (altitude >= last.altitude) return last.colour;
  for (let i = 1; i < ALTITUDE_STOPS.length; i++) {
    const a = ALTITUDE_STOPS[i - 1];
    const b = ALTITUDE_STOPS[i];
    if (altitude > b.altitude) continue;
    const t = (altitude - a.altitude) / (b.altitude - a.altitude);
    const from = hexToRgb(a.colour);
    const to = hexToRgb(b.colour);
    return rgbToHex([
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ]);
  }
  return last.colour;
}

/**
 * The day as one continuous gradient, sampled from the sun's own altitude.
 *
 * This replaces the banded track. The bands were chosen so that a short phase
 * could not be blurred away by its neighbours — blue hour is eleven minutes long
 * at some latitudes — and that worry was right about *stops* and wrong about
 * *sampling*. Interpolating between six fixed stops would indeed smear an
 * eleven-minute band into nothing. Sampling the real altitude does not: the
 * track passes through blue hour's colour exactly when the sun passes through
 * blue hour, however briefly, because the colour is a function of the sun and
 * not of a label.
 *
 * Sampled adaptively — every two minutes through twilight, where the light
 * changes fastest and the interesting bands are thin, and every quarter of an
 * hour through the middle of the day and the middle of the night, where nothing
 * happens. That keeps the string a few kilobytes rather than tens.
 */
export function skyTrackGradient(
  samples: Array<{ altitude: number }>,
  totalMinutes = MINUTES_PER_DAY,
): string {
  if (!samples.length) return PHASE_COLOUR.night;

  const stops: string[] = [];
  let index = 0;
  let previous = '';
  while (index < samples.length && index <= totalMinutes) {
    const colour = altitudeColour(samples[index].altitude);
    // Runs of one colour need only their two ends; the browser interpolates the
    // straight line between them for nothing.
    if (colour !== previous) {
      stops.push(`${colour} ${((index / totalMinutes) * 100).toFixed(3)}%`);
      previous = colour;
    }
    // Twilight is where a couple of degrees is the difference between blue hour
    // and night, so it is where the sampling has to be dense.
    const altitude = samples[index].altitude;
    index += Math.abs(altitude) < 14 ? 2 : 15;
  }

  const end = altitudeColour(samples[Math.min(samples.length - 1, totalMinutes)].altitude);
  stops.push(`${end} 100%`);
  if (stops.length < 2) return stops[0]?.split(' ')[0] ?? PHASE_COLOUR.night;
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/**
 * The shade mask laid over the phase track for one spot.
 *
 * Stacked on the day's own phase gradient rather than replacing it, because the
 * two facts are only useful together: knowing that golden hour runs 06:20–07:10
 * is worth little if your doorway is behind a tower until 08:40, and knowing the
 * doorway is shaded is worth little without knowing what light it is missing.
 * One bar, both answers, read at a glance.
 *
 * Only daytime shade is masked. Night is already dark on the track underneath,
 * and painting it again would say that a spot is in shadow at 3am — technically
 * true, and no use to anyone.
 */
export function shadeOverlayGradient(
  windows: Array<{ lit: boolean; belowHorizon: boolean; startMinute: number; endMinute: number }>,
  totalMinutes = MINUTES_PER_DAY,
  shade = 'rgba(9,13,24,0.74)',
): string {
  const shaded = windows.filter((w) => !w.lit && !w.belowHorizon);
  if (!shaded.length) return 'linear-gradient(to right, transparent, transparent)';
  const stops: string[] = [];
  let cursor = 0;
  for (const window of shaded) {
    const from = (window.startMinute / totalMinutes) * 100;
    const to = (Math.min(window.endMinute, totalMinutes) / totalMinutes) * 100;
    if (from > cursor) stops.push(`transparent ${cursor.toFixed(3)}%`, `transparent ${from.toFixed(3)}%`);
    stops.push(`${shade} ${from.toFixed(3)}%`, `${shade} ${to.toFixed(3)}%`);
    cursor = to;
  }
  if (cursor < 100) stops.push(`transparent ${cursor.toFixed(3)}%`, 'transparent 100%');
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/* ── Formatting ────────────────────────────────────────────────────────────── */

/**
 * Clock time where the *photograph* is, not where the reader is.
 *
 * Scouting Tokyo from London and being shown 12:47 for a Tokyo sunset would be
 * worse than useless. The zone travels with the place from the geocoder as an
 * IANA name, so DST is `Intl`'s problem rather than ours.
 */
export function formatClock(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    }).format(date);
  } catch {
    // An unknown zone must not take the whole readout down with it.
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }).format(date);
  }
}

/** "GMT+9" — shown once, so a time is never ambiguous about whose clock it is. */
export function formatZoneAbbreviation(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/* ── The day's events, as a list ───────────────────────────────────────────── */

export type SunEventIcon =
  | 'firstlight'
  | 'blue'
  | 'sunrise'
  | 'golden'
  | 'noon'
  | 'sunset'
  | 'lastlight';

export interface SunEventRow {
  key: string;
  label: string;
  icon: SunEventIcon;
  /** The instant, or the start of the window. Null when the day has no such event. */
  start: Date | null;
  /** Set only for the windows — golden and blue hour. */
  end?: Date | null;
}

/**
 * The day in the order it happens.
 *
 * Golden and blue hour arrive from the engine as *arrays*, because at high
 * latitudes they are not a tidy morning-and-evening pair — under the midnight
 * sun the golden band is crossed around midnight, and in deep winter the sun can
 * spend the entire day inside it. So the windows are placed by which side of
 * solar noon they fall on rather than by their index, and a day that only has
 * one of them lists only one. A row with no time is still listed, with nothing
 * against it: "no sunrise today" is an answer, and dropping the row silently
 * would leave the reader to notice an absence.
 */
export function sunEventRows(times: ReturnType<typeof sunTimes>): SunEventRow[] {
  const noon = times.solarNoon.getTime();
  const before = (windows: Array<{ start: Date; end: Date }>) =>
    windows.find((w) => w.end.getTime() <= noon) ??
    windows.find((w) => w.start.getTime() < noon) ??
    null;
  const after = (windows: Array<{ start: Date; end: Date }>) =>
    windows.find((w) => w.start.getTime() >= noon) ??
    windows.filter((w) => w.end.getTime() > noon).pop() ??
    null;

  const morningGolden = before(times.goldenHour);
  const eveningGolden = after(times.goldenHour);
  const morningBlue = before(times.blueHour);
  const eveningBlue = after(times.blueHour);

  // The evening window must not repeat the morning one when the day has only a
  // single unbroken band — Tromsø in July has exactly that.
  const distinct = <T extends { start: Date }>(a: T | null, b: T | null) =>
    a && b && a.start.getTime() === b.start.getTime() ? null : b;

  return [
    { key: 'civilDawn', label: 'First light', icon: 'firstlight', start: times.civilDawn },
    {
      key: 'blueMorning',
      label: 'Blue hour',
      icon: 'blue',
      start: morningBlue?.start ?? null,
      end: morningBlue?.end ?? null,
    },
    { key: 'sunrise', label: 'Sunrise', icon: 'sunrise', start: times.sunrise },
    {
      key: 'goldenMorning',
      label: 'Golden hour',
      icon: 'golden',
      start: morningGolden?.start ?? null,
      end: morningGolden?.end ?? null,
    },
    { key: 'solarNoon', label: 'Solar noon', icon: 'noon', start: times.solarNoon },
    {
      key: 'goldenEvening',
      label: 'Golden hour',
      icon: 'golden',
      start: distinct(morningGolden, eveningGolden)?.start ?? null,
      end: distinct(morningGolden, eveningGolden)?.end ?? null,
    },
    { key: 'sunset', label: 'Sunset', icon: 'sunset', start: times.sunset },
    {
      key: 'blueEvening',
      label: 'Blue hour',
      icon: 'blue',
      start: distinct(morningBlue, eveningBlue)?.start ?? null,
      end: distinct(morningBlue, eveningBlue)?.end ?? null,
    },
    { key: 'civilDusk', label: 'Last light', icon: 'lastlight', start: times.civilDusk },
  ];
}

/**
 * The twilight bands, for when the summary rows are not enough.
 *
 * Kept apart from `sunEventRows` because they answer a different question. The
 * main list is about the light you photograph in; this is about the light you
 * can still see by — nautical twilight is when the horizon goes, astronomical is
 * when the last of the sky does and the stars come out properly. Worth having
 * for anyone shooting the night, and clutter for anyone who is not, so the panel
 * folds it away.
 */
export function twilightRows(times: ReturnType<typeof sunTimes>): SunEventRow[] {
  return [
    {
      key: 'astronomicalDawn',
      label: 'Astronomical dawn',
      icon: 'firstlight',
      start: times.astronomicalDawn,
    },
    { key: 'nauticalDawn', label: 'Nautical dawn', icon: 'firstlight', start: times.nauticalDawn },
    { key: 'nauticalDusk', label: 'Nautical dusk', icon: 'lastlight', start: times.nauticalDusk },
    {
      key: 'astronomicalDusk',
      label: 'Astronomical dusk',
      icon: 'lastlight',
      start: times.astronomicalDusk,
    },
  ];
}

/* ── Numbers a photographer reads ──────────────────────────────────────────── */

/**
 * Shadow length as a ratio, the way sun apps quote it: `1 : 2.4` means a metre
 * of height throws 2.4 metres of shadow.
 *
 * Capped at 1:99 rather than printing the six-figure numbers cot() produces
 * within a whisker of the horizon. At that point the honest statement is "very
 * long indeed", and four significant figures of it would be false precision
 * about a shadow that is mostly blocked by something long before it gets there.
 */
export function formatShadowRatio(altitude: number): string {
  if (!(altitude > 0)) return '—';
  const ratio = 1 / Math.tan(altitude * (Math.PI / 180));
  if (!Number.isFinite(ratio) || ratio > 99) return '1 : 99+';
  return `1 : ${ratio < 10 ? ratio.toFixed(2) : ratio.toFixed(1)}`;
}

/** A minute index into the day, as a clock time where the place is. */
export function formatMinute(dayStart: Date, minute: number, timeZone: string): string {
  return formatClock(new Date(dayStart.getTime() + minute * 60_000), timeZone);
}

interface LitWindow {
  lit: boolean;
  startMinute: number;
  endMinute: number;
  belowHorizon: boolean;
}

/**
 * The spot's day in one sentence: *06:41–09:12 and 16:30–19:44 · 5 h 45 m*.
 *
 * This is the sentence the whole shadow machinery exists to produce. An overlay
 * shows you where the shade is now; only this says when the light arrives, which
 * is what decides whether it is worth walking there. Three runs at most, because
 * a spot that flickers in and out behind a colonnade has a dozen and listing
 * them all says less than counting them.
 */
export function describeLightWindows(
  windows: LitWindow[],
  dayStart: Date,
  timeZone: string,
): string {
  const lit = windows.filter((w) => w.lit);
  if (!lit.length) return 'No direct sun here today.';

  const total = lit.reduce((sum, w) => sum + (w.endMinute - w.startMinute), 0);
  const clock = (minute: number) => formatMinute(dayStart, minute, timeZone);

  if (lit.length > 3) {
    return `Sun in ${lit.length} spells, ${formatDuration(total)} in all — first ${clock(
      lit[0].startMinute,
    )}, last ends ${clock(lit[lit.length - 1].endMinute)}.`;
  }

  const runs = lit.map((w) => `${clock(w.startMinute)}–${clock(w.endMinute)}`);
  const joined =
    runs.length === 1 ? runs[0] : `${runs.slice(0, -1).join(', ')} and ${runs[runs.length - 1]}`;
  return `Direct sun ${joined} · ${formatDuration(total)} in all.`;
}

/**
 * What happens next here, and how long you have: *lit in 24 m, at 18:40*.
 *
 * The countdown rather than the clock time is what turns the timeline into a
 * decision you can make standing in the street with a camera on your shoulder.
 */
export function describeNextChange(
  change: { lit: boolean; atMinute: number; inMinutes: number } | null,
  dayStart: Date,
  timeZone: string,
): string {
  if (!change) return '';
  const when = formatMinute(dayStart, change.atMinute, timeZone);
  if (change.inMinutes <= 0) return '';
  return `${change.lit ? 'Lit' : 'In shadow'} in ${formatDuration(change.inMinutes)}, at ${when}.`;
}

/* ── Dates, where the place is ─────────────────────────────────────────────── */

/** How far `timeZone` is ahead of UTC at `instant`, in minutes. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    // Intl gives 24 for midnight in some engines; Date.UTC handles the rollover.
    const asIfUTC = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    return Math.round((asIfUTC - instant.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/**
 * The calendar date at a place, as `YYYY-MM-DD`.
 *
 * The date input has to show the date *there*. Scouting Sydney from London at
 * 23:00 and being offered yesterday would silently plan the wrong day, which is
 * the same class of mistake the timezone-aware clock exists to prevent.
 */
export function isoDateIn(instant: Date, timeZone: string): string {
  const offset = zoneOffsetMinutes(instant, timeZone);
  return new Date(instant.getTime() + offset * 60_000).toISOString().slice(0, 10);
}

/**
 * Midday at a place on a given calendar date, as a UTC instant.
 *
 * Midday rather than midnight because it is the one hour of the day that is
 * unambiguously inside its own date — no timezone is offset enough, and no DST
 * jump large enough, to push noon over a date boundary. Feeding that instant to
 * the sun engine picks out the solar day a person means when they choose a date
 * on a calendar.
 *
 * Two passes: guess at UTC noon, correct by the offset, then correct again in
 * case the first correction landed the other side of a DST change.
 */
export function zonedNoon(isoDate: string, timeZone: string): Date {
  const base = Date.parse(`${isoDate}T12:00:00Z`);
  if (!Number.isFinite(base)) return new Date(NaN);
  let instant = new Date(base);
  for (let pass = 0; pass < 2; pass++) {
    const offset = zoneOffsetMinutes(instant, timeZone);
    const corrected = new Date(base - offset * 60_000);
    if (corrected.getTime() === instant.getTime()) break;
    instant = corrected;
  }
  return instant;
}

/** The same calendar date shifted by whole days, staying a valid `YYYY-MM-DD`. */
export function shiftIsoDate(isoDate: string, days: number): string {
  const base = Date.parse(`${isoDate}T12:00:00Z`);
  if (!Number.isFinite(base)) return isoDate;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** "Fri 31 Jul" — a date a person reads rather than parses. */
export function formatDayLabel(isoDate: string, timeZone: string): string {
  const instant = zonedNoon(isoDate, timeZone);
  if (Number.isNaN(instant.getTime())) return isoDate;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone,
    }).format(instant);
  } catch {
    return isoDate;
  }
}

/** "2 h 14 m", "48 m" — a duration a person can act on. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} m`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} h ${rest} m` : `${hours} h`;
}

/* ── The day, assembled ────────────────────────────────────────────────────── */

export interface ScoutDay {
  samples: SunSample[];
  segments: DaySegment[];
  gradient: string;
  times: ReturnType<typeof sunTimes>;
  /** Milliseconds represented by one step of the slider. */
  dayStart: Date;
}

/**
 * Everything the slider and the map need for one day at one place, computed
 * once. The slider then scrubs an index into `samples` rather than recomputing
 * the sun on every pointer move — the whole day costs about as much as a single
 * position, and dragging has to stay free.
 */
export function scoutDay(latitude: number, longitude: number, date: Date): ScoutDay {
  const times = sunTimes(latitude, longitude, date);
  // One sample per minute, and one extra so the slider's last stop is the end
  // of the day rather than a minute short of it.
  const samples = dayTrack(latitude, longitude, date, {
    stepMinutes: 1,
    from: times.dayStart,
    to: new Date(times.dayStart.getTime() + MINUTES_PER_DAY * 60_000),
  });
  const segments = daySegments(samples.slice(0, MINUTES_PER_DAY));
  return {
    samples,
    segments,
    // Continuous, not banded. `trackGradient` is kept beside it because the
    // banded reading is still the honest one for a *segment list* — it is what
    // the phase label and the jump buttons are built from — but the bar itself
    // is a picture of the light, and the light does not step.
    gradient: skyTrackGradient(samples),
    times,
    dayStart: times.dayStart,
  };
}

/** The phase at a given altitude, named for a person. */
export const describePhase = (altitude: number): string => PHASE_LABEL[phaseForAltitude(altitude)];
