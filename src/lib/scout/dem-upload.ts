/**
 * A user's own elevation data, for one scouted location — issue #50.
 *
 * The global DEM this app otherwise runs on (`terrain.ts`) is AWS's free
 * terrarium tiles: a 20–300 m grid, nearest-neighbour, the same everywhere on
 * earth. That is the right default and the wrong precision for the one cliff
 * edge or vantage point a photographer keeps coming back to and has actually
 * surveyed — a drone photogrammetry export, a LiDAR tile bought for the
 * purpose, whatever a real survey produced. This is the override: not a
 * wholesale precision upgrade, a scoped one, for a kept spot's own bounds
 * only. Outside them the global DEM still answers, exactly as it did before.
 *
 * ## What this deliberately does not do
 *
 *   - **No reprojection.** A GeoTIFF's own coordinates are trusted as
 *     longitude and latitude outright — checked against the range degrees can
 *     actually take, not against the file's declared CRS, because plenty of
 *     real files carry an incomplete or absent GeoKeyDirectory and refusing
 *     all of them on that alone would refuse files that are honestly in
 *     WGS84. A raster in UTM, State Plane or anything else projected reads as
 *     metres and fails that same range check outright, in the direction that
 *     costs nothing: reprojecting it silently would be inventing where it
 *     is, and giving up here is the honest alternative to that.
 *   - **No multi-band handling.** The first band is read as elevation and the
 *     rest is ignored. A photographer's own survey is elevation and nothing
 *     else; a satellite product with separate bands for something else is not
 *     what this was built to accept.
 *   - **No compression this build cannot decode.** `geotiff.js` supports the
 *     common ones (none, LZW, Deflate); an export from QGIS or a drone
 *     photogrammetry tool already lands in one of those.
 */

import { fromArrayBuffer } from 'geotiff';

export class DemUploadError extends Error {}

export interface UploadedDem {
  width: number;
  height: number;
  /** Metres above sea level, row-major from the north-west corner — the same convention `terrain.ts`'s HeightField uses. */
  heights: Float32Array;
  /** The exact rectangle the raster covers, in degrees. */
  bounds: { west: number; south: number; east: number; north: number };
}

/** How large an upload this app will hold in memory and in IndexedDB at once. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Parse a GeoTIFF into the shape the rest of Scout already samples.
 *
 * Refuses rather than guesses at every step: no bands, a bounding box that
 * cannot be longitude and latitude, or more cells than this app is willing to
 * hold in memory all end the parse with a stated reason instead of a raster
 * quietly placed somewhere wrong or an out-of-memory crash three steps later.
 */
export async function parseGeoTiffDem(buffer: ArrayBuffer): Promise<UploadedDem> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new DemUploadError(
      `That file is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB — ${MAX_UPLOAD_BYTES / 1024 / 1024} MB is the most this can hold.`,
    );
  }

  let tiff: Awaited<ReturnType<typeof fromArrayBuffer>>;
  try {
    tiff = await fromArrayBuffer(buffer);
  } catch (err) {
    throw new DemUploadError('That is not a file this can read as a GeoTIFF.');
  }

  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  if (!(width > 1) || !(height > 1)) {
    throw new DemUploadError('The raster is too small to be a survey of anything.');
  }
  if (width * height > 20_000_000) {
    throw new DemUploadError(
      `${width}×${height} is more cells than this can hold — a survey this precise needs to be cropped to the area that matters first.`,
    );
  }

  const [west, south, east, north] = image.getBoundingBox();
  // The one check this module makes of the file's coordinate system: whatever
  // it claims to be, do the numbers fall where longitude and latitude
  // actually can? A UTM easting/northing pair fails this by kilometres, which
  // is the point — see the module doc for why this is checked instead of the
  // declared CRS.
  if (
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north) ||
    Math.abs(west) > 180 ||
    Math.abs(east) > 180 ||
    Math.abs(south) > 90 ||
    Math.abs(north) > 90 ||
    east <= west ||
    north <= south
  ) {
    throw new DemUploadError(
      "This file's coordinates don't read as longitude and latitude — only WGS84 GeoTIFFs are supported. Reproject it (e.g. QGIS → Export → EPSG:4326) and try again.",
    );
  }

  let rasters: Awaited<ReturnType<typeof image.readRasters>>;
  try {
    rasters = await image.readRasters({ interleave: false });
  } catch (err) {
    throw new DemUploadError(
      err instanceof Error && err.message ? `Could not decode the raster: ${err.message}` : 'Could not decode the raster.',
    );
  }
  const band = rasters[0];
  if (!band || band.length !== width * height) {
    throw new DemUploadError('The file has no readable elevation band.');
  }

  return { width, height, heights: Float32Array.from(band as ArrayLike<number>), bounds: { west, south, east, north } };
}

/**
 * Bilinear elevation at a coordinate, or null outside the uploaded area.
 *
 * The same edge convention `terrain.ts`'s `elevationAt` uses — a cell holds
 * the height at its own centre, not its corner — so a spot's uploaded survey
 * and the global DEM it is layered over read identically at the seam between
 * them rather than disagreeing by half a cell.
 */
export function elevationFromUpload(dem: UploadedDem, lon: number, lat: number): number | null {
  const { west, south, east, north } = dem.bounds;
  if (lon < west || lon > east || lat < south || lat > north) return null;

  const col = ((lon - west) / (east - west)) * dem.width - 0.5;
  const row = ((north - lat) / (north - south)) * dem.height - 0.5;
  if (col < -0.5 || row < -0.5 || col > dem.width - 0.5 || row > dem.height - 0.5) return null;

  const c = Math.min(dem.width - 1, Math.max(0, col));
  const r = Math.min(dem.height - 1, Math.max(0, row));
  const c0 = Math.floor(c);
  const r0 = Math.floor(r);
  const c1 = Math.min(dem.width - 1, c0 + 1);
  const r1 = Math.min(dem.height - 1, r0 + 1);
  const fx = c - c0;
  const fy = r - r0;
  const h = dem.heights;
  const top = h[r0 * dem.width + c0] * (1 - fx) + h[r0 * dem.width + c1] * fx;
  const bottom = h[r1 * dem.width + c0] * (1 - fx) + h[r1 * dem.width + c1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Elevation at a coordinate, preferring an uploaded survey over the global
 * DEM wherever one covers the point.
 *
 * `uploads` is checked in order and the first that covers the point wins —
 * callers hand this the uploads for one kept spot, so in practice it is
 * "the survey, or the global field", never a contest between two surveys.
 */
export function elevationWithOverride(
  uploads: readonly UploadedDem[],
  globalElevationAt: (lon: number, lat: number) => number | null,
  lon: number,
  lat: number,
): number | null {
  for (const dem of uploads) {
    const sample = elevationFromUpload(dem, lon, lat);
    if (sample != null) return sample;
  }
  return globalElevationAt(lon, lat);
}
