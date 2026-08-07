# Scout — handoff

Paste everything below into a fresh session to continue work on the `/scout` tab.

---

## Context

Scout is a location-scouting tab inside **Colour Archive** (an Astro 5 + SSR photographic
archive at `/Users/luca/Desktop/Colour Archive`). Type a place — or drag the pin — pick a
date, scrub a time slider, and see how the sun and moon light the spot, including what is
actually in shadow and when the light arrives.

**The locked decisions, as they now stand:**

1. A new tab inside Colour Archive (`/scout`) — not a separate app, not native.
2. Single-user now, public later. Build local-first, but keep the data layer clean
   enough to add accounts without a rewrite. Photo provenance from day one.
3. Sun depth: **Level 2 + Level 4** (sun direction on the map *and* real cast shadows).
   ~~Level 3 skipped — no weather.~~ **Superseded 2026-07-31**: weather is in, via
   keyless Open-Meteo, but strictly as a *qualifier* on the geometry — cloud cover
   never moves a shadow, it only softens how confidently one is drawn. See
   `weather.ts`'s header for the reasoning.
4. **Both** terrain and urban shadows. Both are now real cast shadows.
5. **Typed location**, adjustable radius ~1–50 km, no GPS. The pin is now also
   *draggable*, which keeps the decision intact — still a coordinate you chose
   deliberately — and is the only way to scout a spot with no name to type.
6. ~~Today only.~~ **Superseded 2026-07-31**: full date control — Today chip, ±1 day,
   a date input, and jumps to the four equinoxes and solstices.
