/**
 * Landform shadows — the shade a mountain throws, as opposed to a building.
 *
 * The hillshade this sits beside is a *lighting* effect: it shades every slope
 * by how square-on it faces the sun, which makes relief legible and looks
 * convincing. What it cannot do is answer the question worth asking, because a
 * hillshade has no memory of what is between a slope and the sun. A west-facing
 * meadow in a deep valley is shaded by the ridge behind it an hour before the
 * hillshade dims it, and at that hour the hillshade is confidently wrong.
 *
 * So this computes the thing itself: for every point on the ground, march
 * towards the sun and ask whether anything gets in the way. That is a real cast
 * shadow, it is what turns "the sun sets at 21:47" into "this valley loses the
 * light at 18:40", and it is the one piece of the picture a photographer in
 * mountains actually needs.
 *
 * The elevation comes from the same free terrarium tiles the 3D terrain already
 * uses, decoded to metres and stitched into one mercator-aligned grid. Working
 * on our own grid rather than through the map's terrain has a practical payoff:
 * it works identically in 2D and 3D, it is deterministic, and every function
 * below is pure and testable without a GPU.
 *
 * What this deliberately does *not* claim:
 *
 *   - **Only what was loaded casts.** A peak outside the fetched area throws no
 *     shadow, so the field is padded well past the viewport and the amount of
 *     padding travels with the answer.
 *   - **Nearest-neighbour sampling.** At 30–40 m a sample the edge of a shadow
 *     is a sample wide. It is a shadow map, not a survey.
 *   - **A hard edge.** The sun is half a degree across, so real terrain shadows
 *     have a penumbra tens of metres wide at these distances. Drawn hard, and
 *     softened only in the painting, never in the geometry.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export const TILE_SIZE = 256;

/** Circumference at the equator, metres — the mercator plane's full width. */
export const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

/**
 * Effective earth radius for a line of sight, metres.
 *
 * The 7/6 is the standard allowance for atmospheric refraction bending a
 * horizontal ray back down towards the surface: light travels slightly further
 * round the curve than geometry alone would allow, so a distant ridge hides a
 * little less than a bare-earth calculation says. Over 10 km the correction is
 * about a metre, and the curvature it corrects is nearly eight.
 */
const EFFECTIVE_EARTH_RADIUS_M = (6_371_008.8 * 7) / 6;

/* ── Terrarium encoding ────────────────────────────────────────────────────── */

/**
 * One terrarium pixel in metres.
 *
 * The scheme packs elevation into RGB as a big-endian fixed-point number offset
 * by 32768, which gives a range from -32768 m to +32767 m at 1/256 m — far more
 * than the earth needs in both directions, and no special value for "no data".
 * Ocean reads as a genuine 0 rather than as a gap.
 */
export const decodeTerrarium = (r: number, g: number, b: number): number =>
  r * 256 + g + b / 256 - 32768;

/** A decoded tile: `size × size` heights in metres, row-major from the north-west. */
export function decodeTerrariumTile(rgba: Uint8ClampedArray | Uint8Array, size = TILE_SIZE): Float32Array {
  const expected = size * size * 4;
  if (rgba.length !== expected) {
    throw new RangeError(`expected ${expected} bytes for a ${size}×${size} tile, got ${rgba.length}`);
  }
  const heights = new Float32Array(size * size);
  for (let i = 0; i < heights.length; i++) {
    const p = i * 4;
    heights[i] = decodeTerrarium(rgba[p], rgba[p + 1], rgba[p + 2]);
  }
  return heights;
}

/* ── Web mercator ──────────────────────────────────────────────────────────── */

/** Fractional tile column for a longitude. */
export const lonToTileX = (lon: number, zoom: number): number => ((lon + 180) / 360) * 2 ** zoom;

/** Fractional tile row for a latitude. */
export function latToTileY(lat: number, zoom: number): number {
  const clamped = Math.min(85.05112878, Math.max(-85.05112878, lat));
  const φ = clamped * RAD;
  return ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * 2 ** zoom;
}

export const tileXToLon = (x: number, zoom: number): number => (x / 2 ** zoom) * 360 - 180;

export function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - 2 * Math.PI * (y / 2 ** zoom);
  return DEG * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Ground metres one grid sample spans at a latitude.
 *
 * Mercator is conformal, so this is the same in both axes at any given point,
 * and it shrinks with cos(latitude) — a sample at 60°N covers half the ground a
 * sample at the equator does. Getting this wrong scales every shadow.
 */
export const metresPerSample = (lat: number, zoom: number, samplesPerTile = TILE_SIZE): number =>
  (EARTH_CIRCUMFERENCE_M * Math.cos(lat * RAD)) / (2 ** zoom * samplesPerTile);

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * How many tiles a box covers at a zoom, without building any of them.
 *
 * Counting and enumerating are separate on purpose: at the world view the count
 * is 24,450, and `tilesFor` would allocate every one of those objects only for
 * the caller to look at `.length` and throw them away.
 */
