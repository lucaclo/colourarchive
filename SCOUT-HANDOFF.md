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

**The whole point of the project** is Part 7 below — the join between sun position and
photo spots — and as of 2026-08-07 it is **built**: every photographed spot near the pin
carries its own day of light, the pins recolour as the slider moves, and there is a
ranked list beside the map. What it cannot do is say front- or back-lit for someone
else's photograph, because Commons records no shot bearing and this project does not
invent one. That is waiting on Flickr, and on nothing else.

**House style:** comments explain *why*, not *what*. The project's ethos is refusing to
assert what wasn't measured — a shadow drawn from a guessed building height must look
different from one drawn from a surveyed height, and a forecast must not be dressed up
as arithmetic. Keep that.

---

## What exists and is verified

902 tests pass (`npm test`), `npm run check` clean, `npm run build` clean.

`npm run smoke` (`tests/scout.smoke.ts`) drives the page in a real browser —
Playwright and Chromium, against `astro dev` because `window.scout` is gated
behind `import.meta.env.DEV`. Twenty-one assertions across four suites, each one
per failure this tab has actually shipped: no uncaught errors; no height field fetched before a place is
chosen (the 24,450-tile storm); a link restores a spot and scrubbing moves the
sun; turning the sun path off changes the pixels on the map, which is the
only way to notice a shader that will not link; every photographed spot has
its day computed, with the ranked list's rows laying out as a grid rather than
falling back to a UA default; and the core fold states the shutter limit while
refusing the framing until an aim exists, which is a gate in the page that no
unit test can see. It runs in CI as its own job, so a red smoke against a green
build reads as "look at the network".

The alignment finder has its own suite, on its own page, because its cases have
to *press* things rather than read them and pressing needs the panel open —
which in an automation tab means killing CSS transitions first, since `max-height`
never advances there and every click lands on the panel head. Three cases: it
refuses a bearing nobody chose, a search fills rows that lay out as a grid and a
row moves the whole page onto that evening, and a moved ring marks the standing
answer stale instead of emptying a list somebody is reading.

| File | Lines | What |
|---|---|---|
| `src/lib/scout/sun.ts` | 543 | Solar position/times engine (Meeus/NOAA). 56 tests |
| `src/lib/scout/moon.ts` | 494 | Lunar position, phase, moonrise/set. Topocentric. 27 tests |
| `src/lib/scout/terrain.ts` | 700 | Terrarium decode, height field, landform shadow sweep, horizons. 41 tests |
| `src/lib/scout/daylight.ts` | 616 | Phase bands, the continuous track, event rows, dates. 56 tests |
| `src/lib/scout/skyline.ts` | 410 | Per-point horizon from buildings, merged with terrain. 30 tests |
| `src/lib/scout/lighting.ts` | 245 | The join: front/side/back/rim-lit, the refusals, the order. 30 tests |
| `src/lib/scout/alignment.ts` | 590 | Behind a target: bearing crossings, passes, the four absences. 23 tests |
| `src/lib/scout/astrophoto.ts` | 380 | The night join: trailing limits, the core against the frame. 36 tests |
| `src/lib/scout/shadows.ts` | 406 | Building + monolith shadow casting, with ceilings. 41 tests |
| `src/lib/scout/weather.ts` | 273 | WMO codes, cloud → light quality, forecast parsing. 23 tests |
| `src/lib/scout/air.ts` | 128 | Aerosol optical depth: parse, look up by instant. 7 tests |
| `src/lib/scout/galactic.ts` | 413 | Galactic core position, precession, the moon-free dark window. 19 tests |
| `src/lib/scout/geo.ts` | 191 | Spherical geodesy, radius ring. 31 tests |
| `src/lib/scout/almanac.ts` | 175 | Equinoxes and solstices, solved not tabulated. 15 tests |
| `src/lib/scout/basemap.ts` | 214 | Contrast overrides + sun-driven colour ramps. 16 tests |
| `src/lib/scout/dome.ts` | 130 | Sun/moon path as a 3D ring in the sky. 17 tests |
| `src/lib/scout/share.ts` | 130 | A spot as a link: encode, and decode with validation. 13 tests |
| `src/lib/scout/report.ts` | 95 | The day as pasteable text. 10 tests |
| `src/lib/scout/geocode.ts` | 278 | Nominatim: search **and reverse**, rate limit, disk cache |
| `src/lib/scout/weather-client.ts` | 100 | Open-Meteo, server-side, 20-minute cache |
| `src/lib/scout/view/terrain-shadows.ts` | 333 | The landform overlay: tiles, canvas source, throttle |
| `src/lib/scout/view/dome-layer.ts` | 160 | The custom WebGL layer + a geometry builder |
| `src/lib/scout/view/shadow-layer.ts` | 564 | Cast shadows as volumes: height buffer, MAX blend. 8 tests |
| `src/lib/scout/view/alignment-panel.ts` | 305 | The alignment fold: the ring's bearing, the rows, the staleness |
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

