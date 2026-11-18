/**
 * Stand here: the camera at head height over the pin, turned like a head.
 *
 * MapLibre's camera is defined by a centre it looks at, a zoom and a tilt, so
 * standing somewhere means working backwards: the eye is where it is, and the
 * centre is put on the line of sight at a fixed distance ahead (`lookTarget`).
 * `map.calculateCameraOptionsFromTo(eye, target)` then gives the centre, zoom
 * and tilt that put the camera exactly at the eye. Turning the head moves the
 * target, never the eye.
 *
 * Pure numbers, no map, so the geometry is tested on its own.
 */

/** Eye height above the ground, in metres. */
export const EYE_HEIGHT_M = 1.7;

/**
 * How far ahead along the line of sight the camera's centre is put.
 *
 * It sets the near clip plane: MapLibre puts that at a fiftieth of the canvas
 * height in pixels, which comes to this distance ÷ 75 at the default 36.87°
 * field of view. 75 m keeps everything nearer than 1 m out of sight; the
 * ground under your feet is 1.7 m away, so nothing real is cut off even
 * looking straight down. A longer distance cuts into the foreground (MapLibre's
 * own default of 10 km cuts at 133 m); a shorter one gives up depth precision
 * on the far ridges and asks for a zoom past MapLibre's ceiling of 22.
 */
export const EYE_PIVOT_M = 75;

const RAD = Math.PI / 180;

/** Level with the horizon. MapLibre's pitch is 0 straight down, 90 level. */
export const EYE_PITCH_LEVEL = 90;
/** 60° below level: the valley floor under a ledge. */
export const EYE_PITCH_MIN = 30;
/** 30° above level: a ridge line, the moon over it, the top of a tree. */
export const EYE_PITCH_MAX = 120;

/**
 * MapLibre's hook for choosing a tile's zoom (`Source.calculateTileZoom`).
 * Distances are in Mercator units; the centre zoom is already corrected for
 * the source's tile size.
 */
export type TileZoomFunction = (
  requestedCenterZoom: number,
  distanceToTile2D: number,
  distanceToTileZ: number,
  distanceToCenter3D: number,
  cameraVerticalFOV: number,
) => number;

/** Terrain one zoom coarser than distance alone asks for (see `eyeTileZoom`). */
export const EYE_TERRAIN_BIAS = 1;

/**
 * Terrain tiles to stay under: MapLibre's texture cache holds 30, and one
 * more than fits redraws them all every frame (see `eyeTileZoom`). How many a
 * view needs depends on the place and the window: 24 at Riffelsee, 33 at Fitz
 * Roy at the same settings. So the terrain coarsens half a zoom at a time
 * while over, and refines again once well under.
 */
export const EYE_TERRAIN_TILES_HIGH = 28;
export const EYE_TERRAIN_TILES_LOW = 18;
const EYE_TERRAIN_BIAS_STEP = 0.5;
const EYE_TERRAIN_BIAS_MAX = 4;

/** The terrain bias for the next look, given how many terrain tiles this one drew. */
export function nextTerrainBias(bias: number, tiles: number): number {
  if (tiles > EYE_TERRAIN_TILES_HIGH) return Math.min(EYE_TERRAIN_BIAS_MAX, bias + EYE_TERRAIN_BIAS_STEP);
  if (tiles < EYE_TERRAIN_TILES_LOW && bias > EYE_TERRAIN_BIAS) return Math.max(EYE_TERRAIN_BIAS, bias - EYE_TERRAIN_BIAS_STEP);
  return bias;
}
/**
 * The finest terrain tile drawn while standing. MapLibre otherwise goes to 22
 * beside the camera, 33 tiles inside 2 km, when the 2048² texture of a z16
 * tile already holds the satellite's 30 cm a pixel. (The elevation itself
 * stops at z14.) At 17 London and Fitz Roy came to 32 and 36 tiles.
 */
export const EYE_TERRAIN_MAX_ZOOM = 16;
/** Full detail out to here; beyond it detail falls away three times faster. */
export const EYE_FAR_DETAIL_M = 40_000;
const FAR_FALLOFF = 3;

