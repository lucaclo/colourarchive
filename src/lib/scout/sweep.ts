/**
 * Which instants a light-sweep export renders — issue #65.
 *
 * The dome layer and the Play scrubber already draw every instant of a day;
 * exporting one is not a new rendering question, only a scheduling one:
 * *which* instants, in *what* order, to drive the existing draw loop through
 * while something outside it captures each frame. This module answers only
 * that — the capture and encoding are the browser's job, in the view layer,
 * because canvas capture and `MediaRecorder` are DOM APIs this file has no
 * business knowing about.
 *
 * Two spans, not two mechanisms: a day is `dayStart` to `dayStart + 1440
 * minutes`, the same domain the slider already covers end to end. A
 * solstice-to-solstice run is the same idea at the season's own timescale —
 * the two solstices bracketing today, so the run always shows a real half
 * of the year's actual swing rather than an arbitrary window.
 *
 * Pure. No canvas, no MediaRecorder, no clock of its own.
 */

import { bracketingSolstices } from './almanac';

const MINUTES_PER_DAY = 1440;
const DAY_MS = MINUTES_PER_DAY * 60_000;

/** Output frame rates worth offering — the same short list `timelapse.ts`
 *  offers for its own clip, since it is the same "how smooth does this need
 *  to look" question. */
export const SWEEP_FRAME_RATES = [12, 24, 30];

/** Clip lengths worth offering, seconds. Short: this is a planning artifact
 *  someone glances at, not a film. */
export const SWEEP_CLIP_LENGTHS_S = [4, 6, 8, 12, 20, 30];

export type SweepSpan = 'day' | 'season';

/**
 * The start and end instant a sweep covers.
 *
 * `'day'` is exactly the slider's own domain: `dayStart` to a full 1440
 * minutes later, so an export of "today" shows the same day the scrubber
 * was just open on. `'season'` brackets `at` between the nearest June and
 * December solstice — whichever comes first is `from` — which is not
 * necessarily centred on `at`, because the solstices themselves are not
 * evenly spaced around every date; it is, however, always a real half of
 * one actual year, not a fixed 182-day window that could straddle either
 * solstice by coincidence.
 */
export function sweepRange(span: SweepSpan, dayStart: Date, at: Date): { from: Date; to: Date } {
  if (span === 'day') {
    return { from: dayStart, to: new Date(dayStart.getTime() + DAY_MS) };
  }
  const { june, december } = bracketingSolstices(at);
  return june.getTime() <= december.getTime() ? { from: june, to: december } : { from: december, to: june };
}

/** Frames a clip needs, from its length and rate — the plain multiplication
 *  `timelapse.ts` also starts from, without that module's real-shoot half
 *  (an export has no shutter, no interval, no card to fill). */
export function sweepFrameCount(clipLengthSeconds: number, frameRateFps: number): number {
  if (!(clipLengthSeconds > 0)) throw new RangeError('clipLengthSeconds must be greater than zero');
  if (!(frameRateFps > 0)) throw new RangeError('frameRateFps must be greater than zero');
  return Math.max(2, Math.round(clipLengthSeconds * frameRateFps));
}

/**
 * `frameCount` instants, evenly spaced from `from` to `to` inclusive.
 *
 * Inclusive at both ends on purpose: a day's sweep that stops short of
 * midnight, or a season's run that stops short of the second solstice, would
 * be missing exactly the frame that makes it a complete cycle rather than an
 * almost-complete one.
 */
export function sweepInstants(from: Date, to: Date, frameCount: number): Date[] {
  if (!(frameCount >= 2)) throw new RangeError('frameCount must be at least 2');
  const fromMs = from.getTime();
  const spanMs = to.getTime() - fromMs;
  if (!(spanMs > 0)) throw new RangeError('to must be after from');
  return Array.from({ length: frameCount }, (_, i) => new Date(fromMs + (spanMs * i) / (frameCount - 1)));
}