**A tier going quiet used to look exactly like a place with nothing in it** — the fault
behind #29. `incategory:` against `Category:Valued images` matches direct membership
only, and everything actually promoted lives in a subcategory by country, by subject, by
month; that tier measured 0 at Edinburgh, Glencoe and Skye, at every radius, for as long
as it existed, and `collectCommonsPhotos` folding a failed request into the same
`titles: []` a genuinely empty one produces meant nothing said so. `deepcat:` fixed the
query (0 → 14 at Edinburgh); `collectCommonsPhotos` now also returns a `tiers: { accolade,
ok }[]` alongside the photographs, so a request that actually failed is distinguishable
from one that came back empty, the "Photographed" fact row says *"N of 4 sources
answered"* when they disagree, and `photo-client.canary.ts` asks the real API for a
coordinate with known non-zero counts in every tier — `npm run canary:scout-photos`, not
part of `npm test`, since a live dependency should not decide whether it passes.

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

### Part 6 — Pins and detail sheet *(done, except the bearing)*

**This was built under Part 5's heading and mislabelled here for two sessions.** Hotspot
circles sized by count, a detail sheet with credit and licence under every thumbnail,
distance and span in its header, and saved spots carrying a full `SpotFrame` — sensor,
focal length, bearing, tilt — all already existed. The only piece genuinely missing was
the best-light window per spot, and that landed with Part 7.

**Shot bearing is the hard field, and it is the one thing still absent.** Some Flickr
EXIF carries `GPSImgDirection`; most doesn't, and Wikimedia Commons does not expose it
*at all*. So no amount of work here produces a bearing — **this is blocked on Flickr, not
on pins.** `RawPhoto.bearing` is deliberately optional and never invented.

### Part 7 — The join ⭐ *(built 2026-08-07 — this is the product)*

For each spot: `spotBearing × sunAzimuth` at the slider time → **front-lit / side-lit /
back-lit / rim-lit**, combined with lit-or-shaded.

Both halves now exist.

- **Lit-or-shaded, per spot.** `rebuildHotspotLight()` runs `buildSkyline` +
  `mergeHorizon` + `lightWindows` for every hotspot, not just the pin. Off the slider's
  path entirely — it depends on the place, the buildings and the date, and the slider
  moves none of them — so scrubbing is an array lookup and a sort. Guarded by a signature
  over `isoDate`, `castableSignature` and the hotspot ids.
- **`lighting.ts`** (28 tests) is the direction half: one measured angle,
  `angleDelta(aim, azimuth)`, and three bands on it. It **refuses more often than it
  answers** — sun down, spot in shade, or aim unknown each return a `direction` of null
  and an `absence` saying which. Every Commons photograph hits `aim-unknown`.
- **Pins recolour live**, four states not two: gold lit, blue shaded, slate sun-down, and
  the original cyan for a spot whose light was never computed. `setData` is guarded by a
  paint signature that includes the spot ids — without those, a moved pin returning a
  differently-placed set with the same lit pattern would leave the old pins on the map.
- **The ranked "best right now" list** in the panel, with the pin's own verdict in the
  framing box (where the aim lives — asserting a direction from a bearing nobody chose
  would be the same fabrication the module refuses for a photograph).

**Two things this got wrong first, both found by driving the real page, neither
visible to any test:**

