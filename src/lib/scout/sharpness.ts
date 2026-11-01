/**
 * What "sharp" means, said out loud (issue #151).
 *
 * Depth of field has no single answer: it depends on how big a blurred point
 * may be and still pass for a point, the circle of confusion, and that depends
 * on how the photograph will be looked at. Scout used to take one standard
 * silently, the pixel (two pixels' width, `CIRCLE_OF_CONFUSION_PX`), which is
 * what looks sharp at 100% on screen. Every print-based table, and every other
 * calculator, takes the other one, so Scout's limits read as strangely tight
 * with nothing on screen to say why.
 *
 * Now there are two, named wherever a depth-of-field number appears:
 *
 *   - **For print**: the sensor's diagonal over 1,500, the traditional
 *     standard for a 10 × 8 inch print seen from about 25 cm (0.029 mm on full
 *     frame). The default for planning, because it is the one people mean.
 *   - **Pixel-sharp**: two pixels, so it depends on the resolution, and it is
 *     what a focus stack is judged by.
 *
 * And a third use for the same arithmetic: the circle a given print size
 * needs, for Book, which knows each page's real size (see `cocForPrintMm`).
 */

import { CIRCLE_OF_CONFUSION_PX, type Sensor } from './frame';
import { pixelPitchMm } from './astrophoto';

export type SharpnessStandard = 'print' | 'pixel';

/** The print standard's divisor of the sensor diagonal. */
export const PRINT_COC_DIVISOR = 1500;

/**
 * The circle of confusion a viewer forgives on the print itself, in mm.
 * 10 × 8 inches is 325 mm corner to corner; seen from 25 cm, 0.2 mm is about
 * what the eye resolves, and 325 / 1500 ≈ 0.22 is where the divisor comes from.
 */
export const PRINT_BLUR_MM = 0.2;

export const readSharpness = (value: unknown): SharpnessStandard => (value === 'pixel' ? 'pixel' : 'print');

const diagonal = (sensor: Sensor) => Math.hypot(sensor.widthMm, sensor.heightMm);

export function circleOfConfusionMm(standard: SharpnessStandard, sensor: Sensor, megapixels: number): number {
  return standard === 'pixel'
    ? pixelPitchMm(sensor, megapixels) * CIRCLE_OF_CONFUSION_PX
    : diagonal(sensor) / PRINT_COC_DIVISOR;
}

/**
 * The circle of confusion a print of this size asks of the sensor: the blur
 * the eye forgives on paper, shrunk by how much the frame is enlarged. A
 * 30 × 40 cm print of a full-frame file needs about 0.017 mm, tighter than
 * the 10 × 8 standard, and an A5 page looser.
 */
export function cocForPrintMm(sensor: Sensor, printWidthMm: number, printHeightMm: number): number {
  const enlargement = Math.hypot(printWidthMm, printHeightMm) / diagonal(sensor);
  return PRINT_BLUR_MM / enlargement;
}

/** "Sharp in a 10 × 8 print" or "Sharp at 100%": the standard, as the answer's opening. */
export function sharpWhere(standard: SharpnessStandard): string {
  return standard === 'pixel' ? 'Sharp at 100%' : 'Sharp in a 10 × 8 print';
}

export const SHARPNESS_LABEL: Record<SharpnessStandard, string> = {
  print: 'For print',
  pixel: 'Pixel-sharp',
};
