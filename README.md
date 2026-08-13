# Colour Archive

A personal photographic archive viewed as one continuous vertical scroll.
Photos are grouped into **chapters by dominant colour** and, within a chapter,
ordered along the **hue** so colour moves smoothly frame to frame.

Local-first: an in-app upload UI runs the whole pipeline on this machine.
Originals are stored **byte-for-byte untouched**; sharp runs locally, so there
is zero quality or colour loss on ingest.

## Run

```bash
npm install
npm run dev          # http://localhost:4321
```

- `/upload` — drag-and-drop photos in (or paste them). They're saved to
  `/photos` untouched, analysed, and placed into a colour chapter. Each photo is
  its own request, so progress is real, one bad file can't take the batch down
  with it, and you can stop a run part-way. Camera RAW is rejected on the spot
  rather than after the upload. New photos join the manage grid live.
- `/` — the archive scroll.

## Pipeline

`src/lib/` holds the pipeline; the upload endpoint (`src/pages/api/upload.ts`)
and the CLI both use it.

1. **Hash** — sha256 of file contents → stable ID + derivative basename.
2. **Dominant colour** — downsample, convert each pixel to **OKLCH**, discard
   near-black/near-white, quantise, take the most populous chromatic bucket.
   A dark frame with one red sign reads as red, not black.
3. **Chapter** — fixed 30° hue bins (never re-fit as the archive grows).
   Low-chroma frames go to the achromatic chapter.
4. **Overrides** — `photos.overrides.json` renames chapters / reassigns photos.
5. **Order** — chapters around the hue wheel; within a chapter, hue then lightness.
6. **Derivatives** — AVIF + WebP at several widths (ICC kept, EXIF stripped),
   plus an inline blurred placeholder. EXIF is preserved into the manifest.

## Style Match

On `/inspiration`, hover any reference and press **◐ match**. Drop in the photo
you want to edit and you get measured evidence, Lightroom values, a live preview
you scrub with a strength slider, and an importable `.xmp`.

`src/lib/match/` holds it. The pipeline:

1. **Decode** — RAW via macOS `sips` (ARW/CR3/NEF/RAF/DNG…), or a zero-slider
   Lightroom export, or the RAW's embedded preview. Each carries a different
   fidelity, and every measurement records which one it came from.
2. **Segment** — SegFormer-B2/ADE20K for scene regions, SegFormer-B2/clothes for
   real skin masks, RMBG-1.4 for a subject matte. Local, offline after first
   download, same as the DINOv2 and CLIP models already here.
3. **Erode** — every mask is shrunk inward before a pixel is sampled. A boundary
   pixel is a blend of both sides, and sky bleeding into a foliage mask would
   produce confident, wrong advice. Coverage traded for purity.
4. **Measure** — per region: OKLCH moments, circular-mean hue with a resultant
   strength, and luminance percentiles. Texture and grain from native-resolution
   crops, reported at a common scale so two differently-sized photos compare.
5. **Solve** — controls assigned in a fixed order, each closing only the gap the
   previous left. Tone is Exposure + curve (both exactly solvable); the Basic
   sliders are *descriptions* of that curve, never applied alongside it.
6. **Export** — `.xmp` carrying only what was measured. Anything with no
   evidence is omitted, not zeroed: a preset asserting `Sharpness="0"` would
   strip the default capture sharpening off your RAW.

It refuses as readily as it advises — a hue with no coherent direction, a
vignette that is really scene content, grain on a re-compressed reference, two
photographs too far apart to match. Every refusal says why.

Away from the Mac it falls back to measuring on-device: no models, no downloads,
global + luminance zones + colour bands only. Masks are unavailable and it says
so. Both paths share one measurement core, so the numbers agree.

```bash
npx tsx scripts/match-probe.ts <reference> <your photo> --out=DIR --strength=0.5
```

### Already in the archive

Opening a reference also ranks the whole archive against it **on grade alone** —
the tone curve, the cast, the saturation, the contrast, and how far the
highlights are pulled from the shadows in colour. Some evenings the answer is
that you already took it.

This is not the board's "find similar", which ranks by subject and composition
(DINOv2, colour layout, aspect). The two disagree constantly, and that is the
point: this one cannot see what the photograph is *of*.

