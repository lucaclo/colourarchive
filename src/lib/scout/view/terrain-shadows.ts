/**
 * The landform shadow overlay: `terrain.ts` on the map.
 *
 * Everything that needs a network, a canvas or a map lives here, and everything
 * that needs testing lives in `terrain.ts`. The split is the point — the shadow
 * geometry is checked against a landscape built to order in a test file, and
 * this file's only job is to feed it real elevation and paint what comes back.
 *
 * Two costs are managed here rather than in the maths:
 *
 *   - **Fetching.** Terrain tiles are immutable, so they are cached for the life
 *     of the page and a new field is only fetched when the view leaves the one
 *     already loaded.
 *   - **Computing.** A whole-field mask is tens of milliseconds, which is far
 *     too slow to run on every pointer move of the time slider. So the mask is
 *     debounced, and while it is out of date the layer says so rather than
 *     showing yesterday's shadows as though they were now.
 */

import type maplibregl from 'maplibre-gl';
import {
  fitsZoom,
  decodeTerrariumTile,
  loadHeightField,
  maskToRGBA,
  terrainShadowMask,
  tilesFor,
  TILE_SIZE,
  type Bounds,
  type HeightField,
  type TileAddress,
} from '../terrain';

export const TERRAIN_SHADOW_SOURCE = 'scout-landform-src';
export const TERRAIN_SHADOW_LAYER = 'scout-landform';