export function tileCountAt(bounds: Bounds, zoom: number): number {
  const across =
    Math.floor(lonToTileX(bounds.east, zoom)) - Math.floor(lonToTileX(bounds.west, zoom)) + 1;
  const down =
    Math.floor(latToTileY(bounds.south, zoom)) - Math.floor(latToTileY(bounds.north, zoom)) + 1;
  return Math.max(0, across) * Math.max(0, down);
}

export interface ZoomChoice {
  zoom: number;
  /** Tiles the box needs at that zoom. */
  tiles: number;
  /** False when even `min` is over budget — the caller has to decide what to do. */
  fits: boolean;
}

/**
 * A zoom at which the area of interest needs no more than `maxTiles` tiles.
 *
 * Chosen from the area rather than fixed, so scouting one street and scouting a
 * fifty-kilometre radius both come back with a usable grid rather than one being
 * a blur and the other being ten thousand tile requests.
 *
 * **When nothing fits, this still returns `min`** — there is nothing lower to
 * offer — and that is exactly how it once cost the page 24,450 tile requests in
 * a single `Promise.all`. Returning a number and nothing else gave the caller no
 * way to tell "z7 is the right answer" from "z7 is the least wrong answer and it
 * is 1,500× over your budget". `fitsZoom` says which it is; prefer it, and use
 * this only where being over budget genuinely does not matter.
 */
export function chooseZoom(bounds: Bounds, maxTiles = 16, min = 7, max = 13): number {
  return fitsZoom(bounds, maxTiles, min, max).zoom;
}

/** `chooseZoom`, with the part it used to swallow. */
export function fitsZoom(bounds: Bounds, maxTiles = 16, min = 7, max = 13): ZoomChoice {
  let tiles = Number.POSITIVE_INFINITY;
  // Down to and *including* `min`, so its count is measured rather than assumed.
  for (let zoom = max; zoom >= min; zoom--) {
    tiles = tileCountAt(bounds, zoom);
    if (tiles <= maxTiles) return { zoom, tiles, fits: true };
  }
  return { zoom: min, tiles, fits: false };
}

export interface TileAddress {
  z: number;
  x: number;
  y: number;
}

/** Every tile touching a box, at a zoom. */
export function tilesFor(bounds: Bounds, zoom: number): TileAddress[] {
  const scale = 2 ** zoom;
  const wrap = (x: number) => ((x % scale) + scale) % scale;
  const minX = Math.floor(lonToTileX(bounds.west, zoom));
  const maxX = Math.floor(lonToTileX(bounds.east, zoom));
  const minY = Math.max(0, Math.floor(latToTileY(bounds.north, zoom)));
  const maxY = Math.min(scale - 1, Math.floor(latToTileY(bounds.south, zoom)));

  const tiles: TileAddress[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) tiles.push({ z: zoom, x: wrap(x), y });
  }
  return tiles;
}

/* ── The height field ──────────────────────────────────────────────────────── */

export interface HeightField {
  width: number;
  height: number;
  /** Metres above sea level, row-major from the north-west corner. */
  heights: Float32Array;
  zoom: number;
  /** The exact mercator rectangle the grid covers. */
  bounds: Bounds;
  /** Ground metres per sample, one entry per row — cos(latitude) varies down it. */
  scaleM: Float64Array;
  /** How many tiles were asked for, and how many actually arrived. */
  tilesRequested: number;
  tilesLoaded: number;
}

export type TileDecoder = (tile: TileAddress) => Promise<Float32Array | null>;

export interface HeightFieldOptions {
  /**
   * Take every nth sample. Halving the resolution quarters the work, and a
   * terrain shadow at 60 m is still a terrain shadow — what it costs is the
   * crispness of the edge, not whether the valley is dark.
   */
  downsample?: number;
  maxTiles?: number;
  zoom?: number;
}

/**
 * Fetch and stitch the elevation covering a box.
 *
 * The decoder is injected rather than built in: it is the only part that needs
 * a network and a canvas, and keeping it out means everything below can be
 * tested against a hand-built landscape.
 *
 * A tile that fails to load leaves its patch at sea level and is counted. Sea
 * level is the least harmful guess — it casts nothing and hides nothing — and
 * the count is what lets the UI say the map is incomplete instead of quietly
 * showing a shadowless mountain range.
 */