/**
 * Tile detail while standing: by distance from the eye, one zoom less for
 * each doubling, which is how much smaller a thing looks.
 *
 * MapLibre's own rule takes detail off for every tile seen at a glancing
 * angle, measured from the camera's height over its centre. Standing, that
 * height is about nil, every tile is at the horizon, and the whole view came
 * in at zoom 0. Its other knob, `setSourceTileLodParams`, can only zero that
 * penalty from one exact level count; a hair below it the penalty turns into
 * a boost of tens of zooms (it multiplies log2 cos 90°, about −54), every
 * tile asks for full detail and the page locks up. Hence a rule of our own.
 *
 * The terrain is held to fewer tiles than the rest (`bias`, `maxZoom`): each
 * one is a 2048² texture MapLibre draws the map into, its cache holds 30, and
 * past that every tile is redrawn every frame: 220 ms a frame against 18.
 */
export function eyeTileZoom({
  bias = 0,
  maxZoom = Infinity,
  farM = EYE_FAR_DETAIL_M,
  pivotM = EYE_PIVOT_M,
}: { bias?: number | (() => number); maxZoom?: number; farM?: number; pivotM?: number } = {}): TileZoomFunction {
  const biasNow = typeof bias === 'function' ? bias : () => bias;
  return (centreZoom, toTile2D, _toTileZ, toCentre3D, fovDeg) => {
    // The tile under the eye is at distance 0; a thousandth of the way to
    // the centre keeps the logarithm finite, and the source's own maxzoom
    // caps what that asks for.
    const toTile = Math.max(toTile2D, toCentre3D * 1e-3);
    let zoom = centreZoom + Math.log2(toCentre3D / toTile / Math.max(0.5, Math.cos((fovDeg / 2) * RAD))) - biasNow();
    // The centre is `pivotM` from the eye, so this is the tile's distance in metres over `farM`.
    const beyond = ((toTile / toCentre3D) * pivotM) / farM;
    if (beyond > 1) zoom -= FAR_FALLOFF * Math.log2(beyond);
    return Math.min(maxZoom, zoom);
  };
}

/** MapLibre's earth radius, so offsets agree with its own conversions. */
const EARTH_RADIUS_M = 6371008.8;

/**
 * How far the view reaches standing. MapLibre sets its far plane for a camera
 * looking down, which from head height at sea level is 18 km: a coast across
 * a bay was simply not drawn. Up a mountain its own reaches further and is
 * kept. Past about 100 km the flat map shows distant peaks a little high
 * (0.45° at 100 km), where the earth's curve would have lowered them.
 */
export const EYE_FAR_PLANE_M = 150_000;

/** MapLibre's pixels per metre at a latitude, for its world size (512 × 2^zoom). */
export const pixelsPerMetre = (worldSize: number, lat: number): number =>
  worldSize / (2 * Math.PI * EARTH_RADIUS_M * Math.cos(lat * RAD));

export interface EyePoint {
  lon: number;
  lat: number;
  /** Metres above sea level, in the renderer's terms (exaggeration applied). */
  altM: number;
}

export interface EyePose extends EyePoint {
  /** Compass heading of the gaze, degrees clockwise from north. */
  bearing: number;
  /** MapLibre pitch of the gaze: 0 straight down, 90 level, above 90 looking up. */
  pitch: number;
}

/** The point `distanceM` along the line of sight from the eye. */
export function lookTarget(eye: EyePoint, bearing: number, pitch: number, distanceM = EYE_PIVOT_M): EyePoint {
  const across = distanceM * Math.sin(pitch * RAD);
  const north = across * Math.cos(bearing * RAD);
  const east = across * Math.sin(bearing * RAD);
  return {
    lat: eye.lat + (north / EARTH_RADIUS_M) / RAD,
    lon: eye.lon + (east / (EARTH_RADIUS_M * Math.cos(eye.lat * RAD))) / RAD,
    altM: eye.altM - distanceM * Math.cos(pitch * RAD),
  };
}

/** Pitch kept inside what standing allows. */
export const clampEyePitch = (pitch: number): number => Math.min(EYE_PITCH_MAX, Math.max(EYE_PITCH_MIN, pitch));

/**
 * Degrees the view turns per pixel dragged, so the ground under a finger stays
 * under it: the vertical field of view spread over the canvas height.
 */
export const degreesPerPixel = (fovDeg: number, heightPx: number): number => fovDeg / Math.max(1, heightPx);

/**
 * A drag turns the head the way grabbing the scene would, as in Street View:
 * drag right and the view turns left; drag down and it looks up.
 */
export function turnHead(
  pose: { bearing: number; pitch: number },
  dxPx: number,
  dyPx: number,
  degPerPx: number,
): { bearing: number; pitch: number } {
  const bearing = (((pose.bearing - dxPx * degPerPx) % 360) + 540) % 360 - 180;
  return { bearing, pitch: clampEyePitch(pose.pitch + dyPx * degPerPx) };
}