1. **Ranking on light alone rewards ignorance.** A spot with no buildings loaded has
   nothing to shade it, so it reports *more* light than one properly examined — and the
   list came back with eight of eight rows "terrain only". `buildingsKnown` is now a
   ranking criterion, placed straight after `lit`, so confidence outranks the quantity it
   inflates. `buildingsCover()` tests whether the whole 1.5 km skyline disc fell inside
   the collected box, not merely whether the point did.
2. **`frame.ts` was making a lighting claim on a different threshold.** Its `'behind'`
   note said "front-lighting whatever you are pointed at", derived from its own 90°
   behind-the-camera test. At 132° off aim it sat directly above `lighting.ts` saying
   "side-lit", disagreeing about the same sun. `frame.ts` now answers only where the sun
   is relative to the *frame*. One question, one owner.

**Never rank by a score.** The order is five stated criteria in a stated priority and the
note prints them. A number nobody can reproduce is exactly what this project refuses to
publish about sunsets, and it would be no better here.

Verified in a browser at Calton Hill: 38 hotspots, all with their day computed, 31 lit at
08:00, 18 at 19:10, 0 at 23:00, pins painted 31 lit / 8 shaded. There is a smoke case for
it — the list rows are built by script, which is the exact shape of the Astro scoping bug
this project has already shipped once.

### Part 7b — The night join *(built 2026-08-09)*

The astrophotography counterpart to Part 7: the same "where is it *relative to my
picture*" question, asked of the Milky Way core instead of the sun.

- **`astrophoto.ts`** (36 tests). Two answers, and they are gated differently on
  purpose. The **shutter limit** needs only the body, so it is always offered; **where
  the core lands in the frame** needs an aim, and an aim nobody chose is the same
  fabrication `lighting.ts` refuses for a Commons photograph, so it appears only with
  the frame layer.
- **No rule of thumb.** The 500 rule predates digital and cannot tell a 12 MP body
  from a 61 MP one; the NPF rule does use pixel pitch but wraps it in fitted constants,
  which makes it exactly the unreproducible number this project refuses to publish about
  sunsets. Instead: a star at declination δ moves at `15.041″/s · cos δ` — an identity,
  not a fit — projected through the focal length onto the pixel pitch, giving the trail
  **in pixels**, which can be checked against the file afterwards. Two shutters are
  printed (one pixel, three) because there is no single right answer and offering one
  would imply there was. Calibration, since everyone arrives holding a rule: at 24mm on
  33 MP the 500 rule is 6.2 px of trail and NPF at f/2.8 is 3.1 px.
- **Pixel pitch is derived, not tabulated** — a table would be a list of bodies and the
  picker offers formats. A "Sensor pixels" control was added to the lens box; it gives
  the a7C II 5.11 µm against its real 5.12.
- **The core is a region, not a point.** `CORE_SPAN_DEG = 15` now lives in `galactic.ts`
  (the size of the thing belongs with the thing), and `frameRegion` walks its rim *on the
  sky* and projects each point, rather than adding a radius to the frame offsets — near
  the zenith ten degrees of sky is a hundred degrees of azimuth and only the projected
  rim knows that. A circle on the sphere projects to a conic, so the rim really does
  bound it. It reports overflow (how much is being cut off) and shortfall (how far the
  nearest of it is from getting in) as **different numbers**, which the first version
  conflated.
- **`inFrameWindows`** says how long the composition holds — the sky turns 15°/hour, so
  this is what decides how many frames there are to stack. Measured at Calton Hill:
  18:55 → 00:37 on a 24mm.
- **"At the core"** joins the aim buttons, and unlike the other two it aims at a moment
  that has not happened — the best of the coming night, not the slider's minute.
- **A Milky Way button** sits beside Layers in the top-right controls, because the answer
  was reachable and not findable: a panel section opened by clicking a heading, a layer
  toggle two menus deep *with the same name as that section*, and a framing answer gated
  on a different toggle again. Three discoveries for one question. One press now switches
  on the arc and the frame layer, opens the section, aims at the core and scrolls to it.
  It **gives back only what it borrowed** — someone who already had the frame up to
  compose a sunset does not lose it by glancing at the Milky Way. It deliberately does
  *not* move the time slider: jumping to the best moment crosses a date boundary whenever
  that moment is after midnight, since the night runs noon to noon and the slider runs
  over the solar day. The layer toggle is renamed **"Milky Way arc"** — it only ever drew
  the arc, and sharing a name with the text section made ticking it look like a no-op.