/** AWS Open Data's global 30 m elevation, the same tiles the 3D terrain uses. */
const TILE_URL = (t: TileAddress) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${t.z}/${t.x}/${t.y}.png`;

/**
 * How many samples the working grid may hold.
 *
 * A *total*, not a longest side. Bounded by the side, a viewport twice as wide
 * as it is tall — which is most laptop windows — spent its whole allowance on
 * the width and then threw away two thirds of the vertical detail it had
 * already fetched. Over Hong Kong that came out at 425 m a sample, coarse
 * enough to smooth away the very ridges the feature exists to find.
 *
 * The mask is recomputed every time the sun moves. It used to cost cells times
 * march steps — about thirteen million samples — which is what set this number.
 * The sweep that replaced the march touches each cell once, so the same grid now
 * costs **2.9 ms exact, 1.2 ms at stride 2** (measured, 470 × 470). The budget
 * is left where it is: it is now bounded by the DEM tiles it takes to fill the
 * grid and by how fine a sample is worth drawing, not by the arithmetic.
 */
const MAX_CELLS = 220_000;

/**
 * The most DEM tiles one field may ever ask for.
 *
 * `chooseZoom` walks down from z13 looking for a zoom that fits its tile budget
 * and, finding none, returns its floor of z7 anyway — which is correct as far as
 * it goes, since there is nothing lower to offer, but says nothing about how far
 * over budget that leaves the caller. At the world view the page opens on, the
 * padded box spans the whole planet: z7 is 128 tiles across, the pad pushes it
 * past the antimeridian in both directions, and the result was a request for
 * **24,450 tiles, fired in one `Promise.all`**. AWS answered with 503s, the
 * connection pool was full of them for a minute, and every other request the
 * page needed queued behind it.
 *
 * A landform overlay at that scale would be a grey smear over a continent and
 * tells a photographer nothing. So past this many tiles the field is not
 * fetched at all and `tooWide` is set, which the panel prints. 64 covers any
 * radius the scouting slider can ask for with room to spare.
 */
const MAX_TILES = 64;

/* ── Tiles ─────────────────────────────────────────────────────────────────── */

const tileCache = new Map<string, Promise<Float32Array | null>>();

/**
 * A terrarium PNG as heights.
 *
 * `OffscreenCanvas` where it exists, a detached DOM canvas where it does not —
 * Safari only gained the former recently and this has to work on the iPad it was
 * built for.
 */
async function decodeTile(tile: TileAddress): Promise<Float32Array | null> {
  const key = `${tile.z}/${tile.x}/${tile.y}`;
  const cached = tileCache.get(key);
  if (cached) return cached;

  const work = (async () => {
    try {
      const response = await fetch(TILE_URL(tile));
      if (!response.ok) return null;
      const bitmap = await createImageBitmap(await response.blob());
      const { width, height } = bitmap;

      let context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
      if (typeof OffscreenCanvas !== 'undefined') {
        context = new OffscreenCanvas(width, height).getContext('2d');
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        context = canvas.getContext('2d');
      }
      if (!context) return null;

      context.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const pixels = context.getImageData(0, 0, width, height);
      return decodeTerrariumTile(pixels.data, width);
    } catch {
      // A tile that will not load is a patch of unknown ground, which
      // `loadHeightField` counts and reports. It is not a page error.
      return null;
    }
  })();

  tileCache.set(key, work);
  return work;
}

/* ── The overlay ───────────────────────────────────────────────────────────── */

export interface TerrainShadowState {
  /** The field currently loaded, for the pin's horizon and elevation to reuse. */
  field: HeightField | null;
  /** True while a newer mask is still being computed. */
  stale: boolean;
  /** Set when some of the elevation could not be fetched. */
  tilesMissing: number;
  /**
   * Set when the view is too wide for elevation to be worth fetching at all.
   *
   * Distinct from `tilesMissing`, which means we asked and did not get it. This
   * means we did not ask, and the panel should say so rather than sit on
   * "loading elevation…" for a field that is never coming.
   */
  tooWide: boolean;
  shadedFraction: number;
}

export interface TerrainShadowOptions {
  /** Where in the layer stack to sit — under the labels, over the ground. */
  beforeId?: string;
  colour: [number, number, number];
  opacity: number;
}

export interface TerrainShadows {
  /** Load the elevation covering these bounds, if the current field does not. */
  ensureField(bounds: Bounds): Promise<void>;
  /**
   * Recompute and repaint for a sun position. Cheap to call repeatedly.
   *
   * `moving` marks a call made while the time slider is being dragged: those are
   * throttled and computed coarsely, so the shade keeps moving with the sun
   * instead of freezing. A call without it settles the overlay at full quality.
   */
  update(
    azimuth: number,
    altitude: number,
    options: TerrainShadowOptions,
    moving?: boolean,
  ): void;
  setVisible(visible: boolean): void;
  state(): TerrainShadowState;
  destroy(): void;
}

/**
 * How often the overlay may recompute while the slider is moving.
 *
 * This was a debounce, which was the wrong shape entirely: a debounce that
 * resets on every pointer event never fires during a continuous drag, so the
 * terrain shade sat frozen through the whole scrub and then jumped to its final
 * position when you let go. A throttle keeps it moving.
 */
const MOVING_INTERVAL_MS = 110;

/**
 * Attach the overlay to a map.
 *
 * The canvas is deliberately never added to the document: it is a texture, and
 * MapLibre reads it straight out of memory.
 */
export function createTerrainShadows(map: maplibregl.Map): TerrainShadows {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;

  let field: HeightField | null = null;
  let loading: Promise<void> | null = null;
  let loadedFor: Bounds | null = null;
  let visible = true;
  let stale = false;
  let shadedFraction = 0;
  let tilesMissing = 0;
  let tooWide = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPaintAt = 0;
  let destroyed = false;

  const sourceExists = () => Boolean(map.getSource(TERRAIN_SHADOW_SOURCE));

  /** Does `outer` completely contain `inner`? */
  const contains = (outer: Bounds, inner: Bounds) =>
    outer.west <= inner.west &&
    outer.east >= inner.east &&
    outer.south <= inner.south &&
    outer.north >= inner.north;

  function install(target: HeightField, beforeId?: string) {
    const { bounds } = target;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [bounds.west, bounds.north],
      [bounds.east, bounds.north],
      [bounds.east, bounds.south],
      [bounds.west, bounds.south],
    ];

    if (sourceExists()) {
      // The grid moved: the texture and its footprint have to change together,
      // or one frame gets drawn with the old shadows stretched over new ground.
      (map.getSource(TERRAIN_SHADOW_SOURCE) as maplibregl.CanvasSource).setCoordinates(coordinates);
      return;
    }

    map.addSource(TERRAIN_SHADOW_SOURCE, {
      type: 'canvas',
      canvas,
      coordinates,
      // Uploaded on demand rather than every frame — see `flush`.
      animate: false,
    });
    map.addLayer(
      {
        id: TERRAIN_SHADOW_LAYER,
        type: 'raster',
        source: TERRAIN_SHADOW_SOURCE,
        paint: {
          'raster-opacity': 1,
          'raster-fade-duration': 0,
          // Linear, so the shadow edge softens across the sample rather than
          // showing the grid it was computed on.
          'raster-resampling': 'linear',
        },
        layout: { visibility: visible ? 'visible' : 'none' },
      },
      beforeId,
    );
  }

  /**
   * Push the canvas to the GPU once.
   *
   * A canvas source only re-uploads while it is "playing", so it is started,
   * given a couple of frames to be picked up, and stopped again. Leaving it
   * playing would re-upload a megabyte of texture on every frame of every pan.
   */
  function flush() {
    const source = map.getSource(TERRAIN_SHADOW_SOURCE) as maplibregl.CanvasSource | undefined;
    if (!source) return;
    source.play();
    map.triggerRepaint();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!destroyed && map.getSource(TERRAIN_SHADOW_SOURCE)) source.pause();
      }),
    );
  }

  async function ensureField(bounds: Bounds): Promise<void> {
    if (loadedFor && contains(loadedFor, bounds)) return;
    if (loading) return loading;

    // Padded well past the viewport: a ridge just off the edge of the screen
    // throws its shadow onto the middle of it, and a field cut to the viewport
    // would silently lose exactly the shadows worth seeing.
    const padLon = (bounds.east - bounds.west) * 0.35;
    const padLat = (bounds.north - bounds.south) * 0.35;
    const padded: Bounds = {
      west: bounds.west - padLon,
      east: bounds.east + padLon,
      south: Math.max(-85, bounds.south - padLat),
      north: Math.min(85, bounds.north + padLat),
    };

    // Counted before anything is built: over budget, `tilesFor` would allocate
    // tens of thousands of addresses only to have them thrown away.
    const choice = fitsZoom(padded, 16);
    if (!choice.fits && choice.tiles > MAX_TILES) {
      // Say nothing rather than ask for the planet. See MAX_TILES.
      tooWide = true;
      field = null;
      loadedFor = null;
      return;
    }
    tooWide = false;
    const zoom = choice.zoom;
    const tiles = tilesFor(padded, zoom);
    const across = Math.max(1, new Set(tiles.map((t) => t.x)).size);
    const down = Math.max(1, new Set(tiles.map((t) => t.y)).size);
    // Thin the grid by whatever square factor brings it inside the budget, so
    // both axes give up detail at the same rate rather than one of them being
    // sacrificed for the other.
    const full = across * down * TILE_SIZE * TILE_SIZE;
    const downsample = Math.max(1, Math.ceil(Math.sqrt(full / MAX_CELLS)));

    loading = (async () => {
      try {
        const next = await loadHeightField(padded, decodeTile, { zoom, downsample });
        if (destroyed) return;
        field = next;
        loadedFor = padded;
        tilesMissing = next.tilesRequested - next.tilesLoaded;
        canvas.width = next.width;
        canvas.height = next.height;
      } catch {
        // No elevation is a missing overlay, never a broken page.
        field = null;
        loadedFor = null;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  /**
   * Always exact.
   *
   * There used to be a coarse variant at stride 2 for the drag, because the mask
   * cost tens of milliseconds and could not be run at full resolution inside a
   * frame. The sweep costs 2.9 ms, so the coarse pass buys 1.7 ms and costs a
   * visible change in the picture the moment you let go of the slider — the
   * shadow edge shifting by a sample or two and its extra blur coming off. That
   * reads as the shadow moving when nothing moved.
   */
  function paint(azimuth: number, altitude: number, options: TerrainShadowOptions) {
    if (!field || destroyed) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    install(field, options.beforeId);

    if (!(altitude > 0)) {
      // Below the horizon there is no terrain shadow to draw — the whole world
      // is in shade and the daylight wash already says so. Drawing a second full
      // -screen darkening on top of it would double-count the night.
      context.clearRect(0, 0, canvas.width, canvas.height);
      shadedFraction = 1;
      flush();
      return;
    }

    // No distance cap any more. It existed to bound a march that started afresh
    // from every cell; the sweep costs the same whether it looks a kilometre
    // upwind or across the whole grid, so the loaded field is the only limit —
    // and a cap could only ever lose a shadow a serious mountain really casts
    // (a 2,000 m peak at 3° reaches 38 km).
    const mask = terrainShadowMask(field, azimuth, altitude);
    shadedFraction = mask.shadedCells / (mask.shadedCells + mask.litCells || 1);

    const rgba = maskToRGBA(mask, options.colour, options.opacity, 1);
    const image = new ImageData(rgba, mask.width, mask.height);
    context.putImageData(image, 0, 0);
    stale = false;
    flush();
  }

  return {
    ensureField,

    update(azimuth, altitude, options, moving = false) {
      if (destroyed || !visible) return;
      stale = true;
      clearTimeout(timer);

      if (moving) {
        // Leading edge, then at most one every interval: the shade tracks the
        // sun while you drag rather than waiting for you to stop. The throttle
        // stays even though the mask is now cheap, because the cost that is left
        // is the canvas source re-uploading a megabyte of texture, not the
        // arithmetic.
        const since = performance.now() - lastPaintAt;
        if (since >= MOVING_INTERVAL_MS) {
          lastPaintAt = performance.now();
          paint(azimuth, altitude, options);
        } else {
          timer = setTimeout(() => {
            lastPaintAt = performance.now();
            paint(azimuth, altitude, options);
          }, MOVING_INTERVAL_MS - since);
        }
        return;
      }

      // Settled: one more pass, after a beat in case more calls are coming.
      timer = setTimeout(() => {
        lastPaintAt = performance.now();
        paint(azimuth, altitude, options);
      }, 60);
    },

    setVisible(next) {
      visible = next;
      if (map.getLayer(TERRAIN_SHADOW_LAYER)) {
        map.setLayoutProperty(TERRAIN_SHADOW_LAYER, 'visibility', next ? 'visible' : 'none');
      }
    },

    state: () => ({ field, stale, tilesMissing, tooWide, shadedFraction }),

    destroy() {
      destroyed = true;
      clearTimeout(timer);
      try {
        if (map.getLayer(TERRAIN_SHADOW_LAYER)) map.removeLayer(TERRAIN_SHADOW_LAYER);
        if (map.getSource(TERRAIN_SHADOW_SOURCE)) map.removeSource(TERRAIN_SHADOW_SOURCE);
      } catch {
        /* the style may already have been torn down */
      }
    },
  };
}