`src/lib/match/resemble.ts` does the comparing, `looks.ts` the measuring — the
same measurement core the reference runs through, over the existing AVIF
derivatives, cached to `.match-cache/looks.json`. A first pass over ~70
photographs takes about two seconds; after that it is instant. The honest limit
is stated in the panel: a measurement of a photograph is a measurement of the
scene *and* the grade, and this cannot separate them, so the parts are reported
individually and nothing ever claims two photographs were given the same edit.

## Scout

`/scout` is the location-planning tab: type a place or drag the pin, pick a
date, scrub a time slider, and see how the sun and moon light it — including
real cast shadows from buildings and terrain. `src/lib/scout/` holds it, and
`SCOUT-HANDOFF.md` is the long version.

Three recent additions, all in the same refuse-rather-than-guess spirit:

**The frame** (`frame.ts`) — a sensor, a focal length, an aim and a tilt. The
wedge on the map is where the frame lands on the ground; the panel answers the
question the wedge cannot, which is whether the sun is *in* the picture rather
than merely lighting it. Rectilinear projection, no lens distortion and no flare
magnitude — so the answer near an edge is a gap in degrees, not a yes or a no.
It also solves the tilt that would just bring the sun into shot, rounded
*inward* so the number it prints always works.

**Cloud, deck by deck** (`weather.ts`) — Open-Meteo's low, mid and high cover
alongside the total. One total cannot tell cirrus over a clear sun from a grey
afternoon and they are opposite photographs; only low and mid stand between the
sun and the ground, so only those scale a drawn shadow now.

**The sunset's own sky** — the light that reddens the cloud above you left the
sun travelling nearly horizontally and passed low over the ground about three
hundred kilometres away, in the sun's direction. That distance is √(2·R·h), not
a matter of taste, and it is why a forecast *for where you are standing* cannot
answer whether a sunset will have colour. Scout fetches that second forecast and
reports the arrangement — cloud on the sun's horizon, cloud overhead — and
deliberately emits **no score**. A number out of a hundred is a model's opinion
wearing a percentage; the two measurements are quoted so they can be disagreed
with.

**Line of sight** (`profile.ts`) — drag the ring to what you want to photograph
and get the terrain cross-section between, the straight line from eye to
subject, and where the ground rises into it. Curvature is added to the ground
rather than subtracted from the line (same picture, more honest one), with the
same 7/6 refraction allowance the horizon uses, and the answer is "you are
eleven metres short at the ridge 1.9 km out" rather than a yes or no. Bare earth
only — trees and buildings are not in it, and it says so every time it appears.

### Scout is published; Inspiration is not

`/scout` prerenders, so it ships in the static build alongside the archive. It
reads nothing of yours and needs almost no server: the sun and moon are
arithmetic, the terrain and its shadows are decoded in the browser, and the
frame and the line of sight are geometry.

Where its data comes from depends on what is behind it, and that was measured
rather than assumed:

