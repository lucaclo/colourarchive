/**
 * Milky Way mode's camera floor — how far in the map must zoom, and how high
 * the free-look pivot must float, so that a camera looking at the sky from
 * *outside* the mercator plane still reads as standing at the true centre of
 * a dome whose radius now tracks the scouting ring (`domeRadiusFor` in
 * `dome.ts`) instead of a fixed 4000m.
 *
 * MapLibre's 3D camera never sits at `center` — it is pulled back from it by
 * `cameraToCenterDistance ≈ 1.5 * viewportHeightPx * groundResolution(zoom,
 * lat)`. That pull-back has to stay a small fraction of the dome's radius —
 * otherwise two stars actually aligned in the sky would not read as aligned
 * on screen, because the vantage point has visibly left the centre — and the
 * free-look pivot's elevation has to clear it entirely, or a pitch past 90°
 * looks *from* underground. Both used to be fixed numbers, 20 and 500m,
 * hand-tuned against the single 4000m dome this mode always drew. The dome
 * is now exactly the scouting radius (180m to 50km — see `MIN_DOME_RADIUS_M`
 * in `dome.ts`), so both have to be solved fresh for whatever radius is on
 * screen.
 */

const RAD = Math.PI / 180;

/** Mean earth circumference, metres — 2π × the IUGG mean radius `geo.ts`
 *  already uses for its own distance maths. */
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

/** MapLibre's own web-mercator tile size — the ground-resolution formula
 *  divides the world's circumference across this many pixels per tile at
 *  zoom 0. Not the CSS pixel size of anything on screen. */
const TILE_SIZE_PX = 256;

/**
 * A deliberately generous, fixed viewport height — past what any phone,
 * laptop or 4K monitor actually reports — so both numbers below stay
 * correct without needing to be recomputed if the window is resized while
 * the mode is already active. Carried over unchanged from the original
 * fixed-dome design.
 */
const ASSUMED_VIEWPORT_HEIGHT_PX = 2200;

/** MapLibre's own zoom ceiling. Past this there is no tighter answer to give. */
const MAPLIBRE_MAX_ZOOM = 22;

/**
 * The pull-back : dome-radius ratio the original fixed design accepted —
 * 492.75m of pull-back at zoom 20 against a 4000m dome. Not a fresh number:
 * the exact tradeoff this mode always made, carried forward so a 4000m-radius
 * scouting circle (the old fixed dome's own size) reproduces the original
 * zoom floor of 20.
 */
const TARGET_PULLBACK_FRACTION = 492.75 / 4000; // ≈ 0.12319

/** Flat clearance above the real pull-back at the chosen zoom, however large
 *  or small that pull-back turns out to be — simpler than reproducing the
 *  original design's own ~7m margin (500m against its 492.75m case) and no
 *  less safe. */
const PIVOT_CLEARANCE_M = 10;

/** Ground resolution, metres per pixel, at a given zoom and latitude. */
function groundResolutionM(zoom: number, latDeg: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(latDeg * RAD)) / (TILE_SIZE_PX * 2 ** zoom);
}

/** The 3D camera's pull-back from `center`, in metres, at a given zoom and
 *  latitude — MapLibre's own `cameraToCenterDistance`, at the fixed generous
 *  viewport height above. */
export function nightCameraPullbackM(zoom: number, latDeg: number): number {
  return 1.5 * ASSUMED_VIEWPORT_HEIGHT_PX * groundResolutionM(zoom, latDeg);
}

export interface NightCameraConstraints {
  /** The zoom Milky Way mode floors at — never zooms out past this. */
  zoom: number;
  /** How high the free-look pivot floats, metres. Always clears the *real*
   *  pull-back at `zoom`, whether or not `TARGET_PULLBACK_FRACTION` was
   *  actually reachable (see below). */
  pivotElevationM: number;
}

/**
 * Solve both numbers for the dome currently on screen.
 *
 * Below roughly a 985m dome (worked out from `TARGET_PULLBACK_FRACTION`
 * against `MAPLIBRE_MAX_ZOOM`) even MapLibre's own zoom ceiling cannot reach
 * the target ratio — the pull-back stops shrinking once zoom cannot climb
 * any further. A very tight scouting radius trades away some of "the camera
 * is exactly the dome's centre" precision in exchange for staying zoomable
 * at all; `pivotElevationM` is still solved from the *real* pull-back at
 * whatever zoom is actually reached, so the camera never goes underground
 * even there — only the star-alignment precision degrades, and only at the
 * tightest radii.
 */
export function nightCameraConstraintsFor(domeRadiusM: number, latDeg: number): NightCameraConstraints {
  const targetPullbackM = TARGET_PULLBACK_FRACTION * domeRadiusM;
  // nightCameraPullbackM(zoom) = K / 2^zoom, K = pull-back at zoom 0 — solve
  // K / 2^zoom = targetPullbackM for zoom.
  const pullbackAtZoom0 = nightCameraPullbackM(0, latDeg);
  const exactZoom = Math.log2(pullbackAtZoom0 / targetPullbackM);
  const zoom = Math.min(MAPLIBRE_MAX_ZOOM, Math.max(0, exactZoom));
  const pivotElevationM = nightCameraPullbackM(zoom, latDeg) + PIVOT_CLEARANCE_M;
  return { zoom, pivotElevationM };
}
