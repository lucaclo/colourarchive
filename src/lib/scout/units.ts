/**
 * Metres or feet, for every length Scout prints.
 *
 * One setting for the whole page, the way a camera's focus scale is one scale:
 * someone who reads their lens in feet wants the hyperfocal distance, the
 * frame's width and the monolith's height in feet too, and a page that mixed
 * them would be worse than one that offered no choice. Long distances follow
 * along, kilometres becoming miles.
 *
 * The choice is module state rather than a parameter threaded through every
 * formatter, because those formatters sit at the bottom of a dozen notes
 * (`frame.ts`, `profile.ts`, `geo.ts`) that already have callers and tests.
 * It defaults to metres, so nothing that never sets it changes, and every
 * test that never sets it keeps reading metric.
 */

export type DistanceUnits = 'm' | 'ft';

export const FEET_PER_METRE = 1 / 0.3048;
const FEET_PER_MILE = 5280;

let current: DistanceUnits = 'm';

export const distanceUnits = (): DistanceUnits => current;

export function setDistanceUnits(units: DistanceUnits): void {
  current = units === 'ft' ? 'ft' : 'm';
}

/** Read a stored or linked value back, refusing anything that is not one. */
export const readDistanceUnits = (value: unknown): DistanceUnits => (value === 'ft' ? 'ft' : 'm');

const trim1 = (v: number) => (v < 10 ? Number(v.toFixed(1)).toString() : String(Math.round(v)));

/**
 * A distance the size of a focus scale: "1.8 m", "23 m", "1.2 km", or "5.9 ft",
 * "75 ft", "0.7 mi". One decimal only below ten, where it is still a step you
 * could set on a lens. Infinity is a real answer here (the far limit at
 * hyperfocal) and prints as the sign every focus ring carries.
 */
export function formatLength(metres: number, units: DistanceUnits = current): string {
  if (metres === Infinity) return '∞';
  if (!Number.isFinite(metres)) return '—';
  if (units === 'ft') {
    const feet = metres * FEET_PER_METRE;
    if (feet < 1000) return `${trim1(feet)} ft`;
    const miles = feet / FEET_PER_MILE;
    return miles < 9.95 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
  }
  if (metres < 1000) return `${trim1(metres)} m`;
  const km = metres / 1000;
  return km < 9.95 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/**
 * A distance across a map: "850 m", "2.4 km", "18 km", or "0.5 mi", "11 mi".
 * Whole metres, because nothing on a map is placed finer; in feet, a short one
 * stays in feet up to a tenth of a mile.
 */
export function formatMapDistance(metres: number, units: DistanceUnits = current): string {
  if (!Number.isFinite(metres)) return '—';
  if (units === 'ft') {
    const feet = metres * FEET_PER_METRE;
    if (feet < FEET_PER_MILE / 10) return `${Math.round(feet)} ft`;
    const miles = feet / FEET_PER_MILE;
    return miles < 9.95 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
  }
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return km < 9.95 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** A height in whole units: "1,240 m", "4,068 ft". Ground elevations, slabs, subjects. */
export function formatHeight(metres: number, units: DistanceUnits = current): string {
  if (!Number.isFinite(metres)) return '—';
  const value = units === 'ft' ? metres * FEET_PER_METRE : metres;
  return `${Math.round(value).toLocaleString('en-GB')} ${units}`;
}