export async function loadHeightField(
  bounds: Bounds,
  decode: TileDecoder,
  options: HeightFieldOptions = {},
): Promise<HeightField> {
  const downsample = Math.max(1, Math.floor(options.downsample ?? 1));
  const zoom = options.zoom ?? chooseZoom(bounds, options.maxTiles ?? 16);
  const tiles = tilesFor(bounds, zoom);
  if (!tiles.length) throw new RangeError('no tiles cover those bounds');

  const scale = 2 ** zoom;
  const minX = Math.floor(lonToTileX(bounds.west, zoom));
  const maxX = Math.floor(lonToTileX(bounds.east, zoom));
  const minY = Math.max(0, Math.floor(latToTileY(bounds.north, zoom)));
  const maxY = Math.min(scale - 1, Math.floor(latToTileY(bounds.south, zoom)));

  const perTile = Math.floor(TILE_SIZE / downsample);
  const across = maxX - minX + 1;
  const down = maxY - minY + 1;
  const width = across * perTile;
  const height = down * perTile;
  const heights = new Float32Array(width * height);

  // Bounded concurrency, for the same reason the service worker warms the
  // archive six at a time: firing every tile at once saturates the connection
  // pool, and the host starts answering 503 rather than queueing. Everything
  // else on the page — the basemap, the geocoder — is then stuck behind a
  // hundred elevation requests it does not care about.
  const decoded: Array<{ tile: TileAddress; data: Float32Array | null }> = new Array(tiles.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < tiles.length; i = next++) {
      decoded[i] = { tile: tiles[i], data: await decode(tiles[i]).catch(() => null) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, tiles.length) }, worker));

  let tilesLoaded = 0;
  for (const { tile, data } of decoded) {
    if (!data) continue;
    tilesLoaded++;
    // Tile columns were wrapped for the request; place them back on the
    // unwrapped grid so a field straddling the antimeridian still stitches.
    const unwrappedX = tile.x + Math.round((minX - tile.x) / scale) * scale;
    const col0 = (unwrappedX - minX) * perTile;
    const row0 = (tile.y - minY) * perTile;
    for (let ty = 0; ty < perTile; ty++) {
      const source = (ty * downsample) * TILE_SIZE;
      const target = (row0 + ty) * width + col0;
      for (let tx = 0; tx < perTile; tx++) {
        heights[target + tx] = data[source + tx * downsample];
      }
    }
  }

  const fieldBounds: Bounds = {
    west: tileXToLon(minX, zoom),
    east: tileXToLon(maxX + 1, zoom),
    north: tileYToLat(minY, zoom),
    south: tileYToLat(maxY + 1, zoom),
  };

  // One scale per row, because a field 50 km tall at 60°N spans enough latitude
  // for cos(φ) to change by more than a percent, and every distance in the
  // shadow march is measured with it.
  const samplesPerTile = perTile;
  const scaleM = new Float64Array(height);
  for (let row = 0; row < height; row++) {
    const lat = tileYToLat(minY + (row + 0.5) / samplesPerTile, zoom);
    scaleM[row] = metresPerSample(lat, zoom, samplesPerTile);
  }

  return {
    width,
    height,
    heights,
    zoom,
    bounds: fieldBounds,
    scaleM,
    tilesRequested: tiles.length,
    tilesLoaded,
  };
}

/**
 * Grid column and row for a coordinate. Fractional, and may fall outside.
 *
 * Measured to sample *centres*, which is where the numbers actually are: grid
 * cell 100 covers the ground from 100/256 to 101/256 of the tile, so the height
 * stored in it belongs at 100.5/256 and not at the edge. Half a sample sounds
 * like nothing until it is the difference between a march starting inside a
 * ridge and starting beside it — and it is the same half-sample the per-row
 * latitude scale is computed at, so the two now agree.
 */
export function sampleAt(field: HeightField, lon: number, lat: number): { col: number; row: number } {
  const zoom = field.zoom;
  const samplesPerTile = field.width / (lonToTileX(field.bounds.east, zoom) - lonToTileX(field.bounds.west, zoom));
  return {
    col: (lonToTileX(lon, zoom) - lonToTileX(field.bounds.west, zoom)) * samplesPerTile - 0.5,
    row: (latToTileY(lat, zoom) - latToTileY(field.bounds.north, zoom)) * samplesPerTile - 0.5,
  };
}

/**
 * Elevation at a coordinate, bilinearly interpolated.
 *
 * Returns null outside the field rather than clamping to the edge: "I do not
 * have that ground" and "that ground is at the same height as the corner of my
 * grid" are different statements, and only one of them is true. Inside the
 * outermost half-sample there is real data but nothing to interpolate against,
 * so the edge value stands rather than the point being refused.
 */
