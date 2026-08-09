/**
 * Everything Scout does once the page has loaded.
 *
 * This was five thousand lines inside `scout.astro`, where nothing could reach
 * it: `tsc` does not look inside .astro files, no test can import one, and the
 * only way to exercise any of it was to open a browser. It is one function
 * because it genuinely is one — the map, the arithmetic and the panel are wired
 * together by a shared set of mutable variables, and the honest way to hold
 * those is a closure rather than a module-level `let` that any importer could
 * reach in and change.
 *
 * The parts that did *not* need that closure have been lifted out into the
 * modules beside this one — `palette`, `shading`, `format`, `session`,
 * `state`, `scout-api`, `dom`, and the feature islands that own their own DOM.
 * What is left here is the orchestration, which is the part that is genuinely
 * about how the pieces fit rather than about any one of them.
 *
 * Nothing runs at import time. The page calls `startScout()`, and the dynamic
 * `import('maplibre-gl')` inside it is what keeps the library in a chunk of its
 * own — see the note at that line.
 */

// Pinned to maplibre-gl v5, which ships one default export carrying
// everything (v6 moved to named exports with no default).
//
// Types only. The library itself is a megabyte of WebGL that this page used to
// pull into its own entry chunk — 1,186 kB of scout script, of which about
// fifty was scout. It now arrives through a dynamic `import()` below, which
// Rollup gives a chunk of its own, leaving this page's script at 145 kB.
//
// `import type` is what keeps that true: a value import here, or in any module
// this one reaches, silently drags the whole library back into the entry.
// `view/dome-layer.ts`, `shadow-layer.ts` and `terrain-shadows.ts` all take it
// the same way for the same reason.
import type MapLibre from 'maplibre-gl';
type MapLibreMap = MapLibre.Map;
type GeoJSONSource = MapLibre.GeoJSONSource;
type ColourExpression = MapLibre.DataDrivenPropertyValueSpecification<string>;

import {
  boundingBox,
  circleFeature,
  compassPoint,
  destination,
  distance,
  formatDistance,
  initialBearing,
  type LatLon,
} from '../geo';
import { shadowBearing, shadowLengthRatio, type SunSample } from '../sun';
import {
  contrastOverrides,
  daylightWash,
  directionalIntensity,
  extrusionLightColour,
  lightPosition,
  shadowColour,
  skyColour,
  sunlightColour,
} from '../basemap';
import {
  domePath,
  domePosition,
  domeRadiusFor,
  dotStride,
  hourMarks,
  splitAtHorizon,
} from '../dome';
import { decodeScoutLink, encodeScoutLink } from '../share';
import {
  addSpot,
  describeFrame,
  indexOfSpot,
  readPhoto,
  readSpots,
  removeSpot,
  updateSpot,
  MAX_PHOTOS,
  type SavedSpot,
  type SpotPhoto,
} from '../spots';
import { PHOTO_SEARCH_RADIUS_M } from '../sources/types';
import { shootPlan } from '../report';
import {
  buildingHeight,
  castPrisms,
  castShadow,
  castShadows,
  convexHull,
  heightIsEstimated,
  maxShadowLength,
  buildingSetSignature,
  padBounds,
  ringIntersects,
  squareFootprint,
  type Ring,
} from '../shadows';
import { ShadowGeometry, createShadowLayer, type ShadowLayer } from './shadow-layer';
import {
  MINUTES_PER_DAY,
  PHASE_LABEL,
  describeLightWindows,
  describeNextChange,
  formatClock,
  formatDayLabel,
  formatDuration,
  formatMinute,
  formatShadowRatio,
  formatZoneAbbreviation,
  isoDateIn,
  scoutDay,
  shadeOverlayGradient,
  shiftIsoDate,
  sunEventRows,
  twilightRows,
  zonedNoon,
  type ScoutDay,
  type SunEventRow,
} from '../daylight';
import {
  MOON_PHASE_LABEL,
  moonIllumination,
  moonTimes,
  moonTrack,
  moonlightNote,
  type MoonSample,
} from '../moon';
import { aodAt, type AirReport } from '../air';
import {
  coreNight,
  corePosition,
  coreTrack,
  type CoreNight,
  type CoreSample,
} from '../galactic';
import {
  RESOLUTIONS,
  frameTheCore,
  inFrameWindows,
  pixelPitchMm,
  trailLimit,
} from '../astrophoto';
import { bracketingSolstices, seasonEvents, seasonName } from '../almanac';
import {
  buildSkyline,
  isSunlit,
  lightWindows,
  mergeHorizon,
  nextChange,
  type LightWindow,
  type Skyline,
} from '../skyline';
import {
  compareSpots,
  describeLighting,
  litMinutesAhead,
  type Lighting,
} from '../lighting';
import {
  elevationAt,
  terrainHorizon,
  terrainShadowAt,
  type HeightField,
} from '../terrain';
import {
  aerosolFor,
  chromaticityToSrgb,
  precipitableWater,
  readLight,
  spectralLight,
} from '../atmosphere';
import {
  DomeGeometry,
  createDomeLayer,
  mergeDomeGeometry,
  type DomeGeometryData,
  type DomeVertex,
  type RGBA,
} from './dome-layer';
import { createTerrainShadows, type TerrainShadows } from './terrain-shadows';
import {
  cloudStructure,
  blockingCover,
  directLightFractionFor,
  horizonReading,
  horizonSampleDistanceM,
  hourAt,
  lightQuality,
  stalenessNote,
  summariseHour,
  weatherCondition,
  type WeatherReport,
} from '../weather';
import {
  FOCAL_LENGTHS,
  SENSORS,
  checkFraming,
  describeLens,
  fieldOfView,
  frameAxis,
  frameWedge,
  frameWidthAt,
  sensorByKey,
  type Orientation,
} from '../frame';
import { lineOfSight, profileGeometry, type LineOfSight } from '../profile';
import {
  fetchAirQualityDirect,
  fetchHorizonPairDirect,
  fetchPhotosDirect,
} from '../browser/sources';
import { $, markerElement, on } from './dom';
import {
  LAYER_TOGGLES,
  defaultLens,
  defaultShown,
  defaultSlab,
  defaultTarget,
  themeOf,
  type Basemap,
  type Lens,
  type PlaceLabel,
  type Shown,
  type SightTarget,
  type Slab,
  type ViewMode,
} from './state';
import { WIDTH, clearInk, frameInk, inkColour, liftColour, rgbOf } from './palette';
import { buildingRamp, shadowDarkness, shadowFade } from './shading';
import { bearingLabel, formatCoords, moonDiscPath, shadowCaveat } from './format';
import {
  SPOTS_KEY,
  STORE_KEY,
  readSession,
  writeSession,
  type SavedView,
} from './session';
import { getScoutJson, type Place } from './scout-api';
import { createSearchBox } from './search-box';
import { pace } from './pacing';
import { createMonthGrid } from './month-grid';

