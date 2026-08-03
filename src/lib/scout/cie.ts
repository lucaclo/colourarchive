/**
 * The CIE 1931 2° standard observer, 380–780 nm at 10 nm.
 *
 * Published data, transcribed rather than derived — this is the definition of
 * what "colour" means numerically, and there is nothing to compute. It lives in
 * its own file because `atmosphere.ts` is an argument and this is a table, and
 * mixing the two makes the argument impossible to read.
 *
 * 10 nm is ample here. The quantity being integrated is a smooth atmospheric
 * transmittance curve with no narrow features; the Fraunhofer lines that would
 * justify 1 nm are absent from the solar model anyway (see `atmosphere.ts`).
 */

export const CIE_START_NM = 380;
export const CIE_STEP_NM = 10;

/** x̄, ȳ, z̄ at 380, 390, … 780 nm. */
export const CIE_1931: ReadonlyArray<readonly [number, number, number]> = [
  [0.001368, 0.000039, 0.006450], // 380
  [0.004243, 0.000120, 0.020050], // 390
  [0.014310, 0.000396, 0.067850], // 400
  [0.043510, 0.001210, 0.207400], // 410
  [0.134380, 0.004000, 0.645600], // 420
  [0.283900, 0.011600, 1.385600], // 430
  [0.348280, 0.023000, 1.747060], // 440
  [0.336200, 0.038000, 1.772110], // 450
  [0.290800, 0.060000, 1.669200], // 460
  [0.195360, 0.090980, 1.287640], // 470
  [0.095640, 0.139020, 0.812950], // 480
  [0.032010, 0.208020, 0.465180], // 490
  [0.004900, 0.323000, 0.272000], // 500
  [0.009300, 0.503000, 0.158200], // 510
  [0.063270, 0.710000, 0.078250], // 520
  [0.165500, 0.862000, 0.042160], // 530
  [0.290400, 0.954000, 0.020300], // 540
  [0.433450, 0.994950, 0.008750], // 550
  [0.594500, 0.995000, 0.003900], // 560
  [0.762100, 0.952000, 0.002100], // 570
  [0.916300, 0.870000, 0.001650], // 580
  [1.026300, 0.757000, 0.001100], // 590
  [1.062200, 0.631000, 0.000800], // 600
  [1.002600, 0.503000, 0.000340], // 610
  [0.854450, 0.381000, 0.000190], // 620
  [0.642400, 0.265000, 0.000050], // 630
  [0.447900, 0.175000, 0.000020], // 640
  [0.283500, 0.107000, 0.000000], // 650
  [0.164900, 0.061000, 0.000000], // 660
  [0.087400, 0.032000, 0.000000], // 670
  [0.046770, 0.017000, 0.000000], // 680
  [0.022700, 0.008210, 0.000000], // 690
  [0.011359, 0.004102, 0.000000], // 700
  [0.005790, 0.002091, 0.000000], // 710
  [0.002899, 0.001047, 0.000000], // 720
  [0.001440, 0.000520, 0.000000], // 730
  [0.000690, 0.000249, 0.000000], // 740
  [0.000332, 0.000120, 0.000000], // 750
  [0.000166, 0.000060, 0.000000], // 760
  [0.000083, 0.000030, 0.000000], // 770
  [0.000042, 0.000015, 0.000000], // 780
];

/** Wavelength in nm of row `i`. */
export const cieWavelength = (i: number) => CIE_START_NM + i * CIE_STEP_NM;

/**
 * Ozone absorption cross-section over the Chappuis band, cm⁻¹ per atm-cm.
 *
 * Broad, weak, and centred around 600 nm — which is exactly why it matters
 * here: it takes a bite out of the orange-red and is one reason a high sun's
 * light is not quite as warm as Rayleigh scattering alone would make it.
 * Sampled on the same grid as above; zero outside the band.
 */
export const OZONE_CHAPPUIS: readonly number[] = [
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.003, 0.006, 0.009, // 380–470
  0.014, 0.021, 0.030, 0.040, 0.048, 0.063, 0.075, 0.085, 0.103, 0.120, // 480–570
  0.120, 0.115, 0.125, 0.120, 0.105, 0.090, 0.079, 0.067, 0.057, 0.048, // 580–670
  0.036, 0.028, 0.023, 0.018, 0.014, 0.011, 0.010, 0.009, 0.007, 0.006, // 680–770
  0.005, // 780
];
