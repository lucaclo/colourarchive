/**
 * The sun's path as a ring in the sky.
 *
 * Flattening the day onto the ground — the polar plot this started as — throws
 * away the thing a photographer is actually judging: how *high* the sun gets,
 * and how steeply it comes down at the end of the day. Two places can share a
 * sunset bearing and have completely different evenings.
 *
 * So the path is placed where it belongs: on a dome of fixed radius centred on
 * the spot you are standing. Azimuth swings it round, altitude lifts it, and the
 * result is the tilted ring you see over a city — flat and high in midsummer,
 * steep and shallow in winter, and at a glance you know which.
 *
 * Pure geometry. The WebGL that draws it lives with the map.
 */

import { destination, type LatLon } from './geo';

export interface DomePoint {
  lon: number;
  lat: number;
  /** Metres above the ground at the centre. Negative below the horizon. */
  altitudeM: number;
  /** Carried through so the renderer can dim the part that is underground. */
  sunAltitude: number;
}

const RAD = Math.PI / 180;

/**
 * Where a given sun position sits on the dome.
 *
 * A point on a sphere of radius `radiusM`: the ground offset shrinks by
 * cos(altitude) as the sun climbs, so the ring stays a true circle rather than
 * a cylinder, and directly overhead lands at the centre rather than at the rim.
 */
export function domePosition(
  centre: LatLon,
  azimuth: number,
  sunAltitude: number,
  radiusM: number,
): DomePoint {
  const ground = radiusM * Math.cos(sunAltitude * RAD);
  const up = radiusM * Math.sin(sunAltitude * RAD);
  // A negative ground radius would fold the path through the centre; the sun
  // never gets past the zenith, but clamping costs nothing and is one less way
  // for a bad input to produce a silently wrong picture.
  const point = destination(centre, azimuth, Math.max(0, ground));
  return { lon: point.lon, lat: point.lat, altitudeM: up, sunAltitude };
}

/** The whole day's path, in order. */
export function domePath(
  centre: LatLon,
  samples: Array<{ azimuth: number; altitude: number }>,
  radiusM: number,
): DomePoint[] {
  return samples.map((s) => domePosition(centre, s.azimuth, s.altitude, radiusM));
}

/**
 * A sensible dome radius for the current view.
 *
 * Tied to the radius ring rather than to the zoom, so the arc keeps a constant
 * relationship to the area being scouted: big enough to read as a path across
 * the sky, small enough to stay on screen next to the buildings it explains.
 */
export function domeRadiusFor(scoutRadiusM: number): number {
  return Math.min(1200, Math.max(180, scoutRadiusM * 0.06));
}

/**
 * Hour marks along the path — only whole hours that are actually in the day,
 * and only while the sun is up, which is the part worth marking.
 */
export function hourMarks(
  centre: LatLon,
  samples: Array<{ azimuth: number; altitude: number; date: Date }>,
  radiusM: number,
  timeZone: string,
): Array<DomePoint & { hour: number }> {
  const marks: Array<DomePoint & { hour: number }> = [];
  let lastHour = -1;
  for (const sample of samples) {
    if (sample.altitude < 0) continue;
    let hour: number;
    try {
      hour = Number(
        new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone }).format(
          sample.date,
        ),
      );
    } catch {
      hour = sample.date.getUTCHours();
    }
    if (hour === lastHour) continue;
    lastHour = hour;
    marks.push({ ...domePosition(centre, sample.azimuth, sample.altitude, radiusM), hour });
  }
  return marks;
}

/**
 * How many samples to step between dots on the underground half of a path.
 *
 * The dotted half is notation, and notation only reads as a pattern if the
 * spacing is even. Taking every other sample makes the spacing depend on how
 * finely the day happened to be sampled — a summer day and a winter one, or the
 * sun and the moon, would come out with visibly different dots for no reason a
 * reader could act on. So the stride is derived from the ring angle a sample
 * covers rather than from the length of the array.
 *
 * `sampleCount` is how many samples span the whole circuit.
 */
export function dotStride(sampleCount: number, spacingDeg = 4.5): number {
  if (!Number.isFinite(sampleCount) || sampleCount < 2) return 1;
  const degreesPerSample = 360 / sampleCount;
  return Math.max(1, Math.round(spacingDeg / degreesPerSample));
}

/** Split a path into the parts above and below the horizon, for separate styling. */
export function splitAtHorizon(path: DomePoint[]): { above: DomePoint[][]; below: DomePoint[][] } {
  const above: DomePoint[][] = [];
  const below: DomePoint[][] = [];
  let run: DomePoint[] = [];
  let runIsAbove: boolean | null = null;

  const flush = () => {
    if (run.length > 1) (runIsAbove ? above : below).push(run);
    run = [];
  };

  for (const point of path) {
    const isAbove = point.sunAltitude >= 0;
    if (runIsAbove === null) runIsAbove = isAbove;
    if (isAbove !== runIsAbove) {
      // Repeat the boundary point so the two runs meet rather than leaving a gap.
      run.push(point);
      flush();
      runIsAbove = isAbove;
      run = [point];
      continue;
    }
    run.push(point);
  }
  flush();
  return { above, below };
}