| Source | From a page? |
|---|---|
| Open-Meteo (weather, cloud decks, the sunset horizon) | yes — `access-control-allow-origin: *` |
| Wikimedia Commons (photo hotspots) | yes, with `origin=*` |
| Nominatim (place search, the dragged pin's name) | **no** — no CORS header under any query string |

So the published Scout calls the first two directly and routes the third through
`netlify/functions/`, which import the same `searchPlaces`/`reverseGeocode` the
Astro routes do — one implementation, not two. `browser/sources.ts` holds the
direct transports and reuses the same parsers as the server path, so both
produce the same objects. The choice is baked in at build time from
`PUBLIC_STATIC`, not probed at runtime.

**A Netlify _Drop_ deploy carries no functions.** Drag `dist/client` onto Drop
and everything works except typed place search, which says so in as many words
and points you at the pin. Use `npm run deploy:site` if you want search.

`/inspiration` stays server-only: it writes to disk, and it holds other people's
photographs pending credit. That means "already in the archive" is a Mac feature
by design, not by omission.

## Publishing

```bash
npm run drift         # what is published, what is here, what a publish would change
npm run deploy:site   # the same report, then publish, then confirm it arrived
```

One manual command, deliberately. The Netlify project has **no repository
linked**, and linking one would not help: `photos/` and `public/img/*` are out of
git because they are large, so a repository-driven build would produce a site
listing seventy-nine photographs and able to show none of them. One route that
carries the code *and* the imagery beats two routes with different latencies.

The cost of a manual route is that not running it leaves no trace — publishing
had drifted ten days and 69-against-79 photographs behind the Mac, and the site
did not look old, it looked fine. So the build writes **`/publish.json`**: when
it was built, how many photographs, and their ids. `npm run drift` reads it and
names the photographs that would be added; the foot of the archive page carries
the date for anyone reading it; and after a deploy the command asks the site
whether the build it just sent is the one now being served, because the CLI has
exited 0 on a deploy that never landed.

## The manifest against the files

```bash
npm run check:photos            # both directions of the mismatch
npm run check:photos -- --fix   # regenerate what is missing, drop dead promises
npm run check:photos -- --prune # delete derivatives no entry owns
```

`photos.json` and `public/img` are two records of the same photographs and
nothing used to check them against each other, so one photograph sat in the
manifest with no derivatives on disk at all — the page laid out a slot, asked for
`/img/d62b2154e7fee842-2000.avif`, and the reader got a hole.

**Two records own `public/img`, not one.** The inspiration board keeps its own
`inspiration.json` and runs the same pipeline into the same directory, so an
audit that reads only the archive calls every reference on the board an orphan.
The first `--prune` did exactly that and deleted all thirteen of them; they came
back from the originals in `inspiration/`, which is the only reason that is a
story rather than a loss. Anything that renders from `/img/` belongs in
`owners()` in `scripts/check-photos.ts`.

The audit is `src/lib/derivatives.ts`, and `astro build` runs it over what it
just emitted: a build that would publish a photograph with no file behind it
fails instead. It measures against `manifest.json` — the file the page is built
from — rather than the store, so an unparseable store cannot pass the guard by
auditing zero entries while the page renders from a manifest nobody checked.

Only a missing derivative blocks a publish, in the build and in
`deploy:site`'s preflight alike. Orphans, undeclared widths, and holes on the
inspiration board (which is server-only and never published) are reported and do
not: none can reach a reader, and refusing to publish seventy-nine correct
photographs over a file nobody can request would make the honest manual route
harder to run.

A count of files per width proves nothing on its own: nothing is ever upscaled,
so only the 46 photographs at 2000px or wider have a 2000px derivative, and that
is the correct number rather than a shortfall.

## Offline

The archive is a **local-first PWA**. Visit once from the iPad while the Mac is
running and a service worker caches every derivative, the fonts and the page
itself; after that the Home Screen icon opens and scrolls with the Mac off and
the Wi-Fi gone. It caches six files at a time (firing hundreds at once made iOS
drop requests and left holes in the snapshot) and counts up while it works, so
you can see when it's safe to walk away. Going offline says so on screen —
otherwise a live archive and a cached one look identical.

iOS grants a site a small fraction of the quota a desktop does, and nothing is
ever evicted to make room (that rule is what keeps the map's sprites and DEM
tiles available offline). So a snapshot can simply not fit. When that happens
the run stops rather than spending the data allowance on files it must throw
away, and says **"No room left · 214 of 400 saved"** — the count is of what is
genuinely on the device. Clear the site's data to start a fresh snapshot.

Requires a **secure origin**: iOS only allows a service worker over HTTPS, which
is what the certs in `certs/` are for (see `astro.config.mjs`).

## Fonts

Self-hosted in `public/fonts` — no third-party request on the critical path, and
type that survives going offline. Only the faces the baked-in theme uses are
vendored (Fraunces + JetBrains Mono, latin + latin-ext).

```bash
npm run fonts     # re-download, then paste the printed @font-face block
                  # over the one at the top of src/styles/global.css
```

Switching `DEFAULT_THEME` (`src/lib/themes.ts`) to a preset built on Playfair
Display, Libre Bodoni or Space Mono means editing the family list at the top of
`scripts/fetch-fonts.ts` and re-running it — otherwise that preset falls back to
Georgia. Update the `rel="preload"` tags in `src/layouts/Layout.astro` to match.

## Commands

```bash
npm run manifest          # rescan /photos, rebuild, print the chapter breakdown
npm run check:photos      # the manifest against the files on disk, both ways
npm run drift             # what is published against what is here
npm run deploy:site       # publish, and confirm the site changed
npm run fonts             # re-vendor the web fonts into public/fonts
npm run export:sequence   # write sequence.json for the book (original filenames)
```

## Overrides

```json
{
  "chapters": { "hue-030": "Rust", "achromatic": "Ash" },
  "photos": { "<hash>": { "chapter": "hue-210" } }
}
```

Anything absent falls back to the automatic result.

## Reset the archive

```bash
rm -f photos/*.* public/img/*.avif public/img/*.webp
echo '[]' > src/data/photos.json && npm run manifest
```