- *Known:* the tilt slider stops at 80°, so an Atacama core at 85.6° cannot be centred.

**`frame.ts`'s framing test was only right for a level camera** and had to be fixed
first. It differenced azimuths and altitudes, which is exact only at tilt zero near the
horizon. Two things break it: azimuth is not a distance (meridians converge, so aimed 80°
up a subject 90° away in azimuth is **five degrees across the frame**, not out of shot —
and that is the core from anywhere worth photographing), and tilt swings the frame's own
axes (tilt up 45° and the horizon 20° off the aim sits 27° across it). `projectToFrame`
now builds a camera basis and reads the two angles off the image plane. Exact for a
rectilinear lens with no roll, which is the model the module already declared. Verified
against the spherical law of cosines — `tan θ = hypot(tan across, tan up)` — over a sweep
sharing no arithmetic with the implementation. The offered tilt is now also **checked
before it is offered**, because tilting swings the horizontal axis too. One existing test
changed: a subject 20° off axis and 10° up now reads 10.6°, which is what it is.

### Part 7c — The alignment finder *(built 2026-08-09 — issues #30, #31, #32)*

"On what dates does the sun set **behind that**?" Every other answer on this page
starts from a moment and asks what the light is doing; this one starts from a
picture and asks which dates it happens on.

**Why this beats the usual answer.** The planners that offer this match an
azimuth against a *flat* horizon — "the sun sets at 245° on 12 September", which
is true and is not the answer, because a summit stands some degrees above the
horizon and the sun reaches the bearing minutes before it reaches the height.
Scout already holds the real profile, so `obstructionAt(skyline, bearing)` over
the merged buildings-and-terrain skyline turns that into "12 September, 19:04,
the sun meets the ridge 3.1° up".

- **`alignment.ts`** (23 tests). Scans each day for sign changes of the gap
  between the body's azimuth and the bearing, and bisects each to the second.
  Measured: `sunPosition` 0.246 µs, `moonPosition` 0.523 µs, so a year at the
  four-minute default is **38 ms for the sun and 74 ms for the moon** — a button
  press, not a frame, which buys robustness that a seeded secant walk would not
  have where this is interesting (a branch that appears in April and vanishes in
  September).
- **The answer is a *pass*, not a date.** Passes are the local minima of
  |clearance| along each branch — "every time it comes closest and then goes away
  again" — each carrying the run of consecutive dates whose disc still touches the
  line. A run because that is the truth: the disc has width and the geometry
  drifts a fraction of a degree a day, so the shot is usually on for two or three
  evenings, and naming one would throw the others away.
- **The tolerance is the body's own disc**, per instant, from the model:
  `moonPosition` already returns `angularRadius` and the sun's follows from
  `distanceAU`. So a perigee moon really does get a wider window than an apogee
  one. A hand-picked degree would be the unreproducible constant this project
  refuses to publish about sunsets.
- **Four named absences, each carrying the closest approach**: `no-bearing` (it
  never reaches that compass point — the equator in June never sees the sun due
  south), `always-above`, `always-below`, `never-quite`. "No alignments" alone is
  a bug report, not an answer.
- **Apparent altitude, deliberately.** Refraction lifts the sun by more than its
  own width at the horizon and this is a question about what a viewfinder sees.
  Note `isSunlit` in `skyline.ts` compares the *geometric* altitude and is right
  to — that one is about which surfaces the beam reaches. Same sky, two
  questions, answered differently on purpose.
- **The bearing is the sightline ring's**, not a second way to aim. Gated on the
  *layer*, not on the coordinate: `redrawEverything` parks the ring half a radius
  due north the moment a place is chosen, so the coordinate is almost never the
  "never placed" sentinel — and due north is a placeholder, not a thing anyone
  pointed at.
- **A moved ring marks the answer stale; it does not clear it.** An arriving
  terrain tile must not empty a list somebody is reading, and an old bearing must
  not pass for the current one. `restate()` is a redraw, never a research.
