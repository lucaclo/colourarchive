/**
 * How many frames a time-lapse needs, and what that costs.
 *
 * A time-lapse clip is an edit decision — how long it plays and at what frame
 * rate — applied backwards to a shoot. The shoot itself only has two numbers
 * of its own: how far apart the shutter fires, and how many times it fires
 * before the edit has enough frames. Everything else here — the real time on
 * site, the card space, how many times faster the world runs in the clip —
 * follows from multiplying those two together, so there is nothing to fit and
 * nothing to measure. It is the same kind of pure arithmetic as the ND
 * calculator next to it in the panel, for the same reason: no dependency on
 * any other Scout subsystem, and nothing else needs to depend on this.
 *
 * What this deliberately does not do: know whether the interval is short
 * enough for the subject. Clouds want a few seconds between frames and stars
 * want minutes; that judgement is the photographer's, not this module's.
 */

/** The output frame rates worth offering. */
export const TIMELAPSE_FRAME_RATES = [24, 25, 30, 60];

/**
 * The shooting intervals worth offering, seconds — half a second for fast
 * cloud, ten minutes for a clip that spans a whole night's stars.
 */
export const TIMELAPSE_INTERVALS_S = [0.5, 1, 2, 3, 5, 10, 15, 30, 60, 120, 300, 600];

export interface TimelapseInput {
  /** How long the finished clip plays, seconds. */
  clipLengthSeconds: number;
  /** The clip's output frame rate, frames a second. */
  frameRateFps: number;
  /** How far apart the shutter fires while shooting, seconds. */
  intervalSeconds: number;
  /** How big one photo is, megabytes. */
  fileSizeMb: number;
}

export interface Timelapse {
  /** Frames the clip needs — and so, exposures the shoot needs. */
  photoCount: number;
  /** How long the shoot itself takes, real time, seconds. */
  shootDurationSeconds: number;
  /** All the photos together, megabytes. */
  storageMb: number;
  /** How many times faster the world moves in the clip than it did on site. */
  speedupFactor: number;
  /** Whole sentence, for the panel. */
  note: string;
}

/**
 * The shoot a given clip needs, and what it costs in time and card space.
 *
 * `photoCount` is rounded up rather than to the nearest frame — a time-lapse
 * one frame short of the requested length is a clip that does not do what it
 * was asked to, and the shutter cannot fire a fraction of a time to make up
 * the difference.
 */
export function timelapse(input: TimelapseInput): Timelapse {
  if (!(input.clipLengthSeconds > 0)) throw new RangeError('clipLengthSeconds must be greater than zero');
  if (!(input.frameRateFps > 0)) throw new RangeError('frameRateFps must be greater than zero');
  if (!(input.intervalSeconds > 0)) throw new RangeError('intervalSeconds must be greater than zero');
  if (!(input.fileSizeMb > 0)) throw new RangeError('fileSizeMb must be greater than zero');

  const photoCount = Math.ceil(input.clipLengthSeconds * input.frameRateFps);
  const shootDurationSeconds = photoCount * input.intervalSeconds;
  const storageMb = photoCount * input.fileSizeMb;
  const speedupFactor = input.intervalSeconds * input.frameRateFps;

  return {
    photoCount,
    shootDurationSeconds,
    storageMb,
    speedupFactor,
    note: describeTimelapse(photoCount, shootDurationSeconds, storageMb, speedupFactor),
  };
}

/** "3 h 20 min", "45 min", "90 s" — a shoot's real-world duration. */
export function formatDuration(seconds: number): string {
  const totalSeconds = Math.round(seconds);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** "1.2 GB", "480 MB" — never more precision than a card's own display has. */
export function formatStorage(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function describeTimelapse(
  photoCount: number,
  shootDurationSeconds: number,
  storageMb: number,
  speedupFactor: number,
): string {
  return (
    `${photoCount} photos over ${formatDuration(shootDurationSeconds)} on site, ` +
    `${formatStorage(storageMb)} of card. The clip runs ${Math.round(speedupFactor)}× real time.`
  );
}