export function elevationAt(field: HeightField, lon: number, lat: number): number | null {
  const raw = sampleAt(field, lon, lat);
  if (
    raw.col < -0.5 ||
    raw.row < -0.5 ||
    raw.col > field.width - 0.5 ||
    raw.row > field.height - 0.5
  ) {
    return null;
  }
  const col = Math.min(field.width - 1, Math.max(0, raw.col));
  const row = Math.min(field.height - 1, Math.max(0, raw.row));
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(field.width - 1, c0 + 1);
  const r1 = Math.min(field.height - 1, r0 + 1);
  const fx = col - c0;
  const fy = row - r0;
  const h = field.heights;
  const top = h[r0 * field.width + c0] * (1 - fx) + h[r0 * field.width + c1] * fx;
  const bottom = h[r1 * field.width + c0] * (1 - fx) + h[r1 * field.width + c1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/* ── Terrain as a shadow blocker ───────────────────────────────────────────── */

/** One ground triangle, corners at their own absolute elevation. */
export interface TerrainFacet {
  a: [lon: number, lat: number, heightM: number];
  b: [lon: number, lat: number, heightM: number];
  c: [lon: number, lat: number, heightM: number];
}

/**
 * The loaded field, as a coarse mesh of absolute-elevation triangles —
 * issue #51's second gap. Building shadows already stop at whatever else is
 * standing in their way; this is what lets a mountain do the same, by
 * entering the identical height-field competition a building's own blocker
 * already runs in `shadow-layer.ts`, at the same absolute elevation that
 * blocker now carries instead of a height measured from sea level.
 *
 * Strided rather than one triangle a cell, the same trade `downsample`
 * already makes for the shadow march: a mountain's silhouette does not need
 * building-level precision to stop a shadow, and the full field can be
 * hundreds of thousands of cells — cheap to sample, not cheap to hand the GPU
 * two triangles each.
 */
export function terrainFacets(field: HeightField, stride = 4): TerrainFacet[] {
  const s = Math.max(1, Math.floor(stride));
  if (field.width <= s || field.height <= s) return [];

  const zoom = field.zoom;
  const samplesPerTile =
    field.width / (lonToTileX(field.bounds.east, zoom) - lonToTileX(field.bounds.west, zoom));
  const minTileX = lonToTileX(field.bounds.west, zoom);
  const minTileY = latToTileY(field.bounds.north, zoom);

  // The exact inverse of `sampleAt`'s cell-centre convention, so a facet's
  // corners sit where the height stored for that cell actually belongs.
  const at = (col: number, row: number): [number, number, number] => [
    tileXToLon(minTileX + (col + 0.5) / samplesPerTile, zoom),
    tileYToLat(minTileY + (row + 0.5) / samplesPerTile, zoom),
    field.heights[row * field.width + col],
  ];

  const facets: TerrainFacet[] = [];
  for (let row = 0; row + s < field.height; row += s) {
    for (let col = 0; col + s < field.width; col += s) {
      const nw = at(col, row);
      const ne = at(col + s, row);
      const sw = at(col, row + s);
      const se = at(col + s, row + s);
      // Split along the same diagonal both ways, so the two triangles share
      // an edge exactly rather than leaving a sliver a rounding error apart.
      facets.push({ a: nw, b: ne, c: sw });
      facets.push({ a: ne, b: se, c: sw });
    }
  }
  return facets;
}

/* ── The shadow itself ─────────────────────────────────────────────────────── */

export interface TerrainShadowOptions {
  /**
   * Thin the grid by this factor before sweeping, then fill the block back in.
   *
   * A quality dial, kept for a caller working to a tighter budget than the
   * overlay's. **The overlay itself no longer uses it**: the sweep runs the full
   * grid in about three milliseconds, so drawing coarse during a drag would only
   * buy a millisecond and would make the picture visibly change when you let go.
   *
   * At stride 2 the mask costs a quarter as much and the edge lands within a
   * sample or two of where it belongs; at stride 1 it is exact. Note that the
   * thinning takes the *tallest* cell in each block, not a sample of it — see
   * `coarsen`.
   */
  stride?: number;
}

export interface TerrainShadowMask {
  width: number;
  height: number;
  /** 1 where the ground is in terrain shadow, 0 where the sun reaches it. */
  shadowed: Uint8Array;
  shadedCells: number;
  litCells: number;
  /** True when the sun is at or below the horizon and the whole field is dark. */
  wholeFieldDark: boolean;
  /** How far the march actually looked, metres. */
  searchedM: number;
}

/**
 * Sweep the field along the sun's line and see what each cell stands behind.
 *
 * ## Why this is not a march
 *
 * It used to be one: from every cell, step towards the sun with a step that grew
 * by 3.5% each time, on the reasoning that "a ridge ten kilometres off is a
 * kilometre wide and does not need sampling at 30 m". That reasoning is wrong,
 * and wrong in the way that matters — **a crest is a crest at any distance**.
 * Distance makes a ridge subtend a smaller angle; it does not make it broader in
 * the grid. By five kilometres out the step had grown to about 200 m, so a
 * one-cell ridge fell between two samples and the ray sailed through the
 * mountain.
 *
 * Measured on a plain with a single wall casting an 8.6 km shadow: a 20 m ridge
 * shaded **26%** of the ground it should have, a 40 m ridge 48%, a 100 m ridge
 * 84%. Only ridges wider than about 200 m were caught reliably. And *which*
 * cells fell through depended on the sun's azimuth, so the holes moved as the
 * time slider moved — which is what a shadow that flickers and passes through a
 * mountain actually is.
 *
 * ## What replaces it
 *
 * Every cell on a line towards the sun blocks the cells behind it in the same
 * way, so the whole line can be settled in one walk instead of re-marched from
 * each cell. Writing the blocking condition out, with `s` the distance along the
 * line and `R` the effective earth radius:
 *
 *     h(s′) − (s−s′)²/2R  >  h(s) + (s−s′)·tan(altitude)
 *
 * and expanding the square separates `s` from `s′` completely:
 *
 *     A(s′) + s·B(s′)  >  C(s)
 *     A(s′) = h(s′) − s′²/2R + s′·tan(alt),  B(s′) = s′/R,
 *     C(s)  = h(s)  + s²/2R  + s·tan(alt)
 *
 * So "is anything upwind blocking me" is the upper envelope of a set of straight
 * lines, evaluated at `s`. Cells arrive in order of increasing `s`, which means
 * increasing slope `B`, and are queried at increasing `s` too — the textbook
 * conditions for a monotonic hull, kept on a stack at O(1) a cell.
 *
 * The result is **exact**: every cell is visited, nothing is skipped, and the
 * curvature term is carried in full rather than approximated (the expansion
 * above is an identity, and is invariant to where the line's origin is put). It
 * is also about sixty times cheaper than the march it replaces, because each
 * cell is touched once instead of being the origin of its own ray.
 *
 * Two things a flat-plane version would still miss are kept:
 *
 *   - **The earth curves away.** Ten kilometres off, the ground has dropped
 *     nearly eight metres below the tangent plane, so a bare comparison of
 *     heights makes distant terrain block far more than it does.
 *   - **The sample spacing is not constant.** Metres per sample follows
 *     cos(latitude), so the row the line is currently crossing sets the step.
 *
 * What remains a limit, unchanged: only terrain inside the loaded field can
 * cast. The field is padded around the viewport, and a line that runs off the
 * edge is treated as clear rather than as blocked.
 */
export function terrainShadowMask(
  field: HeightField,
  sunAzimuth: number,
  sunAltitude: number,
  options: TerrainShadowOptions = {},
): TerrainShadowMask {
  const { width, height } = field;

  // No sun at all: the whole field is in the earth's own shadow. Said as a flag
  // rather than as a mask of ones, so the caller can skip painting entirely.
  if (!(sunAltitude > 0)) {
    const dark = new Uint8Array(width * height).fill(1);
    return {
      width,
      height,
      shadowed: dark,
      shadedCells: dark.length,
      litCells: 0,
      wholeFieldDark: true,
      searchedM: 0,
    };
  }

  const stride = Math.max(1, Math.floor(options.stride ?? 1));
  const grid = stride === 1 ? field : coarsen(field, stride);
  const swept = sweepShadows(grid, sunAzimuth, sunAltitude);

  if (stride === 1) {
    let shadedCells = 0;
    for (let i = 0; i < swept.shadowed.length; i++) shadedCells += swept.shadowed[i];
    return {
      width,
      height,
      shadowed: swept.shadowed,
      shadedCells,
      litCells: swept.shadowed.length - shadedCells,
      wholeFieldDark: false,
      searchedM: swept.searchedM,
    };
  }

  // One answer, spread over the block it stands for.
  const shadowed = new Uint8Array(width * height);
  let shadedCells = 0;
  for (let row = 0; row < height; row++) {
    const sourceRow = Math.floor(row / stride) * grid.width;
    for (let col = 0; col < width; col++) {
      const value = swept.shadowed[sourceRow + Math.floor(col / stride)];
      shadowed[row * width + col] = value;
      shadedCells += value;
    }
  }
  return {
    width,
    height,
    shadowed,
    shadedCells,
    litCells: shadowed.length - shadedCells,
    wholeFieldDark: false,
    searchedM: swept.searchedM,
  };
}

/** Just enough of a `HeightField` to sweep: the grid, and its metres per sample. */
interface Grid {
  width: number;
  height: number;
  heights: Float32Array;
  scaleM: Float64Array;
}

/**
 * Thin the grid by a square factor, taking the **tallest** cell in each block.
 *
 * The maximum rather than a sample, and that is the whole point. Point-sampling
 * a coarse grid throws away exactly what the rewrite above exists to preserve —
 * a one-cell crest vanishes at stride 2 and its shadow with it, which is the old
 * bug reintroduced at half strength every time the slider moves. Taking the
 * maximum keeps every ridge, at the cost of drawing its shadow a sample or two
 * wide of the truth. That errs towards drawing a shadow rather than withholding
 * one, which is the direction the convex hull in `shadows.ts` already errs in.
 */
function coarsen(field: HeightField, stride: number): Grid {
  const width = Math.ceil(field.width / stride);
  const height = Math.ceil(field.height / stride);
  const heights = new Float32Array(width * height);
  const scaleM = new Float64Array(height);

  for (let row = 0; row < height; row++) {
    const fromRow = row * stride;
    const toRow = Math.min(field.height, fromRow + stride);
    scaleM[row] = field.scaleM[fromRow] * stride;
    for (let col = 0; col < width; col++) {
      const fromCol = col * stride;
      const toCol = Math.min(field.width, fromCol + stride);
      let tallest = -Infinity;
      for (let r = fromRow; r < toRow; r++) {
        for (let c = fromCol; c < toCol; c++) {
          const value = field.heights[r * field.width + c];
          if (value > tallest) tallest = value;
        }
      }
      heights[row * width + col] = tallest;
    }
  }
  return { width, height, heights, scaleM };
}

/**
 * The sweep proper: one pass per line of cells parallel to the sun's bearing.
 *
 * Lines are indexed by their intercept on the minor axis, so every cell belongs
 * to exactly one of them — for a fixed major coordinate the map from minor
 * coordinate to line is a shift, and therefore a bijection. Walking the major
 * axis one step at a time is what guarantees no cell is skipped, which was the
 * entire failure of the march this replaces.
 *
 * Whichever axis the sun is more aligned with becomes the major one, so the
 * minor step is never more than one cell and the line stays connected.
 */
function sweepShadows(
  grid: Grid,
  sunAzimuth: number,
  sunAltitude: number,
): { shadowed: Uint8Array; searchedM: number } {
  const { width, height, heights, scaleM } = grid;
  const shadowed = new Uint8Array(width * height);
  const tanAltitude = Math.tan(sunAltitude * RAD);
  const R = EFFECTIVE_EARTH_RADIUS_M;

  // Towards the sun, in grid space: north is -row, east is +col. Light travels
  // the other way, and the sweep has to run the way the light does.
  const travelCol = -Math.sin(sunAzimuth * RAD);
  const travelRow = Math.cos(sunAzimuth * RAD);

  const steep = Math.abs(travelRow) > Math.abs(travelCol);
  const majorCount = steep ? height : width;
  const minorCount = steep ? width : height;
  const slope = steep ? travelCol / travelRow : travelRow / travelCol;
  const forward = (steep ? travelRow : travelCol) > 0;
  const perStep = Math.hypot(1, slope);

  // The hull of lines y = A + x·B, largest slope last.
  const hullA = new Float64Array(majorCount);
  const hullB = new Float64Array(majorCount);

  const endOffset = Math.round(slope * (majorCount - 1));
  const firstLine = -Math.max(0, endOffset);
  const lastLine = minorCount - 1 - Math.min(0, endOffset);
  let searchedM = 0;

  for (let line = firstLine; line <= lastLine; line++) {
    let size = 0;
    let cursor = 0;
    let distance = 0;
    let walking = false;

    for (let step = 0; step < majorCount; step++) {
      const major = forward ? step : majorCount - 1 - step;
      const minor = line + Math.round(slope * major);
      if (minor < 0 || minor >= minorCount) {
        // The in-range part of a straight line across a rectangle is one
        // unbroken run, so this is only ever the approach or the departure.
        if (walking) break;
        continue;
      }

      const col = steep ? minor : major;
      const row = steep ? major : minor;
      const index = row * width + col;
      const elevation = heights[index];

      if (walking) distance += scaleM[row] * perStep;
      else walking = true;
      if (distance > searchedM) searchedM = distance;

      // Is anything already passed on this line standing in the way?
      if (size > 0) {
        if (cursor >= size) cursor = size - 1;
        while (
          cursor + 1 < size &&
          hullA[cursor + 1] + distance * hullB[cursor + 1] >=
            hullA[cursor] + distance * hullB[cursor]
        ) {
          cursor++;
        }
        const blockingHeight = hullA[cursor] + distance * hullB[cursor];
        const ownSightline =
          elevation + distance * tanAltitude + (distance * distance) / (2 * R);
        if (blockingHeight > ownSightline) shadowed[index] = 1;
      }

      // Then offer this cell as a blocker to everything downwind of it.
      const a = elevation - (distance * distance) / (2 * R) + distance * tanAltitude;
      const b = distance / R;
      while (size >= 2 && useless(hullA[size - 2], hullB[size - 2], hullA[size - 1], hullB[size - 1], a, b)) {
        size--;
      }
      hullA[size] = a;
      hullB[size] = b;
      size++;
      if (cursor >= size) cursor = size - 1;
    }
  }

  return { shadowed, searchedM };
}

/**
 * Is the middle line never the highest of the three?
 *
 * The standard monotonic-hull test, cross-multiplied so it needs no division:
 * both slope gaps are positive because `B` is `distance / R` and the distance
 * strictly increases along a line.
 */
function useless(
  a1: number,
  b1: number,
  a2: number,
  b2: number,
  a3: number,
  b3: number,
): boolean {
  return (a1 - a3) * (b2 - b1) <= (a1 - a2) * (b3 - b1);
}

/**
 * Is one point in terrain shadow? The same question, for a single coordinate.
 *
 * Worth having separately because the pin's answer must not depend on whether a
 * full mask happens to have been computed. It is a march rather than a sweep
 * because one ray is all that is wanted, and a single ray across the whole field
 * is a thousand steps — cheap enough that there is nothing to buy by coarsening
 * it, and coarsening it is what put holes in the mask.
 *
 * **One cell at a time along the dominant axis**, so nothing narrow can hide
 * between two samples. When this and `terrainShadowMask` disagreed, the panel
 * said the pin was lit while the map painted it shaded, which reads as one of
 * them being broken because one of them was.
 */
export function terrainShadowAt(
  field: HeightField,
  lon: number,
  lat: number,
  sunAzimuth: number,
  sunAltitude: number,
): boolean | null {
  if (!(sunAltitude > 0)) return true;
  const origin = elevationAt(field, lon, lat);
  if (origin == null) return null;

  const { col, row } = sampleAt(field, lon, lat);
  const tanAltitude = Math.tan(sunAltitude * RAD);
  const dx = Math.sin(sunAzimuth * RAD);
  const dy = -Math.cos(sunAzimuth * RAD);

  // Scaled so the larger of the two axes advances exactly one cell a step.
  const perStep = 1 / Math.max(Math.abs(dx), Math.abs(dy));
  const maxSteps = Math.max(field.width, field.height);

  for (let s = 1; s <= maxSteps; s++) {
    const cells = s * perStep;
    const sampleCol = Math.round(col + dx * cells);
    const sampleRow = Math.round(row + dy * cells);
    // Off the edge of what was loaded. Nothing more can be said about this ray,
    // so it is treated as clear — and the padding around the viewport is what
    // keeps that from being a lie about anything on screen.
    if (sampleCol < 0 || sampleRow < 0 || sampleCol >= field.width || sampleRow >= field.height) {
      return false;
    }
    const groundM = cells * field.scaleM[sampleRow];
    const drop = (groundM * groundM) / (2 * EFFECTIVE_EARTH_RADIUS_M);
    if (field.heights[sampleRow * field.width + sampleCol] - drop > origin + groundM * tanAltitude) {
      return true;
    }
  }
  return false;
}

/* ── The horizon from a point ──────────────────────────────────────────────── */

/**
 * How far away a peak this much higher than the observer can still just clear
 * the horizon — issue #52.
 *
 * A comparable tool (TPE 3D) has a documented failure mode: it only loads
 * terrain out to a fixed radius, so a real, tall, distant peak sitting just
 * past that radius is silently never checked, and a sunrise is reported early
 * with no sign anything was missed. Auditing `terrainHorizon`'s own radius
 * against the same failure starts here rather than with a guessed number.
 *
 * Solved from the identity the ray-march already evaluates per sample —
 * apparent altitude reaches zero exactly where the peak's height above the
 * observer equals the curvature-and-refraction drop, `height = groundM² /
 * (2·R)` — so this is the same geometry `terrainHorizon` walks, read
 * backwards, not a second model of it. At a 1,000 m prominence — a real,
 * unremarkable ridge, not an extreme case — that is about 120 km; at 2,500 m
 * it is close to 190 km. The old default of 30 km caught neither.
 */
export function horizonReachM(peakHeightAboveObserverM: number): number {
  if (!(peakHeightAboveObserverM > 0)) return 0;
  return Math.sqrt(2 * EFFECTIVE_EARTH_RADIUS_M * peakHeightAboveObserverM);
}

/**
 * The default search radius for `terrainHorizon`.
 *
 * `horizonReachM(1500)` is about 149 km — a 1,500 m prominence is a serious
 * mountain but not an exceptional one, and this is chosen to comfortably
 * cover it rather than to cover the most extreme peak on earth, because nothing
 * this walks is free: past this point every step costs a sample, and a radius
 * chosen for Denali would spend most of its steps over ocean for everyone
 * scouting nearer sea level. In practice this rarely is the binding limit
 * anyway — `terrain-shadows.ts` pads the fetched field by 35% past the
 * viewport on every side, so a tight scouting view runs out of *loaded*
 * terrain well inside this radius, and this number only starts to matter once
 * someone is zoomed out far enough for it to.
 */
export const DEFAULT_HORIZON_RADIUS_M = 150_000;

export interface TerrainHorizon {
  /** Bearing resolution, degrees. `altitudes` has 360/stepDeg entries. */
  stepDeg: number;
  /** Highest terrain in each bearing bin, degrees above the horizontal. */
  altitudes: Float64Array;
  /** How far out it looked, metres. */
  radiusM: number;
  /** The elevation it looked *from*. Null when the point is off the field. */
  elevationM: number | null;
  peakAltitude: number;
  peakBearing: number;
}

/**
 * The skyline the landscape makes, seen from one point.
 *
 * The same idea as the building skyline in `skyline.ts` and deliberately the
 * same shape, so the two profiles merge into one horizon: a doorway can be
 * shaded by the tower opposite in the morning and by the mountain behind the
 * town in the afternoon, and only the combined profile answers when the light
 * arrives. Where a building profile is exact geometry over tens of metres, this
 * is a sampled ray cast over tens of kilometres — which is why they are computed
 * apart and merged rather than pretending to be one measurement.
 */
export function terrainHorizon(
  field: HeightField,
  lon: number,
  lat: number,
  options: { stepDeg?: number; radiusM?: number; maxSteps?: number; growth?: number } = {},
): TerrainHorizon {
  const stepDeg = options.stepDeg ?? 0.5;
  const radiusM = options.radiusM ?? DEFAULT_HORIZON_RADIUS_M;
  const maxSteps = options.maxSteps ?? 220;
  const growth = options.growth ?? 1.03;
  const bins = Math.max(4, Math.round(360 / stepDeg));
  const altitudes = new Float64Array(bins);

  const elevation = elevationAt(field, lon, lat);
  if (elevation == null) {
    return { stepDeg, altitudes, radiusM, elevationM: null, peakAltitude: 0, peakBearing: 0 };
  }

  const { col, row } = sampleAt(field, lon, lat);
  let peakAltitude = 0;
  let peakBearing = 0;

  for (let bin = 0; bin < bins; bin++) {
    const bearing = bin * stepDeg;
    const dx = Math.sin(bearing * RAD);
    const dy = -Math.cos(bearing * RAD);
    let cells = 1;
    let step = 1;
    let highest = 0;

    for (let s = 0; s < maxSteps; s++) {
      const sampleCol = Math.round(col + dx * cells);
      const sampleRow = Math.round(row + dy * cells);
      if (sampleCol < 0 || sampleRow < 0 || sampleCol >= field.width || sampleRow >= field.height) break;
      const groundM = cells * field.scaleM[sampleRow];
      if (groundM > radiusM) break;

      const drop = (groundM * groundM) / (2 * EFFECTIVE_EARTH_RADIUS_M);
      const rise = field.heights[sampleRow * field.width + sampleCol] - drop - elevation;
      const apparent = Math.atan2(rise, groundM) * DEG;
      if (apparent > highest) highest = apparent;

      step *= growth;
      cells += step;
    }

    altitudes[bin] = highest;
    if (highest > peakAltitude) {
      peakAltitude = highest;
      peakBearing = bearing;
    }
  }

  return { stepDeg, altitudes, radiusM, elevationM: elevation, peakAltitude, peakBearing };
}

/* ── Painting ──────────────────────────────────────────────────────────────── */

/**
 * A mask as RGBA bytes, ready for `putImageData`.
 *
 * The softening happens here rather than in the geometry, which is the whole
 * reason it is a separate step: a blurred edge is a drawing decision about the
 * sun's half-degree disc, not a claim that the shadow falls anywhere other than
 * where the march says it does.
 */
export function maskToRGBA(
  mask: TerrainShadowMask,
  colour: [number, number, number],
  opacity: number,
  softness = 1,
): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, shadowed } = mask;
  // Backed by an explicit ArrayBuffer so the result is the exact type
  // `ImageData` accepts — the default is widened to include SharedArrayBuffer,
  // which `putImageData` will not take.
  const out = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  const [r, g, b] = colour;
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255);
  const radius = Math.max(0, Math.floor(softness));

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const index = row * width + col;
      let coverage = shadowed[index];
      // A cheap box average over the neighbours, so an edge steps through a few
      // values rather than snapping from full dark to nothing.
      if (radius > 0) {
        let total = 0;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const y = row + dy;
          if (y < 0 || y >= height) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const x = col + dx;
            if (x < 0 || x >= width) continue;
            total += shadowed[y * width + x];
            count++;
          }
        }
        coverage = count ? total / count : coverage;
      }
      const p = index * 4;
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = Math.round(alpha * coverage);
    }
  }
  return out;
}