- **Moon rows carry the lit fraction and phase** (`withMoonPhase`), with a filter
  that starts at nothing hidden and says how many rows it hid. Which fraction is
  worth the drive is the reader's call.
- *Known:* two crossings closer together than the scan step look like none. That
  only happens at a turning point of the azimuth, where the body grazes the
  bearing and turns back, and it is reported as `no-bearing` with how close it
  came — which is the honest description of a graze anyway.
- *Worth knowing about the moon:* alignments are date-quantised. The moon crosses
  a bearing once a day and its altitude there swings degrees between nights, so
  the nearest night is often 0.7° off and the disc never quite touches. That is
  the real world, not a bug, and it is why the near-miss number is printed rather
  than swallowed. The move that fixes it — walking a few hundred metres — is not
  built.

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

- **Landform shadows walked straight over ridges, and that was the flickering.**
  `terrainShadowMask` marched from every cell towards the sun with a step growing 3.5% a
  time, justified in its own comment as "a ridge ten kilometres off is a kilometre wide
  and does not need sampling at 30 m". That is false: distance makes a ridge subtend a
  smaller *angle*, it does not make the crest broader in the grid. By 5 km out the step
  was ~200 m and anything narrower fell between two samples.

  Measured on a plain with one wall casting an 8.6 km shadow — fraction of the ground
  behind it actually shaded: **20 m ridge 26%, 40 m 48%, 100 m 84%**, and only past
  200 m reliable. Worse, *which* cells fell through depended on the sun's azimuth, so
  the holes crawled as the slider moved. That is what "the shadows glitch and pass
  through mountains" was.

  Replaced with an exact **sweep**. Every cell on a line towards the sun blocks the ones
  behind it identically, so a line settles in one walk instead of being re-marched from
  each cell. Expanding the blocking condition separates the two distances completely:

      A(s′) + s·B(s′) > C(s)
      A(s′) = h(s′) − s′²/2R + s′·tan(alt),  B(s′) = s′/R,
      C(s)  = h(s)  + s²/2R  + s·tan(alt)

  — so "is anything upwind blocking me" is the upper envelope of a set of straight lines.
  Cells arrive at increasing `s`, hence increasing slope, and are queried at increasing
  `s`: the textbook conditions for a monotonic hull, O(1) a cell. Nothing is skipped, the
  curvature term is carried in full (that expansion is an identity, and is invariant to
  where the line's origin is put), and it is **~60× cheaper** — 2.9 ms for the full
  470×470 production grid against tens of milliseconds.

  Three knock-ons. `maxDistanceM`/`growth`/`maxSteps` are **gone**: they bounded a march
  that no longer exists, and a distance cap could only lose a shadow a real mountain
  casts. The **coarse stride-2 drag pass is gone** — it bought 1.7 ms and cost a visible
  shift in the shadow edge the moment you let go. And `terrainShadowAt` now steps one
  cell at a time too; it had its own coarser march, so the panel could say the pin was
  lit while the map painted it shaded. `stride` survives as a dial nothing uses, and now
  thins by taking the **tallest** cell in each block rather than a sample of it —
  point-sampling would reintroduce the same bug at half strength.

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
  dust reddens and keeps them. Shown as a "Light" fact row — a **swatch of the beam's
  own colour** beside CCT · stops, with EV and the provenance in the tooltip — over a
  strip of the whole day's beam colour, all three drawn from one `spectralLight` call
  so they cannot disagree.

  **Two of the four inputs are now measured** (#22). The aerosol *amount* comes from
  CAMS via Open-Meteo's air-quality host (`air.ts`, verified to send
  `access-control-allow-origin: *`, cached an hour on disk and in memory — it is a
  smooth field that moves over half a day). The *water column* comes from Reitan's fit
  on the forecast's dew point, which rides along on a request already being made,
  replacing a fixed 1.5 cm everywhere from the Sahara to Bergen. Elevation is measured
  from the DEM. The Ångström exponent — the particle *size*, which decides whether
  haze whitens or reddens — is still inferred from the sea fraction, because nothing
  publishes it; the tooltip names each of the four and which it was. Bird is a
  clear-sky model, so the row says so, and names the cloud cover that will change it.

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

0. **The *shadow* ramp is still hand-fitted** — the light's own colour is not, as of
   #22. `sunPaintColour` now grades the hillshade's highlight and the sky's horizon
   from the same spectral integral as the panel swatch and the dome arc, falling back
   to `sunlightColour`'s ramp below the horizon (where there is no beam to have a
   colour) and before a place is chosen. What is left is the other half: `basemap.ts`
   `shadowOpacity` is still `0.24 + 0.22·clamp01(altitude/18)` while its own comment
   argues in air masses, and it should be driven by `readLight().diffuseFraction`,
   with `shadowColour` from the computed sky chromaticity. Keep the ramps as the
   fallback when no height field has loaded.