/** Wire the page up. Called once, from the bootstrap in `scout.astro`. */
export async function startScout(): Promise<void> {

  /**
   * True in the published build, which has no API of its own.
   *
   * Baked in at build time rather than probed at runtime: a static host answers
   * an unknown /api/ path with its 404 page, so a probe would have to tell an
   * HTML error body from a JSON one and would get it wrong the first time the
   * Mac's server was merely slow. One flag, two known arrangements.
   */
  const STATIC = import.meta.env.PUBLIC_STATIC === 'true';

  /* ── Sources and layers ──────────────────────────────────────────────── */

  const RING_SOURCE = 'scout-radius';
  const SUN_SOURCE = 'scout-sun';
  const MOON_SOURCE = 'scout-moon';
  const SHADOW_SOURCE = 'scout-shadows-src';
  const SLAB_SOURCE = 'scout-slab-src';
  const WASH_SOURCE = 'scout-daylight-src';
  const TERRAIN_SOURCE = 'scout-terrain';
  const SATELLITE_SOURCE = 'scout-satellite';
  const PHOTO_SOURCE = 'scout-photos-src';
  const FRAME_SOURCE = 'scout-frame-src';
  const SIGHT_SOURCE = 'scout-sight-src';

  /** OpenMapTiles only carries building footprints from z14. */
  const BUILDING_MIN_ZOOM = 14;
  const MAX_SHADOW_BUILDINGS = 4000;
  /**
   * How far out a building can still put a point in shade — `buildSkyline`'s
   * own default, named here because three separate things now have to agree
   * about it: which footprints are kept for the pin, which are gathered for a
   * hotspot, and how much of the map must have been collected before either
   * answer can be trusted.
   */
  const SKYLINE_RADIUS_M = 1500;

  /**
   * The day plan's two assumptions, named here so they are one edit apart from
   * the sentence that states them to the reader.
   *
   * Half an hour at a spot is a working figure — long enough to set up, wait
   * out a cloud and shoot; short enough that a plan built on it is not absurd.
   * 30 km/h over straight-line distance is deliberately pessimistic for a car
   * and optimistic for a bus, which is the honest middle for "can I get there".
   * Both are printed with every plan; neither is a measurement.
   */
  const PLAN_DWELL_MINUTES = 30;
  const PLAN_SPEED_KMH = 30;

  /**
   * A hotspot's colour is what the light is doing there, right now.
   *
   * Four states and not two, because the pin is the only part of the join most
   * people will ever read. Gold is direct sun; blue is the sun up and something
   * in the way; slate is the sun down, which is not the same finding as shade
   * and must not look like it. The original flat cyan is kept for a spot whose
   * light has not been computed — it is the one colour here that asserts
   * nothing, which is exactly right for "we have not worked this one out".
   *
   * All four are light enough to carry the count in dark text.
   */
  const HOTSPOT_COLOUR = [
    'case',
    ['!', ['coalesce', ['get', 'known'], false]],
    '#6fc3f0',
    ['coalesce', ['get', 'lit'], false],
    '#f6c67e',
    ['coalesce', ['get', 'sunUp'], false],
    '#7fa8c4',
    '#94a0ad',
  ] as unknown as ColourExpression;

  const STYLES = {
    light: 'https://tiles.openfreemap.org/styles/liberty',
    dark: 'https://tiles.openfreemap.org/styles/dark',
  } as const;

  /**
   * Satellite is the light vector style with imagery slid underneath and the
   * style's own ground fills switched off — so it comes out as a hybrid, with
   * real roads and labels over real ground, rather than as a bare photograph you
   * cannot navigate. The imagery is Esri's, which is free to use with the
   * attribution below and needs no key, like everything else here.
   */
  const SATELLITE_TILES =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  /** Source layers whose fills would cover the imagery. */
  const GROUND_LAYERS = new Set(['landcover', 'landuse', 'park', 'water', 'waterway', 'aeroway']);

  /* ── State ───────────────────────────────────────────────────────────── */

  let centre: LatLon | null = null;
  let label: PlaceLabel = { name: '', detail: '' };
  let timeZone = 'UTC';
  let radiusKm = 10;
  let styleReady = false;
  let basemap: Basemap = 'light';
  let view: ViewMode = '2d';
  let day: ScoutDay | null = null;
  /** Minutes into the solar day — the slider's unit. */
  let minute = 720;
  /** The date being scouted, as `YYYY-MM-DD` where the place is. */
  let isoDate = '';
  let moonSamples: MoonSample[] = [];
  /**
   * The core's path across the night that *follows* the chosen date.
   *
   * Sampled more coarsely than the sun and the moon because nothing indexes
   * into it — the slider does not scrub the core, and the arc is a shape rather
   * than a timeline. Built only while the layer is on: it is off by default and
   * costs a track nobody asked for on every date change otherwise.
   */
  let coreSamples: CoreSample[] = [];
  /**
   * Where the core will be at the best moment of the coming night.
   *
   * Kept because the "At the core" button aims at a moment that has not
   * happened, unlike the sun and moon buttons which aim at the slider's own
   * minute. Null when the core never clears the horizon, and the button then
   * has nothing to do — which is the honest answer at Tromsø.
   */
  let coreAim: { azimuth: number; altitude: number; declination: number } | null = null;
  /**
   * The night the core fold last computed, kept so turning the camera does not
   * recompute it.
   *
   * `coreNight` is three interval sweeps over twenty-four hours plus a peak
   * scan — well over a thousand trigonometric solves — and it depends on the
   * place, the date and nothing else. The aim slider fires faster than the
   * screen refreshes, and putting that behind it would stick the slider for the
   * sake of an answer that cannot have changed.
   */
  let coreNightCache: { night: CoreNight; window: { from: Date; to: Date } } | null = null;
  let weather: WeatherReport | null = null;
  /** The aerosol column over the pin, when the air-quality host answered. */
  let air: AirReport | null = null;
  /**
   * The forecast where the sunrise or sunset light passes low over the ground —
   * three hundred kilometres away, in the sun's own direction. Kept beside the
   * pin's forecast rather than merged into it, because they are answers to
   * different questions and the panel says which is which.
   */
  let horizonGate: WeatherReport | null = null;
  /** Which event the gate above was fetched for, so it is refetched when it flips. */
  let gateEvent: 'sunrise' | 'sunset' | null = null;
  let gateBearing = 0;
  let skyline: Skyline | null = null;
  let spotWindows: ReturnType<typeof lightWindows> = [];
  let terrainShadows: TerrainShadows | null = null;
  /** The last solved sightline, kept so the chart and the panel agree. */
  let sight: LineOfSight | null = null;

  // Mutated in place by the restore, which merges a stored session over them —
  // see `state.ts` for why each of these arrives from a function.
  const shown: Shown = defaultShown();
  const slab: Slab = defaultSlab();
  const lens: Lens = defaultLens();
  const target: SightTarget = defaultTarget();

  /* ── Map ─────────────────────────────────────────────────────────────── */

  const msgEl = $<HTMLDivElement>('mapmsg');
  let messageKind: 'none' | 'not-painted' | 'no-webgl' | 'basemap' = 'none';

  function showMapMessage(kind: typeof messageKind, title: string, body: string) {
    messageKind = kind;
    $('mapmsg-title').textContent = title;
    $('mapmsg-body').textContent = body;
    msgEl.hidden = false;
  }
  function clearMapMessage(only?: typeof messageKind) {
    if (only && messageKind !== only) return;
    messageKind = 'none';
    msgEl.hidden = true;
  }

  function webglAvailable(): boolean {
    try {
      const probe = document.createElement('canvas');
      return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'));
    } catch {
      return false;
    }
  }

  // The map is optional. Everything else on this page — the search, the sun
  // times, the slider — is arithmetic, and works perfectly well without a GPU.
  let map: MapLibreMap | null = null;

  /**
   * The library, fetched as its own chunk rather than as part of this page.
   *
   * What the split buys is the chunk boundary, not a change of order. A
   * top-level `await` in a module script — which is what Astro emits here —
   * suspends everything written below it, and everything below it is the whole
   * page, so this still finishes before the search box is wired up. The gains
   * are that the megabyte is now a separate, content-hashed file that survives
   * every edit to this page, and that no other route pays for it at all.
   *
   * Letting the search and the sun times run *while* it is in flight is a
   * different change: it needs the map's setup separated from the arithmetic's,
   * which is what breaking this script into modules is for (#17).
   *
   * Named `maplibregl` deliberately. Every `new maplibregl.Map(...)` and
   * `maplibregl.MercatorCoordinate` below this line is the same call it was
   * before the split, and a rename would have been seven chances to miss one.
   */
  const maplibregl = (await import('maplibre-gl')).default;

  if (!webglAvailable()) {
    showMapMessage(
      'no-webgl',
      'The map cannot be drawn here',
      'This browser has no WebGL, which the map needs. Embedded preview panes — ' +
        "VS Code's Simple Browser, for one — usually have it switched off. Open " +
        'https://localhost:4321/scout in Chrome, Safari or Firefox and the map will appear. ' +
        'Everything else on this page works either way.',
    );
  } else {
    map = new maplibregl.Map({
      container: 'map',
      style: STYLES.light,
      center: [0, 25],
      zoom: 1.4,
      attributionControl: { compact: true },
      // Kept so the view can be exported as an image — see "Save as an image".
      //
      // Nested, because MapLibre v5 moved the WebGL context attributes under
      // `canvasContextAttributes`. Passed at the top level — where it used to
      // live, and where this page was still passing it — it is silently
      // ignored, and the export comes back as an empty frame with no error to
      // say why. Nothing warns about an unknown map option.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    watchForFirstPaint(map);
  }

  // A handle on the internals, in development only. The diagnostics endpoint
  // this replaces reported to the server on a timer whether anyone was looking
  // or not; this costs nothing, ships nothing to production, and is there when
  // a shadow percentage looks wrong and you need to know what the field under it
  // actually covers.
  if (import.meta.env.DEV) {
    Object.assign(window as unknown as Record<string, unknown>, {
      scout: {
        map: () => map,
        state: () => ({ centre, radiusKm, minute, isoDate, timeZone, view, basemap, shown }),
        terrain: () => terrainShadows?.state(),
        // What is actually being cast, which is the only honest scale for a
        // timing run: the count of buildings in the vector tiles says nothing
        // about how many survived the collection box, and a measurement taken
        // before the set finished populating reads as a speed-up.
        shadows: () => ({ castable: castable.length, stats: shadowStats }),
        // The join, as numbers: what each hotspot's light was computed to be at
        // the minute the slider is on, and what it was computed *from*. The
        // basis is the half worth checking — a spot outside the collected box
        // has no buildings and must not be reported as though it had.
        spots: () =>
          hotspots.map((spot, index) => ({
            id: spot.id,
            count: spot.count,
            at: spot.at,
            distanceM: centre ? Math.round(distance(centre, spot.at)) : null,
            lit: spotLitAt(index, Math.min(Math.max(minute, 0), 1439)),
            litMinutesAhead: spotLights[index]
              ? litMinutesAhead(spotLights[index].windows, Math.min(Math.max(minute, 0), 1439))
              : null,
            windows: spotLights[index]?.windows.length ?? 0,
            buildingsKnown: spotLights[index]?.buildingsKnown ?? false,
            considered: spotLights[index]?.considered ?? 0,
            phrase: spotLights.length ? spotLightPhrase(index) : null,
          })),
        // Runs one batched frame by hand. Needed because a backgrounded tab
        // suspends requestAnimationFrame entirely, so the scheduler that draws
        // this page never fires there — which is correct behaviour and makes
        // the page impossible to measure from an automated browser without it.
        tick: () => runFrame(),
        setMinute: (value: number) => setMinute(value),
      },
    });
  }

  /**
   * A canvas that never paints looks exactly like a canvas painting black.
   *
   * MapLibre draws on `requestAnimationFrame`, which browsers suspend entirely
   * in a hidden tab — no frames, and therefore no tile requests either. That is
   * legitimate, so the watchdog waits for the page to be visible before it
   * starts counting, and withdraws the message the moment a frame arrives.
   */
  function watchForFirstPaint(instance: MapLibreMap) {
    let painted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onPaint = () => {
      if (painted) return;
      painted = true;
      clearTimeout(timer);
      instance.off('render', onPaint);
      // Only withdraw the watchdog's own complaint — a basemap failure reported
      // in the meantime is still true and must stay on screen.
      clearMapMessage('not-painted');
    };
    instance.once('idle', onPaint);
    instance.on('render', onPaint);

    const arm = () => {
      if (painted || document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (painted) return;
        showMapMessage(
          'not-painted',
          'The map has not drawn',
          'The page loaded and the map was set up, but no frame has been rendered. ' +
            'That usually means WebGL is unavailable or throttled — most often in an ' +
            'embedded preview pane rather than a real browser window. The sun times, ' +
            'the slider and the radius are unaffected.',
        );
      }, 6000);
    };

    document.addEventListener('visibilitychange', arm);
    arm();
  }

  /**
   * Where to slot our layers so labels stay on top.
   *
   * Computed per style, never hard-coded: the dark style's first symbol layer is
   * `water_name`, the light one's is `road_one_way_arrow`, and MapLibre does not
   * complain about an unknown `beforeId` — it silently declines to add the layer
   * at all. That failure mode cost an afternoon; it is not allowed to recur.
   */
  /** Only some layer kinds carry a `source-layer`, so it is read, not indexed. */
  const sourceLayerOf = (layer: unknown): string | undefined =>
    (layer as { 'source-layer'?: string })['source-layer'];

  function labelAnchor(instance: MapLibreMap): string | undefined {
    return (instance.getStyle().layers ?? []).find((l) => l.type === 'symbol')?.id;
  }
  let BELOW_LABELS: string | undefined;

  /**
   * Where the hillshade goes: under the water, over the land. Above the first
   * non-background layer would put it at the bottom of the stack, where every
   * landcover fill paints over it.
   */
  function hillshadeAnchor(instance: MapLibreMap): string | undefined {
    const layers = instance.getStyle().layers ?? [];
    return (
      layers.find((l) => sourceLayerOf(l) === 'water' && l.type === 'fill')?.id ??
      layers.find((l) => l.type !== 'background')?.id
    );
  }

  const domeLayer = createDomeLayer('scout-dome');

  /**
   * True once the custom shadow layer has proved the context can run it.
   *
   * Until then — and for good on a context that cannot — the plain fill layer
   * keeps drawing shadows the old way: pooled where they cross, and painted
   * over whatever they land on. Worse, but not nothing, and the decision is
   * made in `onAdd`, before a frame is drawn, so the two are never both up.
   */
  let glShadows = false;
  const shadowLayer: ShadowLayer = createShadowLayer('scout-shadows-gl', (ready) => {
    glShadows = ready;
    applyVisibility();
    if (!ready) {
      console.warn('[scout] falling back to flat shadows — no framebuffer or MAX blending');
      // Nothing has ever been put in the GeoJSON source, so the fallback layer
      // would come up empty without being asked to cast again.
      lastCast = null;
      invalidate({ shadows: true });
    }
  });

  /* ── Markers ─────────────────────────────────────────────────────────── */

  /**
   * The centre, as a marker you can drag.
   *
   * Dragging is the only way to scout a spot that has no name to type — the
   * north side of the square, the bridge rather than the town. Decision 5 holds:
   * still no GPS, still a coordinate chosen deliberately.
   */
  const pin = new maplibregl.Marker({ element: markerElement('pin'), draggable: true });
  const slabMarker = new maplibregl.Marker({ element: markerElement('slabmark'), draggable: true });
  /** The far end of the sightline. Declared here so the handlers below can see it. */
  const sightMarker = new maplibregl.Marker({ element: markerElement('sightmark'), draggable: true });

  /**
   * How much of a marker survives being on the far side of something.
   *
   * MapLibre uses one setting for two different situations, and they do not
   * want the same answer. Behind a *hill*, a ghost of the pin is useful — it
   * says the place is over there, out of sight, which is exactly the kind of
   * thing this page exists to tell you. Behind the *planet*, a ghost is a lie:
   * there is nothing to see through, and a faint pin over the Pacific while the
   * spot is in Scotland reads as a bug.
   *
   * So it is switched with the projection. The transition state is the same
   * number the shaders key off, so the marker and the dome stop being drawn on
   * the same frame.
   */
  let coveredOpacity = '';
  function applyMarkerOcclusion(instance: MapLibreMap) {
    const onGlobe = ((instance.style as { projection?: { transitionState?: number } })?.projection
      ?.transitionState ?? 0) > 0;
    // MapLibre's own default behind terrain is 0.2, and that is the one to keep.
    const covered = onGlobe ? '0' : '0.2';
    if (covered === coveredOpacity) return;
    coveredOpacity = covered;
    // Only the second argument: passing neither resets both, and the first is
    // the marker's ordinary opacity, which nothing here wants to touch.
    for (const marker of [pin, slabMarker, sightMarker]) marker.setOpacity(undefined, covered);
  }

  pin.on('dragend', () => {
    const position = pin.getLngLat();
    setCentreCoordinates({ lat: position.lat, lon: position.lng });
  });
  slabMarker.on('drag', () => {
    const position = slabMarker.getLngLat();
    slab.lat = position.lat;
    slab.lon = position.lng;
    drawSlab();
  });
  slabMarker.on('dragend', () => {
    drawSlab();
    save();
  });
  // The sightline redraws live while the ring is dragged but only *solves* when
  // it is let go: the march is over a grid in memory and cheap, the chart it
  // feeds is not worth rebuilding sixty times a second, and a profile that
  // flickered through every intermediate ridge would be unreadable.
  sightMarker.on('drag', () => {
    const position = sightMarker.getLngLat();
    target.lat = position.lat;
    target.lon = position.lng;
    drawSight();
  });
  sightMarker.on('dragend', () => {
    solveSight();
    drawSight();
    renderSight();
    save();
  });

  /* ── Style ───────────────────────────────────────────────────────────── */

  /**
   * The world as a sphere, flattening on the way in.
   *
   * `'globe'` is MapLibre's adaptive projection, not a fixed one: it draws the
   * vertical perspective of a planet while the whole world is in view and
   * crosses to mercator around the zoom where a city fills the screen. That
   * crossing is the point. Scouting happens at street zoom, where mercator is
   * the honest projection and every existing measurement on this page is
   * already made in it; a sphere is only the truthful shape when you are far
   * enough out that a flat map would put a Reykjavík evening and a Nairobi one
   * side by side at wildly different scales.
   *
   * Re-applied on every `style.load` because projection is a property *of the
   * style*, so `setStyle` — which is how this page switches between the light
   * and dark basemaps — silently drops it and the globe springs flat.
   */
  function applyProjection(instance: MapLibreMap) {
    try {
      instance.setProjection({ type: 'globe' });
    } catch (error) {
      // Not fatal: the page is entirely usable on a flat map, and it was flat
      // until this was added. Better a plane than a blank rectangle.
      console.warn('[scout] globe projection unavailable', error);
    }
  }

  /**
   * Change the basemap, which tears down every source and layer on the map.
   *
   * Two things have to happen *before* the swap, and both fail several frames
   * later and somewhere else, which is why they are gathered here rather than
   * left to each caller to remember.
   *
   * `styleReady` goes down because every draw on this page is guarded by it,
   * and the sources those draws write to stop existing the moment `setStyle`
   * is called. Most of them cope — `getSource` returns undefined and the draw
   * quietly does nothing — but `map.setLight` throws outright, once per frame,
   * until the new style lands. The basemap buttons already did this; restoring
   * a saved dark or satellite view did not, so the one path that runs on
   * *every* return visit was the one that threw.
   *
   * Terrain comes off because MapLibre's own depth pass reads
   * `style.projection.shaderPreludeCode` without checking it exists, and
   * `style.projection` is undefined between the old style being dropped and
   * the new one loading. With terrain set — which is to say in 3D — every
   * frame in that window throws from inside the renderer, where nothing here
   * can catch it. `style.load` calls `applyView`, which puts terrain back if
   * the view still wants it.
   */
  function swapStyle() {
    if (!map) return;
    styleReady = false;
    try {
      map.setTerrain(null);
    } catch {
      /* no terrain to take off, which is the same as having taken it off */
    }
    map.setStyle(STYLES[basemap === 'dark' ? 'dark' : 'light']);
  }

  /**
   * Put a custom WebGL layer on the map, replacing one that outlived a swap.
   *
   * `setStyle` diffs the two stylesheets rather than rebuilding from nothing
   * when it can, and a custom layer is not the sort of thing a stylesheet diff
   * knows how to remove — so after switching basemaps it is *still there*, and
   * adding it again throws "Layer already exists on this map". That error was
   * being raised twice on every basemap change: harmless in that the layer kept
   * drawing, but it is a failure being reported and ignored, which is the state
   * this page tries not to be in.
   *
   * Taken off and put back rather than merely skipped, because the position it
   * was added at was computed against the *old* style's layer names — the light
   * style's first symbol layer is not the dark style's — and a sun path drawn
   * under the wrong labels is the kind of thing nobody notices until it matters.
   */
  function addCustomLayer(
    instance: MapLibreMap,
    layer: MapLibre.CustomLayerInterface,
    before?: string,
  ) {
    if (instance.getLayer(layer.id)) instance.removeLayer(layer.id);
    instance.addLayer(layer as never, before);
  }

  map?.on('style.load', () => {
    if (!map) return;

    applyProjection(map);
    applyMarkerOcclusion(map);

    // First, before anything is added: every layer below is anchored with it,
    // and computing it afterwards anchored them with the *previous* style's id.
    BELOW_LABELS = labelAnchor(map);

    // --- Satellite, if it is on ------------------------------------------
    if (basemap === 'satellite') installSatellite(map);

    // --- The light of the hour -------------------------------------------
    // A wash over the whole basemap. A world-covering fill rather than a second
    // `background` layer, because a fill drapes onto terrain in 3D.
    map.addSource(WASH_SOURCE, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          // Deliberately past ±85.05°, where web mercator gives out.
          //
          // On a flat map the extra latitude is clipped away and costs nothing.
          // On the globe it is the difference between a washed planet and one
          // with a bare polar cap: MapLibre extends a fill to the pole only
          // when its geometry reaches the top edge of the top tile, and a
          // polygon that stops at ±85 stops just short of it. The Arctic Ocean
          // then keeps its daylight colour through the night, which reads as a
          // hole in the drawing rather than as the edge of a projection.
          coordinates: [
            [[-180, -89.9], [180, -89.9], [180, 89.9], [-180, 89.9], [-180, -89.9]],
          ],
        },
      },
    });
    map.addLayer(
      {
        id: 'scout-daylight',
        type: 'fill',
        source: WASH_SOURCE,
        paint: { 'fill-color': '#000000', 'fill-opacity': 0, 'fill-antialias': false },
      },
      BELOW_LABELS,
    );

    map.addSource(RING_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer(
      {
        id: 'scout-radius-fill',
        type: 'fill',
        source: RING_SOURCE,
        paint: { 'fill-color': '#e8e4dc', 'fill-opacity': 0.05 },
      },
      BELOW_LABELS,
    );
    map.addLayer(
      {
        id: 'scout-radius-line',
        type: 'line',
        source: RING_SOURCE,
        paint: {
          'line-color': '#e8e4dc',
          'line-width': 1.2,
          'line-opacity': 0.5,
          'line-dasharray': [3, 3],
        },
      },
      BELOW_LABELS,
    );

    // --- The moon ---------------------------------------------------------
    map.addSource(MOON_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer(
      {
        id: 'scout-moon-ray',
        type: 'line',
        source: MOON_SOURCE,
        filter: ['==', ['get', 'kind'], 'ray'],
        // Cooler and thinner than the sun's: the same notation, one rank down.
        paint: { 'line-color': '#d6e0f2', 'line-width': 2.4, 'line-opacity': 0.9 },
      },
      BELOW_LABELS,
    );
    map.addLayer(
      {
        id: 'scout-moon-dot',
        type: 'circle',
        source: MOON_SOURCE,
        filter: ['==', ['get', 'kind'], 'moon'],
        paint: {
          'circle-radius': 7,
          'circle-color': '#eef3ff',
          'circle-blur': 0.5,
          // Faded by how much of it is lit — a new moon is not a light source
          // and should not be drawn as one.
          'circle-opacity': ['+', 0.25, ['*', 0.75, ['get', 'lit']]],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(12,14,20,0.65)',
        },
      },
      BELOW_LABELS,
    );

    // --- The sun ----------------------------------------------------------
    map.addSource(SUN_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Each ground line is drawn twice: a soft dark casing underneath, then the
    // line itself over it. Without the casing a thin warm ray disappears
    // against pale ground and a satellite basemap eats it entirely — and this
    // is the mark that says which way the light is coming from.
    map.addLayer(
      {
        id: 'scout-sun-shadow-casing',
        type: 'line',
        source: SUN_SOURCE,
        filter: ['==', ['get', 'kind'], 'shadow'],
        paint: { 'line-color': 'rgba(0,0,0,0.45)', 'line-width': 6.5, 'line-blur': 3 },
      },
      BELOW_LABELS,
    );
    map.addLayer(
      {
        id: 'scout-sun-shadow',
        type: 'line',
        source: SUN_SOURCE,
        filter: ['==', ['get', 'kind'], 'shadow'],
        paint: {
          'line-color': '#8f9ec4',
          'line-width': 2.6,
          'line-opacity': 0.95,
          'line-dasharray': [2, 1.8],
        },
      },
      BELOW_LABELS,
    );
    map.addLayer(
      {
        id: 'scout-sun-ray-glow',
        type: 'line',
        source: SUN_SOURCE,
        filter: ['==', ['get', 'kind'], 'ray'],
        paint: { 'line-color': '#f0b866', 'line-width': 11, 'line-opacity': 0.22, 'line-blur': 7 },
      },
      BELOW_LABELS,
    );
    map.addLayer(
      {
        id: 'scout-sun-ray',
        type: 'line',
        source: SUN_SOURCE,
        filter: ['==', ['get', 'kind'], 'ray'],
        paint: { 'line-color': '#ffd79a', 'line-width': 3.2, 'line-opacity': 0.98 },
      },
      BELOW_LABELS,
    );
    map.addLayer(
      {
        id: 'scout-sun-events',
        type: 'circle',
        source: SUN_SOURCE,
        filter: ['==', ['get', 'kind'], 'event'],
        paint: {
          'circle-radius': 5.5,
          'circle-color': ['get', 'colour'],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(12,14,20,0.75)',
        },
      },
      BELOW_LABELS,
    );
    map.addLayer(
      {
        id: 'scout-sun-dot',
        type: 'circle',
        source: SUN_SOURCE,
        filter: ['==', ['get', 'kind'], 'sun'],
        paint: {
          // Halo, disc, dark rim: findable on snow and on a night basemap alike.
          'circle-radius': 8,
          'circle-color': '#ffd79a',
          'circle-blur': 0.9,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(12,14,20,0.65)',
        },
      },
      BELOW_LABELS,
    );

    // --- The frame, and the line of sight ---------------------------------
    // Both go under the sun furniture: they are context for where the sun is,
    // and a wedge painted over the sun's own disc would bury the thing being
    // framed. The wedge is a flat wash with a bright edge rather than a solid,
    // because it covers a lot of ground and everything under it still has to be
    // readable — it is a statement about what is in shot, not a mask.
    //
    // The ink follows the basemap. A pale wash is invisible over the light
    // style's own paper and a dark one disappears into the dark style, and a
    // wedge you cannot see is worse than no wedge: the toggle appears broken.
    //
    // Keyed off the basemap rather than off `theme()`, which calls satellite
    // "light" because it is the light vector style — but satellite is aerial
    // imagery, and imagery is nearly always darker than paper.
    const frameInk = basemap === 'light' ? '#1c2530' : '#f2efe8';
    // Same reasoning for the sightline: the pale green reads against imagery and
    // the dark style, and washes out on paper.
    const clearInk = basemap === 'light' ? '#2f7d4f' : '#8fd6a8';
    map.addSource(FRAME_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer(
      {
        id: 'scout-frame-fill',
        type: 'fill',
        source: FRAME_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': frameInk, 'fill-opacity': 0.1 },
      },
      BELOW_LABELS,
    );
    map.addLayer(
      {
        id: 'scout-frame-edge',
        type: 'line',
        source: FRAME_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': frameInk, 'line-width': 1.4, 'line-opacity': 0.8 },
      },
      BELOW_LABELS,
    );
    map.addLayer(
      {
        id: 'scout-frame-axis',
        type: 'line',
        source: FRAME_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': frameInk, 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': 0.9 },
      },
      BELOW_LABELS,
    );

    map.addSource(SIGHT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Blocked and clear are two layers, not one layer in two colours. Partly so
    // the state reads without relying on hue, and partly because `line-dasharray`
    // is not data-driven in MapLibre — an expression there is accepted at the
    // type level and then quietly ignored.
    map.addLayer(
      {
        id: 'scout-sight-clear',
        type: 'line',
        source: SIGHT_SOURCE,
        filter: ['==', ['get', 'clear'], true],
        paint: { 'line-color': clearInk, 'line-width': 2 },
      },
      BELOW_LABELS,
    );
    map.addLayer(
      {
        id: 'scout-sight-blocked',
        type: 'line',
        source: SIGHT_SOURCE,
        filter: ['==', ['get', 'clear'], false],
        paint: { 'line-color': '#c1863c', 'line-width': 2, 'line-dasharray': [2, 2] },
      },
      BELOW_LABELS,
    );

    // --- Photo hotspots ---------------------------------------------------
    // Above the sun furniture, because these are the only things on the map
    // you are meant to *click*, and a target you have to hunt for is not one.
    map.addSource(PHOTO_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'scout-photos-halo',
      type: 'circle',
      source: PHOTO_SOURCE,
      paint: {
        // Grows with how many people stopped here — the size *is* the finding.
        'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 11, 10, 17, 60, 26, 200, 34],
        'circle-color': HOTSPOT_COLOUR,
        'circle-opacity': 0.2,
        'circle-blur': 0.6,
      },
    });
    map.addLayer({
      id: 'scout-photos',
      type: 'circle',
      source: PHOTO_SOURCE,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 7, 10, 11, 60, 16, 200, 21],
        'circle-color': HOTSPOT_COLOUR,
        'circle-opacity': 0.92,
        'circle-stroke-width': 2,
        'circle-stroke-color': 'rgba(10,14,22,0.75)',
      },
    });
    map.addLayer({
      id: 'scout-photos-count',
      type: 'symbol',
      source: PHOTO_SOURCE,
      layout: {
        'text-field': ['to-string', ['get', 'count']],
        'text-size': 11,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#08121c' },
    });

    // --- Legibility -------------------------------------------------------
    // The stock dark style draws its roads about 1.1:1 against its own
    // background. It renders perfectly and looks like a blank rectangle.
    for (const { layerId, property, value } of themeOf(basemap) === 'dark'
      ? contrastOverrides(map.getStyle().layers ?? [])
      : []) {
      try {
        map.setPaintProperty(layerId, property, value);
      } catch {
        /* a layer the style no longer has is not worth failing over */
      }
    }

    // The style's own building layers step aside: ours are lit by the sun and
    // theirs are not, so they would z-fight.
    for (const id of ['building-3d', 'building_3d']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    }

    // --- Terrain ----------------------------------------------------------
    map.addSource(TERRAIN_SOURCE, {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 14,
      attribution: 'Elevation: Mapzen / AWS Open Data',
    });
    map.addLayer(
      {
        id: 'scout-hillshade',
        type: 'hillshade',
        source: TERRAIN_SOURCE,
        paint: {
          // Anchored to the map, so the terrain is lit from a compass direction
          // rather than from wherever the screen happens to face.
          'hillshade-illumination-anchor': 'map',
          'hillshade-illumination-direction': 315,
          'hillshade-exaggeration': 0.4,
        },
      },
      hillshadeAnchor(map),
    );

    // --- Cast shadows -----------------------------------------------------
    map.addSource(SHADOW_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer(
      {
        id: 'scout-shadows',
        type: 'fill',
        source: SHADOW_SOURCE,
        paint: { 'fill-color': '#141a2c', 'fill-opacity': shadowFade(0, cloudScale()) as never },
      },
      BELOW_LABELS,
    );
    // Sits directly over the fill layer and takes its place the moment it says
    // it can — see `shadow-layer.ts` for what a fill layer cannot do here.
    addCustomLayer(map, shadowLayer, BELOW_LABELS);

    // The monolith's own shadow, drawn apart from the buildings' — it is the one
    // shadow here cast from a height that was stated rather than inferred, and
    // it is drawn harder because of it.
    map.addSource(SLAB_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer(
      {
        id: 'scout-slab-shadow',
        type: 'fill',
        source: SLAB_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#0e1420', 'fill-opacity': 0.55 },
      },
      BELOW_LABELS,
    );

    // --- Buildings in three dimensions ------------------------------------
    map.addLayer(
      {
        id: 'scout-buildings',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: BUILDING_MIN_ZOOM,
        paint: {
          'fill-extrusion-color': buildingRamp(-90, themeOf(basemap)) as never,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.94,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      BELOW_LABELS,
    );

    map.addLayer({
      id: 'scout-slab',
      type: 'fill-extrusion',
      source: SLAB_SOURCE,
      filter: ['==', ['get', 'kind'], 'slab'],
      paint: {
        'fill-extrusion-color': '#e4e8f0',
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-opacity': 0.95,
      },
    });

    // Sky is a root style property in MapLibre v5, not a layer — `addLayer`
    // with `type: 'sky'` is accepted and then silently dropped.
    // No place, no air, and the sun nominally below the horizon: the ramp.
    applySky(-90, null);
    addCustomLayer(map, domeLayer);

    terrainShadows?.destroy();
    terrainShadows = createTerrainShadows(map);

    styleReady = true;
    // The shadow source and the layer's buffers above are brand new and empty,
    // so nothing may be skipped on the grounds that it is already drawn.
    lastCast = null;
    blockerSet = null;
    castableSignature = '';
    // The photo source is new and empty too, so the pins must be redrawn even
    // though their colours have not changed.
    hotspotPaint = '';
    applyView();
    applyVisibility();
    redrawEverything();
  });

  map?.on('moveend', () => {
    collectBuildings();
    refreshTerrain();
  });

  map?.on('click', (event) => {
    // Nowhere chosen yet: the first spot is picked by name, not by guessing at
    // a point on a world map.
    if (!centre) return;

    // A hotspot is the one thing on this map you are meant to click, so it
    // wins over moving the pin. Without this, opening a photo spot would also
    // silently relocate the place you are scouting.
    const hit = map!.queryRenderedFeatures(event.point, { layers: ['scout-photos'] })[0];
    if (hit) {
      openHotspot(Number(hit.properties?.index));
      return;
    }
    // Markers and controls sit in their own DOM above the canvas and never
    // reach this, so dragging the monolith is unaffected.
    const next = { lat: event.lngLat.lat, lon: event.lngLat.lng };
    undoSpot = { centre, label: { ...label }, timeZone };
    setCentreCoordinates(next);
    pin.setLngLat([next.lon, next.lat]);
    offerUndo('Pin moved');
  });
  // `sourcedata` fires for every tile that finishes, so at a city zoom this
  // arrives in bursts of dozens — and `collectBuildings` walks every loaded
  // tile each time. Collapsing a burst into one pass on the next frame turns
  // that into a single walk, with no visible delay.
  let gatherQueued = 0;
  map?.on('sourcedata', (e) => {
    if (e.sourceId !== 'openmaptiles' || !e.isSourceLoaded || gatherQueued) return;
    gatherQueued = requestAnimationFrame(() => {
      gatherQueued = 0;
      collectBuildings();
    });
  });
  // The dome stands on the ground under the pin, and that height is unknown
  // until the DEM tile covering the pin has loaded — until then it reads as
  // zero, which on high ground draws the whole ring underneath the map. A
  // terrain tile landing is therefore a reason to redraw; the height comparison
  // inside `updateDome` makes every call that changes nothing free.
  map?.on('sourcedata', (e) => {
    if (e.sourceId !== TERRAIN_SOURCE || !e.isSourceLoaded) return;
    invalidate({ dome: true });
  });
  map?.on('rotate', () => {
    document.documentElement.style.setProperty('--bearing', `${-(map?.getBearing() ?? 0)}deg`);
  });
  // Crossing between globe and flat changes what "covered" means for a marker.
  map?.on('zoom', () => map && applyMarkerOcclusion(map));

  map?.on('error', (e) => {
    const detail = e?.error?.message ?? String(e);
    console.warn('[scout] map error', detail);
    // A single tile failing on a flaky connection is noise. The style or the
    // tile source failing means an empty rectangle, and that has to be said out
    // loud rather than left to look like a design choice.
    if (/style|sprite|glyph|tiles\.json|source/i.test(detail)) {
      showMapMessage('basemap', 'The basemap could not load', `${detail}. The sun geometry is unaffected.`);
    }
  });

  function installSatellite(instance: MapLibreMap) {
    if (!instance.getSource(SATELLITE_SOURCE)) {
      instance.addSource(SATELLITE_SOURCE, {
        type: 'raster',
        tiles: [SATELLITE_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      });
    }
    const layers = instance.getStyle().layers ?? [];
    const anchor = layers.find((l) => l.type !== 'background')?.id;
    if (!instance.getLayer('scout-satellite')) {
      instance.addLayer({ id: 'scout-satellite', type: 'raster', source: SATELLITE_SOURCE }, anchor);
    }
    // Hide the fills that would otherwise paint over the photograph, and only
    // those — roads and labels stay, which is what makes it a hybrid rather
    // than a picture you cannot navigate.
    for (const layer of layers) {
      const source = sourceLayerOf(layer);
      if (source && GROUND_LAYERS.has(source) && layer.type === 'fill') {
        try {
          instance.setLayoutProperty(layer.id, 'visibility', 'none');
        } catch {
          /* gone from the style already */
        }
      }
    }
  }

  /* ── Drawing ─────────────────────────────────────────────────────────── */

  const current = (): SunSample | null => day?.samples[minute] ?? null;
  const currentMoon = (): MoonSample | null => moonSamples[minute] ?? null;
  const currentInstant = (): Date | null =>
    day ? new Date(day.dayStart.getTime() + minute * 60_000) : null;

  /**
   * The solstice days, kept because they cost a full day's solar track each and
   * only change when the place or the year does — not when the slider moves.
   */
  let solsticeDays: { june: ScoutDay; december: ScoutDay } | null = null;

  function rebuildSolstices() {
    if (!centre || !isoDate) {
      solsticeDays = null;
      return;
    }
    const { june, december } = bracketingSolstices(zonedNoon(isoDate, timeZone));
    solsticeDays = {
      june: scoutDay(centre.lat, centre.lon, june),
      december: scoutDay(centre.lat, centre.lon, december),
    };
  }

  function drawRing() {
    if (!centre || !styleReady) return;
    const source = map?.getSource(RING_SOURCE) as GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features: [circleFeature(centre, radiusKm * 1000)] });
    pin.setLngLat([centre.lon, centre.lat]).addTo(map!);
  }

  function frameRing() {
    if (!centre || !map) return;
    const [west, south, east, north] = boundingBox(centre, radiusKm * 1000);
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: { top: 70, bottom: 190, left: 70, right: 70 }, duration: 900, maxZoom: 15 },
    );
  }

  function drawSun() {
    if (!styleReady) return;
    const source = map?.getSource(SUN_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    if (!centre || !day) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const at = centre;
    const features: GeoJSON.Feature[] = [];
    /** Where a bearing meets the radius ring — the horizon, on the ground. */
    const onRing = (azimuth: number) => {
      const p = destination(at, azimuth, radiusKm * 1000);
      return [p.lon, p.lat] as [number, number];
    };

    // Sunrise and sunset sit on the ring where the sun will actually come up and
    // go down, so the ring doubles as a compass for the day.
    for (const [when, colour] of [
      [day.times.sunrise, '#f0b866'],
      [day.times.sunset, '#e0603a'],
    ] as const) {
      if (!when) continue;
      const index = Math.round((when.getTime() - day.dayStart.getTime()) / 60_000);
      const sample = day.samples[Math.min(day.samples.length - 1, Math.max(0, index))];
      features.push({
        type: 'Feature',
        properties: { kind: 'event', colour },
        geometry: { type: 'Point', coordinates: onRing(sample.azimuth) },
      });
    }

    const now = current();
    if (now && now.altitude > -0.833) {
      const sunEdge = destination(at, now.azimuth, radiusKm * 1000);
      features.push({
        type: 'Feature',
        properties: { kind: 'ray' },
        geometry: { type: 'LineString', coordinates: [[at.lon, at.lat], [sunEdge.lon, sunEdge.lat]] },
      });
      // Direction only, at a fixed length. True shadow length is metres, not
      // kilometres — a 10m wall at 5° throws 114m, a single pixel at this scale.
      const shadowEdge = destination(at, shadowBearing(now.azimuth), radiusKm * 550);
      features.push({
        type: 'Feature',
        properties: { kind: 'shadow' },
        geometry: { type: 'LineString', coordinates: [[at.lon, at.lat], [shadowEdge.lon, shadowEdge.lat]] },
      });
    }
    if (now && now.altitude > -0.833) {
      // The bearing marker, at the end of its own ray. The sun *itself* is drawn
      // in the sky by the dome layer; this is the point on the ground the ray
      // arrives at, which is what tells you where to stand.
      features.push({
        type: 'Feature',
        properties: { kind: 'sun' },
        geometry: { type: 'Point', coordinates: onRing(now.azimuth) },
      });
    }

    source.setData({ type: 'FeatureCollection', features });
  }

  function drawMoon() {
    if (!styleReady) return;
    const source = map?.getSource(MOON_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    if (!centre || !moonSamples.length || !shown.moonPath) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const at = centre;
    const features: GeoJSON.Feature[] = [];

    const now = currentMoon();
    const instant = currentInstant();
    if (now && instant && now.altitude > -0.833) {
      const edge = destination(at, now.azimuth, radiusKm * 1000);
      features.push({
        type: 'Feature',
        properties: { kind: 'ray' },
        geometry: { type: 'LineString', coordinates: [[at.lon, at.lat], [edge.lon, edge.lat]] },
      });
      features.push({
        type: 'Feature',
        properties: { kind: 'moon', lit: moonIllumination(instant).fraction },
        geometry: { type: 'Point', coordinates: [edge.lon, edge.lat] },
      });
    }

    source.setData({ type: 'FeatureCollection', features });
  }


  /**
   * What the shadow pass last knew about the monolith.
   *
   * The monolith is the one caster that moves without the sun moving, so the
   * recast guard cannot see a change in it. Rather than have six call sites
   * remember to say so, `drawSlab` compares it to what was last drawn and
   * speaks up only when it has genuinely moved, grown or gone away — which
   * keeps a slider scrub, where it has done none of those, free.
   */
  let lastSlab = '';

  /** The monolith: its footprint extruded, and the shadow it throws. */
  function drawSlab() {
    if (!styleReady) return;
    const source = map?.getSource(SLAB_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;

    const signature =
      shown.monolith && centre ? `${slab.lon},${slab.lat},${slab.heightM},${slab.sizeM}` : '';
    if (glShadows && signature !== lastSlab) {
      lastSlab = signature;
      lastCast = null;
      invalidate({ shadows: true });
    }

    if (!shown.monolith || !centre) {
      source.setData({ type: 'FeatureCollection', features: [] });
      slabMarker.remove();
      return;
    }

    slabMarker.setLngLat([slab.lon, slab.lat]).addTo(map!);
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { kind: 'slab', height: slab.heightM },
        geometry: { type: 'Polygon', coordinates: [monolithFootprint()] },
      },
    ];

    // Under the custom layer the monolith's shadow is cast with the buildings'
    // instead, so that the two cannot pool where they cross. Here it is only
    // ever the fallback's copy.
    const now = current();
    const shadow = glShadows ? null : now && monolithShadow(now);
    if (shadow) {
      features.push({
        type: 'Feature',
        properties: { kind: 'shadow', lengthM: Math.round(shadow.lengthM) },
        geometry: { type: 'Polygon', coordinates: [shadow.ring] },
      });
    }
    source.setData({ type: 'FeatureCollection', features });
  }

  /* ── The frame ─────────────────────────────────────────────────────────
     Where the lens is pointed, drawn on the ground, and what that means for
     the sun. The wedge is only the horizontal half of the answer — the frame
     is a rectangle in the sky and the vertical half needs the tilt, which no
     map can show. That part is in the panel, not here. */

  /** Field of view for the lens currently chosen. */
  const currentFov = () =>
    fieldOfView(sensorByKey(lens.sensor) ?? SENSORS[0], lens.focalLengthMm, lens.orientation);

  function drawFrame() {
    if (!styleReady) return;
    const source = map?.getSource(FRAME_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    if (!shown.frame || !centre) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    // Drawn to the radius, because that is the area being scouted. It is not a
    // claim about what the lens can resolve at that distance.
    const rangeM = radiusKm * 1000;
    const fov = currentFov();
    source.setData({
      type: 'FeatureCollection',
      features: [
        frameWedge(centre, lens.bearing, fov.horizontalDeg, rangeM),
        frameAxis(centre, lens.bearing, rangeM),
      ],
    });
  }

  /**
   * Where the sun and the moon fall relative to the picture.
   *
   * Kept out of `drawFrame` because it is a different kind of statement and
   * updates on a different clock: the wedge moves when you turn the camera, this
   * moves every minute of the slider.
   */
  function renderFraming() {
    const box = $<HTMLElement>('framing');
    const now = current();
    if (!shown.frame || !centre || !now) {
      box.hidden = true;
      return;
    }
    box.hidden = false;

    const sensor = sensorByKey(lens.sensor) ?? SENSORS[0];
    const fov = currentFov();
    const aim = { bearing: lens.bearing, tiltDeg: lens.tiltDeg };
    $('framing-lens').textContent = `${describeLens(sensor, lens.focalLengthMm, fov)} · ${compassPoint(lens.bearing)} ${Math.round(lens.bearing)}°${lens.tiltDeg ? `, ${lens.tiltDeg > 0 ? '+' : ''}${lens.tiltDeg}° tilt` : ''}`;

    const sun = checkFraming({ azimuth: now.azimuth, altitude: now.altitude }, aim, fov);
    // Below the horizon the framing arithmetic still runs and still answers, and
    // the answer is worthless — you cannot photograph a sun that has set. Say
    // that instead of the geometry.
    $('framing-sun').textContent =
      now.altitude <= -0.833
        ? `Sun ${Math.round(Math.abs(sun.horizontalOffsetDeg))}° ${sun.horizontalOffsetDeg >= 0 ? 'right' : 'left'} of the aim, and below the horizon.`
        : `Sun: ${sun.note}`;

    // The join, for the pin. Two things this page already knows separately —
    // where the sun is relative to the aim, and whether the sun reaches here at
    // all — and the answer a photographer wants is the pair of them together.
    // It lives here rather than in the spot box because it needs an aim, and
    // the aim is a thing you set with the lens; asserting a direction from a
    // bearing nobody chose would be the same fabrication `lighting.ts` refuses
    // for a Commons photograph.
    const litHere = spotWindows.length
      ? Boolean(skyline && isSunlit(skyline, now.azimuth, now.altitude))
      : false;
    const verdict = describeLighting({
      aimBearing: lens.bearing,
      sunAzimuth: now.azimuth,
      sunAltitude: now.altitude,
      lit: litHere,
    });
    // A spot with no windows computed has not been found to be in shade, so
    // say nothing rather than say "in shadow".
    $('framing-light').textContent =
      !spotWindows.length && now.altitude > 0
        ? ''
        : `Subject at this aim: ${verdict.note}.`;

    const moon = moonSamples[Math.min(moonSamples.length - 1, Math.max(0, minute))];
    $('framing-moon').textContent =
      moon && moon.altitude > 0 && shown.moonPath
        ? `Moon: ${checkFraming({ azimuth: moon.azimuth, altitude: moon.altitude }, aim, fov).note}`
        : '';

    // What the frame actually covers out at the ring, which is the number that
    // decides whether the whole hill fits.
    const acrossM = frameWidthAt(fov, radiusKm * 1000);
    $('framing-width').textContent = `Across ${formatDistance(radiusKm * 1000)} out, the frame covers ${formatDistance(acrossM)}.`;
  }

  /* ── The line of sight ─────────────────────────────────────────────────
     Bare-earth only, and it says so everywhere it appears. The height field is
     the one the landform shadows already loaded, so this costs a march over
     data that is in memory rather than a fetch. */

  function solveSight() {
    sight = null;
    if (!shown.sight || !centre) return;
    const field = terrainShadows?.state().field;
    if (!field) return;
    if (target.lat === 0 && target.lon === 0) return;
    sight = lineOfSight(field, centre, { lat: target.lat, lon: target.lon }, {
      targetM: target.heightM,
      samples: 320,
    });
  }

  function drawSight() {
    if (!styleReady) return;
    const source = map?.getSource(SIGHT_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    if (!shown.sight || !centre) {
      source.setData({ type: 'FeatureCollection', features: [] });
      sightMarker.remove();
      return;
    }
    sightMarker.setLngLat([target.lon, target.lat]).addTo(map!);
    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          // `clear` drives which of the two line layers draws it, so it must be
          // a real boolean even before a height field has arrived — an absent
          // property would match neither filter and the line would vanish.
          properties: { clear: sight?.clear === true },
          geometry: {
            type: 'LineString',
            coordinates: [[centre.lon, centre.lat], [target.lon, target.lat]],
          },
        },
      ],
    });
  }

  const SIGHT_CHART = { width: 320, height: 84 };

  function renderSight() {
    const box = $<HTMLElement>('sightline');
    if (!shown.sight || !centre) {
      box.hidden = true;
      return;
    }
    box.hidden = false;

    if (!sight || !sight.samples.length) {
      $('sight-ground').setAttribute('d', '');
      $('sight-ray').setAttribute('d', '');
      $('sight-block').setAttribute('cx', '-10');
      // Say which of the three reasons it is. "Waiting for the elevation" is
      // true of all of them and useful for none — at a wide view it never
      // arrives, and a message that waits forever reads as a hung feature
      // rather than as a map you need to zoom.
      const terrain = terrainShadows?.state();
      $('sight-verdict').textContent =
        sight?.note
        ?? (terrain?.tooWide
          ? 'Zoom in to load the elevation this needs.'
          : terrain?.field
            ? 'Drag the ring to what you want to see.'
            : 'Waiting for the elevation.');
      $('sight-detail').textContent = '';
      return;
    }

    const geometry = profileGeometry(sight, SIGHT_CHART.width, SIGHT_CHART.height);
    $('sight-ground').setAttribute('d', geometry.terrainPath);
    $('sight-ray').setAttribute('d', geometry.sightPath);
    const block = $('sight-block');
    block.setAttribute('cx', String(geometry.blockPoint ? geometry.blockPoint[0] : -10));
    block.setAttribute('cy', String(geometry.blockPoint ? geometry.blockPoint[1] : -10));

    $('sight-verdict').textContent = sight.note;
    const rise = sight.targetAltitudeDeg;
    $('sight-detail').textContent = [
      `${formatDistance(sight.distanceM)} ${compassPoint(sight.bearing)}`,
      rise == null ? '' : `${rise >= 0 ? '+' : ''}${rise.toFixed(1)}° above level`,
      `eye ${sight.eyeM} m${sight.targetM ? `, subject ${sight.targetM} m` : ''}`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /* ── The dome ──────────────────────────────────────────────────────────
     Split in two, because almost none of it depends on the time. The horizon
     ring, the day's own arc, the hour beads, the solstice arcs and the moon's
     path are all properties of *the day* — rebuilding six hundred trigonometric
     points on every pointer move of the slider was most of why dragging it
     stuttered. Only the sun's disc, its ray, its plumb line and the moon's
     marker actually move, and that is four points. */

  /**
   * The ground the dome stands on, in the metres the renderer is using.
   *
   * `dome.ts` states its altitudes as metres above the ground *at the centre*,
   * and `MercatorCoordinate.fromLngLat` measures from sea level. Those are the
   * same number only at the coast. Anywhere higher the whole ring was drawn
   * that far underground — on a 600 m plateau the horizon ring sat 600 m below
   * the street, the arc appeared to saw through the hills it was supposed to
   * stand over, and the sun could be buried in a ridge it was clearing by a
   * kilometre.
   *
   * Read back from the renderer rather than from the DEM on purpose:
   * `queryTerrainElevation` returns the height *with the terrain exaggeration
   * applied*, and the arc has to agree with the ground actually drawn rather
   * than with the ground as surveyed. Null means terrain is off, and then the
   * ground genuinely is the plane at zero.
   */
  let domeBaseM = 0;

  function groundUnderPin(): number {
    if (!map || !centre) return 0;
    try {
      return map.queryTerrainElevation(centre) ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Terrain height at a point, in the dome's own frame.
   *
   * For the marks that belong *on* the ground — the horizon ring, the foot of
   * the plumb line. A flat ring at the pin's own height is right only on a
   * plain; on a hillside half of it hovers and the other half is buried, which
   * is the single most obvious way this drawing used to look broken.
   */
  function groundOffsetAt(lon: number, lat: number): number {
    if (!map) return 0;
    try {
      const height = map.queryTerrainElevation({ lng: lon, lat });
      return height == null ? 0 : height - domeBaseM;
    } catch {
      return 0;
    }
  }

  /**
   * A dome point in the units both projections need.
   *
   * `altitudeM` arrives measured from the ground under the pin, which is what
   * `dome.ts` deals in; both numbers that come back are measured from sea
   * level, which is what the map deals in. `domeBaseM` is the difference.
   *
   * The metres are not a convenience — the globe projection takes elevation in
   * metres and the mercator one takes it in mercator units, and a vertex that
   * states only one of them is wrong under the other. See `dome-layer.ts`.
   */
  const projectToMercator = (lon: number, lat: number, altitudeM: number): DomeVertex => {
    const seaLevelM = altitudeM + domeBaseM;
    const m = maplibregl.MercatorCoordinate.fromLngLat({ lng: lon, lat }, seaLevelM);
    return [m.x, m.y, m.z ?? 0, seaLevelM];
  };

  /** Everything on the dome that stays put for a whole day. */
  let domeStatic: DomeGeometryData | null = null;
  const EMPTY_DOME: DomeGeometryData = {
    lines: new Float32Array(0),
    runs: [],
    points: new Float32Array(0),
  };

  function rebuildDomeStatic() {
    domeStatic = null;
    if (!map || !styleReady || !centre || !day) return;

    const radius = domeRadiusFor(radiusKm * 1000);
    const geometry = new DomeGeometry(projectToMercator);
    const ink = inkColour(basemap);

    // Sampling is a *drawing* decision here, not a smoothness one.
    //
    // The arc's weight comes from soft sprites laid along it, so the spacing of
    // the samples is the spacing of the sprites: at one point every eight
    // minutes they landed several pixels apart and the sun's path — the loudest
    // mark on the page — rendered as a chain of beads with a hairline threaded
    // through it. A ring framed in the viewport is roughly two thousand pixels
    // around, so it takes a few hundred samples before the sprites overlap into
    // a stroke. Line vertices are cheap; a dotted arc is not.
    const step = Math.max(1, Math.floor(day.samples.length / 720));
    const coarse = day.samples.filter((_, i) => i % step === 0);

    /**
     * A path on the dome: solid where the body is up, dotted where it is not.
     *
     * The dotted half is the whole reason this is a ring rather than an arc. An
     * arc that stops at the horizon tells you where the sun goes; a ring that
     * carries on underneath tells you *how* it gets there — how far round and
     * how steeply it comes back — and at a glance that is the difference between
     * a shallow northern evening and a vertical tropical one.
     *
     * Drawn as spaced points rather than as a dashed line because a GL line
     * strip has no dash pattern, and points at this spacing read as one.
     */
    const ridePath = (
      samples: Array<{ azimuth: number; altitude: number }>,
      solid: RGBA | ((index: number) => RGBA),
      dotted: RGBA,
      width = WIDTH.arc,
      dotSize = 3,
      lift: RGBA | null = null,
    ) => {
      const { above, below } = splitAtHorizon(domePath(centre!, samples, radius));
      // The whole lift first, then the whole mark: one buffer, drawn in the
      // order it was filled, so anything pushed later sits on top.
      if (lift) {
        for (const run of above) geometry.push(run, 'strip', lift, width + WIDTH.lift);
      }
      let seen = 0;
      for (const run of above) {
        // The colour callback is indexed within its own run, but a path split
        // at the horizon arrives in pieces — so the offset has to be carried
        // across or the second piece would repeat the first's colours.
        const from = seen;
        const at = typeof solid === 'function' ? (i: number) => solid(from + i) : solid;
        geometry.push(run, 'strip', at, width);
        seen += run.length;
      }
      // Evenly spaced in ring angle rather than in array index, so a coarsely
      // sampled path and a finely sampled one produce the same dotted line.
      const stride = dotStride(samples.length);
      for (const run of below) {
        geometry.push(run.filter((_, i) => i % stride === 0), 'points', dotted, dotSize);
      }
    };

    if (shown.sunPath) {
      // The horizon itself, as a ring on the ground. It is what the arc is
      // measured against — where it crosses this circle is sunrise and sunset —
      // and without it the tilt of the arc has nothing to be tilted relative to.
      // Laid on the terrain rather than on a plane through the pin. A flat ring
      // is right only where the ground is flat; on a slope it used to hover at
      // one side and vanish into the hill at the other, which read as a bug
      // rather than as the level circle it is.
      //
      // Height is sampled every four degrees and the vertices are stepped every
      // half degree between them. The two densities answer different questions:
      // the terrain does not change shape between adjacent samples, but the
      // sprites that give the ring its weight have to be a few pixels apart or
      // the circle comes out dashed. Sampling the DEM at the drawing density
      // would mean seven hundred terrain queries on every rebuild for a ground
      // profile that four degrees already describes.
      const SAMPLE_DEG = 4;
      const DRAW_DEG = 0.5;
      const seats: number[] = [];
      for (let bearing = 0; bearing <= 360; bearing += SAMPLE_DEG) {
        const point = domePosition(centre, bearing, 0, radius);
        seats.push(groundOffsetAt(point.lon, point.lat));
      }
      const horizon: Array<{ lon: number; lat: number; altitudeM: number }> = [];
      for (let bearing = 0; bearing <= 360; bearing += DRAW_DEG) {
        const at = bearing / SAMPLE_DEG;
        const low = Math.min(Math.floor(at), seats.length - 1);
        const high = Math.min(low + 1, seats.length - 1);
        const height = seats[low] + (seats[high] - seats[low]) * (at - low);
        const point = domePosition(centre, bearing, 0, radius);
        // Two metres of daylight under it: at ground level the ring disappears
        // into the terrain it is drawn on wherever the DEM and the vector map
        // disagree by a hair.
        horizon.push({ ...point, altitudeM: height + 2 });
      }
      geometry.push(horizon, 'strip', [...ink, 0.26] as RGBA, WIDTH.horizon);

      // The arc, painted with the light along it.
      //
      // It used to be one flat ink line, which said only *where* the sun goes.
      // The same curve carrying the colour of the light at each moment says
      // *when* as well: deep blue before dawn, the orange band at the horizon,
      // pale gold climbing to white at noon. It costs one lookup a vertex and
      // turns a piece of geometry into a timeline you can read at a glance.
      //
      // That lookup is now the *spectral* one, the same integral the panel's
      // swatch and the day strip come out of, rather than the hand-fitted
      // altitude ramp `sunlightColour` still drives the basemap with. Two
      // pictures of the same light, computed two different ways, were free to
      // disagree — and did, because only one of them knew where it was: the
      // ramp has no idea whether the pin is a coast or a ridge, and this does.
      const aboveHorizon = coarse.filter((s) => s.altitude > -0.5);
      const arcField = terrainShadows?.state().field ?? null;
      const arcAir = atmosphereNow(
        arcField && centre ? elevationAt(arcField, centre.lon, centre.lat) : null,
        arcField,
        currentInstant(),
      );
      const arcColour = (i: number): RGBA => {
        const sample = aboveHorizon[Math.min(i, aboveHorizon.length - 1)];
        return [...rgbOf(beamColour(sample?.altitude ?? 0, arcAir)), 0.95] as RGBA;
      };
      ridePath(coarse, arcColour, [...ink, 0.5] as RGBA, WIDTH.arc, 3.4, liftColour(basemap));

      // Hour beads. The arc they sit on is now a dark band on every basemap —
      // that is what the lift is for — so the beads are light on all of them.
      // Ink here would be dark on dark on the paper map, which is where the
      // hours became unreadable.
      const marks = hourMarks(centre, coarse, radius, timeZone);
      if (marks.length) {
        geometry.push(marks, 'points', [...liftColour(basemap).slice(0, 3), 0.55] as RGBA, 8.5);
        geometry.push(marks, 'points', [0.99, 0.99, 1, 0.95] as RGBA, 4.5, 2);
      }
    }

    // The two extremes of the year, on the same dome and in the same units as
    // today's. One day's path says where the sun goes today; these say what this
    // spot can ever do — whether a wall shaded now is shaded all year or only
    // until June.
    if (shown.solstice && solsticeDays) {
      for (const [season, reference] of [
        ['june', solsticeDays.june],
        ['december', solsticeDays.december],
      ] as const) {
        const tint: RGBA =
          season === 'june' ? [0.94, 0.68, 0.35, 0.7] : [0.52, 0.62, 0.85, 0.7];
        const referenceStep = Math.max(1, Math.floor(reference.samples.length / 120));
        const path = domePath(
          centre,
          reference.samples.filter((_, i) => i % referenceStep === 0),
          radius,
        );
        for (const run of splitAtHorizon(path).above) {
          geometry.push(run, 'strip', tint, WIDTH.solstice);
        }
      }
    }

    if (shown.corePath && coreSamples.length) {
      // A dusty violet, deliberately in neither family: the sun's arc is warm
      // and the moon's is cool silver, so a third mark in either would read as a
      // variant of one of them rather than as another object. Quieter than both,
      // because it is the only one of the three that is often not there at all.
      const coreLift = liftColour(basemap);
      ridePath(coreSamples, [0.74, 0.6, 0.95, 0.8], [0.74, 0.6, 0.95, 0.38], WIDTH.moon, 3, [
        coreLift[0],
        coreLift[1],
        coreLift[2],
        coreLift[3] * 0.5,
      ]);
    }

    if (shown.moonPath && moonSamples.length) {
      const moonCoarse = moonSamples.filter((_, i) => i % step === 0);
      // Cool silver, so it never competes with the sun's warm arc — but silver
      // on a white basemap is nothing at all, so it gets a lift of its own,
      // lighter than the sun's because it must stay the quieter of the two.
      const moonLift = liftColour(basemap);
      ridePath(moonCoarse, [0.72, 0.79, 0.92, 0.86], [0.72, 0.79, 0.92, 0.45], WIDTH.moon, 3, [
        moonLift[0],
        moonLift[1],
        moonLift[2],
        moonLift[3] * 0.6,
      ]);
    }

    domeStatic = geometry.data();
  }

  /**
   * The moving parts, merged onto the day's static geometry.
   *
   * One buffer upload either way, but the expensive half — projecting several
   * hundred points through mercator — happens once a day instead of once a
   * frame.
   */
  function updateDome() {
    if (!map || !styleReady || !centre || !day) {
      domeLayer.setGeometry(EMPTY_DOME);
      return;
    }
    // The ground under the pin arrives with the terrain tiles, not with the
    // page, and changes again when the view is switched or the terrain
    // exaggerated. A day's geometry built against the old base is in the wrong
    // place by the difference, so it is dropped rather than merged onto.
    const base = groundUnderPin();
    if (domeStatic && Math.abs(base - domeBaseM) > 0.5) domeStatic = null;
    domeBaseM = base;

    if (!domeStatic) rebuildDomeStatic();
    const now = current();
    if (!now || !domeStatic) {
      domeLayer.setGeometry(EMPTY_DOME);
      return;
    }

    const radius = domeRadiusFor(radiusKm * 1000);
    const moving = new DomeGeometry(projectToMercator);
    const ink = inkColour(basemap);
    const lift = liftColour(basemap);

    if (shown.moonPath) {
      const moonNow = currentMoon();
      if (moonNow && moonNow.altitude > -1) {
        // Cold and bright, with a small halo. The moon should look like the
        // moon and not like a second, paler sun.
        const at = domePosition(centre, moonNow.azimuth, moonNow.altitude, radius);
        moving.push([at], 'points', [lift[0], lift[1], lift[2], lift[3] * 0.8] as RGBA, 12);
        moving.push([at], 'points', [0.93, 0.95, 1, 0.98] as RGBA, 15, 2.4);
      }
    }

    if (now.altitude > -1) {
      const lit = rgbOf(sunlightColour(now.altitude));
      const sun = domePosition(centre, now.azimuth, now.altitude, radius);
      // The plumb line ends on the hillside under the sun, not at the height of
      // the pin — otherwise it stops in mid-air across a valley and buries
      // itself in a slope.
      const ground = {
        lon: sun.lon,
        lat: sun.lat,
        altitudeM: groundOffsetAt(sun.lon, sun.lat),
      };
      const origin = { lon: centre.lon, lat: centre.lat, altitudeM: 0 };

      // The ray you are actually standing in, and the plumb line down from the
      // sun — without the second one the height of the arc is ambiguous in
      // perspective. The ray fades along its length, from full at the sun to
      // nearly nothing at your feet, so it reads as light arriving rather than
      // as a stick joining two dots.
      moving.push([origin, sun], 'lines', [lift[0], lift[1], lift[2], lift[3] * 0.8] as RGBA, WIDTH.ray + WIDTH.lift);
      moving.push(
        [origin, sun],
        'lines',
        (i) => [...lit, i === 0 ? 0.32 : 1] as RGBA,
        WIDTH.ray,
      );
      moving.push([sun, ground], 'lines', [...ink, 0.4] as RGBA, WIDTH.plumb);

      // The disc itself: a hot near-white core inside a wide halo of the
      // moment's own colour. At noon that halo is pale and tight; at sunset it
      // is a broad orange bloom, which is what the sun actually looks like and
      // what makes the marker findable on a bright satellite basemap.
      const core: RGBA = [
        Math.min(1, lit[0] * 0.35 + 0.65),
        Math.min(1, lit[1] * 0.45 + 0.55),
        Math.min(1, lit[2] * 0.55 + 0.45),
        1,
      ];
      // Seated on a dark disc, for the same reason the arc is: a hot white core
      // over a white plaza is nothing. The seat is only a little wider than the
      // core — enough to give it an edge, not enough to read as a ring of its
      // own — and the halo is wider than both.
      moving.push([sun], 'points', [lift[0], lift[1], lift[2], lift[3] * 0.9] as RGBA, 16);
      moving.push([sun], 'points', [...lit, 0.95] as RGBA, 26, 3.4);
      moving.push([sun], 'points', core, 13);
    }

    domeLayer.setGeometry(mergeDomeGeometry(domeStatic, moving.data()));
    map.triggerRepaint();
  }

  /* ── Lighting ────────────────────────────────────────────────────────── */

  /** How much of the direct light survives the forecast cloud, 0–1. */
  function cloudScale(): number {
    const instant = currentInstant();
    if (!weather || !instant) return 1;
    // Never below a quarter: even under solid cloud the geometry is worth seeing
    // faintly, and fading it to nothing would look like the feature had broken.
    //
    // Reads the deck split where the forecast has it, so cirrus over a clear sun
    // no longer softens a shadow that would in fact still have an edge. Falls
    // back to the plain total where it does not.
    return 0.25 + 0.75 * directLightFractionFor(hourAt(weather, instant));
  }

  /**
   * The sun's colour for the map's own paint, from the same integral as the rest.
   *
   * Spectral while the sun is up, so the hillshade's highlight and the sky's
   * horizon are graded by *this place's* air rather than by a ramp that knows
   * only the altitude — a hazy coast and a clear ridge had been drawn with the
   * same light at the same hour.
   *
   * Below the horizon it falls back to the ramp, and that is not a compromise:
   * there is no beam to have a colour, and `sunlightColour`'s twilight hues are
   * a deliberate *look* rather than a measurement of anything. Also the fallback
   * before a place is chosen, when there is no air to speak of.
   */
  function sunPaintColour(altitude: number, air: ReturnType<typeof atmosphereNow> | null): string {
    return altitude > 0 && air ? beamColour(altitude, air) : sunlightColour(altitude);
  }

  function applySunLight() {
    if (!map || !styleReady) return;
    const now = current();
    const altitude = now?.altitude ?? -90;
    const azimuth = now?.azimuth ?? 0;

    // Computed once and handed on: this runs inside the batched frame, and the
    // sky wants the same answer the hillshade just got.
    const field = terrainShadows?.state().field ?? null;
    const air =
      centre && altitude > 0
        ? atmosphereNow(
            field ? elevationAt(field, centre.lon, centre.lat) : null,
            field,
            currentInstant(),
          )
        : null;

    map.setLight({
      anchor: 'map',
      // Hue from the sun, brightness from the buildings themselves — MapLibre
      // multiplies one by the other, so a literal sunlight colour here crushes
      // the whole city towards black at exactly the hours worth scouting.
      position: lightPosition(azimuth, altitude),
      color: extrusionLightColour(altitude),
      intensity: directionalIntensity(altitude),
    });

    const set = (layer: string, property: string, value: unknown) => {
      try {
        map!.setPaintProperty(layer, property, value as never);
      } catch {
        /* layer not present yet */
      }
    };

    const wash = daylightWash(altitude);
    set('scout-daylight', 'fill-color', wash.colour);
    set('scout-daylight', 'fill-opacity', wash.opacity);

    set('scout-hillshade', 'hillshade-illumination-direction', Math.round(azimuth) % 360);
    set('scout-hillshade', 'hillshade-highlight-color', sunPaintColour(altitude, air));
    set('scout-hillshade', 'hillshade-shadow-color', shadowColour(altitude));
    // Deeper relief when the sun is low and raking, flat when it is overhead or
    // gone — the same reason the buildings' side-lighting peaks at dawn.
    set(
      'scout-hillshade',
      'hillshade-exaggeration',
      altitude > 0 ? 0.28 + 0.34 * Math.max(0, 1 - altitude / 25) : 0.1,
    );

    set('scout-shadows', 'fill-color', shadowColour(altitude));
    set('scout-shadows', 'fill-opacity', shadowFade(altitude, cloudScale()));
    // The custom layer holds the same ramp as a uniform. A shadow at dawn is a
    // different colour from one at noon, and that has to survive the change of
    // renderer or the two draw visibly different pictures.
    shadowLayer.tint = rgbOf(shadowColour(altitude));
    shadowLayer.opacity = cloudScale();
    set('scout-slab-shadow', 'fill-opacity', 0.55 * cloudScale());
    set('scout-buildings', 'fill-extrusion-color', buildingRamp(altitude, themeOf(basemap)));
    applySky(altitude, air);
  }

  function applySky(altitude: number, air: ReturnType<typeof atmosphereNow> | null) {
    if (!map) return;
    try {
      map.setSky({
        'sky-color': skyColour(altitude),
        'horizon-color': sunPaintColour(altitude, air),
        'fog-color': skyColour(Math.min(altitude, 2)),
        'sky-horizon-blend': 0.55,
        'horizon-fog-blend': 0.55,
        'fog-ground-blend': 0.08,
      });
    } catch {
      /* older builds without sky support simply go without */
    }
  }

  /* ── Building shadows ────────────────────────────────────────────────── */

  let shadowStats = { cast: 0, estimated: 0, longestM: 0, tooFar: false, omitted: 0 };
  /** The footprints near the centre, kept for the skyline. */
  let nearby: Array<{ ring: Ring; height: number; estimated: boolean }> = [];
  /**
   * Everything in range to cast, gathered once per view rather than per frame,
   * each footprint carrying its own hull.
   *
   * The hull is computed once per gather and read by both passes — the cast and
   * the blocker depth map — because both used to derive it per building per
   * frame. See `ShadowOptions.hull`.
   */
  let castable: Array<{ ring: Ring; height: number; estimated: boolean; hull?: Ring }> = [];
  /**
   * The box `castable` was collected from.
   *
   * Kept because the hotspots are up to 2 km from the pin and this box is not:
   * it is bounded by the viewport. A spot outside it has no buildings loaded
   * around it, and a skyline built from an empty set says "lit all day" for a
   * courtyard — the one kind of error a scouting tool must never make quietly.
   * `buildingsCover` turns that into a stated absence instead.
   */
  let castableBox: { west: number; south: number; east: number; north: number } | null = null;
  /**
   * What `castable` was last gathered from, so a gather that found the same
   * buildings can stop rather than reassigning and forcing a recast. Cleared,
   * not just recomputed, wherever `castable` is emptied or the layers holding
   * its output are thrown away — a signature that outlived its geometry would
   * skip the one gather that had to happen.
   */
  let castableSignature = '';

  /**
   * The widest the length cap ever opens, whatever the sun is doing.
   *
   * The collection box used to be built from the *current* sun's throw, which
   * meant the set of buildings changed as the slider moved: buildings entered
   * and left the box on their own schedule and their shadows popped in and out
   * of existence mid-scrub. Gathering against a fixed margin instead makes the
   * set a property of where you are looking, so shadows only ever lengthen and
   * swing — which is the only thing they should do when time passes.
   */
  const COLLECT_MARGIN_M = maxShadowLength(90);

  /**
   * Gather the footprints worth casting. Expensive, and deliberately not on the
   * slider's path: `querySourceFeatures` walks every loaded tile.
   */
  function collectBuildings() {
    if (!map || !styleReady || !centre) return;

    if (map.getZoom() < BUILDING_MIN_ZOOM || !shown.buildings) {
      castable = [];
      castableSignature = '';
      castableBox = null;
      nearby = [];
      shadowStats = {
        cast: 0,
        estimated: 0,
        longestM: 0,
        omitted: 0,
        tooFar: map.getZoom() < BUILDING_MIN_ZOOM,
      };
      invalidate({ shadows: true });
      renderFacts();
      return;
    }

    let features: GeoJSON.Feature[] = [];
    try {
      features = map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' });
    } catch {
      return;
    }

    // Only what is on screen, plus a margin for shadows falling in from just
    // outside it. Without this a single Shibuya MultiPolygon contributes nearly
    // twelve thousand sub-polygons, most of them off the edge of the map.
    const bounds = map.getBounds();
    const viewport = padBounds(
      {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      },
      COLLECT_MARGIN_M,
    );

    // Bounded three ways, and the tightest wins. A pitched camera sees to the
    // horizon: at 55° over Tokyo the viewport alone catches thirty-seven
    // thousand buildings, nearly all far past anywhere a shadow could reach.
    const centreOfView = map.getCenter();
    const [vw, vs, ve, vn] = boundingBox(
      { lat: centreOfView.lat, lon: centreOfView.lng },
      Math.max(1200, COLLECT_MARGIN_M * 1.5),
    );
    const [rw, rs, re, rn] = boundingBox(centre, radiusKm * 1000);
    const box = {
      west: Math.max(viewport.west, vw, rw),
      south: Math.max(viewport.south, vs, rs),
      east: Math.min(viewport.east, ve, re),
      north: Math.min(viewport.north, vn, rn),
    };
    castableBox = box;

    // The same building appears once per tile it touches, so dedupe before
    // casting — otherwise a block on a tile seam gets a doubly dark shadow.
    const seen = new Set<string>();
    const buildings: Array<{ ring: Ring; height: number; estimated: boolean; hull?: Ring }> = [];
    const close: typeof buildings = [];
    let estimated = 0;

    for (const feature of features) {
      const height = buildingHeight(feature.properties as Record<string, unknown>);
      if (!(height > 0)) continue;
      const geometry = feature.geometry;
      const polygons =
        geometry.type === 'Polygon'
          ? [geometry.coordinates]
          : geometry.type === 'MultiPolygon'
            ? geometry.coordinates
            : [];
      const isEstimated = heightIsEstimated(feature.properties as Record<string, unknown>);
      for (const polygon of polygons) {
        const ring = polygon[0] as Ring;
        if (!ring || ring.length < 4) continue;
        if (!ringIntersects(ring, box)) continue;
        const key = `${ring[0][0].toFixed(6)},${ring[0][1].toFixed(6)},${height}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (isEstimated) estimated++;
        const entry = { ring, height, estimated: isEstimated };
        buildings.push(entry);
        // Within reach of the pin: the ones that can put it in shade.
        if (distance(centre, { lat: ring[0][1], lon: ring[0][0] }) < SKYLINE_RADIUS_M) {
          close.push(entry);
        }
      }
    }

    // Tallest first, then cut — and cut *here*, once, so the same buildings are
    // drawn all day. If there is more in view than can be cast smoothly, the
    // ones worth keeping are the ones throwing the long shadows.
    let omitted = 0;
    if (buildings.length > MAX_SHADOW_BUILDINGS) {
      buildings.sort((a, b) => b.height - a.height);
      omitted = buildings.length - MAX_SHADOW_BUILDINGS;
      buildings.length = MAX_SHADOW_BUILDINGS;
    }

    // Almost every gather returns exactly what the last one did.
    //
    // `sourcedata` fires per tile, so at a city zoom this runs dozens of times
    // a second, and once the tiles around a viewport have settled the set stops
    // changing while the events do not. Assigning `castable` a fresh array
    // regardless was quietly expensive: the recast guard below holds the set by
    // *reference*, so a new array for identical buildings looked like new
    // buildings and bought a full four-thousand-building recast — about 9 ms —
    // for every one of those bursts.
    //
    // The pin is in the signature because `close` is filtered by distance from
    // it, so the same buildings around a moved pin are not the same answer.
    const signature = `${buildingSetSignature(buildings)}@${centre.lat},${centre.lon}`;
    if (signature === castableSignature) return;
    castableSignature = signature;

    // Hull each footprint once, here, rather than once per building per minute
    // inside `castShadow` — see `ShadowOptions.hull`. Deliberately *after* the
    // signature check: a gather that returns the set we already hold does no
    // work at all, and at a city zoom `sourcedata` brings dozens a second.
    for (const building of buildings) building.hull = convexHull(building.ring);

    castable = buildings;
    shadowStats = { cast: 0, estimated, longestM: 0, omitted, tooFar: false };

    // The skyline does not depend on the time at all, so it is rebuilt with the
    // buildings rather than with the sun.
    //
    // Compared by content, not by count. A pan that brings one building in as
    // another leaves keeps the length identical, and this used to read that as
    // "nothing changed" — leaving the spot's light windows, the basis line
    // under them and the shade overlay on the slider track describing buildings
    // that are no longer there.
    nearby = close;
    rebuildSpot();

    invalidate({ shadows: true });
    renderFacts();
  }

  /**
   * What the polygons currently on the map were cast from: the set itself, held
   * by reference so that re-gathering invalidates it on its own, and the two
   * numbers that decide where a shadow lands.
   */
  let lastCast: { set: typeof castable; azimuth: number; ratio: number } | null = null;

  /** Cast the gathered set at the sun of the moment. Cheap enough for a frame. */
  function castCurrentShadows() {
    if (!map || !styleReady) return;
    const source = map.getSource(SHADOW_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;

    const now = current();
    if (!now || now.altitude <= 0 || !shown.buildings || !castable.length) {
      source.setData({ type: 'FeatureCollection', features: [] });
      shadowLayer.setShadows(EMPTY_GEOMETRY);
      map.triggerRepaint();
      shadowStats.cast = 0;
      shadowStats.longestM = 0;
      lastCast = null;
      return;
    }

    // Casting is 3 ms; rebuilding and re-uploading the geometry for up to four
    // thousand buildings is the rest of the frame, and it is the largest single
    // cost on the slider's path either way round. A cast shadow is fixed by
    // exactly two things — the bearing it points along and how far it reaches —
    // so when neither has moved enough to shift a polygon by more than about a
    // pixel, what is already on the map *is* the answer and rebuilding it buys
    // nothing. (Azimuth crossing north reads as a 360° jump and simply recasts,
    // which is the harmless direction to be wrong in.)
    const ratio = 1 / Math.tan((now.altitude * Math.PI) / 180);
    if (
      lastCast &&
      lastCast.set === castable &&
      Math.abs(now.azimuth - lastCast.azimuth) < 0.1 &&
      Math.abs(ratio - lastCast.ratio) < 0.005 * lastCast.ratio
    ) {
      return;
    }

    const options = { maxLengthM: maxShadowLength(now.altitude) };

    if (glShadows) {
      const result = castPrisms(castable, now.azimuth, now.altitude, options);
      const geometry = new ShadowGeometry(projectFlat);
      for (const prism of result.prisms) {
        geometry.addShadow(prism.ring, prism.ceilings, shadowDarkness(prism.lengthM, now.altitude));
      }

      // The monolith joins the same pass rather than keeping its own layer.
      // Two fill layers would pool against each other exactly the way crossing
      // shadows used to, and the one shadow here cast from a height that was
      // *stated* is the last one that should be drawn twice over.
      const slabShadow = monolithShadow(now);
      if (slabShadow) geometry.addShadow(slabShadow.ring, slabShadow.ceilings, 0.55);

      ensureBlockers();
      shadowLayer.setShadows(geometry.shadowVertices());
      map.triggerRepaint();
      shadowStats.cast = result.cast;
      shadowStats.longestM = result.longestM;
    } else {
      const result = castShadows(castable, now.azimuth, now.altitude, options);
      source.setData(result.collection);
      shadowStats.cast = result.cast;
      shadowStats.longestM = result.longestM;
    }

    lastCast = { set: castable, azimuth: now.azimuth, ratio };
  }

  const EMPTY_GEOMETRY = new Float32Array(0);

  const projectFlat = (lon: number, lat: number): [number, number] => {
    const m = maplibregl.MercatorCoordinate.fromLngLat({ lng: lon, lat });
    return [m.x, m.y];
  };

  /** What the blocker buffer was last built from. */
  let blockerSet: typeof castable | null = null;
  let blockerSlab = '';

  /**
   * Hand the layer the things a shadow can land on — but only when they have
   * actually changed.
   *
   * Everything gathered goes in, not just what threw a shadow: a building with
   * no height on record casts nothing, but it is still standing, and a shadow
   * crossing it should stop at its roof rather than be painted through it.
   *
   * The set turns over when the view moves or the monolith does, and at no
   * other time — so scrubbing a whole day rebuilds it exactly never, which is
   * the point of keeping it out of the shadow buffer.
   */
  function ensureBlockers() {
    const slabKey =
      shown.monolith && centre ? `${slab.lon},${slab.lat},${slab.heightM},${slab.sizeM}` : '';
    if (blockerSet === castable && blockerSlab === slabKey) return;
    blockerSet = castable;
    blockerSlab = slabKey;

    const geometry = new ShadowGeometry(projectFlat);
    for (const building of castable) {
      geometry.addBlocker(building.ring, building.height, building.hull);
    }
    if (slabKey) geometry.addBlocker(monolithFootprint(), slab.heightM);
    shadowLayer.setBlockers(geometry.blockerVertices());
  }

  /** The monolith's footprint, wherever it currently stands. */
  const monolithFootprint = (): Ring => squareFootprint({ lat: slab.lat, lon: slab.lon }, slab.sizeM);

  /** The monolith's shadow, or null when it is not down or there is no sun. */
  function monolithShadow(now: { azimuth: number; altitude: number }) {
    if (!shown.monolith || !centre || !(now.altitude > 0)) return null;
    // Given its own length cap: this height is known, so there is no reason to
    // cut its shadow short the way a guessed one is cut short.
    return castShadow(monolithFootprint(), slab.heightM, now.azimuth, now.altitude, {
      maxLengthM: 4000,
    });
  }

  /* ── Landform shadows ────────────────────────────────────────────────── */

  function refreshTerrain() {
    if (!map || !terrainShadows || !shown.landform) return;
    // Nothing to shade until somewhere has been chosen. Without this the page
    // opens on the whole world and asks for elevation to cover it, which is
    // both meaningless and, before `MAX_TILES` existed, catastrophic.
    if (!centre) return;
    const bounds = map.getBounds();
    void terrainShadows
      .ensureField({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      })
      .then(() => {
        paintTerrain();
        // The elevation grid is also what the pin's horizon is built from, so a
        // freshly loaded field is a reason to recompute the spot's day.
        rebuildSpot();
        renderFacts();
      });
  }

  function paintTerrain(moving = false) {
    if (!terrainShadows || !shown.landform) return;
    const now = current();
    terrainShadows.update(
      now?.azimuth ?? 0,
      now?.altitude ?? -90,
      {
        beforeId: map?.getLayer('scout-shadows') ? 'scout-shadows' : BELOW_LABELS,
        colour: [10, 14, 26],
        // Landform shade is deeper than a building's — a mountain shadow is a
        // whole valley out of the sun, not a strip across a street.
        opacity: 0.5 * cloudScale(),
      },
      moving,
    );
  }

  /* ── The spot's own day ──────────────────────────────────────────────── */

  /**
   * What blocks the sun *here*, and therefore when the light arrives.
   *
   * Two profiles, measured differently and merged: the buildings around the pin
   * as exact geometry, and the landscape as a ray cast over the elevation grid.
   * Kept apart until the last moment so each stays honest about its own method.
   */
  function rebuildSpot() {
    if (!centre || !day) {
      spotWindows = [];
      skyline = null;
      renderSpot();
      return;
    }

    let profile = buildSkyline(centre, nearby);
    const field = terrainShadows?.state().field;
    if (field) {
      const horizon = terrainHorizon(field, centre.lon, centre.lat, { stepDeg: 1, radiusM: 30_000 });
      if (horizon.elevationM != null) profile = mergeHorizon(profile, horizon);
    }
    skyline = profile;
    spotWindows = lightWindows(profile, day.samples.slice(0, 1440));

    // The shade mask over the slider track — the day's phases underneath, this
    // spot's own shadow over the top.
    timeInput.style.setProperty('--scout-shade', shadeOverlayGradient(spotWindows));
    renderSpot();

    // Every input the hotspots' own light depends on — the buildings, the
    // terrain field, the date — has just been settled for the pin, and they
    // share all three. Guarded by its own signature, so a rebuild that changes
    // nothing costs one string compare.
    rebuildHotspotLight();
    drawHotspots();
    renderBest();
    renderSheetLight();

  }

  /** The countdown, which is the only part of the spot box that ticks. */
  function renderSpotNext() {
    if (!day || !spotWindows.length) {
      $('spot-next').textContent = '';
      return;
    }
    $('spot-next').textContent = describeNextChange(
      nextChange(spotWindows, Math.min(minute, 1439)),
      day.dayStart,
      timeZone,
    );
  }

  function renderSpot() {
    if (!day || !centre) {
      $('spot-windows').textContent = '—';
      $('spot-next').textContent = '';
      $('spot-basis').textContent = '';
      return;
    }
    $('spot-windows').textContent = describeLightWindows(spotWindows, day.dayStart, timeZone);
    renderSpotNext();

    // Say what the answer rests on. A timeline computed from eleven buildings
    // and no elevation is a different claim from one computed from four hundred
    // and a loaded terrain grid, and they must not look alike.
    const field = terrainShadows?.state().field;
    const parts: string[] = [];
    parts.push(
      skyline?.considered
        ? `${skyline.considered} building${skyline.considered === 1 ? '' : 's'} in range`
        : 'no buildings loaded here',
    );
    parts.push(field ? 'terrain included' : 'terrain not loaded');
    if (skyline?.estimated) parts.push(`${skyline.estimated} height${skyline.estimated === 1 ? '' : 's'} estimated`);
    if (skyline?.enclosed) parts.push('the pin is inside a building');
    $('spot-basis').textContent = `From ${parts.join(' · ')}.`;
  }

  /* ── Panel ───────────────────────────────────────────────────────────── */

  /** The parts that only change when the *place* does. */
  function renderPanel() {
    // Every path that changes where you are ends up here, so this is the one
    // place the star and the notebook have to be told about it. The notebook
    // belongs to a spot, not to the page: moving the pin off a kept place must
    // take its note off the panel with it.
    renderStar();
    renderNotebook();
    if (!centre) {
      $<HTMLElement>('panel').hidden = true;
      return;
    }
    $<HTMLElement>('panel').hidden = false;
    $('panel-name').textContent = label.name;
    $('panel-detail').textContent = label.detail;
    $('sheet-name').textContent = label.name;
    renderLive();
    renderFacts();
  }

  /**
   * The parts that change with the slider — and nothing else.
   *
   * Everything here is a handful of string writes. The elevation lookup that
   * used to sit among them is a bilinear sample of the height field and belongs
   * with the facts, which settle rather than track.
   */
  function renderLive() {
    if (!centre) return;
    const now = current();
    const up = Boolean(now && now.altitude > -0.833);

    $('c-azimuth').textContent = now && up ? bearingLabel(now.azimuth) : '—';
    $('c-altitude').textContent = now ? `${now.altitude.toFixed(1)}°` : '—';
    $('c-shadow').textContent = now ? formatShadowRatio(now.altitude) : '—';

    // The one line visible when the panel is shut, so it has to be the three
    // numbers you would otherwise open it for.
    $('panel-glance').textContent = now
      ? `${up ? bearingLabel(now.azimuth) : 'sun down'} · ${now.altitude.toFixed(1)}° · ${formatShadowRatio(now.altitude)}`
      : '';

    markCurrentEvent();
    renderMoonNow();
    renderWeather();
    renderSpotNext();
    // The join, on the slider's clock. All three read precomputed windows —
    // no skyline is built here — so scrubbing stays a lookup and a sort.
    drawHotspots();
    renderBest();
    renderSheetLight();
  }

  /**
   * What the light here is *like*, as opposed to where it is.
   *
   * The geometry has always been exact and said nothing about quality: the same
   * sun at the same altitude is hard and blue over a dry ridge and soft and
   * white over a tropical coast, and the difference is entirely the air in
   * between. `atmosphere.ts` computes it; this decides what may honestly be fed
   * in.
   *
   * Elevation comes from the DEM already loaded, so the mountain half is
   * measured. The aerosol half is not — nothing here can sample the air — but
   * how much *sea* surrounds the pin can be measured, from the same height
   * field, and sea air is the thing that makes coastal light soft and white.
   * That is an inference from real terrain rather than a guess, and it is
   * labelled as an inference.
   */
  /**
   * The atmosphere over the pin, as the light model wants it.
   *
   * Everything that draws the light's colour goes through here — the panel's
   * swatch, the day strip and the arc on the dome — so the three can never be
   * computed from different air. Where a measurement exists it is used and
   * labelled; where none does, the table is used and labelled.
   */
  function atmosphereNow(
    elevation: number | null,
    field: HeightField | null | undefined,
    instant: Date | null,
  ) {
    const sea = seaFraction(field);
    const aerosol = aerosolFor({ aod550: instant ? aodAt(air, instant) : null, seaFraction: sea });
    // The dew point comes from the forecast that was being fetched anyway.
    const hour = weather && instant ? hourAt(weather, instant) : null;
    const dew = hour?.dewPointC ?? null;
    return {
      elevationM: elevation ?? 0,
      aerosol: aerosol.value,
      waterCm: dew == null ? undefined : precipitableWater(dew),
      provenance: {
        aerosol,
        water:
          dew == null
            ? 'water column assumed temperate'
            : `water column ${precipitableWater(dew).toFixed(1)} cm, from a ${dew.toFixed(0)}° dew point`,
        elevation:
          elevation == null
            ? 'elevation assumed at sea level'
            : `${Math.round(elevation)} m, from the DEM`,
      },
    };
  }

  /** The beam's colour at an altitude, from the same model as everything else. */
  function beamColour(altitudeDeg: number, air: ReturnType<typeof atmosphereNow>): string {
    // Floored rather than allowed to run to the horizon. Below about a quarter
    // of a degree the air mass runs away, the modelled beam is a rounding error
    // and its chromaticity stops meaning anything — while the arc still has
    // vertices there that have to be some colour.
    return chromaticityToSrgb(
      spectralLight({
        altitudeDeg: Math.max(0.25, altitudeDeg),
        elevationM: air.elevationM,
        aerosol: air.aerosol,
      }).sun,
    );
  }

  function renderLightQuality(elevation: number | null, field: HeightField | null | undefined) {
    const cell = $('f-light');
    const swatch = $('light-swatch');
    const text = $('light-text');
    const now = current();
    if (!now || !(now.altitude > 0)) {
      text.textContent = now ? 'no direct sun' : '—';
      swatch.style.removeProperty('background');
      cell.title = '';
      renderLightDay(elevation, field);
      return;
    }

    const air = atmosphereNow(elevation, field, now.date);
    const reading = readLight({ altitudeDeg: now.altitude, ...air });

    text.textContent = `${Math.round(reading.sun.cct / 50) * 50} K · ${reading.contrastStops.toFixed(1)} stops`;
    swatch.style.background = chromaticityToSrgb(reading.sun);

    // The provenance, where there is room for it: which parts were measured.
    // "Clear sky" is not a hedge here, it is the model's actual scope — Bird is
    // a clear-sky model and cloud is never an input to it.
    const cover = weather ? blockingCover(hourAt(weather, now.date)) : null;
    cell.title = [
      `EV ${reading.ev100.toFixed(1)} at ISO 100`,
      air.provenance.elevation,
      air.provenance.aerosol.note,
      air.provenance.water,
      cover != null && cover > 25
        ? `clear-sky model — ${Math.round(cover)}% cloud will change this`
        : 'clear-sky model',
    ].join(' · ');

    renderLightDay(elevation, field);
  }

  /**
   * The day's light as a strip.
   *
   * A colour temperature at one minute answers "what do I set the camera to";
   * it cannot answer "when is this place worth photographing", which is a shape
   * over a day and is what someone opens this page for. Built from the same
   * `spectralLight` as the swatch beside it and the arc on the map.
   */
  function renderLightDay(elevation: number | null, field: HeightField | null | undefined) {
    const box = $<HTMLElement>('lightday');
    if (!day || !centre) {
      box.hidden = true;
      return;
    }
    const air = atmosphereNow(elevation, field, currentInstant());

    // Every twelfth minute: 120 stops across the day, which is finer than the
    // strip is wide in pixels and costs one spectral integral each, once a day.
    const stops: string[] = [];
    const STEP = 12;
    for (let i = 0; i < MINUTES_PER_DAY; i += STEP) {
      const sample = day.samples[i];
      const percent = ((i / MINUTES_PER_DAY) * 100).toFixed(1);
      // Night is not a colour of sunlight, it is the absence of one, and
      // painting the twilight ramp here would invent a beam that is not there.
      const colour = sample && sample.altitude > 0 ? beamColour(sample.altitude, air) : '#00000000';
      stops.push(`${colour} ${percent}%`);
    }
    box.hidden = false;
    $<HTMLElement>('lightday-strip').style.background = `linear-gradient(to right, ${stops.join(', ')})`;
    $('lightday-note').textContent = `The beam's own colour through the day · ${air.provenance.aerosol.basis === 'measured' ? 'aerosol measured' : 'aerosol from a table'}`;
  }

  /**
   * How much of the loaded terrain is at or below sea level.
   *
   * A proxy for maritime air, and an honest one: it measures the ground, not
   * the atmosphere, and the caller says so. Null when there is no field to
   * measure, because assuming a coast is as wrong as assuming a desert.
   */
  let seaField: HeightField | null = null;
  let seaCached: number | null = null;

  function seaFraction(field: HeightField | null | undefined): number | null {
    if (!field || !field.heights.length) return null;
    // Held against the field itself: this runs on every settle and the answer
    // cannot change until a new field is loaded.
    if (field === seaField) return seaCached;
    let sea = 0;
    // Every sixteenth sample: this runs on settle, and the answer is a ratio
    // that does not need every cell to be stable.
    let counted = 0;
    for (let i = 0; i < field.heights.length; i += 16) {
      if (field.heights[i] <= 1) sea++;
      counted++;
    }
    seaField = field;
    seaCached = counted ? sea / counted : null;
    return seaCached;
  }

  function renderFacts() {
    if (!centre) return;
    $('f-coords').textContent = formatCoords(centre);
    $('f-radius').textContent = formatDistance(radiusKm * 1000);

    const elevationField = terrainShadows?.state().field;
    const elevation = elevationField ? elevationAt(elevationField, centre.lon, centre.lat) : null;
    $('c-elevation').textContent = elevation == null ? '—' : `${Math.round(elevation)} m`;

    renderLightQuality(elevation, elevationField);

    const now = current();
    const up = Boolean(now && now.altitude > -0.833);
    const ratio = now ? shadowLengthRatio(now.altitude) : Infinity;
    $('f-throw').textContent = !up
      ? '—'
      : Number.isFinite(ratio)
        ? `throws ${formatDistance(ratio * 10)}`
        : // Above the sunrise threshold but at or below the true horizon: the
          // disc is only visible because of refraction, and the shadow it casts
          // has no length worth quoting.
          'sun on the horizon';

    const cell = $('f-buildings');
    if (!shown.buildings) cell.textContent = 'off';
    else if (shadowStats.tooFar) cell.textContent = 'zoom in for shadows';
    else if (!shadowStats.cast) cell.textContent = up ? 'none in view' : '—';
    else {
      // Say when heights were guessed, and say when the cap bit — near the
      // horizon a whole city is within casting range, and silence here would let
      // a triaged shadow map pass for a complete one.
      const guessed = shadowStats.estimated ? ` · ${shadowStats.estimated} est.` : '';
      cell.textContent = shadowStats.omitted
        ? `${shadowStats.cast} tallest of ${(shadowStats.cast + shadowStats.omitted).toLocaleString('en-GB')}${guessed}`
        : `${shadowStats.cast} casting${guessed}`;
    }

    const photos = $('f-photos');
    if (!shown.photos) photos.textContent = 'off';
    // A wide radius is a dozen round trips to Commons. Saying nothing for ten
    // seconds and then saying "nothing found" is indistinguishable from being
    // broken, so the search says it is still going.
    else if (photoSearching) photos.textContent = 'searching…';
    else if (!hotspots.length) photos.textContent = 'nothing found';
    else {
      const total = hotspots.reduce((n, spot) => n + spot.count, 0);
      photos.textContent = `${total} in ${hotspots.length} spot${hotspots.length === 1 ? '' : 's'}`;
    }

    const landform = $('f-landform');
    const state = terrainShadows?.state();
    if (!shown.landform) landform.textContent = 'off';
    else if (state?.tooWide) landform.textContent = 'zoom in for landform';
    else if (!state?.field) landform.textContent = 'loading elevation…';
    else if (state.tilesMissing) landform.textContent = `${state.tilesMissing} tiles missing`;
    else {
      // Deliberately *not* the fraction of the field in shade. The field is
      // padded well past the viewport, and around a coastline most of that
      // padding is open sea, which is never in terrain shadow and dragged the
      // number towards zero however deep the valley you were looking at. It
      // read as a fact about the view and was a fact about the ocean.
      //
      // The pin's own state is the one that is both unambiguous and worth
      // knowing, and it is measured at the pin rather than averaged over
      // anything.
      const shaded = terrainShadowAt(
        state.field,
        centre.lon,
        centre.lat,
        current()?.azimuth ?? 0,
        current()?.altitude ?? -90,
      );
      const resolution = `${Math.round(state.field.scaleM[Math.floor(state.field.height / 2)])} m grid`;
      landform.textContent =
        shaded == null
          ? `off the grid · ${resolution}`
          : shaded
            ? `pin in shade · ${resolution}`
            : `sun on the pin · ${resolution}`;
    }
  }

  /**
   * The event rows, built once per day rather than once per pointer move.
   *
   * They only change when the day does — dragging the slider changes which row
   * is *current*, and that is one class on one element. Rebuilding thirteen
   * buttons and their listeners sixty times a second was smooth enough to get
   * away with and wasteful enough not to.
   */
  function renderEvents() {
    if (!day) return;
    const build = (rows: SunEventRow[], into: HTMLElement) => {
      into.replaceChildren(
        ...rows.map((row) => {
          const li = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';

          const name = document.createElement('span');
          name.className = 'ev-label';
          name.textContent = row.label;

          const when = document.createElement('span');
          when.className = 'ev-time';
          if (!row.start) {
            // A day with no sunrise has no sunrise to print. Saying so is the
            // answer; dropping the row would leave the reader to notice a gap.
            when.textContent = 'none today';
            button.disabled = true;
          } else if (row.end) {
            when.textContent = `${formatClock(row.start, timeZone)} → ${formatClock(row.end, timeZone)}`;
          } else {
            when.textContent = formatClock(row.start, timeZone);
          }

          const target = row.start ? minuteFor(row.start) : null;
          if (target == null) button.disabled = true;
          // Kept on the element so the highlight pass can read the window back
          // without recomputing every event time.
          if (target != null) {
            when.dataset.from = String(target);
            when.dataset.to = String(row.end ? (minuteFor(row.end) ?? target) : target);
          }

          button.append(name, when);
          button.addEventListener('click', () => {
            if (target != null) setMinute(target);
          });
          li.append(button);
          return li;
        }),
      );
    };

    build(sunEventRows(day.times), $('events'));
    build(twilightRows(day.times), $('twilight'));
    markCurrentEvent();
  }

  /** Light up whichever event the slider is sitting in. */
  function markCurrentEvent() {
    for (const element of document.querySelectorAll<HTMLElement>('.events .ev-time')) {
      const from = Number(element.dataset.from);
      const to = Number(element.dataset.to);
      if (!Number.isFinite(from)) continue;
      // An instant gets a couple of minutes of grace either side; a window is
      // current for as long as it lasts.
      const inside = to > from ? minute >= from && minute < to : Math.abs(minute - from) <= 2;
      element.classList.toggle('ev-now', inside);
    }
  }

  /** Moonrise and moonset: a property of the day, so computed once per day. */
  function renderMoonDay() {
    if (!centre || !day) return;
    const times = moonTimes(centre.lat, centre.lon, day.dayStart, day.times.dayEnd, 5);
    const clock = (date: Date | null) => (date ? formatClock(date, timeZone) : '—');
    $('moon-times').textContent = times.alwaysUp
      ? 'Up all day'
      : times.alwaysDown
        ? 'Down all day'
        : `Rises ${clock(times.rise)} · sets ${clock(times.set)}`;
  }

  /**
   * The night that *follows* the chosen date, noon to noon.
   *
   * Not the solar day the rest of the page runs on. That one starts at solar
   * midnight, which cuts a night in half — the first hours of tonight would sit
   * at one end of the slider and the rest at the other, and "the core rises at
   * 23:40" would be reported against a day that had already ended. Noon to noon
   * contains exactly one night, which is the thing being asked about.
   */
  function nightWindow(): { from: Date; to: Date } | null {
    if (!day) return null;
    const noon = day.dayStart.getTime() + 12 * 3_600_000;
    return { from: new Date(noon), to: new Date(noon + 24 * 3_600_000) };
  }

  /** The core's arc, built only while the layer is on. */
  function rebuildCore() {
    const window = nightWindow();
    coreSamples =
      centre && window && shown.corePath
        ? coreTrack(centre.lat, centre.lon, window.from, window.to, 5)
        : [];
  }

  /**
   * The core's night: three conditions, and which of them failed.
   *
   * Reported for the whole night rather than for the slider's minute, because
   * unlike the sun and the moon this is not a question about a moment. Nobody
   * scrubs to find the core; they want to know whether tonight is worth driving
   * out for, and that is a window or it is nothing.
   */
  function renderCoreDay() {
    const window = nightWindow();
    if (!centre || !window) return;

    const night = coreNight(centre.lat, centre.lon, window.from, window.to);
    coreNightCache = { night, window };
    const clock = (date: Date) => formatClock(date, timeZone);
    const { core } = night;

    $('core-times').textContent = core.alwaysDown
      ? 'Never rises at this latitude'
      : [
          core.rise ? `Rises ${clock(core.rise)}` : 'Already up at dusk',
          core.transit
            ? `highest ${clock(core.transit)} at ${core.peakAltitude.toFixed(0)}°`
            : `peaks at ${core.peakAltitude.toFixed(0)}°`,
          core.set ? `sets ${clock(core.set)}` : 'still up at dawn',
        ].join(' · ');

    // Only the windows that satisfy all three conditions are offered as such.
    // The darkness and the moon-free stretches are on their own no use — the
    // core has to be in the sky for them to be about anything.
    $('core-window').textContent = night.visible.length
      ? night.visible
          .map(
            (w) =>
              `${clock(w.from)} → ${clock(w.to)} (${formatDuration(
                Math.round((+w.to - +w.from) / 60_000),
              )})`,
          )
          .join(' · ')
      : '—';

    $('core-note').textContent = night.best
      ? `Best at ${clock(night.best.at)}, ${night.best.altitude.toFixed(0)}° up.`
      : night.refusal;

    renderCoreLens(night, window);
  }

  /**
   * The core against the lens: where it falls in the picture, and how long an
   * exposure it will take before it stops being a point.
   *
   * Both are answered for **the best moment of the night**, not for the slider's
   * minute, for the same reason the rest of this fold is: nobody scrubs to find
   * the core. `coreAim` is remembered here so the "At the core" button can point
   * the camera at a moment that has not happened yet.
   */
  /**
   * Redo only the half of the core fold that depends on the lens.
   *
   * The night itself cannot have moved because the camera did, and recomputing
   * it would put a thousand trigonometric solves behind a slider that fires
   * faster than the screen refreshes.
   */
  function refreshCoreLens() {
    if (coreNightCache) renderCoreLens(coreNightCache.night, coreNightCache.window);
  }

  function renderCoreLens(night: CoreNight, window: { from: Date; to: Date }) {
    const frameLine = $('core-frame');
    const extentLine = $('core-extent');
    const exposureLine = $('core-exposure');
    if (!centre) return;
    const clock = (date: Date) => formatClock(date, timeZone);

    const at = night.best?.at ?? night.core.transit;
    coreAim = at ? corePosition(centre.lat, centre.lon, at) : null;

    // The shutter needs the lens and the target's declination, and no aim at
    // all, so it is offered whether or not the frame layer is up. It names the
    // focal length and the pixel it was worked out from, because a shutter
    // limit nobody can reproduce is worth no more than a sunset score.
    const sensor = sensorByKey(lens.sensor) ?? SENSORS[0];
    exposureLine.textContent = coreAim
      ? trailLimit({
          focalLengthMm: lens.focalLengthMm,
          pixelPitchMm: pixelPitchMm(sensor, lens.megapixels),
          declinationDeg: coreAim.declination,
        }).note
      : '';

    // Where it lands in the frame does need an aim, and one nobody chose would
    // be an invention. Off until the lens is on the map.
    if (!shown.frame || !coreAim || !at) {
      frameLine.textContent = '';
      extentLine.textContent = '';
      return;
    }

    const aim = { bearing: lens.bearing, tiltDeg: lens.tiltDeg };
    const fov = currentFov();
    const region = frameTheCore(coreAim, aim, fov);

    // How long the composition holds. The sky turns fifteen degrees an hour, so
    // this is the number that decides how many frames there are to stack — and
    // on a long lens it is startlingly short.
    const held = inFrameWindows(
      window.from,
      window.to,
      (t) => corePosition(centre!.lat, centre!.lon, t),
      aim,
      fov,
    );
    const holding = held
      .map((w) => `${clock(w.from)} → ${clock(w.to)}`)
      .join(' · ');

    frameLine.textContent =
      `At ${clock(at)}: ${region.centre.note}` + (holding ? ` In frame ${holding}.` : '');
    extentLine.textContent = region.note;
  }

  function renderMoonNow() {
    const instant = currentInstant();
    if (!instant || !centre || !day) return;

    const phase = moonIllumination(instant);
    $<SVGPathElement>('moon-lit').setAttribute('d', moonDiscPath(phase.fraction, phase.waxing));
    $('moon-phase').textContent = `${MOON_PHASE_LABEL[phase.name]} · ${Math.round(phase.fraction * 100)}% lit`;

    const now = currentMoon();
    $('moon-now').textContent = now
      ? now.altitude > -0.833
        ? `${bearingLabel(now.azimuth)} · ${now.altitude.toFixed(1)}° · ${Math.round(now.distanceKm).toLocaleString('en-GB')} km`
        : 'Below the horizon'
      : '—';
    $('moon-note').textContent = now ? moonlightNote(now.altitude, phase.fraction) : '';
  }

  const WX_GLYPH: Record<string, string> = {
    clear: '☀',
    partly: '⛅',
    cloudy: '☁',
    fog: '≡',
    drizzle: '☂',
    rain: '☂',
    snow: '❄',
    thunder: '⚡',
  };

  function renderWeather() {
    const box = $<HTMLElement>('wx');
    const instant = currentInstant();
    const decks = $('wx-decks');
    const horizon = $<HTMLElement>('wx-horizon');
    if (!weather || !instant) {
      box.hidden = true;
      $('wx-note').textContent = '';
      decks.textContent = '';
      horizon.textContent = '';
      return;
    }
    const hour = hourAt(weather, instant);
    if (!hour) {
      // Past the end of the forecast. Saying so beats showing the last hour it
      // does have as though it applied to a date a fortnight away.
      box.hidden = false;
      $('wx-icon').textContent = '·';
      $('wx-label').textContent = 'No forecast this far out';
      $('wx-sum').textContent = '';
      $('wx-stale').textContent = '';
      $('wx-note').textContent = '';
      decks.textContent = '';
      horizon.textContent = '';
      return;
    }

    const condition = weatherCondition(hour.weatherCode);
    box.hidden = false;
    $('wx-icon').textContent = WX_GLYPH[condition.icon] ?? '·';
    $('wx-label').textContent = condition.label;
    $('wx-sum').textContent = summariseHour(hour);
    $('wx-stale').textContent = stalenessNote(weather.fetchedAt, Date.now());
    // The blocking decks decide whether there is an edge to a shadow; the total
    // does not. Where the split is missing this falls back to the total, which
    // is what `blockingCover` returning null means.
    const structure = cloudStructure(hour);
    $('wx-note').textContent = lightQuality(
      structure.blocking ?? hour.cloudCover,
      current()?.altitude ?? -90,
    );
    decks.textContent = structure.note;
    renderHorizon();
  }

  /**
   * The sunset's own sky, which is three hundred kilometres away.
   *
   * Shown for whichever of sunrise and sunset the slider is nearer to, because
   * that is the one being planned. It is deliberately *not* tied to the current
   * minute otherwise — at two in the afternoon the question is still "what will
   * this evening do", and a reading that blanked out between the two events
   * would be useless exactly when it is wanted.
   */
  function renderHorizon() {
    const box = $<HTMLElement>('wx-horizon');
    const event = chosenSkyEvent();
    if (!weather || !day || !event) {
      box.textContent = '';
      box.removeAttribute('data-verdict');
      return;
    }
    const when = event === 'sunrise' ? day.times.sunrise : day.times.sunset;
    if (!when) {
      box.textContent = '';
      box.removeAttribute('data-verdict');
      return;
    }
    const reading = horizonReading(
      horizonGate ? hourAt(horizonGate, when) : null,
      hourAt(weather, when),
      gateBearing,
      horizonSampleDistanceM(),
    );
    box.dataset.verdict = reading.verdict;
    box.textContent = `${event === 'sunrise' ? 'Sunrise' : 'Sunset'}: ${reading.note}`;
  }

  /** Sunrise or sunset — whichever the slider is closer to. */
  function chosenSkyEvent(): 'sunrise' | 'sunset' | null {
    if (!day) return null;
    const noon = minuteFor(day.times.solarNoon) ?? 720;
    return minute < noon ? 'sunrise' : 'sunset';
  }

  /** The sun's azimuth at that event — the direction the gate sample lies in. */
  function skyEventBearing(event: 'sunrise' | 'sunset'): number | null {
    if (!day) return null;
    const when = event === 'sunrise' ? day.times.sunrise : day.times.sunset;
    const index = minuteFor(when);
    if (index == null) return null;
    return day.samples[Math.min(day.samples.length - 1, Math.max(0, index))].azimuth;
  }

  /* ── Time ────────────────────────────────────────────────────────────── */

  const timeInput = $<HTMLInputElement>('time');

  function renderTime() {
    const now = current();
    if (!day || !now) {
      $<HTMLElement>('timebar').hidden = true;
      return;
    }
    $<HTMLElement>('timebar').hidden = false;
    $<HTMLElement>('edge-time').hidden = false;
    $('chip-clock').textContent = formatClock(now.date, timeZone);
    $('sheet-zone').textContent = `${label.detail ? '' : ''}${formatZoneAbbreviation(now.date, timeZone)}`;

    // "Golden hour · 22 m left" — the countdown is what turns the slider from a
    // readout into a decision. Segments cover minutes 0–1439; the slider's last
    // stop is 1440, so clamp rather than let the label blank out at the far right.
    const lookup = Math.min(minute, 1439);
    const segment = day.segments.find((s) => lookup >= s.startMinute && lookup < s.endMinute);
    if (segment) {
      const left = segment.endMinute - minute;
      $('chip-phase').textContent =
        left <= 180
          ? `${PHASE_LABEL[segment.phase]} · ${formatDuration(left)} left`
          : PHASE_LABEL[segment.phase];
    } else {
      $('chip-phase').textContent = '';
    }
  }

  /* ── One frame, one pass ───────────────────────────────────────────────
     A pointer dragging the slider fires far faster than the screen refreshes,
     and every one of those events used to run the whole pipeline end to end:
     text, GeoJSON, eight paint properties, six hundred projected dome points, a
     full re-query of every building tile and a terrain mask. The work could not
     fit in a frame, frames were dropped, and the thumb appeared to stick and
     then jump.

     Now an event only records *what* went out of date. The work happens once per
     animation frame, in one pass, and the genuinely expensive things wait for
     the scrub to settle. */

  const dirty = { clock: false, live: false, sky: false, dome: false, shadows: false };
  let frame = 0;
  /** True from the first slider move until a beat after the last one. */
  let scrubbing = false;
  /**
   * True while the day is being played. Declared here rather than with the rest
   * of the playback state below, because `timeIsMoving` reads it and is called
   * from `setMinute` — sixteen hundred lines earlier. Every caller is
   * asynchronous today, so the dead zone is never entered, but a declaration
   * that far from its use is one reorder away from taking the page down with
   * "Cannot access 'playing' before initialization".
   */
  let playing = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Whether the clock is being driven faster than the settled passes can follow.
   *
   * `scrubbing` alone was not that. It is set by the slider's own `input`
   * handler and by nothing else, so playing the day — which calls `setMinute`
   * on every animation frame — left it false and took the *settled* path
   * everywhere. That path is a timer that gets cleared and re-armed by the next
   * call, so at sixty calls a second it never fired: the landform shade froze
   * for the whole of playback while the building shadows kept swinging, which
   * reads as the terrain layer having broken. `terrain-shadows.ts` carries a
   * comment about a debounce that never fires during a continuous drag; this is
   * the same failure arriving through a different caller.
   */
  function timeIsMoving(): boolean {
    return scrubbing || playing;
  }

  /**
   * How often the shadows may be recast while the clock is running.
   *
   * A recast is the largest single cost on this page — the geodesic offset, a
   * convex hull and a ceiling for every one of up to four thousand buildings,
   * about 9 ms — and the guard inside `castCurrentShadows` cannot help with it:
   * it holds when the sun has moved less than a tenth of a degree, and one
   * slider minute moves it between 0.2° and 0.4°. So every minute of a scrub
   * paid the full cost, against a frame budget of 16.7 ms that MapLibre also
   * has to draw the map in, and the thumb stuck.
   *
   * The same interval the terrain overlay already uses, for the same reason and
   * so that the two layers step together rather than beating against each
   * other. Nothing is drawn differently — every building still casts, at full
   * quality — the picture is only rebuilt about nine times a second instead of
   * sixty while a gesture is in progress.
   */
  const SHADOW_MOVING_INTERVAL_MS = 110;
  /**
   * A recast this cheap is not worth throttling.
   *
   * Four thousand buildings cost about 9 ms; a quiet village costs a fraction
   * of one, and capping *that* at nine frames a second would make the common
   * case worse to fix the expensive one. So the last recast's own duration
   * decides: the throttle engages only where it is earning something, and a
   * scene that fits inside a frame keeps running at frame rate.
   */
  const SHADOW_CHEAP_MS = 3;
  let lastShadowCastAt = 0;
  let lastShadowCastMs = 0;
  let shadowCatchUp: ReturnType<typeof setTimeout> | undefined;

  function castAndTime() {
    const started = performance.now();
    castCurrentShadows();
    lastShadowCastAt = performance.now();
    lastShadowCastMs = lastShadowCastAt - started;
  }

  function recastShadows() {
    clearTimeout(shadowCatchUp);
    const answer = pace({
      moving: timeIsMoving(),
      lastDurationMs: lastShadowCastMs,
      sinceLastMs: performance.now() - lastShadowCastAt,
      intervalMs: SHADOW_MOVING_INTERVAL_MS,
      cheapMs: SHADOW_CHEAP_MS,
    });
    // Trailing as well as leading: the minute a gesture *ends* on almost always
    // arrives inside the interval, and dropping it would leave the map showing
    // a moment you had already left.
    if (answer.run) castAndTime();
    else shadowCatchUp = setTimeout(castAndTime, answer.waitMs);
  }

  function invalidate(flags: Partial<typeof dirty>) {
    Object.assign(dirty, flags);
    if (!frame) frame = requestAnimationFrame(runFrame);
  }

  function runFrame() {
    frame = 0;
    const todo = { ...dirty };
    dirty.clock = dirty.live = dirty.sky = dirty.dome = dirty.shadows = false;

    if (todo.clock) renderTime();
    if (todo.live) renderLive();
    if (todo.sky) {
      drawSun();
      drawMoon();
      drawSlab();
      applySunLight();
    }
    if (todo.dome) updateDome();
    if (todo.shadows) recastShadows();
    // The framing readout is the one thing here that changes with *both* the
    // time and the lens, so it is rebuilt whenever either flag is up rather
    // than being given a flag of its own.
    if (todo.live || todo.sky) renderFraming();
  }

  /**
   * What happens once the slider stops: the passes too expensive to run while it
   * is moving, at full quality.
   */
  function settle() {
    scrubbing = false;
    paintTerrain(false);
    // The gesture is over, so anything the throttle deferred is due now.
    recastShadows();
    renderFacts();
    // Crossing noon changes which horizon the reading is about, and that needs a
    // forecast from the other side of the sky.
    refreshHorizonGate();
    // A march over the height field, so it belongs with the other things that
    // wait for the gesture to end — though unlike them it does not depend on the
    // time at all, and re-solving here only costs when the field has changed.
    solveSight();
    drawSight();
    renderSight();
    announce();
  }

  /**
   * Say what changed, once the time has stopped changing.
   *
   * Every number on this page is a live region's worst case: the clock, the
   * phase and the sun's angles all turn over on every minute of a scrub, and a
   * region that announced each one would produce hundreds of interruptions per
   * drag and be worse than silence. So it is spoken only from `settle`, which
   * already exists precisely because it marks the end of a gesture.
   *
   * Assembled from the rendered text rather than recomputed, so a screen reader
   * cannot be told something different from what is on screen.
   */
  function announce() {
    if (!centre || !day) return;
    const said = [
      $('chip-clock').textContent,
      formatDayLabel(isoDate, timeZone),
      $('chip-phase').textContent,
      $('panel-glance').textContent,
    ]
      .map((part) => (part ?? '').trim())
      .filter(Boolean)
      .join(' · ');
    const say = $('say');
    // Only when it actually differs: repeating identical text is not always
    // re-announced, and when it is, it is noise.
    if (say.textContent !== said) say.textContent = said;
  }

  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 180);
  }

  function setMinute(next: number, { fromSlider = false } = {}) {
    const wanted = Math.min(1440, Math.max(0, Math.round(next)));
    if (wanted === minute && fromSlider) return;
    minute = wanted;
    if (!fromSlider) timeInput.value = String(minute);

    invalidate({ clock: true, live: true, sky: true, dome: true, shadows: true });
    // Coarse and throttled while moving, exact once it settles.
    paintTerrain(timeIsMoving());
    scheduleSettle();
  }

  /**
   * Index into the day for an instant, or null when it falls outside it.
   *
   * `bias` decides which side of the minute boundary to land on. The slider's
   * grain is a minute and the sun crosses the horizon at about a fifth of a
   * degree per minute, so rounding to nearest can put "Sunrise" a shade *below*
   * the sunrise threshold — you press the button and are told the sun is down.
   */
  function minuteFor(
    when: Date | null | undefined,
    bias: 'nearest' | 'after' | 'before' = 'nearest',
  ): number | null {
    if (!when || !day) return null;
    const exact = (when.getTime() - day.dayStart.getTime()) / 60_000;
    const round = bias === 'after' ? Math.ceil : bias === 'before' ? Math.floor : Math.round;
    const index = round(exact);
    return index >= 0 && index <= 1440 ? index : null;
  }

  function jumpTargets(): Record<string, number | null> {
    if (!day) return {};
    const golden = day.times.goldenHour;
    const middle = (w: { start: Date; end: Date }) =>
      new Date((w.start.getTime() + w.end.getTime()) / 2);
    return {
      civilDawn: minuteFor(day.times.civilDawn, 'after'),
      sunrise: minuteFor(day.times.sunrise, 'after'),
      goldenMorning: golden[0] ? minuteFor(middle(golden[0])) : null,
      solarNoon: minuteFor(day.times.solarNoon),
      goldenEvening: golden[1] ? minuteFor(middle(golden[1])) : null,
      sunset: minuteFor(day.times.sunset, 'before'),
      civilDusk: minuteFor(day.times.civilDusk, 'before'),
    };
  }

  function refreshJumps() {
    const targets = jumpTargets();
    for (const button of $('jumps').querySelectorAll('button')) {
      // A day with no sunrise has no "Sunrise" to jump to. Disable it and say so
      // by greying it, rather than moving the slider somewhere arbitrary.
      button.disabled = targets[button.dataset.jump ?? ''] == null;
    }
  }

  /* ── The day and the date ────────────────────────────────────────────── */

  const todayHere = () => (centre ? isoDateIn(new Date(), timeZone) : '');
  const isToday = () => isoDate === todayHere();

  function rebuildDay({ keepMinute = false } = {}) {
    if (!centre) {
      day = null;
      $<HTMLElement>('timebar').hidden = true;
      return;
    }
    const anchor = isoDate ? zonedNoon(isoDate, timeZone) : new Date();
    day = scoutDay(centre.lat, centre.lon, anchor);
    // One sample a minute for the moon too, so the slider indexes line up
    // exactly with the sun's and neither can drift from the other.
    moonSamples = moonTrack(centre.lat, centre.lon, day.dayStart, day.times.dayEnd, { stepMinutes: 1 });

    timeInput.style.setProperty('--scout-track', day.gradient);
    refreshJumps();
    renderDateChips();
    renderEvents();
    renderMoonDay();
    rebuildCore();
    renderCoreDay();

    const wanted = keepMinute
      ? minute
      : (isToday() ? minuteFor(new Date()) : null) ?? minuteFor(day.times.solarNoon) ?? 720;
    rebuildSolstices();
    // The horizon ring, the arc, the beads and the solstice rings all belong to
    // this day, so they are dropped and rebuilt on the next frame that draws.
    domeStatic = null;
    rebuildSpot();
    setMinute(wanted);
  }

  function renderDateChips() {
    if (!centre) return;
    $<HTMLElement>('edge-date').hidden = false;
    $('chip-date').textContent = formatDayLabel(isoDate, timeZone);
    $<HTMLButtonElement>('chip-today').disabled = isToday();
    $<HTMLInputElement>('date-input').value = isoDate;

    // The four corners of the year, seeded from the date on screen so the list
    // reads forwards from where you are rather than from January.
    const anchor = zonedNoon(isoDate, timeZone);
    const year = anchor.getUTCFullYear();
    const events = [...seasonEvents(year), ...seasonEvents(year + 1)]
      .filter((event) => event.date.getTime() > anchor.getTime() - 40 * 86_400_000)
      .slice(0, 4);
    $('seasons').replaceChildren(
      ...events.map((event) => {
        const button = document.createElement('button');
        button.type = 'button';
        const name = document.createElement('span');
        name.textContent = seasonName(event.key, centre!.lat);
        const when = document.createElement('span');
        when.className = 'se-when';
        // A date, never a time: the solver is worth about ten minutes and
        // printing an hour and minute would be four digits it does not have.
        //
        // The year is added whenever it is not the year on screen. The list
        // reaches a little way back so a solstice that has just gone is still
        // offered, and "Sun 21 Jun" sitting above "Sat 20 Mar" with no years on
        // either is genuinely ambiguous about which way round they are.
        // The date *where the place is*, which is also the date the button
        // jumps to. Taking the label from the UTC date and the target from the
        // local one put "Sat 20 Mar" on a button that landed you on the 21st —
        // in Hong Kong the 2027 equinox falls after local midnight.
        const target = isoDateIn(event.date, timeZone);
        const day = formatDayLabel(target, timeZone);
        const eventYear = Number(target.slice(0, 4));
        when.textContent = eventYear === year ? day : `${day} ${eventYear}`;
        button.append(name, when);
        button.addEventListener('click', () => setDate(target));
        return button;
      }),
    );

    renderWeek();
  }

  /**
   * The next seven days, by their light.
   *
   * A date input asks you to already know which day you want. What a
   * photographer actually holds is a question about the light — when does the
   * sun get here, how long is the golden hour, is it worth going Thursday —
   * and answering that meant typing seven dates in turn and reading the panel
   * each time.
   *
   * `scoutDay` is pure and costs about a millisecond, so seven of them is
   * nothing; this runs only when the sheet is rebuilt, not on the slider.
   */
  function renderWeek() {
    if (!centre) return;
    const today = todayHere();
    const rows: HTMLElement[] = [];

    for (let offset = 0; offset < 7; offset++) {
      const iso = shiftIsoDate(today, offset);
      const times = scoutDay(centre.lat, centre.lon, zonedNoon(iso, timeZone)).times;

      const button = document.createElement('button');
      button.type = 'button';
      button.classList.toggle('on', iso === isoDate);

      const name = document.createElement('span');
      name.textContent = offset === 0 ? 'Today' : formatDayLabel(iso, timeZone).replace(/,.*$/, '');

      const when = document.createElement('span');
      when.className = 'se-when';
      // The two numbers that decide whether a day is worth the drive. A day
      // with neither — midnight sun, or polar night — says so instead of
      // showing two dashes that look like a failure to load.
      if (times.sunrise && times.sunset) {
        when.textContent = `${formatClock(times.sunrise, timeZone)} – ${formatClock(times.sunset, timeZone)}`;
      } else {
        when.textContent = times.solarNoon && !times.sunrise ? 'no sunrise' : 'no sunset';
      }

      button.append(name, when);
      button.addEventListener('click', () => setDate(iso));
      rows.push(button);
    }

    $('week').replaceChildren(...rows);
  }

  function setDate(next: string) {
    if (!next || next === isoDate) return;
    isoDate = next;
    rebuildDay();
    void loadWeather();
    save();
  }

  /* ── Centre ──────────────────────────────────────────────────────────── */

  function redrawEverything() {
    drawRing();
    drawSun();
    drawMoon();
    drawSlab();
    placeTarget();
    drawFrame();
    renderFraming();
    // The sightline is only *drawn* here — solving it needs a height field that
    // `refreshTerrain` below has not fetched yet, so the answer arrives with the
    // next settle rather than being computed against whatever field is stale.
    drawSight();
    renderSight();
    applySunLight();
    domeStatic = null;
    updateDome();
    collectBuildings();
    refreshTerrain();
    // Photographs belong here too, and their absence was a real bug: restoring
    // a session or opening a link calls `loadPhotos` *before* the style has
    // loaded, where it returns early — and nothing called it again, so a
    // restored spot showed "nothing found" no matter how much was there.
    // The dedupe guard makes the extra calls from a basemap switch free.
    void loadPhotos();
  }

  function setCentre(place: Place, { refit = true } = {}) {
    centre = { lat: place.lat, lon: place.lon };
    label = { name: place.name, detail: place.detail };
    timeZone = place.timeZone || 'UTC';
    if (!isoDate) isoDate = isoDateIn(new Date(), timeZone);
    if (!shown.monolith || (slab.lat === 0 && slab.lon === 0)) {
      // Put the slab a little way off the pin, so it does not land on top of it.
      const spot = destination(centre, 45, 60);
      slab.lat = spot.lat;
      slab.lon = spot.lon;
    }

    $<HTMLElement>('scout-hint').hidden = true;
    $<HTMLElement>('tools').hidden = false;
    $<HTMLElement>('sheet').hidden = false;

    rebuildDay();
    renderPanel();
    redrawEverything();
    if (refit) frameRing();
    void loadWeather();
    void loadPhotos();
    save();
  }

  /** The pin was dragged: keep everything, ask what the new spot is called. */
  let reverseToken = 0;
  function setCentreCoordinates(next: LatLon) {
    const token = ++reverseToken;
    centre = next;
    label = { name: 'Naming that spot…', detail: formatCoords(next) };
    nearby = [];
    renderPanel();
    rebuildDay({ keepMinute: true });
    redrawEverything();
    void loadWeather();
    void loadPhotos();

    void (async () => {
      try {
        const data = await getScoutJson(`/api/scout/reverse?lat=${next.lat}&lon=${next.lon}`);
        if (token !== reverseToken) return;
        if (data.ok) {
          const place = data.place as Place;
          label = { name: place.name, detail: place.detail };
          timeZone = place.timeZone || timeZone;
          $<HTMLInputElement>('place').value = place.name;
          rebuildDay({ keepMinute: true });
          renderPanel();
        }
      } catch {
        // The coordinate is what matters and it is already set. A name is a
        // courtesy, so failing to get one costs the label and nothing else.
        if (token === reverseToken) {
          label = { name: formatCoords(next), detail: '' };
          renderPanel();
        }
      }
      save();
    })();
  }

  /* ── Tapping the map ───────────────────────────────────────────────────
     The pin was draggable and nothing else, which on a touchscreen means
     catching a marker a few millimetres across with a fingertip. Tapping the
     map is the obvious gesture and MapLibre already distinguishes it from a
     pan, which is a drag — so this cannot fire while you are moving the map.

     What it *can* do is move a spot you chose carefully, by accident. So it is
     paired with an undo that restores the position, the name and the zone
     exactly, and the undo is what makes the speed safe rather than reckless. */

  let undoSpot: { centre: LatLon; label: typeof label; timeZone: string } | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function offerUndo(text: string) {
    $('toast-text').textContent = text;
    $<HTMLElement>('toast-undo').hidden = false;
    $<HTMLElement>('toast').hidden = false;
    clearTimeout(toastTimer);
    // Long enough to notice and reach, short enough not to sit over the map.
    toastTimer = setTimeout(() => ($<HTMLElement>('toast').hidden = true), 6000);
  }

  /**
   * The same strip, with nothing to undo.
   *
   * For the things that simply did not happen — a save the browser refused.
   * Offering "Undo" against those would be inviting you to reverse something
   * that never took place.
   */
  function notify(text: string) {
    undoSpot = null;
    $('toast-text').textContent = text;
    $<HTMLElement>('toast-undo').hidden = true;
    $<HTMLElement>('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($<HTMLElement>('toast').hidden = true), 6000);
  }

  on('toast-undo', 'click', () => {
    const previous = undoSpot;
    $<HTMLElement>('toast').hidden = true;
    clearTimeout(toastTimer);
    if (!previous) return;
    undoSpot = null;
    // Restored wholesale rather than re-derived: a reverse lookup could name
    // the same coordinate differently a minute later, and "undo" has to mean
    // exactly what was there before.
    reverseToken++; // abandon any naming still in flight for the tapped spot
    centre = previous.centre;
    label = previous.label;
    timeZone = previous.timeZone;
    nearby = [];
    searchBox.setQuery(label.name);
    pin.setLngLat([centre.lon, centre.lat]);
    renderPanel();
    rebuildDay({ keepMinute: true });
    redrawEverything();
    void loadWeather();
    void loadPhotos();
    save();
  });

  /* ── Photo hotspots ────────────────────────────────────────────────────
     What Scout could never say before: whether anyone has ever found this
     coordinate worth photographing. Two hundred pictures of one bridge are
     one spot, not two hundred pins — see `cluster.ts` — and every photograph
     shown carries its author and its licence.

     Deliberately an addition and never a dependency: if this fails, the sun
     and the shadows beside it are unaffected and say nothing about it. */

  interface Hotspot {
    id: string;
    at: LatLon;
    count: number;
    spanM: number;
    photos: Array<{
      id: string;
      title: string;
      author: string;
      licence: { name: string; url?: string };
      originUrl: string;
      thumbUrl: string;
      accolade?: 'featured' | 'quality' | 'valued';
      megapixels?: number;
    }>;
  }

  let hotspots: Hotspot[] = [];
  let photoToken = 0;
  /** The query the pins on screen already answer. */
  let photoKey = '';
  let photoSearching = false;

  /* ── The join ──────────────────────────────────────────────────────────
     Until now the light was only ever computed for the pin. Everything the
     page could say about a hotspot was where it is and how many people
     stopped there — which is a map of the past, not a plan for this evening.

     The whole of the machinery already existed and was pointed at one
     coordinate: `buildSkyline` + `mergeHorizon` + `lightWindows` answers
     "when does the sun reach here" for an arbitrary point in about a
     millisecond. Running it per hotspot is what turns the photograph layer
     into a decision. See `lighting.ts` for the direction half. */

  /** What the light does at one hotspot, across the whole day. */
  interface SpotLight {
    windows: LightWindow[];
    /**
     * Whether the buildings around *this* spot were loaded, as opposed to the
     * buildings around the pin.
     *
     * Never assumed. `castable` is bounded by the viewport and the hotspots
     * run to 2 km from the pin, so a spot can easily sit outside the gathered
     * box — and a skyline built there from an empty set reports a shaded
     * courtyard as lit from dawn to dusk. False means the answer is terrain
     * and horizon only, and the row says so.
     */
    buildingsKnown: boolean;
    /** Buildings that actually contributed, for the same reason. */
    considered: number;
  }

  let spotLights: SpotLight[] = [];
  /** What `spotLights` was computed from, so it is not recomputed unchanged. */
  let spotLightKey = '';

  /**
   * Is every building that could shade `at` inside the box we collected from?
   *
   * The skyline reaches 1.5 km, so the honest test is whether that whole disc
   * was covered — not whether the point itself happens to fall inside.
   */
  function buildingsCover(at: LatLon): boolean {
    if (!castableBox) return false;
    const [west, south, east, north] = boundingBox(at, SKYLINE_RADIUS_M);
    return (
      west >= castableBox.west &&
      east <= castableBox.east &&
      south >= castableBox.south &&
      north <= castableBox.north
    );
  }

  /**
   * The day's light at an arbitrary point.
   *
   * The one implementation behind three answers — the pin's own timeline, the
   * photograph hotspots, and the day plan's stops — so none of them can end up
   * describing the same coordinate differently. Costs about a millisecond.
   */
  function dayLightAt(at: LatLon, samples: SunSample[]): SpotLight {
    // From `castable` rather than `nearby`: `nearby` is filtered to 1.5 km of
    // the *pin*, and a spot 2 km away needs its own neighbours, not the pin's.
    const around = castable.filter(
      (building) =>
        distance(at, { lat: building.ring[0][1], lon: building.ring[0][0] }) < SKYLINE_RADIUS_M,
    );
    let profile = buildSkyline(at, around);
    const field = terrainShadows?.state().field;
    if (field) {
      const horizon = terrainHorizon(field, at.lon, at.lat, { stepDeg: 1, radiusM: 30_000 });
      if (horizon.elevationM != null) profile = mergeHorizon(profile, horizon);
    }
    return {
      windows: lightWindows(profile, samples),
      buildingsKnown: buildingsCover(at),
      considered: profile.considered,
    };
  }

  /**
   * Work out the day's light at every hotspot.
   *
   * Off the slider's path entirely — this depends on the place, the buildings
   * and the date, none of which the slider moves. What the slider does with
   * the result is an array lookup.
   */
  function rebuildHotspotLight() {
    if (!day || !centre || !hotspots.length) {
      spotLights = [];
      spotLightKey = '';
      return;
    }

    const field = terrainShadows?.state().field;
    // The date matters because the sun samples do; the building signature
    // because a pan can bring a whole street into range of a hotspot.
    const key = `${isoDate}|${castableSignature}|${field ? 'terrain' : 'flat'}|${hotspots.map((s) => s.id).join(',')}`;
    if (key === spotLightKey) return;
    spotLightKey = key;

    const samples = day.samples.slice(0, 1440);
    spotLights = hotspots.map((spot) => dayLightAt(spot.at, samples));
  }

  async function loadPhotos() {
    if (!map || !styleReady) return;
    const source = map.getSource(PHOTO_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    if (!centre || !shown.photos) {
      hotspots = [];
      spotLights = [];
      spotLightKey = '';
      hotspotPaint = '';
      photoKey = '';
      source.setData({ type: 'FeatureCollection', features: [] });
      renderBest();
      return;
    }

    // Several paths legitimately end in "the spot may have changed" — a search,
    // a pin drag, a tap, a restore — and some of them run together. Asking
    // Commons the same question four times in a second is rude to a free API
    // and gains nothing, so a query that is already answered is dropped here
    // rather than deduplicated four call sites away.
    const at = centre;
    // The scouting radius is not part of this: photographs are always looked
    // for within walking distance of the pin, so changing the ring does not
    // invalidate them.
    const key = `${at.lat.toFixed(5)},${at.lon.toFixed(5)}`;
    if (key === photoKey) return;
    photoKey = key;

    const token = ++photoToken;
    photoSearching = true;
    renderFacts();
    try {
      const found = STATIC
        ? await fetchPhotosDirect(at, PHOTO_SEARCH_RADIUS_M)
        : await fetch(
            `/api/scout/photos?lat=${at.lat}&lon=${at.lon}&radius=${PHOTO_SEARCH_RADIUS_M}`,
          )
            .then((response) => response.json())
            .then((data) => (data.ok ? { hotspots: data.hotspots as Hotspot[] } : null));
      // A slower earlier search must not overwrite a faster later one, and a
      // result for a spot you have already left is not a result.
      if (token !== photoToken) return;
      hotspots = found?.hotspots ?? [];
      // A failed answer is not an answer: let the next attempt through rather
      // than caching the failure as though the place had no photographs.
      if (!found) photoKey = '';
    } catch {
      if (token !== photoToken) return;
      hotspots = [];
      photoKey = '';
    }
    photoSearching = false;
    // The light before the pins, so they are painted from it rather than
    // painted neutral and corrected a frame later.
    rebuildHotspotLight();
    drawHotspots();
    renderBest();
    renderSheetLight();
    renderFacts();
  }

  /**
   * Is this hotspot in direct sun at the minute the slider is on?
   *
   * Read off the windows rather than recomputed, so a pin's colour, its row in
   * the list and the sentence in its sheet cannot disagree with each other.
   * Null when there is nothing to say — no light computed for it yet.
   */
  function spotLitAt(index: number, atMinute: number): boolean | null {
    const light = spotLights[index];
    if (!light || !light.windows.length) return null;
    const window = light.windows.find(
      (w) => atMinute >= w.startMinute && atMinute < w.endMinute,
    );
    return window ? window.lit : null;
  }

  /**
   * What the pins are currently painted as, so the slider does not re-upload
   * a source that would come out identical.
   *
   * Scrubbing runs this 240 times over a drag. The set is small — tens of
   * points, not the four thousand polygons that made this matter for shadows —
   * but the guard is one string compare and MapLibre re-tessellates on every
   * `setData` regardless of whether anything moved.
   */
  let hotspotPaint = '';

  function drawHotspots() {
    const source = map?.getSource(PHOTO_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    const now = current();
    const sunUp = Boolean(now && now.altitude > 0);
    const at = Math.min(Math.max(minute, 0), 1439);

    const features = hotspots.map((spot, index) => {
      const lit = spotLitAt(index, at);
      return {
        type: 'Feature' as const,
        properties: {
          index,
          count: spot.count,
          // Three states, not two. "Shaded" and "the sun is down" look the same
          // in a boolean and are completely different answers to stand in.
          lit: Boolean(sunUp && lit),
          sunUp,
          // A spot whose light was never computed must not be painted as though
          // it had been found to be in shade.
          known: lit !== null,
        },
        geometry: { type: 'Point' as const, coordinates: [spot.at.lon, spot.at.lat] },
      };
    });

    // The identity of the spots is in the signature, not just their colours: a
    // moved pin can return a different set of hotspots that happen to be lit in
    // the same pattern, and skipping that would leave the old pins on the map.
    const paint = features
      .map((f) => `${f.properties.lit ? 1 : 0}${f.properties.known ? 1 : 0}`)
      .join('');
    const signature = `${paint}|${sunUp}|${hotspots.map((s) => s.id).join(',')}`;
    if (signature === hotspotPaint) return;
    hotspotPaint = signature;

    source.setData({ type: 'FeatureCollection', features });
  }

  /* ── Saying it ─────────────────────────────────────────────────────────── */

  /**
   * A hotspot's light at the current minute, as a phrase and a state.
   *
   * One function behind the pin colour, the list row and the sheet, so those
   * three cannot end up describing the same place differently.
   */
  function spotLightPhrase(index: number): { text: string; state: 'lit' | 'shaded' | 'down' } {
    const now = current();
    const at = Math.min(Math.max(minute, 0), 1439);
    const light = spotLights[index];
    if (!now || !day || !light || !light.windows.length) {
      return { text: 'light not computed', state: 'down' };
    }
    if (!(now.altitude > 0)) return { text: 'sun down', state: 'down' };

    const lit = spotLitAt(index, at);
    if (lit === null) return { text: 'light not computed', state: 'down' };

    const change = nextChange(light.windows, at);
    const until = change ? formatMinute(day.dayStart, change.atMinute, timeZone) : null;
    if (lit) {
      // "Lit until 20:14" is the number you act on; "lit" alone is not, because
      // the whole question is whether it will still be lit when you get there.
      return { text: until ? `lit until ${until}` : 'lit', state: 'lit' };
    }
    return { text: until ? `shaded, lit ${until}` : 'in shadow', state: 'shaded' };
  }

  /** A Commons filename, made readable enough to identify a place by. */
  function spotLabel(spot: Hotspot): string {
    const title = spot.photos[0]?.title ?? '';
    const trimmed = title.replace(/\.[a-z0-9]{3,4}$/i, '').trim();
    return trimmed || `${spot.count} photograph${spot.count === 1 ? '' : 's'}`;
  }

  /**
   * The ranked list. Rebuilt on every slider minute, so it stays cheap: the
   * expensive part is `rebuildHotspotLight`, and this is a sort of tens of
   * rows over numbers that are already computed.
   */
  function renderBest() {
    const box = $<HTMLElement>('best');
    const list = $('best-list');
    if (!centre || !day || !shown.photos || !hotspots.length || !spotLights.length) {
      box.hidden = true;
      list.replaceChildren();
      return;
    }
    box.hidden = false;

    // Captured because every callback below outlives the narrowing above, and
    // the pin can move under an async redraw.
    const from = centre;
    const at = Math.min(Math.max(minute, 0), 1439);
    const now = current();
    const sunUp = Boolean(now && now.altitude > 0);

    const rows = hotspots
      .map((spot, index) => {
        const light = spotLights[index];
        const lit = spotLitAt(index, at);
        return {
          spot,
          index,
          distanceM: distance(from, spot.at),
          buildingsKnown: light?.buildingsKnown ?? false,
          rank: {
            lit: Boolean(sunUp && lit),
            buildingsKnown: light?.buildingsKnown ?? false,
            litMinutesAhead: light ? litMinutesAhead(light.windows, at) : 0,
            count: spot.count,
            distanceM: distance(from, spot.at),
          },
        };
      })
      .sort((a, b) => compareSpots(a.rank, b.rank))
      .slice(0, 8);

    list.replaceChildren(
      ...rows.map((row, position) => {
        const li = document.createElement('li');
        li.tabIndex = 0;
        li.setAttribute('role', 'button');

        const rank = document.createElement('span');
        rank.className = 'best-rank';
        rank.textContent = String(position + 1);

        const name = document.createElement('span');
        name.className = 'best-name';
        name.textContent = spotLabel(row.spot);
        const where = document.createElement('span');
        where.className = 'best-where';
        // The bearing here is from the pin to the spot — where to walk. It is
        // not the direction anyone pointed a camera, and does not pretend to be.
        where.textContent = `${compassPoint(initialBearing(from, row.spot.at))} ${formatDistance(row.distanceM)} · ${row.spot.count} photo${row.spot.count === 1 ? '' : 's'}${row.buildingsKnown ? '' : ' · terrain only'}`;
        name.append(where);

        const phrase = spotLightPhrase(row.index);
        const light = document.createElement('span');
        light.className = `best-light is-${phrase.state}`;
        light.textContent = phrase.text;

        li.append(rank, name, light);
        // The row is the same action as the pin: open this spot's photographs.
        const open = () => openHotspot(row.index);
        li.addEventListener('click', open);
        li.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
        return li;
      }),
    );

    // Say what the order is, once, rather than implying a score by hiding it.
    const partial = rows.filter((row) => !row.buildingsKnown).length;
    const order =
      'Ordered by light now, then how well the surroundings are known, then light left today, then photographs, then distance.';
    $('best-note').textContent = partial
      ? `${order} ${partial} of ${rows.length} sit outside the buildings loaded here — those are terrain and horizon only, and rank below the rest because nothing was there to shade them.`
      : order;
  }

  /** Which hotspot's sheet is open, so the slider can keep its light current. */
  let openSpotIndex: number | null = null;

  function renderSheetLight() {
    const cell = $('photos-light');
    if (openSpotIndex === null || !spotLights.length) {
      cell.textContent = '';
      return;
    }
    const light = spotLights[openSpotIndex];
    const phrase = spotLightPhrase(openSpotIndex);
    cell.textContent = light?.buildingsKnown
      ? `Here now: ${phrase.text}.`
      : `Here now: ${phrase.text} — from terrain and horizon only, no buildings loaded this far out.`;
  }

  function openHotspot(index: number) {
    const spot = hotspots[index];
    if (!spot) return;
    openSpotIndex = index;
    $('photos-title').textContent = `${spot.count} photograph${spot.count === 1 ? '' : 's'} here`;
    // The span is the honest part: a spot 8 m across is a doorway, one 200 m
    // across is a stretch of riverbank, and they are not the same claim.
    $('photos-sub').textContent =
      `${formatDistance(distance(centre!, spot.at))} away · about ${spot.spanM} m across`;

    $('photo-grid').replaceChildren(
      ...spot.photos.slice(0, 60).map((photo, index) => {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = photo.originUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = photo.title;

        const img = document.createElement('img');
        img.src = photo.thumbUrl;
        img.alt = photo.title;
        // The first screenful is fetched at once and the rest deferred. All
        // lazy meant a sheet that could open completely blank — the browser
        // will not start a deferred image until it decides one is near enough
        // to the viewport, and in a background tab that can be never.
        img.loading = index < 8 ? 'eager' : 'lazy';
        img.decoding = 'async';
        // A thumbnail that will not load leaves the credit and the licence
        // standing, because those are the part that must not disappear.
        img.addEventListener('error', () => img.classList.add('missing'), { once: true });
        link.append(img);

        // What the reviewers said, on the picture. It is the reason this one
        // is here at all and the reason it is above the others.
        if (photo.accolade) {
          const badge = document.createElement('span');
          badge.className = `acc acc-${photo.accolade}`;
          badge.textContent =
            photo.accolade === 'featured' ? 'Featured' : photo.accolade === 'quality' ? 'Quality' : 'Valued';
          link.append(badge);
        }

        const by = document.createElement('span');
        by.className = 'by';
        by.textContent = photo.author;
        link.append(by);

        const licence = document.createElement('span');
        licence.className = 'lic';
        licence.textContent = photo.licence.name;
        link.append(licence);

        li.append(link);
        return li;
      }),
    );
    renderSheetLight();
    $<HTMLElement>('photos').hidden = false;
  }

  /** Closing the sheet takes its spot with it — a closed sheet has no light. */
  function closePhotoSheet() {
    openSpotIndex = null;
    $<HTMLElement>('photos').hidden = true;
  }

  on('photos-close', 'click', closePhotoSheet);

  async function loadWeather() {
    if (!centre) return;
    const at = centre;
    // Two forecasts in one request: here, and the sky the low light has to come
    // through. The second is optional — if it fails the horizon reading says it
    // does not know, and everything else on the row is unaffected.
    const event = chosenSkyEvent();
    const bearing = event ? skyEventBearing(event) : null;
    const query = new URLSearchParams({ lat: String(at.lat), lon: String(at.lon) });
    if (bearing != null) {
      query.set('bearing', bearing.toFixed(2));
      query.set('gateKm', (horizonSampleDistanceM() / 1000).toFixed(0));
    }
    try {
      const pair = STATIC
        ? await fetchHorizonPairDirect(
            at.lat,
            at.lon,
            bearing ?? 0,
            horizonSampleDistanceM(),
          )
        : await fetch(`/api/scout/weather?${query}`)
            .then((response) => response.json())
            .then((data) =>
              data.ok
                ? { pin: data.report as WeatherReport, gate: (data.gate ?? null) as WeatherReport | null }
                : null,
            );
      if (centre !== at && (centre?.lat !== at.lat || centre?.lon !== at.lon)) return;
      weather = pair?.pin ?? null;
      // Only claim a gate when one was actually asked for. Without a bearing the
      // far sample is the pin's own sky under another name, and reading a
      // horizon off it would be a confident answer to a question not asked.
      horizonGate = bearing == null ? null : (pair?.gate ?? null);
      gateEvent = horizonGate ? event : null;
      gateBearing = bearing ?? 0;
    } catch {
      weather = null;
      horizonGate = null;
      gateEvent = null;
    }
    renderWeather();
    // Cloud cover scales how hard the shadows are drawn, so a forecast arriving
    // is a reason to repaint them.
    applySunLight();
    paintTerrain();
    void loadAir();
  }

  /**
   * The aerosol column, which is the measured half of the light's colour.
   *
   * Fetched after the forecast rather than beside it, and never awaited by
   * anything: it is one input to one row, its host is not the forecast's, and
   * the geometry the page exists for needs none of it. A failure leaves
   * `air` null, `aerosolFor` falls back to the table it used before this
   * existed, and the provenance line says which it used.
   */
  async function loadAir() {
    if (!centre) return;
    const at = centre;
    try {
      const report = STATIC
        ? await fetchAirQualityDirect(at.lat, at.lon)
        : await fetch(`/api/scout/air?lat=${at.lat}&lon=${at.lon}`)
            .then((response) => response.json())
            .then((data) => (data.ok ? (data.report as AirReport) : null));
      if (centre?.lat !== at.lat || centre?.lon !== at.lon) return;
      air = report;
    } catch {
      air = null;
    }
    renderFacts();
  }

  /**
   * Refetch the far sample when the slider crosses noon.
   *
   * The gate lies in the sun's direction, which is opposite for the two events,
   * so one fetch cannot answer both. Guarded on the event actually changing —
   * a scrub across midday would otherwise fire a request per minute.
   */
  function refreshHorizonGate() {
    const event = chosenSkyEvent();
    if (!event || event === gateEvent || !weather) return;
    gateEvent = event; // claim it now, so a scrub does not queue a second fetch
    void loadWeather();
  }

  /* ── Controls ────────────────────────────────────────────────────────── */

  function applyView() {
    if (!map || !styleReady) return;
    const three = view === '3d';
    try {
      map.setTerrain(three ? { source: TERRAIN_SOURCE, exaggeration: 1.15 } : null);
    } catch {
      /* terrain unsupported — the rest still works */
    }
    map.easeTo({ pitch: three ? 55 : 0, duration: 700 });
    // Turning terrain on and off moves the ground the dome stands on — in 2D
    // the ground *is* the plane at zero, in 3D it is the exaggerated DEM — so
    // the day's geometry has to be rebuilt against the new base.
    domeStatic = null;
    invalidate({ dome: true });
    try {
      map.setLayoutProperty('scout-buildings', 'visibility', three ? 'visible' : 'none');
    } catch {
      /* layer not installed yet — the next style.load will apply the view */
    }
  }

  function applyVisibility() {
    if (!map || !styleReady) return;
    const set = (layer: string, visible: boolean) => {
      try {
        map!.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
      } catch {
        /* not installed yet */
      }
    };
    set('scout-hillshade', shown.hillshade);
    // Only ever one of these two is up: the custom layer when the context can
    // run it, the flat fill when it cannot.
    set('scout-shadows', shown.buildings && !glShadows);
    set('scout-shadows-gl', shown.buildings && glShadows);
    set('scout-sun-events', shown.sunPath);
    for (const id of ['scout-photos', 'scout-photos-halo', 'scout-photos-count']) {
      set(id, shown.photos);
    }
    set('scout-moon-ray', shown.moonPath);
    set('scout-moon-dot', shown.moonPath);
    terrainShadows?.setVisible(shown.landform);
    for (const id of ['scout-frame-fill', 'scout-frame-edge', 'scout-frame-axis']) set(id, shown.frame);
    for (const id of ['scout-sight-clear', 'scout-sight-blocked']) set(id, shown.sight);
    $<HTMLElement>('slab').hidden = !shown.monolith;
    $<HTMLElement>('framebox').hidden = !shown.frame;
    $<HTMLElement>('sightbox').hidden = !shown.sight;
  }

  on('viewseg', 'click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    const next = button?.dataset.view as '2d' | '3d' | undefined;
    if (!next || next === view) return;
    view = next;
    for (const b of $('viewseg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.view === view);
    applyView();
    save();
  });

  on('baseseg', 'click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    const next = button?.dataset.base as Basemap | undefined;
    if (!next || next === basemap || !map) return;
    basemap = next;
    for (const b of $('baseseg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.base === basemap);
    // Swapping the style discards every source and layer, so everything gets
    // rebuilt by the `style.load` handler that fires straight after.
    swapStyle();
    save();
  });

  for (const [id, key] of LAYER_TOGGLES) {
    on(id, 'change', (event) => {
      shown[key] = (event.target as HTMLInputElement).checked;
      applyVisibility();
      if (key === 'moonPath') drawMoon();
      if (key === 'corePath') rebuildCore();
      if (key === 'solstice' && !solsticeDays) rebuildSolstices();
      if (key === 'monolith') drawSlab();
      if (key === 'buildings') collectBuildings();
      if (key === 'landform') refreshTerrain();
      if (key === 'frame') {
        drawFrame();
        renderFraming();
        // The core's framing is gated on this toggle, so it appears and
        // disappears with it.
        refreshCoreLens();
      }
      if (key === 'sight') {
        placeTarget();
        solveSight();
        drawSight();
        renderSight();
      }
      if (key === 'photos') {
        // Turned off, the sheet goes with the pins — it is about a hotspot
        // that is no longer on the map. So does the ranked list, which is the
        // same finding in a different shape.
        if (!shown.photos) {
          closePhotoSheet();
          renderBest();
        }
        void loadPhotos();
      }
      domeStatic = null;
      invalidate({ dome: true });
      save();
    });
  }

  on('slab-height', 'input', (event) => {
    slab.heightM = Number((event.target as HTMLInputElement).value);
    $('slab-out').textContent = `${slab.heightM} m`;
    drawSlab();
  });
  on('slab-height', 'change', () => save());

  /* ── The frame's controls ──────────────────────────────────────────────── */

  // Built from the module's own lists rather than written out in the markup, so
  // adding a sensor or a focal length in one place adds it here too.
  {
    const sensorSelect = $<HTMLSelectElement>('frame-sensor');
    for (const sensor of SENSORS) {
      sensorSelect.append(new Option(sensor.label, sensor.key));
    }
    const focalSelect = $<HTMLSelectElement>('frame-focal');
    for (const focal of FOCAL_LENGTHS) focalSelect.append(new Option(`${focal}mm`, String(focal)));
    const pixelSelect = $<HTMLSelectElement>('frame-mp');
    for (const mp of RESOLUTIONS) pixelSelect.append(new Option(`${mp} MP`, String(mp)));
  }

  /** Everything the frame draws and says, after any of its controls moves. */
  function frameChanged({ persist = true } = {}) {
    const sensor = sensorByKey(lens.sensor) ?? SENSORS[0];
    $('frame-bearing-out').textContent = `${lens.bearing}° ${compassPoint(lens.bearing)}`;
    $('frame-tilt-out').textContent = `${lens.tiltDeg > 0 ? '+' : ''}${lens.tiltDeg}°`;
    $('frame-lens').textContent = describeLens(sensor, lens.focalLengthMm, currentFov());
    drawFrame();
    renderFraming();
    // The core fold prints two answers about this lens, and both go stale the
    // moment it is turned or changed.
    refreshCoreLens();
    if (persist) save();
  }

  on('frame-sensor', 'change', (event) => {
    lens.sensor = (event.target as HTMLSelectElement).value;
    frameChanged();
  });
  on('frame-focal', 'change', (event) => {
    lens.focalLengthMm = Number((event.target as HTMLSelectElement).value);
    frameChanged();
  });
  on('frame-mp', 'change', (event) => {
    lens.megapixels = Number((event.target as HTMLSelectElement).value);
    frameChanged();
  });
  on('frameorient', 'click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    const next = button?.dataset.orient as Orientation | undefined;
    if (!next || next === lens.orientation) return;
    lens.orientation = next;
    for (const b of $('frameorient').querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.orient === lens.orientation);
    }
    frameChanged();
  });
  on('frame-bearing', 'input', (event) => {
    lens.bearing = Number((event.target as HTMLInputElement).value);
    frameChanged({ persist: false });
  });
  on('frame-bearing', 'change', () => save());
  on('frame-tilt', 'input', (event) => {
    lens.tiltDeg = Number((event.target as HTMLInputElement).value);
    frameChanged({ persist: false });
  });
  on('frame-tilt', 'change', () => save());

  /**
   * Point the camera at something in the sky.
   *
   * Sets the tilt as well as the bearing, which is the whole point: aiming at a
   * sun sixty degrees up and leaving the camera level would put it out of frame
   * on every lens here, and the button would appear not to work.
   */
  function aimAt(body: { azimuth: number; altitude: number } | null) {
    if (!body) return;
    lens.bearing = Math.round(((body.azimuth % 360) + 360) % 360);
    lens.tiltDeg = Math.round(Math.min(80, Math.max(-60, body.altitude)));
    $<HTMLInputElement>('frame-bearing').value = String(lens.bearing);
    $<HTMLInputElement>('frame-tilt').value = String(lens.tiltDeg);
    frameChanged();
  }

  on('aim-sun', 'click', () => aimAt(current()));
  on('aim-moon', 'click', () =>
    aimAt(moonSamples[Math.min(moonSamples.length - 1, Math.max(0, minute))] ?? null),
  );
  // Not at the core *now* — at where it will be when the night is at its best.
  // The other two aim at the slider's minute because the sun and the moon are
  // what the slider is for; the core is a question about the whole night.
  on('aim-core', 'click', () => aimAt(coreAim));

  /* ── The sightline's controls ──────────────────────────────────────────── */

  /**
   * Put the target somewhere sensible the first time the layer is turned on.
   *
   * Half the radius due north, which is far enough for the terrain between to be
   * worth asking about and near enough to be on screen. Dropping it on the pin
   * would give a zero-length sightline and an empty chart, which reads as broken.
   */
  function placeTarget() {
    if (!centre || (target.lat !== 0 && target.lon !== 0)) return;
    const spot = destination(centre, 0, radiusKm * 500);
    target.lat = spot.lat;
    target.lon = spot.lon;
  }

  on('sight-height', 'input', (event) => {
    target.heightM = Number((event.target as HTMLInputElement).value);
    $('sight-out').textContent = `${target.heightM} m`;
    solveSight();
    renderSight();
  });
  on('sight-height', 'change', () => save());

  on('layers-button', 'click', () => {
    const panel = $<HTMLElement>('layers');
    const open = panel.hidden;
    panel.hidden = !open;
    $('layers-button').setAttribute('aria-expanded', String(open));
  });

  /**
   * Which of the night's layers this button switched on, so that switching it
   * off puts back what was there rather than what it assumes was there.
   *
   * Somebody who already had the frame up to compose a sunset should not lose
   * it because they glanced at the Milky Way. A mode that cannot be left
   * cleanly is worse than one that is fiddly to enter.
   */
  let nightTurnedOn: Array<keyof typeof shown> = [];

  /**
   * The whole Milky Way answer, in one press.
   *
   * It sets four things that had to be found separately before: the arc on the
   * sky dome, the frame layer (which is what the *framing* half of the answer is
   * gated on), the panel section opened, and the camera pointed at where the
   * core will be at its best.
   *
   * What it deliberately does **not** do is move the time slider. The obvious
   * next step — jump to the best moment — crosses a date boundary whenever that
   * moment is after midnight, because the night runs noon to noon while the
   * slider runs over the solar day. The fold prints the times; the slider is
   * left where the user put it.
   */
  function setNightMode(on: boolean) {
    const button = $('night-button');
    button.setAttribute('aria-pressed', String(on));

    if (on) {
      nightTurnedOn = (['corePath', 'frame'] as const).filter((key) => !shown[key]);
      for (const key of nightTurnedOn) {
        shown[key] = true;
        const box = $<HTMLInputElement>(key === 'corePath' ? 't-core' : 't-frame');
        box.checked = true;
      }
    } else {
      for (const key of nightTurnedOn) {
        shown[key] = false;
        $<HTMLInputElement>(key === 'corePath' ? 't-core' : 't-frame').checked = false;
      }
      nightTurnedOn = [];
    }

    applyVisibility();
    rebuildCore();
    drawFrame();
    renderFraming();
    invalidate({ dome: true });

    const fold = $<HTMLDetailsElement>('fold-core');
    fold.open = on;
    if (on) {
      // Aim before the fold is read, so the framing lines are already the
      // answer for a camera pointed at the core rather than for whatever the
      // lens happened to be doing.
      aimAt(coreAim);
      fold.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      refreshCoreLens();
    }
    save();
  }

  on('night-button', 'click', () => {
    setNightMode($('night-button').getAttribute('aria-pressed') !== 'true');
  });

  on('compass', 'click', () => {
    map?.easeTo({ bearing: 0, duration: 500 });
  });

  /**
   * The view as a PNG.
   *
   * This is what `preserveDrawingBuffer` has been costing performance for since
   * it was added to prove the map had drawn at all. Now it buys something: the
   * frame can be read back after the fact.
   */
  on('export', 'click', () => {
    if (!map) return;
    map.once('idle', () => {
      try {
        const url = map!.getCanvas().toDataURL('image/png');
        const link = $<HTMLAnchorElement>('download');
        link.href = url;
        link.download = `scout-${(label.name || 'view').replace(/[^\w-]+/g, '-').toLowerCase()}-${isoDate}.png`;
        link.click();
      } catch (err) {
        console.warn('[scout] could not export the view', err);
      }
    });
    map.triggerRepaint();
  });

  /* ── Taking it with you ────────────────────────────────────────────────
     Everything the page knows has, until now, been trapped on the page. A plan
     made here had to be copied out by hand into whatever the shoot is actually
     organised in. These two put it on the clipboard: the times as text, and
     the spot as a link. */

  /**
   * Say something on the button itself and then put it back.
   *
   * A copy has no visible result anywhere — the clipboard is invisible — so
   * without this you press it and cannot tell whether anything happened.
   */
  function flash(id: string, message: string) {
    const button = $<HTMLButtonElement>(id);
    if (button.dataset.said) return;
    button.dataset.said = button.textContent ?? '';
    button.textContent = message;
    setTimeout(() => {
      button.textContent = button.dataset.said ?? '';
      delete button.dataset.said;
    }, 1600);
  }

  async function toClipboard(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash(id, 'Copied');
    } catch {
      // Denied permission, or an insecure origin. Saying so is better than a
      // button that appears to do nothing.
      flash(id, 'Could not copy');
    }
  }

  on('copy-plan', 'click', () => {
    if (!centre || !day) return;
    const spot = $('spot-windows').textContent?.trim();
    const moon = $('moon-phase').textContent?.trim();
    const weather = $('wx-note').textContent?.trim();
    void toClipboard(
      'copy-plan',
      shootPlan({
        name: label.name || formatCoords(centre),
        centre,
        dayLabel: formatDayLabel(isoDate, timeZone),
        timeZone,
        events: sunEventRows(day.times),
        light: spot && spot !== '—' ? spot : undefined,
        moon: moon && moon !== '—' ? `Moon: ${moon}` : undefined,
        // Stamped with the time it is true of — see `moment` in report.ts.
        moment: weather ? `Light at ${$('chip-clock').textContent}: ${weather}` : undefined,
        caveat: shadowCaveat({
          showing: shown.buildings,
          cast: shadowStats.cast,
          estimated: shadowStats.estimated,
        }),
      }),
    );
  });

  on('copy-link', 'click', () => {
    if (!centre) return;
    writeLink();
    void toClipboard('copy-link', location.href);
  });

  /* ── Panel open/close on touch ───────────────────────────────────────── */

  on('panel-head', 'click', () => {
    const panel = $<HTMLElement>('panel');
    const open = panel.dataset.open !== 'true';
    panel.dataset.open = String(open);
    $('panel-head').setAttribute('aria-expanded', String(open));
  });

  const searchBox = createSearchBox({
    onChoose: (place) => setCentre(place),
    onQueryChanged: () => renderKept(),
  });

  /* ── Kept spots ────────────────────────────────────────────────────────
     Scouting is repetitive in a particular way: you find somewhere, check it
     across a few dates, leave, and come back to it next week. The only ways
     back were to retype the name and hope the geocoder agreed with itself, or
     to have kept the link.

     `localStorage`, deliberately, where the rest of the view state is in
     `sessionStorage` — surviving the tab is the entire point. */

  let keptSpots: SavedSpot[] = [];

  function loadSpots() {
    try {
      keptSpots = readSpots(localStorage.getItem(SPOTS_KEY));
    } catch {
      keptSpots = []; // private mode: the list is simply never kept
    }
  }

  /**
   * Write the list back, and say whether it landed.
   *
   * It used to swallow the failure, which was fine while a spot was five
   * numbers. A notebook is not: someone who has just typed a paragraph and
   * linked three photographs has to be told when none of it was kept, or they
   * will find out by coming back to an empty spot next week. The list in memory
   * is left as it is either way — refusing the edit as well would lose the work
   * twice over.
   */
  function storeSpots(): boolean {
    try {
      localStorage.setItem(SPOTS_KEY, JSON.stringify(keptSpots));
      return true;
    } catch {
      return false; // out of quota, or private mode, where nothing is ever kept
    }
  }

  /** Store, and complain in the open if the browser would not have it. */
  function storeSpotsOrSay(): boolean {
    if (storeSpots()) return true;
    notify('No room to keep that — this browser’s storage is full.');
    return false;
  }

  /** Reflect whether *this* spot is one of the kept ones. */
  function renderStar() {
    const star = $<HTMLButtonElement>('star');
    star.hidden = !centre;
    if (!centre) return;
    const kept = indexOfSpot(keptSpots, centre) !== -1;
    star.setAttribute('aria-pressed', String(kept));
    star.title = kept ? 'Kept — press to forget' : 'Keep this spot';
  }

  function renderKept() {
    const box = $<HTMLElement>('kept');
    const list = $<HTMLElement>('kept-list');
    // Only while the field is empty: with a query typed, the results below are
    // what you asked for and this would be arguing with them.
    const wanted = keptSpots.length > 0 && !searchBox.query() && searchBox.isOpen();
    box.hidden = !wanted;
    if (!wanted) return;

    list.replaceChildren(
      ...keptSpots.map((spot, index) => {
        const li = document.createElement('li');
        li.dataset.spot = String(index);

        const drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'drop-spot';
        drop.dataset.drop = String(index);
        drop.textContent = '×';
        drop.title = `Forget ${spot.name}`;
        li.append(drop);

        const name = document.createElement('span');
        name.className = 'nm';
        name.textContent = spot.name;
        li.append(name);

        const detail = document.createElement('span');
        detail.className = 'dt';
        // The lens and the note are why you kept it. Reading the coordinate
        // back tells you nothing you did not know from the name.
        detail.textContent = [
          spot.frame ? describeFrame(spot.frame) : formatCoords({ lat: spot.lat, lon: spot.lon }),
          spot.note?.split('\n')[0],
        ]
          .filter(Boolean)
          .join(' — ');
        li.append(detail);
        return li;
      }),
    );
  }

  /* ── The month, hour by hour ─────────────────────────────────────────── */

  /**
   * Put the page on a given instant.
   *
   * Two scales meet here and they do not agree. The grid's columns are the
   * local clock; the slider counts minutes from **solar** midnight, which at
   * Edinburgh in August is about 01:19 — so clicking 19:00 and calling
   * `setMinute(1140)` landed the page on 20:15. Worse, the two scales disagree
   * about which *day* an instant belongs to: local 00:30 falls in the solar day
   * that began the previous afternoon. So the date is corrected from the
   * instant rather than taken from the row, which is why this can step a day.
   */
  function goToInstant(instant: Date) {
    let iso = isoDateIn(instant, timeZone);
    setDate(iso);
    for (let pass = 0; pass < 3; pass++) {
      if (!day) return;
      const delta = Math.round((instant.getTime() - day.dayStart.getTime()) / 60_000);
      if (delta >= 0 && delta <= MINUTES_PER_DAY) {
        setMinute(delta);
        return;
      }
      iso = shiftIsoDate(iso, delta < 0 ? -1 : 1);
      setDate(iso);
    }
  }

  const monthSheet = createMonthGrid({
    centre: () => centre,
    isoDate: () => isoDate,
    timeZone: () => timeZone,
    lightAt: (instant) => {
      if (!weather) return null;
      const hour = hourAt(weather, instant);
      return hour ? directLightFractionFor(hour) : null;
    },
    currentInstant,
    goTo: goToInstant,
  });

  on('open-month', 'click', () => {
    // The layers panel is where the button lives, and leaving it standing under
    // a full-screen sheet means finding it still open on the way back out.
    $<HTMLElement>('layers').hidden = true;
    $<HTMLButtonElement>('layers-button').setAttribute('aria-expanded', 'false');
    monthSheet.open();
  });

  /* ── The notebook ───────────────────────────────────────────────────────
     Everything you worked out at a spot that the arithmetic cannot: the note,
     the lens it was kept with, and the photographs that sent you there. Only
     for a kept spot, because there is nowhere else to put it. */

  function keptHere(): SavedSpot | null {
    if (!centre) return null;
    const index = indexOfSpot(keptSpots, centre);
    return index === -1 ? null : keptSpots[index];
  }

  function renderNotebook() {
    const fold = $<HTMLDetailsElement>('fold-note');
    const spot = keptHere();
    fold.hidden = !spot;
    if (!spot) return;

    const text = $<HTMLTextAreaElement>('note-text');
    // Never while it is being typed in: replacing the value under the cursor
    // moves the caret to the end mid-sentence.
    if (document.activeElement !== text) text.value = spot.note ?? '';

    $('note-kept').textContent = spot.frame
      ? `Kept with ${describeFrame(spot.frame)}${spot.slabHeightM ? ` · ${spot.slabHeightM} m monolith` : ''}`
      : 'No lens kept here yet — press the star again to keep the current frame.';

    const photos = spot.photos ?? [];
    $('note-photos').replaceChildren(
      ...photos.map((photo, index) => {
        const li = document.createElement('li');

        const img = document.createElement('img');
        img.src = photo.url;
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        li.append(img);

        const credit = document.createElement('span');
        credit.className = 'cr';
        const link = document.createElement('a');
        link.href = photo.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        // A photograph with no credit says so. It is still a link you saved,
        // and calling it "Untitled" would be inventing an attribution.
        link.textContent = photo.credit ?? 'Uncredited link';
        credit.append(link);
        if (photo.licence) credit.append(document.createTextNode(` · ${photo.licence}`));
        li.append(credit);

        const drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'drop-photo';
        drop.dataset.photo = String(index);
        drop.textContent = '×';
        drop.title = 'Remove this reference';
        li.append(drop);
        return li;
      }),
    );

    $<HTMLInputElement>('note-url').disabled = photos.length >= MAX_PHOTOS;
    $('note-say').textContent =
      photos.length >= MAX_PHOTOS ? `That is ${MAX_PHOTOS} references — remove one to add another.` : '';
  }

  /** Patch the kept spot under the pin, keeping the list's order. */
  function editSpot(patch: Partial<Omit<SavedSpot, 'lat' | 'lon'>>): boolean {
    if (!centre || !keptHere()) return false;
    keptSpots = updateSpot(keptSpots, centre, patch);
    return storeSpotsOrSay();
  }

  // Written on a pause rather than on a keystroke: `localStorage` is
  // synchronous, and serialising two dozen spots on every letter typed is work
  // done on the main thread between the key and the glyph.
  let noteTimer = 0;
  on('note-text', 'input', () => {
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => {
      const note = $<HTMLTextAreaElement>('note-text').value.trim();
      editSpot({ note: note || undefined });
      renderKept();
    }, 400);
  });
  on('note-text', 'blur', () => {
    clearTimeout(noteTimer);
    const note = $<HTMLTextAreaElement>('note-text').value.trim();
    editSpot({ note: note || undefined });
    renderKept();
  });

  function addReference() {
    const spot = keptHere();
    const field = $<HTMLInputElement>('note-url');
    const raw = field.value.trim();
    if (!spot || !raw) return;

    // Validated by the same reader that guards the stored list, so a link that
    // would be dropped on the way back in is refused on the way out — with a
    // reason, rather than by silently doing nothing.
    const photo = readPhoto({ url: raw, source: 'manual' });
    if (!photo) {
      $('note-say').textContent = 'That needs to be a full http or https link.';
      return;
    }

    const photos: SpotPhoto[] = spot.photos ?? [];
    if (photos.some((existing) => existing.url === photo.url)) {
      $('note-say').textContent = 'That one is already here.';
      return;
    }
    if (photos.length >= MAX_PHOTOS) return;

    if (editSpot({ photos: [...photos, photo] })) field.value = '';
    renderNotebook();
  }

  on('note-add', 'click', addReference);
  on('note-url', 'keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') {
      event.preventDefault();
      addReference();
    }
  });

  on('note-photos', 'click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-photo]');
    const spot = keptHere();
    if (!target || !spot?.photos) return;
    const index = Number(target.dataset.photo);
    const photos = spot.photos.filter((_, i) => i !== index);
    editSpot({ photos: photos.length ? photos : undefined });
    renderNotebook();
  });

  on('star', 'click', () => {
    if (!centre) return;
    if (indexOfSpot(keptSpots, centre) !== -1) {
      keptSpots = removeSpot(keptSpots, centre);
    } else {
      keptSpots = addSpot(keptSpots, {
        name: label.name || formatCoords(centre),
        lat: centre.lat,
        lon: centre.lon,
        timeZone,
        radiusKm,
        savedAt: Date.now(),
        // The lens goes in with the place. Half of what you worked out standing
        // here is where to point the camera, and that half used to be thrown
        // away the moment the pin moved. `addSpot` keeps an existing note and
        // photographs across this, so re-keeping a spot updates the aim without
        // costing the writing.
        frame: {
          sensor: lens.sensor,
          focalLengthMm: lens.focalLengthMm,
          orientation: lens.orientation,
          bearing: lens.bearing,
          tiltDeg: lens.tiltDeg,
        },
        // Only when there is a monolith to speak of: a height nobody set is a
        // default, and storing a default as a measurement is how a guess ends
        // up looking like a decision.
        slabHeightM: shown.monolith ? slab.heightM : undefined,
      });
    }
    storeSpotsOrSay();
    renderStar();
    renderKept();
    renderNotebook();
  });

  on('kept-list', 'click', (event) => {
    const target = event.target as HTMLElement;
    const dropped = target.closest<HTMLElement>('[data-drop]');
    if (dropped) {
      const spot = keptSpots[Number(dropped.dataset.drop)];
      if (spot) {
        keptSpots = removeSpot(keptSpots, spot);
        storeSpots();
        renderStar();
        renderKept();
      }
      return;
    }
    const row = target.closest<HTMLElement>('[data-spot]');
    const spot = row && keptSpots[Number(row.dataset.spot)];
    if (!spot) return;
    searchBox.setQuery(spot.name);
    searchBox.closeResults();
    searchBox.hide();
    renderKept();
    // Straight down the same path a search result takes, so a kept spot and a
    // found one cannot behave differently.
    setCentre(
      {
        name: spot.name,
        detail: '',
        lat: spot.lat,
        lon: spot.lon,
        kind: 'kept',
        timeZone: spot.timeZone || timeZone,
      },
      { refit: true },
    );
    if (spot.radiusKm) setRadius(spot.radiusKm, { refit: true });
    restoreNotebook(spot);
  });

  /**
   * Put the camera back the way it was left.
   *
   * A spot restored to the right coordinate with the wrong lens is a worse
   * answer than one restored with none, because the wedge on the map looks
   * exactly as authoritative either way. The tilt is clamped to what the slider
   * can express so the control and the state cannot disagree — a stored +85°
   * with an input that stops at +80° would draw one frame and report another.
   */
  function restoreNotebook(spot: SavedSpot) {
    if (spot.frame) {
      const tiltInput = $<HTMLInputElement>('frame-tilt');
      const limit = { low: Number(tiltInput.min), high: Number(tiltInput.max) };
      lens.sensor = spot.frame.sensor;
      lens.focalLengthMm = spot.frame.focalLengthMm;
      lens.orientation = spot.frame.orientation;
      lens.bearing = Math.round(spot.frame.bearing);
      lens.tiltDeg = Math.round(Math.min(limit.high, Math.max(limit.low, spot.frame.tiltDeg)));

      $<HTMLSelectElement>('frame-sensor').value = lens.sensor;
      $<HTMLSelectElement>('frame-focal').value = String(lens.focalLengthMm);
      $<HTMLInputElement>('frame-bearing').value = String(lens.bearing);
      tiltInput.value = String(lens.tiltDeg);
      for (const button of $('frameorient').querySelectorAll('button')) {
        button.classList.toggle('on', button.dataset.orient === lens.orientation);
      }
      frameChanged();
    }

    if (spot.slabHeightM) {
      slab.heightM = spot.slabHeightM;
      $<HTMLInputElement>('slab-height').value = String(slab.heightM);
      $('slab-out').textContent = `${slab.heightM} m`;
      drawSlab();
    }

    renderNotebook();
  }

  on('radius-button', 'click', () => {
    const box = $<HTMLElement>('radiusbox');
    box.hidden = !box.hidden;
    $('radius-button').setAttribute('aria-expanded', String(!box.hidden));
  });

  /* ── Radius ──────────────────────────────────────────────────────────── */

  const radiusInput = $<HTMLInputElement>('radius');

  function setRadius(km: number, { refit = false } = {}) {
    radiusKm = km;
    $('radius-out').textContent = formatDistance(km * 1000);
    drawRing();
    drawSun();
    drawMoon();
    domeStatic = null;
    invalidate({ dome: true });
    renderFacts();
    if (refit) frameRing();
    save();
  }

  // Live while dragging, reframed only on release: refitting the viewport on
  // every tick of the slider makes the map lurch under your thumb.
  radiusInput.addEventListener('input', () => setRadius(Number(radiusInput.value)));
  radiusInput.addEventListener('change', () => setRadius(Number(radiusInput.value), { refit: true }));

  /* ── Time controls ───────────────────────────────────────────────────── */

  timeInput.addEventListener('input', () => {
    scrubbing = true;
    handsOnTheClock();
    setMinute(Number(timeInput.value), { fromSlider: true });
  });

  on('jumps', 'click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button || button.disabled) return;
    const target = jumpTargets()[button.dataset.jump ?? ''];
    if (target != null) {
      handsOnTheClock();
      setMinute(target);
    }
  });

  /* ── The keyboard ──────────────────────────────────────────────────────
     A time slider is a pointer instrument, and scrubbing to an exact minute
     with one is fiddly on a trackpad and worse on a touchscreen with a stylus.
     The arrows give the day a step you can count in, which is what you want
     when you are checking whether the sun clears a roofline at 18:12 or 18:13.

     Bound on the document rather than the slider so they work wherever you are
     on the page — except while typing, where an arrow key means something else
     entirely. */

  const TIME_KEYS: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowDown: -1,
    ArrowUp: 1,
    PageDown: -60,
    PageUp: 60,
  };

  document.addEventListener('keydown', (event) => {
    if (!centre || !day) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Never steal a key from a field, and never from the slider itself, which
    // already moves on arrows and would otherwise move twice.
    //
    // `instanceof Element` rather than a cast: with nothing focused the target
    // is `document`, which has no `closest` and would throw here — taking the
    // whole handler down silently, so every shortcut simply stopped working.
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]')) {
      return;
    }

    const step = TIME_KEYS[event.key];
    if (step != null) {
      event.preventDefault();
      handsOnTheClock();
      // Shift makes the small step an hour and the big step four, so the whole
      // day is a few presses away without losing the minute underneath.
      setMinute(minute + step * (event.shiftKey ? 60 : 1));
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      const times = day.times;
      const edge = minuteFor(event.key === 'Home' ? times.sunrise : times.sunset, 'after');
      if (edge != null) {
        event.preventDefault();
        handsOnTheClock();
        setMinute(edge);
      }
      return;
    }

    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      $<HTMLButtonElement>('chip-now').click();
      return;
    }

    // Space runs the day — but only when nothing is focused that space already
    // means something to. On a focused button space *is* the press, so binding
    // it here as well would toggle twice and land back where it started.
    if (event.key === ' ' || event.key === 'Spacebar') {
      if (target instanceof Element && target.closest('button, a, [role="button"]')) return;
      event.preventDefault();
      $<HTMLButtonElement>('chip-play').click();
    }
  });

  /* ── Following the clock ───────────────────────────────────────────────
     "Now" was a jump, not a state: it moved the slider once and then the page
     sat at a time that quietly became the past. For a tool you hold while
     standing in the street waiting for the light, that is the wrong shape —
     the thing you most want it to do is keep up.

     So Now is a mode. It follows the real minute until you touch the time
     yourself, and touching the time is exactly what leaves it: any scrub, jump
     or arrow key is a statement that you want to look at some *other* moment,
     and having the page drag you back would be maddening. */

  let following = false;
  let followTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * You have taken hold of the time yourself.
   *
   * Both automatic claims on the clock — following the real minute, and playing
   * the day — mean the page is choosing the moment. Any scrub, jump or arrow
   * key says you want some *other* moment, and one that kept dragging you back
   * would be unusable. One helper, so a new time control cannot forget half of
   * it.
   */
  function handsOnTheClock() {
    setFollowing(false);
    setPlaying(false);
  }

  function setFollowing(next: boolean) {
    if (following === next) return;
    following = next;
    $('chip-now').classList.toggle('on', following);
    $('chip-now').setAttribute('aria-pressed', String(following));
    clearInterval(followTimer);
    // Every ten seconds, not every minute: a wall clock that turns over up to
    // fifty seconds late looks broken, and this costs nothing.
    if (following) followTimer = setInterval(tickToNow, 10_000);
  }

  function tickToNow() {
    if (!following || !centre) return;
    const today = todayHere();
    if (today !== isoDate) {
      // Midnight passed while we were watching.
      isoDate = today;
      rebuildDay();
      void loadWeather();
      return;
    }
    const target = minuteFor(new Date());
    if (target != null && target !== minute) setMinute(target);
  }

  /* ── Playing the day ───────────────────────────────────────────────────
     The one thing a sun tool should obviously do and this one could not: run
     the day and watch the shadows swing. Everything needed was already here —
     the frame-batched pipeline makes a minute cost about 0.2 ms — so this is a
     clock, not a rendering feature.

     A whole day in twenty-four seconds. Slower and you lose interest before
     noon; faster and the shadows stop reading as motion and start reading as
     flicker. */

  const PLAY_MINUTES_PER_SECOND = 60;
  /**
   * Longest step one frame may take, in real seconds.
   *
   * A backgrounded tab stops firing frames and then delivers one enormous
   * delta, which would fling the day forward by hours the moment you looked
   * back at it. Better to lose the time than to jump.
   */
  const PLAY_MAX_STEP_S = 0.25;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  /** Someone who asked for less motion gets the day in steps, not a sweep. */
  const playStepMinutes = () => (reducedMotion?.matches ? 10 : 0);

  let playFrame = 0;
  let playLast = 0;
  /** Fractional minutes carried between frames, so slow steps are not lost. */
  let playCarry = 0;

  function setPlaying(next: boolean) {
    if (playing === next) return;
    playing = next;
    $('chip-play').classList.toggle('on', playing);
    $('chip-play').setAttribute('aria-pressed', String(playing));
    $('play-label').textContent = playing ? 'Pause' : 'Play';
    if (playing) {
      // Playing and following are both claims on the clock and only one can
      // hold — but *not* via `handsOnTheClock`, which would stop the playback
      // being started here.
      setFollowing(false);
      playLast = 0;
      playCarry = 0;
      playFrame = requestAnimationFrame(playTick);
    } else {
      cancelAnimationFrame(playFrame);
      playFrame = 0;
      scheduleSettle();
    }
  }

  function playTick(stamp: number) {
    if (!playing) return;
    playFrame = requestAnimationFrame(playTick);
    if (!day) return;

    if (!playLast) {
      playLast = stamp;
      return;
    }
    const elapsed = Math.min((stamp - playLast) / 1000, PLAY_MAX_STEP_S);
    playLast = stamp;

    playCarry += elapsed * PLAY_MINUTES_PER_SECOND;
    const step = playStepMinutes();
    // Below the step size nothing moves yet, so the carry keeps accumulating.
    if (playCarry < Math.max(1, step)) return;

    const advance = step ? Math.floor(playCarry / step) * step : Math.floor(playCarry);
    playCarry -= advance;

    // Round the day rather than stopping at midnight: the interesting part of
    // a summer day at 57°N is the two ends, and a loop shows them repeatedly.
    const next = minute + advance;
    setMinute(next > MINUTES_PER_DAY ? next - MINUTES_PER_DAY : next);
  }

  on('chip-play', 'click', () => {
    if (!centre || !day) return;
    setPlaying(!playing);
  });

  on('chip-now', 'click', () => {
    if (!centre) return;
    const today = todayHere();
    if (today !== isoDate) {
      isoDate = today;
      rebuildDay();
      void loadWeather();
      save();
      setFollowing(true);
      return;
    }
    const target = minuteFor(new Date());
    if (target != null) setMinute(target);
    // After `setMinute`, which stops following — this is the one caller that means it.
    setFollowing(true);
  });

  on('chip-today', 'click', () => setDate(todayHere()));
  on('day-back', 'click', () => setDate(shiftIsoDate(isoDate, -1)));
  on('day-forward', 'click', () => setDate(shiftIsoDate(isoDate, 1)));
  on('chip-date', 'click', () => {
    const sheet = $<HTMLElement>('datesheet');
    sheet.hidden = !sheet.hidden;
  });
  on('date-close', 'click', () => ($<HTMLElement>('datesheet').hidden = true));
  on('date-input', 'change', (event) => setDate((event.target as HTMLInputElement).value));

  // A slider step is a minute, which is the right grain for golden hour but a
  // tedious way to cross a day. Shift jumps an hour.
  timeInput.addEventListener('keydown', (event) => {
    if (!event.shiftKey) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setMinute(minute - 60);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setMinute(minute + 60);
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (!target.closest('.searchbox') && !target.closest('#search-button')) searchBox.closeResults();
    if (!target.closest('.layers') && !target.closest('#layers-button')) {
      $<HTMLElement>('layers').hidden = true;
      $('layers-button').setAttribute('aria-expanded', 'false');
    }
    if (!target.closest('.datesheet') && !target.closest('#chip-date')) {
      $<HTMLElement>('datesheet').hidden = true;
    }
  });

  /* ── Remembering where you were ──────────────────────────────────────── */

  function save() {
    if (!centre) return;
    try {
      sessionStorage.setItem(
        STORE_KEY,
        writeSession({ centre, label, radiusKm, timeZone, view, basemap, shown, slab, lens, target, isoDate }),
      );
    } catch {
      /* private mode — the map simply forgets */
    }
    writeLink();
  }

  /**
   * Keep the address bar pointing at what is on screen.
   *
   * `replaceState`, not `pushState`: the slider fires this constantly and a
   * history entry per minute would make the back button useless. What the URL
   * carries is *the spot* — where, when, how wide — and not how the map is
   * dressed; see `share.ts` for why the two are split.
   */
  function writeLink() {
    if (!centre) return;
    const query = encodeScoutLink({
      centre,
      name: label.name || undefined,
      timeZone,
      radiusKm,
      isoDate,
      minute,
    });
    try {
      history.replaceState(null, '', `${location.pathname}?${query}`);
    } catch {
      /* nothing here is worth failing a render over */
    }
  }

  // Before restore, so a spot recovered from storage or a link can already tell
  // whether it is one of the kept ones.
  loadSpots();

  (function restore() {
    let saved: SavedView;
    try {
      saved = readSession(sessionStorage.getItem(STORE_KEY));
    } catch {
      // Unreadable, or a browser that will not hand storage over at all. Give
      // up on the whole restore rather than half-applying one.
      return;
    }

    if (saved.shown) Object.assign(shown, saved.shown);
    if (saved.slab) Object.assign(slab, saved.slab);
    if (saved.lens) Object.assign(lens, saved.lens);
    // Storage is the one input written by an older build of this page, so the
    // pixel count is checked rather than trusted: `pixelPitchMm` throws on a
    // number that is not one, and a session with `megapixels: 0` in it would
    // take the whole panel down on restore.
    if (!(lens.megapixels > 0)) lens.megapixels = defaultLens().megapixels;
    if (saved.target) Object.assign(target, saved.target);
    view = saved.view;
    basemap = saved.basemap;

    for (const b of $('viewseg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.view === view);
    for (const b of $('baseseg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.base === basemap);
    for (const [id, key] of LAYER_TOGGLES) {
      $<HTMLInputElement>(id).checked = shown[key];
    }
    $<HTMLInputElement>('slab-height').value = String(slab.heightM);
    $('slab-out').textContent = `${slab.heightM} m`;

    $<HTMLSelectElement>('frame-sensor').value = lens.sensor;
    $<HTMLSelectElement>('frame-focal').value = String(lens.focalLengthMm);
    $<HTMLSelectElement>('frame-mp').value = String(lens.megapixels);
    $<HTMLInputElement>('frame-bearing').value = String(lens.bearing);
    $<HTMLInputElement>('frame-tilt').value = String(lens.tiltDeg);
    for (const b of $('frameorient').querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.orient === lens.orientation);
    }
    $<HTMLInputElement>('sight-height').value = String(target.heightM);
    $('sight-out').textContent = `${target.heightM} m`;
    // Labels and the lens line only — nothing is drawn yet, and `save()` here
    // would write a session back before the restore that is reading it finishes.
    frameChanged({ persist: false });

    // A link beats the last session: following one is a deliberate act, and
    // arriving at somebody's spot only to be shown your own would be absurd.
    const link = decodeScoutLink(location.search);
    if (!link && !saved.centre) return;

    if (link) {
      centre = link.centre;
      label = { name: link.name ?? '', detail: '' };
      // A link with no zone is not assumed into one. UTC would print a London
      // sunset on a Tokyo clock, which is the exact bug `STORE_KEY` was
      // versioned for; the browser's own zone is at least a zone somebody is
      // actually in, and the panel names whichever it used.
      timeZone = link.timeZone ?? browserTimeZone();
      radiusKm = link.radiusKm ?? 10;
      isoDate = link.isoDate || isoDateIn(new Date(), timeZone);
    } else {
      centre = saved.centre!;
      label = saved.label ?? { name: '', detail: '' };
      radiusKm = saved.radiusKm ?? 10;
      timeZone = saved.timeZone ?? 'UTC';
      isoDate = saved.isoDate || isoDateIn(new Date(), timeZone);
    }

    radiusInput.value = String(radiusKm);
    $('radius-out').textContent = formatDistance(radiusKm * 1000);
    searchBox.setQuery(label.name);
    $<HTMLElement>('scout-hint').hidden = true;
    $<HTMLElement>('tools').hidden = false;

    if (map && basemap !== 'light') swapStyle();
    rebuildDay({ keepMinute: false });
    // The link's own minute, applied after the day exists to be indexed into.
    // A link that names a time is a request to look at *that* moment, so the
    // clock is not followed; anything else opens on now and keeps up.
    if (link?.minute != null) setMinute(link.minute);
    else if (isToday()) setFollowing(true);
    renderPanel();
    map?.jumpTo({ center: [centre.lon, centre.lat], zoom: 11 });
    map?.once('idle', frameRing);
    void loadWeather();
    void loadPhotos();

    // A link that arrived without a name gets one, so the panel is not blank.
    if (link && !link.name) void nameTheSpot();
  })();

  /**
   * Put a name — and the *right* zone — on a spot that arrived as bare
   * coordinates.
   *
   * The zone matters more than the name here. A link built by this page always
   * carries one, but one typed by hand or trimmed by a chat client may not, and
   * every clock time on the page is wrong until it is corrected.
   */
  async function nameTheSpot(): Promise<void> {
    if (!centre) return;
    const token = ++reverseToken;
    try {
      const data = await getScoutJson(`/api/scout/reverse?lat=${centre.lat}&lon=${centre.lon}`);
      if (token !== reverseToken || !data.ok) return;
      const place = data.place as Place;
      label = { name: place.name, detail: place.detail };
      if (place.timeZone && place.timeZone !== timeZone) {
        timeZone = place.timeZone;
        rebuildDay({ keepMinute: true });
      }
      searchBox.setQuery(place.name);
      renderPanel();
      save();
    } catch {
      // The coordinate is what matters and it is already set.
      if (token === reverseToken) {
        label = { name: formatCoords(centre), detail: '' };
        renderPanel();
      }
    }
  }

  /** The zone this browser thinks it is in, or UTC if it will not say. */
  function browserTimeZone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  if (!centre) {
    searchBox.show();
    searchBox.focus();
  }
  // Opening on an empty field with spots already kept is the clearest case for
  // showing them: you have arrived with nowhere set and somewhere in mind.
  renderKept();
}