7. **No personal layer** for v1. (The archive's own photos carry no GPS.)
8. Photo sources: a **source-adapter layer** — Flickr geo search + Wikimedia Commons
   automatic, plus a manual paste-a-URL adapter reusing `/api/inspiration/add`.
   *Still not started; this is the main remaining work.*

**The whole point of the project** is still Part 7 below — the join between sun position
and photo spots. Everything built so far is foundation for it, and the per-spot light
timeline (`skyline.ts` + `terrain.ts`) is the half of that join that now works.

**House style:** comments explain *why*, not *what*. The project's ethos is refusing to
assert what wasn't measured — a shadow drawn from a guessed building height must look
different from one drawn from a surveyed height, and a forecast must not be dressed up
as arithmetic. Keep that.

---

## What exists and is verified

749 tests pass (`npm test`), `npm run check` clean, `npm run build` clean.

`npm run smoke` (`tests/scout.smoke.ts`) drives the page in a real browser —
Playwright and Chromium, against `astro dev` because `window.scout` is gated
behind `import.meta.env.DEV`. Four assertions, one per failure this tab has
actually shipped: no uncaught errors; no height field fetched before a place is
chosen (the 24,450-tile storm); a link restores a spot and scrubbing moves the
sun; and turning the sun path off changes the pixels on the map, which is the
only way to notice a shader that will not link. It runs in CI as its own job,
so a red smoke against a green build reads as "look at the network".

| File | Lines | What |
|---|---|---|
| `src/lib/scout/sun.ts` | 543 | Solar position/times engine (Meeus/NOAA). 56 tests |
| `src/lib/scout/moon.ts` | 494 | Lunar position, phase, moonrise/set. Topocentric. 27 tests |
| `src/lib/scout/terrain.ts` | 634 | Terrarium decode, height field, landform shadows, horizons. 35 tests |
| `src/lib/scout/daylight.ts` | 616 | Phase bands, the continuous track, event rows, dates. 56 tests |
| `src/lib/scout/skyline.ts` | 410 | Per-point horizon from buildings, merged with terrain. 30 tests |
| `src/lib/scout/shadows.ts` | 406 | Building + monolith shadow casting, with ceilings. 41 tests |
| `src/lib/scout/weather.ts` | 273 | WMO codes, cloud → light quality, forecast parsing. 23 tests |
| `src/lib/scout/galactic.ts` | 413 | Galactic core position, precession, the moon-free dark window. 19 tests |
| `src/lib/scout/geo.ts` | 191 | Spherical geodesy, radius ring. 31 tests |
| `src/lib/scout/almanac.ts` | 175 | Equinoxes and solstices, solved not tabulated. 15 tests |
| `src/lib/scout/basemap.ts` | 214 | Contrast overrides + sun-driven colour ramps. 16 tests |
| `src/lib/scout/dome.ts` | 130 | Sun/moon path as a 3D ring in the sky. 17 tests |
| `src/lib/scout/share.ts` | 130 | A spot as a link: encode, and decode with validation. 13 tests |
| `src/lib/scout/report.ts` | 95 | The day as pasteable text. 10 tests |
| `src/lib/scout/geocode.ts` | 278 | Nominatim: search **and reverse**, rate limit, disk cache |
| `src/lib/scout/weather-client.ts` | 100 | Open-Meteo, server-side, 20-minute cache |
| `src/lib/scout/view/terrain-shadows.ts` | 333 | The landform overlay: tiles, canvas source, debounce |
| `src/lib/scout/view/dome-layer.ts` | 160 | The custom WebGL layer + a geometry builder |
| `src/lib/scout/view/shadow-layer.ts` | 564 | Cast shadows as volumes: height buffer, MAX blend. 8 tests |
| `src/pages/scout.astro` | ~2650 | The page: layout, map orchestration, every control |
| `src/pages/api/scout/{geocode,reverse,weather}.ts` | — | Three thin proxies |
| `scripts/check-astro-scripts.ts` | 78 | Typechecks page `<script>` blocks — see below |

**The celestial model (matched to Sunlitt, 2026-07-31):** everything in the sky is drawn
on one *dome* — a real tilted ring in mercator space at a fixed radius about the pin,
handed the map's own matrix by the custom WebGL layer. Solid where the body is above the
horizon, **dotted below it** (spaced points, since a GL line strip has no dash pattern),
with a horizon circle on the ground for the arc to be measured against, hour beads, the
sun's disc, its ray, and the plumb line down from it. The two solstice arcs ride the same
dome. The ground carries only what belongs on the ground: the radius ring, the sun and
moon bearing rays, the shadow bearing, and the sunrise/sunset points where the arc meets
the horizon.

The earlier ground-projected polar plot — bearing for angle, altitude for distance from
the centre — is gone. It was legible but it made the sun move *inwards* as it rose, which
is not a motion anything does, and it could not show how steeply the sun comes back up.

**How the page updates (rewritten 2026-07-31 for smoothness).** A pointer dragging the
time slider fires far faster than the screen refreshes, and every event used to run the
whole pipeline: text, GeoJSON, eight paint properties, six hundred projected dome points,
a full `querySourceFeatures` over every building tile, and a terrain mask. It could not
fit in a frame, frames were dropped, and the slider stuck and jumped.

Now an event only records *what* went stale; one batched pass runs per animation frame,
and the expensive work is either cached or deferred:

- **Frame batching.** `invalidate({...})` sets dirty flags, `runFrame` does one pass.
  Measured: **0.46 ms per input event, 0.2 ms median frame** (16.7 ms budget).
- **Buildings are gathered per *view*, not per *minute*.** The collection box used to be
  built from the current sun's throw, so the set changed as you scrubbed and shadows
  popped in and out. It now uses a fixed margin, so shadows only lengthen and swing.
- **Casting got ~4× cheaper.** One geodesic solve per building instead of one per vertex
  (measured worst error 3.9 cm), and the convex hull no longer formats two floats into a
  string per vertex to dedupe. 4,000 buildings: **10.2 ms → 3.25 ms**.
- **The dome is split.** The horizon ring, the day's arc, the hour beads, the solstice
  rings and the moon's path belong to the *day* and are built once; only the sun's disc,
  ray, plumb line and the moon's marker move.
- **The terrain overlay was a debounce, which was the wrong shape** — one that resets on
  every pointer event never fires mid-drag, so the shade froze and then jumped when you
  let go. It is now a throttle: coarse (stride 2, a quarter of the work) every 110 ms
  while moving, one exact pass when it settles.
- **Settling** (180 ms after the last move) runs the exact terrain mask and the readouts
  that need a height-field lookup.

**Working:** place search, draggable pin with reverse geocoding, adjustable radius,
minute-resolution time slider with a continuous sky-coloured track *and* a per-spot shade
mask over it, full date control with equinox/solstice jumps, the sun's events list, twilight
details, moon phase/rise/set/path, azimuth–altitude–shadow-ratio–elevation cards,
weather with a light-quality reading, **real building cast shadows that stop at anything
taller than they are and land on the roofs of anything shorter**, **real landform cast
shadows**, the per-spot "direct sun 07:03–18:20" sentence, a draggable monolith with an
adjustable height, solstice reference arcs, 2D/3D, light/dark/satellite basemaps, a
compass, layer toggles, and image export.

Everything is keyless: OpenFreeMap tiles, AWS terrarium DEM, Nominatim, Open-Meteo,
Esri World Imagery (attribution required and present).

---

## What is left, in build order

### Part 5 — Spot data layer *(Wikimedia done and live; Flickr blocked on a key)*

Built 2026-08-02 and verified end to end against the real API: **199 photographs near
Calton Hill, every one with an author and a licence, clustered into one hotspot 76 m
across.**

- `sources/types.ts` — the `SpotSource` interface. `RawPhoto` has **no optional
  attribution fields**: an adapter that cannot supply author and licence must drop the
  photograph instead. `bearing` is optional and is never invented — Commons does not
  expose `GPSImgDirection`, so it stays undefined, which is what Part 7 must respect.
- `sources/wikimedia.ts` — keyless, and **assessed only**. The first version asked
  `geosearch` for whatever was nearest and got a wall of geograph.org.uk: a bulk import
  documenting every British grid square with one flat snapshot apiece. Near Edinburgh the
  nearest **500 files contained not one peer-reviewed image**. Commons has its own answer
  — files nominated and reviewed by other photographers land in *Featured pictures*,
  *Quality images* or *Valued images* — so this searches the **intersection** of an
  accolade and a place with CirrusSearch's `incategory:` and `nearcoord:` together,
  rather than searching by distance and hoping. 19 tests.

  Measured, same 15 km around Edinburgh: **199 photographs, all geograph, 1 hotspot →
  83 photographs, all peer-reviewed (4 featured + 79 quality), 0 geograph, 47 hotspots**,
  median 13.6 MP and up to 124 MP, in 3.5 s. Ranked by accolade then resolution, with the
  standing shown as a badge on each thumbnail.

  Two traps worth keeping: `nearcoord` takes **kilometres** where `geosearch` takes
  metres, and it has none of geosearch's 10 km ceiling — reusing the geosearch clamp
  silently threw away most of the map (76 hits at 5 km, 97 at 50 km, 368 at 100 km). And
  ORing the categories into one CirrusSearch expression returns *nothing*; ask each tier
  separately and merge.
- `cluster.ts` — single-link (DBSCAN with minPts 1) so a hotspot has no fixed size, but
  **leashed**: a photograph is refused if it would stretch the cluster past `maxSpanM`,
  which stops a line of riverbank photographs chaining into one mile-long "spot".
  `spanM` is reported so a vague spot can say it is vague. 10 tests.
- `/api/scout/photos` — thin route, 30-minute cache, fails as the photo layer alone.
- UI: hotspot circles sized by count with the number in them, a detail sheet with credit
  and licence under every thumbnail, a layers toggle, and a "Photographed" fact row.
  Clicking a hotspot opens it *instead of* moving the pin.

**The nearest-N problem is gone with geosearch itself.** It returned the closest N and
stopped, so a wide radius came back huddled at the pin — which reads on the map as
"there is nothing out there", the one thing a scouting tool must never say by accident.
Ring-probe tiling fixed that and is no longer needed: `nearcoord` covers the whole radius
in one query per tier, and there are only three tiers.

**Photographs are searched within 2 km of the pin, not the scouting radius**
(`PHOTO_SEARCH_RADIUS_M`). The ring answers "how far might I drive"; at 50 km it covers a
county, returns spots in towns you were never going to visit, and buries the ones by the
pin. Two kilometres is walking distance, which is the question a photograph on a map
actually answers. Capped at the caller *and* in the route, since the route is reachable
directly. The radius is deliberately not part of the client's dedupe key, so moving the
ring no longer refetches.

**Flickr is still blocked** — it needs a free API key in `.env`. The adapter interface is
ready for it to drop in, and `sort=interestingness-desc` would be the quality signal
there that the accolade categories are here.

`src/lib/scout/sources/` with a common interface:

```ts
interface SpotSource {
  id: string
  search(centre: LatLon, radiusKm: number): Promise<RawSpot[]>
  licence: LicenceInfo
}
```

- `flickr.ts` — the workhorse. `flickr.photos.search` with `lat`/`lon`/`radius`,
  `has_geo`, `license` filter. Free key, goes in `.env`, proxied server-side.
- `wikimedia.ts` — Commons `geosearch` + `imageinfo`.
- `manual.ts` — paste a URL; reuse the existing `/api/inspiration/add` pipeline.

**Clustering is the step ShotHotspot gets wrong**: raw geotagged photos → spots via
DBSCAN or grid clustering, so 200 photos of one bridge become one pin, not 200 pins.

**Provenance on every photo** — source, author, licence, original URL. Non-negotiable.

### Part 6 — Pins and detail sheet *(not started)*

Clustered pins with thumbnails. Detail sheet: carousel with credit and licence,
distance/bearing from centre, best-light window.

**Shot bearing is the hard field.** Some Flickr EXIF carries `GPSImgDirection`; most
doesn't. Fallback is a draggable cone the user sets. When unknown, say unknown.

### Part 7 — The join ⭐ *(half done — this is the product)*

For each spot: `spotBearing × sunAzimuth` at the slider time → **front-lit / side-lit /
back-lit / rim-lit**, combined with lit-or-shaded.

The lit-or-shaded half now exists and is good: `buildSkyline` + `mergeHorizon` +
`lightWindows` already answer it for an arbitrary point, in one pass over the day, at
about a millisecond a point. Running it per pin is the obvious next move. What is
missing is the *bearing* half — which needs Part 6's data.

Pins recolour live as you scrub. Beside the map, a ranked *"best right now"* list.

### Part 8 — Field readiness *(not started)*

Extend the service worker to cache map tiles, DEM tiles, spot JSON and thumbs for the
scouted radius. The cross-origin fix above is deliberately compatible with this: a
`WARM` message still caches whatever URLs it is handed, and the network-first path
falls back to those entries when there is no network. A "Save this area for offline" button. The sun and moon engines are pure
maths and work offline already; `terrain.ts` caches tiles for the life of the page only.

### Part 9 — Polish *(largely done)*

Done: light/dark/satellite, contrast overrides, 2D/3D, pill controls, a bottom sheet, a
compass, the collapsing panel, 44px touch targets, a mobile layout pass.
Left: the layers menu is a plain list and could be a proper sheet on mobile.

---

## Debts and gotchas that will bite

**Paid off since the last handoff:**

- The diagnostics scaffolding is gone: `/api/scout/diag`, `collectDiagnostics`,
  `reportDiagnostics`, the 500 ms `setInterval` and the visibilitychange reporter. In
  its place, a `window.scout` handle gated behind `import.meta.env.DEV`. The
  user-facing WebGL/basemap messages stayed — they earn their place.
- `preserveDrawingBuffer` now actually works. MapLibre v5 moved it under
  `canvasContextAttributes`, and it had been passed at the top level, where it is
  silently ignored. It is now cashed in for "Save as an image".
- **The service worker no longer pins third-party assets.** It was cache-first for
  every `.json`/`.png` regardless of origin, which meant OpenFreeMap's style and sprite
  sheet and the terrarium DEM tiles were frozen at whatever the first visit saw — a
  sprite that no longer matches its style draws the wrong icons and reports nothing.
  Own-origin assets stay cache-first (that is the offline snapshot); everything
  cross-origin races the network against a 2.5s fuse and falls back to the stored copy.

  **The first attempt at this broke the map**, and the shape of the mistake is worth
  keeping: it also had `activate` evict the existing cross-origin entries as "stale",
  which threw away the offline copy of every sprite and DEM tile. The next network
  hiccup then had nothing to fall back on and the basemap failed outright
  (`AJAXError: Failed to fetch (0) … ofm@2x.json`). Going to the network *first* is the
  whole fix; a stale entry that is only ever read when there is no network is not a bug,
  it is the point of having one. Nothing is evicted now.

  `public/sw.js` has tests as of this session (`src/lib/sw.test.ts`, 9 of them): it is
  evaluated in a `vm` context with a stubbed cache, network and clock, and driven the
  way a browser would. It is the one file here that can take the whole app offline by
  being subtly wrong, it had done so twice, and both failures were behaviours rather
  than typos — invisible to `tsc` and to the build.
- **Redundant shadow re-uploads are skipped.** `setData` over up to 4,000 polygons was
  the largest remaining cost on the slider's path. `castCurrentShadows` now remembers
  the set it cast (by reference, so re-gathering invalidates it) plus the sun's azimuth
  and the `1/tan(altitude)` length multiplier, and returns early when neither has moved
  enough to shift a polygon by about a pixel (0.1°, 0.5%).
- **Shadows no longer pool where they cross, and no longer paint over what they cannot
  reach.** Both were properties of the fill layer, and neither could be styled away —
  `fill-opacity` is applied per fragment *per feature*, so two crossing shadows are
  blended twice, and a flat polygon knows nothing about what it lands on.
  `shadow-layer.ts` replaces it with a custom layer that renders into its own
  framebuffer:
  1. every footprint in view, depth-mapped from its height into a private depth
     attachment — a top-down record of how tall the world is at each pixel;
  2. every shadow, depth-mapped from its *ceiling* (`castShadow` now returns one per
     ring vertex: the building's height at the wall, sloping to zero at the tip),
     depth-tested against that record with no depth writes, colour blended with
     `MAX` so overlaps take the darkest rather than the sum;
  3. one composite of the finished mask over the map.

  Measured by reading the mask back: three shadows of 0.50/0.35/0.20 stacked give
  exactly the 0.50 pixel, where the fill layer gave 0.74; and against a 30 m ceiling,
  roofs at 5/20/29.5 m take the shadow while 30.5/45/300 m stay lit.

  The monolith casts in the same pass, so it cannot pool against the buildings either.
  If shaders, framebuffer or `MAX` blending are unavailable the layer says so from
  `onAdd` and the fill layer stays up — the old picture, but never both at once.

- **The elevation storm is gone.** At the world view the page opens on, the padded
  bounds spanned the planet: `chooseZoom` walks down from z13 looking for a zoom inside
  its 16-tile budget, finds none, and returns its z7 floor anyway — saying nothing about
  how far over budget that leaves the caller. `tilesFor` then enumerated the lot and
  `loadHeightField` fired them in a single `Promise.all`. Measured in the browser:
  **24,450 DEM tile requests, AWS answering 503**, with the basemap and geocoder queued
  behind them. Three guards, because there were three independent failures:
  1. `MAX_TILES = 64` in `terrain-shadows.ts` — past that the field is not fetched at
     all and `tooWide` is set, which the panel prints as "zoom in for landform". A
     landform overlay across a continent is a grey smear that tells a photographer
     nothing.
  2. `refreshTerrain()` returns early with no `centre`. There is nothing to shade until
     somewhere has been chosen.
  3. `loadHeightField` runs **8 tiles at a time** instead of all of them, the same
     bounded-concurrency shape the service worker already uses to warm the archive.

  Verified after: 0 requests at the world view, 8 requests peaking at 8 concurrent at
  z12 over Edinburgh, field complete, `0 tiles missing`.
- **Scout has the two links every other page carries.** It is a full-bleed map with no
  topbar, so `.scout-nav` sits top-left in the same segmented control the view switch
  uses, above the panel (`--stage-top` keeps the two in agreement). Never hidden —
  being unable to pick a place is the most likely reason to want to leave. Below 820px
  the Inspiration link stands down: measured, the nav and the view controls touch at
  390px, and the way back is the one that has to survive.

**Five improvements (2026-08-01):**

1. **A spot is a link.** State lived only in `sessionStorage`, so a spot died with
   the tab — for a tool whose whole output is "be *here* at *this* time", the answer
   was in the wrong place. `share.ts` puts where/when/how-wide in the query string and
   `history.replaceState` keeps it current (never `pushState` — the slider would fill
   the back button with a history entry per minute). Storage keeps the *dressing*
   (basemap, layers, monolith); the link carries the spot. Everything decoded is
   validated, never trusted: a bad zone is dropped rather than assumed into UTC, which
   is the exact bug `STORE_KEY` was versioned for. A link with no zone falls back to
   the browser's and then reverse-geocodes the real one.
   *Note:* `t` is minutes into the **solar** day (dayStart is solar midnight, ~01:19
   at Edinburgh in August), not wall-clock — stable, because it is read back with the
   `at` and `d` it travelled with.
2. **"Now" is a mode, not a jump.** It followed the clock once and then sat at a time
   that quietly became the past. It now ticks every 10s (not 60 — a wall clock up to
   50s late looks broken), rolls the date at midnight, shows as held down, and drops
   out the moment you scrub, jump or press an arrow, because those all say you want to
   look at some *other* moment.
3. **Keyboard control of the day.** Arrows ±1 min, Shift ±60, PageUp/Down ±60,
   Home/End to sunrise/sunset, `n` for now. Bound on the document, ignored while
   typing and under modifiers. Scrubbing to an exact minute with a pointer is fiddly;
   counting presses is not.
4. **`chooseZoom` is honest.** It returns its z7 floor whether that fits the budget or
   not, and the number alone could not tell "this is right" from "this is 1,500× over"
   — which is how the 24,450-tile storm happened. `fitsZoom` returns `{zoom, tiles,
   fits}` and `tileCountAt` counts without building anything, so the overlay no longer
   allocates tens of thousands of tile addresses just to check `.length`. The old loop
   also stopped at `min + 1` and never measured the floor at all.
5. **The day, as pasteable text.** "Copy the plan" puts the event table, the per-spot
   sun window, the moon and the caveat on the clipboard; "Copy a link to this spot"
   puts the URL there. `report.ts` lists an absent event as a dash rather than dropping
   the row, and always closes by saying the shadows are modelled — pasted elsewhere the
   plan loses every visual cue that the heights are storey-count guesses. A momentary
   reading has to name its own minute, or "the sun is down" under a sunrise time reads
   as a contradiction.

- **The light itself is modelled** (`atmosphere.ts`, 21 tests). Kasten–Young air mass,
  pressure-corrected from the DEM elevation already loaded, spectral transmittance
  (Rayleigh/Ångström/ozone) integrated against the CIE 1931 observer for colour
  temperature and lux from the same integral, and Bird & Hulstrom for the direct/diffuse
  split that *is* key-to-fill. Latitude enters through air mass and nowhere else.
  The coast/mountain difference is the Ångström exponent α: sea salt is large and
  scatters neutrally, so maritime haze whitens and lifts the shadows where continental
  dust reddens and keeps them. Shown as a "Light" fact row (CCT · stops, with EV and the
  provenance in the tooltip). Elevation is measured; the *sea fraction* of the loaded
  height field is measured and used to infer sea air — an inference from real terrain,
  and labelled as one.

  Measured, same 45° sun: Zermatt ridge at 1600 m gives 5300 K / 3.27 stops / 10% fill;
  a Maldivian atoll gives 5100 K / 2.52 stops / 17% fill. Across Edinburgh's day the
  fill rises 14% → 62% as contrast collapses from 2.84 to 0.69 stops.

- **A shader that will not link is a silent, total failure.** `u_halo` was declared
  without a precision qualifier in the point vertex shader and `mediump` in the fragment
  shader. GLSL requires them to match, the program returned null, and *everything the
  point program drew simply vanished* — the sun's disc, its halo, the moon marker, the
  hour beads and every sprite giving the arcs their weight. The only trace was one
  console warning. Declare shared uniforms and varyings with explicit, matching precision,
  and read the console after touching a shader.
- **`redrawEverything` now fetches photographs.** Restoring a session or opening a link
  called `loadPhotos` *before* `style.load`, where it returns early — and nothing called
  it again, so a restored spot showed "nothing found" however much was there.
- **Cheaper by measurement, not by guess:** `sourcedata` fires once per finished tile and
  each one walked every loaded tile, so bursts are now collapsed into one pass on the next
  frame; the sea fraction is cached against the height field instead of rescanned on every
  settle; thumbnails dropped 480 → 320 px, which is what a two-column sheet actually
  renders; and `/api/scout/photos` sends `max-age=1800` so a reload is free.

**Still outstanding:**

0. **The shadow ramp is still hand-fitted.** `basemap.ts` `shadowOpacity` is
   `0.24 + 0.22·clamp01(altitude/18)` and its own comment argues in air masses. It should
   be driven by `readLight().diffuseFraction`, and `shadowColour` by the computed sky
   chromaticity, so the map is graded by place and not just the readout. Keep the ramps
   as the fallback when no height field has loaded.
1. **`scout.astro` is ~2,650 lines.** Two subsystems were lifted into
   `src/lib/scout/view/`; the map orchestration itself should follow before Parts 5–7
   are added to it.
2. **Esri World Imagery** is used for the satellite basemap with attribution. Free for
   this kind of use; if Scout ever goes public, check the terms again.

**Traps already hit — do not repeat:**

- **`tsc --noEmit` does not look inside `.astro` files.** Every line of client code in a
  page was going unchecked, which hid `day.dayEnd` on a type that only has
  `day.times.dayEnd` (it threw the moment you picked a place) and the
  `preserveDrawingBuffer` move above. **Run `npm run check`, not `npx tsc`** — it
  extracts each page's `<script>` beside its page and typechecks it for real.
- **Claude's automation tab is `visibilityState: "hidden"`.** This suspends rAF, so
  MapLibre never paints there *and* **CSS transitions never advance** — any transitioned
  property reads back frozen at its start value, which looks exactly like a broken
  selector. Diagnosed once by chasing a "stuck" `max-height`. To measure layout in that
  tab, inject `* { transition: none !important }` first.
- **`CSSStyleRule.cssRules` exists and is empty** in browsers with CSS nesting, so a
  stylesheet walker that recurses on `rule.cssRules` before reading `rule.style` silently
  finds nothing.
- **MapLibre silently declines a layer with an unknown `beforeId`.** No error, no
  warning. Always compute the anchor from the current style (`labelAnchor()`).
- **Add sources/layers on `map.on('style.load')`, never `'load'`.**
- **MapLibre fetches vector tiles inside a Web Worker.** They never appear in
  main-thread `performance.getEntriesByType('resource')`.
- **The custom layer's `render(gl, args)`** receives a projection-data object in v5
  (`args.defaultProjectionData.mainMatrix`), not a bare matrix.
- **Never build screen-space line ribbons in the custom layer.** WebGL guarantees a
  `lineWidth` of 1 px and desktop drivers ignore anything more, so the dome's arcs were
  hairlines. Expanding each segment into a quad in the vertex shader is the usual answer,
  it was tried, and **it hung Chrome's GPU process again and again** — renderer
  unresponsive, no console error, nothing in `getError`, and eventually the devtools
  extension disconnecting. Closing both obvious hazards (`w <= 0` for geometry above the
  camera, a floor under the viewport before dividing) did **not** fix it.
  `dome-layer.ts` now draws a plain `LINE_STRIP` for continuity plus overlapping soft
  sprites along the same path for weight — neither primitive can produce a degenerate
  triangle, per-vertex colour still works, and it looks better anyway. Isolate this class
  of bug with empty buffer (94 ms) → points-only (6 ms) → lines (hang), and **restart
  Chrome before trusting any follow-up measurement**: once the GPU is wedged even a bare
  `map.jumpTo()` times out.
- **MapLibre hands each 2D layer a *zero-width* depth range.** Measured:
  `[0.98419, 0.98419]`. Layers are meant to stack in draw order and never fight, so
  every fragment a custom layer writes lands on one identical depth value whatever its
  vertex shader said. Any depth comparison of your own silently becomes a comparison of
  a number with itself — no error, no warning. `shadow-layer.ts` takes `depthRange(0,1)`
  for its private framebuffer and restores MapLibre's before returning. This cost an
  hour and was only found by reading pixels back: a 5 m shed was blocking a 30 m shadow
  exactly as convincingly as a 300 m tower.
- **A `clear` is masked exactly like a draw.** `clearDepth` + `clear(DEPTH_BUFFER_BIT)`
  while `depthMask` is false does *nothing*. Since a custom layer should leave
  `depthMask` false on the way out, the buffer then clears on the first frame and never
  again, and the height field silently accumulates every building the view has ever
  held. Open both masks before clearing.
- **Restore more GL state than feels necessary.** MapLibre caches what it believes the
  context is set to and skips redundant calls, so anything changed behind its back is
  not corrected next frame — it is simply wrong. `shadow-layer.ts` saves and restores
  the framebuffer, viewport, clear colour, clear depth, depth func and depth range.
- **A `canvas` source only re-uploads while it is "playing".** `play()`, let two frames
  pass, `pause()` — leaving it playing re-uploads a megabyte per frame of every pan.
- **Vite caches pre-bundled deps.** After changing a dependency version,
  `rm -rf node_modules/.vite`.
- **OpenMapTiles merges buildings into vast MultiPolygons** — one Shibuya feature had
  11,819 sub-polygons. Always bbox-filter before casting.
- **maplibre-gl is pinned to v5.24.** v6 was suspected of a tile bug but that was never
  confirmed. Worth retrying deliberately.
- **The slider track is sampled from the sun, not from the phase list.** The original
  banded track used hard stops on the reasoning that interpolating six fixed colours
  would smear an eleven-minute blue hour into nothing. That was right about *stops* and
  wrong about *sampling*: `skyTrackGradient` samples the real altitude every two minutes
  through twilight, so each band's colour is reached exactly when the sun reaches that
  band. `trackGradient` (banded) is kept — the segment list is still what the phase label
  and the jump buttons are built from.
- **A grid budget must be on total cells, not the longest side.** Bounded by the side, a
  wide viewport spends its whole allowance on width and throws away the vertical detail
  it already fetched — 425 m a sample over Hong Kong instead of 283 m.

**Known modelling limits (documented, acceptable, worth revisiting):**

- Building shadows now land correctly on *roofs* — a roof below the shadow's ceiling
  takes it, one above stays lit — but they still do not run up **walls**. Those are
  drawn by MapLibre's own `fill-extrusion` layer, out of reach from a custom layer, so
  shading them means taking over the extrusion pass. That is the remaining half of
  proper shadow mapping and a much larger change than the one just made.
- The shadow ceiling falls from the footprint's *down-sun extreme*, which slightly
  overstates it for parts of a shadow thrown by a nearer edge. It errs towards drawing
  a shadow rather than withholding one, which is the same direction the convex hull
  already errs in.
- Under map pitch the ceiling interpolates screen-linearly rather than
  perspective-correctly, so it is exact in 2D and approximate in 3D.
- Concave footprints are slightly over-covered (convex hull fills the notch), for both
  the shadow and the height field — deliberately the same shape in each, since a
  footprint that disagreed with its own shadow would punch a hole in it.
- Near the horizon the shadow set is capped at the 4,000 tallest; the readout says
  `N tallest of M` rather than passing triage off as complete.
- Landform shadows are nearest-neighbour over a 20–300 m grid depending on zoom, and
  only terrain inside the fetched field can cast. The grid size is printed in the panel.
- `almanac.ts` is worth about ±8 minutes on an equinox instant — the periodic error of
  the low-accuracy solar series. That is why it is only ever printed as a *date*.
- The moon is the classic truncated series: 1–2 arcminutes, about a twentieth of the
  disc. Parallax *is* applied (it is up to a degree); the azimuth correction for it is
  not, being far smaller.

---

## Running and verifying

```bash
npm run dev          # https://localhost:4321/scout
npm test             # 480 tests
npm run check        # tsc + the page <script> blocks
npm run build
```

`/scout` is SSR like `/inspiration` — it needs the Mac running and stays out of the
Netlify static export.

**Ask the user to confirm anything visual.** Several sessions could not see the map
render and that caused real, repeated misdiagnosis.