1. **`scout.astro` is ~2,650 lines.** Two subsystems were lifted into
   `src/lib/scout/view/`; the map orchestration itself should follow before Parts 5–7
   are added to it.
2. **Esri World Imagery** is used for the satellite basemap with attribution. Free for
   this kind of use; if Scout ever goes public, check the terms again.

**Traps already hit — do not repeat:**

- **There was no way into the page on a phone without a server.** Place search needs
  Nominatim, Nominatim needs a proxy, and a published build without functions has none —
  so the search box refused and pointed at the pin. But the pin *arrives with the first
  spot*: with nowhere chosen there was nothing on the map to drag, and `map.on('click')`
  returned early on `!centre` by design ("the first spot is picked by name, not by
  guessing at a point on a world map"). Right about the world map, wrong about everything
  else, and on a phone the two rules closed the last door between them. A tap now places
  the first spot, gated on **zoom ≥ `TAP_TO_PLACE_ZOOM` (10)** rather than on the server —
  at the world view a fingertip is several hundred kilometres and the page says so rather
  than doing nothing, because a dead gesture reads as a broken map. The zone falls back to
  `browserTimeZone()`, since a spot with no zone puts the whole day in UTC.
- **`#sheet` is on screen from the first paint.** It carries "Nowhere yet", and
  `setCentre`'s `hidden = false` on it is a no-op. So its visibility is *not* a test for
  whether a place has been chosen — `#tools` is, or `window.scout.state().centre`. A smoke
  assertion written the obvious way passes at the world view and proves nothing.

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

**Two shadow faults found while fixing the above, both closed by issue #51:**

1. **Building shadows were projected at sea level.** Fixed: every vertex in
   `shadow-layer.ts` now carries its real elevation through `scoutGround`
   (mercator units for the flat matrix, metres for the globe radius — the
   two-units trap `dome-layer.ts` already documents), and `ShadowGeometry`
   packs a per-vertex DEM lookup rather than a flat zero.
2. **Terrain was not a blocker for building shadows.** Fixed: the depth-mapped
   height field now carries bare terrain (`terrainFacets`) alongside building
   footprints, all measured from the same absolute sea-level datum, so a
   mountain stops a shadow the same way a taller building already did.

**Known modelling limits (documented, acceptable, worth revisiting):**

- Building shadows land correctly on *roofs* — a roof below the shadow's ceiling
  takes it, one above stays lit — and, since issue #51's wall curtains, on
  **walls** too: a curtain around each shaded building's own outline, base to
  roof, darkened up to one ceiling sampled at the building's own anchor (the
  same one-sample-a-building trade `addBlocker` already makes, applied here to
  the shadow instead of the terrain). It is a building-level approximation,
  not a per-pixel one — the boundary is a flat band around the whole
  footprint rather than a shape that varies edge to edge — and it has no
  depth test against the real 3D scene (2D custom layers do not get one), so
  a curtain can in principle show through a nearer building that actually
  hides it from that angle. Both are the same class of tradeoff the rest of
  this file already accepts under pitch, not a new one.
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
npm test             # 874 tests
npm run check        # tsc + the page <script> blocks
npm run build
```

`/scout` is SSR like `/inspiration` — it needs the Mac running and stays out of the
Netlify static export.

**Ask the user to confirm anything visual.** Several sessions could not see the map
render and that caused real, repeated misdiagnosis.
