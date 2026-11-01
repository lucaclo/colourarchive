/**
 * Hyperfocal cards (issue #158): one small card per lens you own, for the
 * camera bag. Each is a table of apertures against the hyperfocal distance in
 * both standards of sharp (#151), so it answers in the field without a phone.
 * A zoom gets a card at each of its marked focal lengths.
 *
 * Pure table maths over the kit (#153) and `hyperfocalDistanceMm`; the page
 * at /scout/cards lays them out at credit-card size and prints them.
 */

import { APERTURES, hyperfocalDistanceMm, sensorByKey, SENSORS } from './frame';
import { kitFocalLengths, type KitEntry } from './kit';
import { circleOfConfusionMm } from './sharpness';

/** The format as it fits on a card. */
const SENSOR_SHORT: Record<string, string> = {
  ff: 'full frame',
  apsc: 'APS-C',
  mft: 'Micro Four Thirds',
  medium: 'medium format',
  phone: 'phone',
};

export interface CardRow {
  aperture: number;
  /** Hyperfocal distance for print, metres. Sharp from half this to infinity. */
  printM: number;
  /** And pixel-sharp. */
  pixelM: number;
}

export interface HyperfocalCard {
  /** "a7C II · 35mm" */
  title: string;
  /** "FE 35mm ƒ/2.8 · full frame, 33 MP" */
  detail: string;
  rows: CardRow[];
}

/** The apertures a lens offers on its card: its widest, then the full stops to ƒ/22. */
export function cardApertures(widest: number): number[] {
  return [...new Set([widest, ...APERTURES.filter((a) => a > widest + 0.05)])];
}

export function hyperfocalCards(kit: readonly KitEntry[]): HyperfocalCard[] {
  const cards: HyperfocalCard[] = [];
  for (const entry of kit) {
    const sensor = sensorByKey(entry.sensor) ?? SENSORS[0];
    const zoom = entry.focalMin !== entry.focalMax;
    // A zoom's marked focal lengths; `kitFocalLengths` also adds the one most
    // used, which may not be marked, so only the stops and ends are kept.
    const focals = zoom ? kitFocalLengths({ ...entry, focalUsual: entry.focalMin }) : [entry.focalMin];
    const printCoc = circleOfConfusionMm('print', sensor, entry.megapixels);
    const pixelCoc = circleOfConfusionMm('pixel', sensor, entry.megapixels);
    for (const f of focals) {
      cards.push({
        title: zoom ? `${entry.body} · ${f}mm` : entry.label,
        detail: `${entry.lens}${zoom ? ` at ${f}mm` : ''} · ${SENSOR_SHORT[sensor.key] ?? sensor.label}, ${entry.megapixels} MP`,
        rows: cardApertures(entry.maxAperture).map((aperture) => ({
          aperture,
          printM: hyperfocalDistanceMm(f, aperture, printCoc) / 1000,
          pixelM: hyperfocalDistanceMm(f, aperture, pixelCoc) / 1000,
        })),
      });
    }
  }
  return cards;
}
