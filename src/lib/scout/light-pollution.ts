/**
 * How bright the sky itself is, from a bundled global raster rather than a
 * live source — issue #46.
 *
 * `galactic.ts` already says plainly what it cannot: "a core at 20° over a
 * town is invisible while the same core over a dark site is the photograph"
 * and no source of light-pollution data publishes with CORS headers for a
 * live fetch. What closes that gap is not a live dependency at all, because
 * light pollution barely moves night to night — it is a property of the
 * place, on the timescale of years, not of the sky. `scripts/fetch-light-
 * pollution.ts` bundles one static raster once; this file is the pure
 * lookup into it, kept apart from the fetch/decode so it can be tested
 * against a hand-built grid the same way `terrain.ts` already is.
 */

/** One sample of the atlas's own "Light Pollution Zone" scale — see
 *  `scripts/fetch-light-pollution.ts`'s `ZONE_PALETTE` for where the values
 *  come from and what they are read off. 0 is the darkest class the atlas
 *  distinguishes (open ocean included); 13 is its brightest. */
export const ZONE_COUNT = 14;

export interface LightPollutionField {
  width: number;
  height: number;
  /** Zone class 0..ZONE_COUNT-1, row-major from the north-west corner —
   *  the same layout `scripts/fetch-light-pollution.ts` wrote the bundled
   *  PNG in. */
  zones: Uint8Array;
}

/**
 * The zone at a coordinate, or null off the grid — which a valid lat/lon
 * never is, but a caller that mistakenly hands one in should get a clear
 * "no answer" rather than whatever the nearest edge pixel happens to be.
 *
 * Nearest-cell rather than bilinear: `ZONE_PALETTE`'s classes are ordinal
 * labels, not a continuous quantity, and interpolating between "Zone 3b" and
 * "Zone 5a" does not average to a real zone in between.
 */
export function lightPollutionZoneAt(
  field: LightPollutionField,
  lon: number,
  lat: number,
): number | null {
  if (!(lat >= -90 && lat <= 90) || !Number.isFinite(lon)) return null;
  const wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  const col = Math.min(field.width - 1, Math.floor(((wrapped + 180) / 360) * field.width));
  const row = Math.min(field.height - 1, Math.floor(((90 - lat) / 180) * field.height));
  return field.zones[row * field.width + col];
}

/**
 * Above this zone, the atlas's own published milestones say the sky is
 * bright enough that the galactic core is not a realistic target regardless
 * of the moon.
 *
 * Not a measurement — the atlas explicitly declines to be read as the Bortle
 * scale (see `galactic.ts`'s own note) — but a reasoned anchor rather than a
 * guess: the atlas's colour-key text states that a Light Pollution Index
 * (LPI, the ratio of artificial to natural sky brightness at zenith) of 1
 * falls at the boundary between zones 3b and 4a, and each full zone step is
 * defined as ×3 LPI. Zone 9 in `ZONE_PALETTE`'s ordering sits four half-steps
 * above that boundary — LPI ≈ 3, artificial light three times natural — which
 * is roughly where common astrophotography guidance places the core
 * disappearing into skyglow (suburban skies, Bortle 5-ish). Below it the
 * night is dark enough to be worth the drive; at or above it, the moon being
 * down stops being the thing that matters.
 */
export const CORE_DARK_ENOUGH_MAX_ZONE = 8;

export const lightPollutionDarkEnough = (zone: number): boolean => zone <= CORE_DARK_ENOUGH_MAX_ZONE;
