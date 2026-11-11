# Recon, round 8: Atlas Photo, against Scout

Scope (2026-10-24): the user asked for the replica pass on **Atlas Photo – Spot Finder**
(iOS/iPad/Android, Ensemble Technologies Inc., Android id `com.ensembleai.scoutai`), focused on
two things:

1. **Building detail on the map**: windows, landmark models and other 3D assets.
2. **Where its photo hotspots come from.**

This is competitor research for Scout, not a clone. Everything else in Atlas (Showroom, groups,
lessons, AI editor, paywall) is inventoried briefly for completeness. The locked decisions in
`colour-archive-scout`, `scout-hotspot-quality` and `scout-map-first-redesign` still hold.

Sources were public pages only: the App Store and Play listings, ScreensDesign's public teardown,
Mapbox's public docs, and atlasphoto.app's home and `/photo-spots` pages. **atlasphoto.app's
robots.txt disallows `claudebot` and `anthropic-ai`, so after those two pages nothing more was
read from that domain.** No account, no network logging, no bundles.

## Sources

| source | what it gave |
| --- | --- |
| [App Store listing](https://apps.apple.com/us/app/atlas-photo-spot-finder/id6751760948) | description, version history (2.5.4 → 2.8.1 since May 2026), 19 screenshots, 10 IAPs ($14.99–$99.99) |
| [App Store reviews](https://apps.apple.com/us/app/atlas-photo-spot-finder/id6751760948?see-all=reviews&platform=iphone) | "Every location is uploaded by real users" (Jun 27); "many incorrectly located photo spots" (Jul 20) |
| [Google Play listing](https://play.google.com/store/apps/details?id=com.ensembleai.scoutai) | package name `ensembleai.scoutai`; says it does **not** rely on random user uploads ("AI-driven insights, professional expertise, real-world environmental data") |
| [ScreensDesign teardown](https://screensdesign.com/showcase/atlas-photo-spot-finder) | 24-step onboarding, light scrub on the map at 01:05, AI photo tool → Lightroom, soft paywall |
| [atlasphoto.app](https://atlasphoto.app/) | "2,688,769 photo spots. Pinned by photographers." "Every photo here is a pin" |
| [atlasphoto.app/photo-spots](https://www.atlasphoto.app/photo-spots) | per-theme counts: Nature 51,999; per-city: Greater London 2,714; US 227,456 |
| [DPReview thread](https://www.dpreview.com/forums/threads/atlas-photo-spot-finder.4816687/) | (403 to fetch; the search snippet only) one user guesses the images are scraped from Google with AI. Unverified |
| [Mapbox Standard guide](https://docs.mapbox.com/map-styles/standard/guides) | `show3dBuildings`, `show3dFacades`, `show3dLandmarks`, `show3dTrees`, `lightPreset`, `theme` |
| [Mapbox: 3D landmarks in 80+ cities](https://www.mapbox.com/blog/global-cities-3d-landmarks) | landmark models are hand-made per city: tourist sites, stations, stadiums, skyline towers |
| [Mapbox: detailed architecture](https://www.mapbox.com/blog/detailed-architecture-and-new-design-flexibility-enhance-the-latest-release-of-mapbox-standard) | facades with individual windows, roof shapes and ground-floor detail, near landmarks |
| OpenFreeMap tile `14/4824/6157` (midtown), decoded locally | what Scout's own buildings data already carries (below) |

Reference screenshots are in `replica/round-8/screens/` and are never shipped.

## Focus 1: the buildings

### What Atlas shows

From S10 (NYC, Central Park, SF) and S11 (iPad, Palace of Fine Arts):

- **Two classes of building.** Most blocks are plain flat-roofed extrusions in one warm grey
  with ambient occlusion at the base. A few dozen **landmarks per city** are real 3D models:
  Empire State with its setbacks and spire, Chrysler, Woolworth, One57, Central Park Tower, the
  Hearst Tower's diagrid, and Palace of Fine Arts with its colonnade and dome. These models have
  **window bands and glass that reads blue-grey**, plus true roof shapes.
- **Facade detail around landmarks.** Buildings next to a landmark get window grids. Away from
  landmarks, the walls are blank.
- **3D trees** in parks (Central Park, Washington Square, the Presidio), as instanced lollipop
  models with shadows.
- **Real cast shadows** from every extrusion, model and tree onto the ground and onto other
  buildings, driven by the time scrubber. A "Sun simulation · Day" strip on iPad, and a vertical
  date/time pill ("Today", "16:30", "Now") on iPhone.
- **Pastel Standard basemap**: pale green parks, lilac-grey streets, route shields (`1`, `2`, `8`).
- Map mode buttons: `3D`, a cube, and a map icon. The "added new view to the map" release (2.6.5)
  suggests a second 3D view, possibly satellite.

### Where it comes from: **Mapbox Standard, off the shelf** (confidence: high)

- The **`mapbox` wordmark** shows on the profile globe (S20) and the iPad sun sim (S11).
- The iPad screenshot catches a React Native red box, *"Text strings must be rendered within a
  <Text> component"*, so the app is **React Native + `@rnmapbox/maps`**.
- Every feature above maps one-to-one onto a Mapbox Standard config switch: `show3dLandmarks`
  (the hand-made models), `show3dFacades` (windows "near landmarks", word for word what the
  screenshots show), `show3dTrees`, and shadows and AO from Standard's directional light. The
  pastel look is Standard's `theme`. The time scrub is the app setting the light direction from
  a sun-position calc. `lightPreset` alone has only four presets.

So Atlas built none of the 3D. **The windows and landmarks are Mapbox's licensed content**,
modelled by Mapbox for about 100+ cities. That is a `skip` for us (see features.csv): we can't
take Mapbox's models into MapLibre, and moving to Mapbox GL v3 would trade OpenFreeMap (free, no
key) for a metered token and a closed renderer.

### What Scout has, and what it already carries but throws away

Scout extrudes OpenMapTiles `building` from OpenFreeMap (`src/lib/scout/view/page.ts:1753`) with
a sun-driven colour ramp, its own custom shadow layer and OSM trees. Decoding the midtown tile
(`14/4824/6157`) showed:

| field | in tile | used by Scout |
| --- | --- | --- |
| `render_height`, `render_min_height` | yes, and 272 of 1,488 features are **stacked parts** (min height > 0) | yes |
| `hide_3d` | yes, on 12 outlines, including the **Empire State outline: 444 m, `hide_3d: true`** | **no** |
| `colour` (OSM `building:colour`) | on **1,298 of 1,488** features ("beige", "#5a81a0", "black"…) | **no** |

**Bug G1, confirmed from data:** the Empire State outline is extruded as one solid 444 m box,
which swallows the setback parts (`330→444 m`, `#d5d5d5`) that are already in the tile. Every
building mapped with `building:part` (most landmark towers, cathedrals, stations) renders as its
bounding block. The fix is one filter, `['!=', ['get', 'hide_3d'], true]`, on `scout-buildings`
and on whatever the shadow layer reads. This gets Scout the **stepped massing** that is most of
what makes Atlas's skyline read, at no cost.

### How we get windows without Mapbox

The gaps, ranked by how much each changes the picture, cheapest first:

1. **G1 `hide_3d` filter**: setbacks, spires, domes (as stacks of parts). One line.
2. **G2 facade tint from `colour`**: mix OSM `building:colour` into the sun ramp at low
   saturation (as Standard does: pale, not literal), keeping the "light carries hue, building
   carries value" rule in `basemap.ts:211`. Glass towers ("#5a81a0") then read blue-grey like
   Atlas's.
3. **G3 procedural windows** in a custom layer (we already run two: `shadow-layer`, `dome-layer`).
   Re-extrude visible footprints with wall UVs: `u` = metres along the wall, `v` = metres up.
   Then in the fragment shader: floors every 3.2 m (3.8 m ground floor), bays every 2.8–3.5 m
   (hashed per building), the window rectangle darker and slightly reflective, and walls under
   ~6 m skipped. At night, a hashed share of windows is lit warm. That ties into the basemap
   already going dark at night, and matches Standard's lit-window night look. Limit it to z≥16
   and to the visible tile set, and fade it in so it doesn't shimmer. The traps in
   `maplibre-custom-layer-gl-traps` apply. Verify by reading pixels.
4. **G4 roof shapes** from OSM `roof:shape`: **not in OpenMapTiles**. It needs Overpass, as
   trees already do, or a self-built tileset. Domes and spires come mostly from G1 parts anyway.
   Defer.
5. **G5 landmark models**: open options are thin. Google Photorealistic 3D Tiles look real but
   are metered, need Google attribution and logo, and their terms forbid caching. CC-BY Sketchfab
   models need one-off placing per landmark. **Recommend skip.** G1 to G3 get most of the read.

## Focus 2: where the hotspots come from

### What Atlas shows

- Square **photo pins with an orange score badge** (88, 91, 83…), clustering into a stack of
  thumbnails (S10 SF).
- Bottom-sheet list: thumbnail, name ("Washington Square Park", "Manhattan Bridge from…",
  "Palace of Fine Arts", "Golden Gate Bridge Main Cable Cross Section"), score in purple,
  distance and address, save and report flags.
- Spot detail (S12): photos, an hourly forecast with cloud cover, sunrise/sunset, the **camera
  settings of a shot there** (body, lens, f, shutter, ISO, focal), "Pro Tips" prose, and "Take
  Photo / Add Photo".
- Users post with a **required location** and optional camera settings (S15). Posts can go into
  the Showroom for swipe-rating.

### Where it comes from: **a bulk-seeded POI layer, with community posts on top** (confidence: medium. Atlas doesn't say, and its own copy contradicts itself)

Evidence:

- **Scale doesn't fit a community.** 2.69 M spots against ~50 k Android installs and ~1.2 k App
  Store ratings. And theme counts are tiny next to the total (Nature 51,999), so the bulk is
  uncategorised. That is an import, not pins.
- **Names are POI names, not photographer names.** "Golden Gate Bridge Main Cable Cross Section",
  "Fort Point National Historic Site" and "The Mall and Literary Walk" are map-database place
  names. Community spots would read "Manhattan Bridge from Washington St".
- **Two address formats.** "983 Marine Drive, San Francisco, California 94129, U[nited States]"
  is Mapbox-geocoder style, and "New York, NY 10019, USA" is Google style. That points to at
  least two seeding passes, or reverse-geocoding on import.
- **The copy contradicts itself.** The website says "Pinned by photographers". Play says "not
  random user uploads… AI-driven insights, professional expertise". An App Store reviewer says
  "uploaded by real users". Another says "many incorrectly located photo spots", which fits an
  import more than hand-placed pins.
- **The score and tips read as model output.** A 0–100 "photo score" on every spot, and Pro
  Tips like "The iconic Chicago Theatre marquee is a quintessential symbol of the city…". The
  package was literally `scoutai`.
- **The community layer is real.** Handles (@sjpmedia, @offscriptlucas), coordinates and EXIF
  on posts, and "Top frames" leaderboards. Those photos attach to the seeded spots, or create
  new ones.

**Inferred pipeline (a guess, labelled as one):** import POIs with photos from a places
database (Google Places is the DPReview guess, and the naming and address style fits), have an
LLM write the tips and score each spot, then let posts with GPS add to or create spots. What
source the *photos* on seeded spots come from is **not knowable from public material**. Google
Places photos can't legally be stored, which is the likely legal soft spot.

### Against Scout

Scout already does the defensible version: Flickr `interestingness-desc` plus curated
photographers by verified NSID, licence-aware with origin links (`sources/flickr.ts`), and
Commons as an off-by-default reference layer. Per `scout-hotspot-quality`, **more volume from a
documentation source is not the goal**, so Atlas's 2.7 M is not a target to chase. What *is*
worth taking:

- **H1 per-spot camera settings**: Flickr returns EXIF (`flickr.photos.getExif`), so show "f/8 ·
  1/125 · ISO 100 · 24 mm" under a hotspot photo when the owner allows it. This is Atlas's most
  photographer-useful spot field.
- **H2 a spot score**: something better than an opaque number. Rank by a *disclosed* blend
  (Flickr interestingness rank + number of distinct photographers within 30 m + curated
  photographer hits). Show it as words ("4 photographers shot here"), not 88.
- **H3 place names for clusters**: name a cluster from the nearest OSM `name` or `tourism=viewpoint`
  (Overpass is already wired for trees) instead of coordinates.
- **H4 lighter pins**: Atlas's square thumb + badge is the same weight problem noted in
  `scout-map-first-redesign`. A smaller thumb without a badge, and cluster stacks, would help.
- `skip`: bulk POI seeding, LLM-written tips, social/Showroom/leaderboards (no login, by
  decision).

## Screen inventory (brief, for completeness)

| ID | screen | how you get there | purpose | states seen |
| --- | --- | --- | --- | --- |
| S01 | Level question | first launch | Beginner / Hobbyist / Pro | selected |
| S02–S05 | Onboarding quiz (24 steps) | S01 → | genres, focal length, aperture, "When do you shoot?" live 3D light demo, "What's your style?" swipe 0/10 | filled |
| S06 | Paywall | end of onboarding | 7-day trial timeline, $39.99/yr, "45% OFF forever" second modal | default, other options |
| S07 | For You | tab 1 | feed of posts, groups to join | filled |
| S08 | Showroom | tab 2 | swipe-rate shots, Leaderboard "Top frames" | filled |
| S10 | Discover map | tab 3 | Mapbox 3D, photo pins with score, time pill, filters, sheet list | NYC, SF, globe |
| S11 | Sun simulation | map control | date + time strip, shadows | day |
| S12 | Spot detail | tap pin or list row | photos, forecast, camera settings, Pro Tips | filled |
| S13 | Groups | tab 4 | city groups, join | filled |
| S15 | New post | + | photo, description, genre chips, location (required), settings, Showroom opt-in | empty |
| S16 | Lessons | For You → Lessons | composition sections, streak, kudos | start |
| S17 | AI photo tool | post → analyse | "In plain terms", mood/brightness/colour, Lightroom sliders | filled |
| S20 | Profile | tab 5 | portfolio, spots globe (Mapbox), likes | filled |

## Flows

```
F01 Find a spot for tonight's light
    S10 map -> pin -> S12 detail -> forecast + camera settings -> directions
    happy path: 3 taps. Scout's equivalent is 2 (pin -> sheet), with no paywall.
F02 Preview the light on buildings
    S10 -> drag time pill / S11 strip -> shadows move on landmarks
```

## Inferred data model (spots only)

```
Spot     id, name, lat, lon, address, category?, score (0–100), tips (text), photo_ids[]
         evidence: S10 list rows, S12 detail; confidence: high for fields, low for score meaning
Post     id, user_id, spot_id, image, description, genres[], camera {body, lens, f, ss, iso, focal},
         showroom_opt_in, feedback_prompt
         evidence: S15, S12 "Camera Settings"; confidence: high
```

## Size

For Scout's purposes: **S to M**. G1 and G2 are an afternoon. G3 (procedural windows) is the
real work, about 2–4 days with pixel verification. H1 to H4 are a day or two. The rest of Atlas
(social, lessons, AI editor) is out of scope by decision.

Next step: `/replica-architect`, or straight to build, since everything lands inside Scout's
existing layers.
