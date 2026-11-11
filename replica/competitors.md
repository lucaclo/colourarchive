# Competitor recon: Colour Archive (web, iPad-first PWA)

Scope: every part of Colour Archive, each one checked against the best apps doing the same job
For: Luca's own use first. The improvement list is ranked for that.
Date: 2026-10-09

This is the recon skill turned the other way round. Instead of mapping one app to copy it,
it maps the best competitor in each area and lists what they do better. Every "we don't
have it" below was checked by searching this repo's source, not assumed. Every competitor
claim links to its source. Many of those sources are the vendors' own pages, and they're
marked as such.

## Our core loop, in one sentence

Photos go in untouched and are filed by colour. You browse them as one hue-ordered scroll.
From there you match a reference's look in Lightroom (Style Match), plan when light will
fall on a place (Scout), and turn the archive into a printed object (Book and Zine).

## The five areas and who competes in each

| area | our feature | best competitors | verdict |
| --- | --- | --- | --- |
| A. Archive and search | colour chapters, hue-ordered scroll, CLIP text search, find similar, duplicates, colour gaps, 3-level pinch zoom, offline PWA | Eagle, PhotoPrism, Immich, Lightroom desktop natural-language search, Excire | **we lead on the colour-ordered viewing; they lead on searching by a colour you pick** |
| B. Inspiration board | board, find similar (composition/colour slider), "already in the archive" | Cosmos, mymind, Eagle, Are.na, Milanote, Pinterest | **we lead on analysis; they lead on capture (saving from anywhere) and colour palettes per image** |
| C. Style Match | reference → measured evidence → Lightroom `.xmp`, live preview, per-panel strength, multi-reference, Check tab round trip, calibration | Capture One Match Look, FindPreset, Preset Generator, Imagen, Aftershoot, Photoshop Color Transfer, Lightroom adaptive presets | **we lead on honesty and depth; Capture One leads on per-photo adaptation and speed on a batch; FindPreset leads on exact extraction when the reference still carries its settings** |
| D. Scout | sun/moon, building + terrain + tree shadows, weather decks, sunset-horizon forecast, frame, line of sight, alignment finder, AR, itinerary, gap shoots, astro | PhotoPills, Planit Pro, TPE, Sun Surveyor, Sunlitt, ShadowMap, PhotoHound, Locationscout, Alpenglow | **we lead on combining everything into one map; Planit and PhotoPills lead on a few astro and simulation tools; PhotoHound leads on per-spot community knowledge** |
| E. Book and Zine | curated chapter sequence, one plate per page print export, 8-page one-sheet zine with Wada palettes | Lightroom Classic Book module + Blurb, Black's Photobook, Shutterfly, Milanote (sequencing), pdfimpose, Mini Magic Zine Imposer | **this is our weakest area: one photo per page, no spreads, no print-service sizes** |

## A. Archive and search

| competitor | what it does better | evidence |
| --- | --- | --- |
| **Eagle** (desktop asset manager, one-time ~$30) | Pick a colour on a wheel or type a HEX/RGB/HSL code, and every image containing that shade comes back in under half a second, across tens of thousands of files. | [Eagle blog](https://eagle.cool/blog/post/still-manually-scanning-for-the-right-color-eagles-color-search-finds-any-shade-in-half-a-second) (vendor) |
| **PhotoPrism** (self-hosted, local-first like us) | Colour is a first-class search filter (`color:green`), filters combine with OR (`color:red\|orange`), and there's a numeric **chroma** filter (`chroma:70`), i.e. "only the saturated ones". | [PhotoPrism search filters](https://docs.photoprism.app/user-guide/search/filters) |
| **Immich** (self-hosted) | CLIP smart search combined with filters for people, place, camera, lens and date. Same model family as ours, but it searches a phone-sized library and syncs from the phone. | [Immich searching docs](https://docs.immich.app/features/searching), [PixelUnion write-up](https://pixelunion.eu/blog/2026/04/immich-smart-search/) |
| **Lightroom desktop 9.3 to 9.4** (April to June 2026) | Natural-language search, assisted culling that stacks similar frames and suggests the strongest, and a Faces panel with eye-sharpness scores. **Desktop only, none of it on iPad.** | [Adobe what's new](https://helpx.adobe.com/lightroom-cc/using/whats-new.html), [PetaPixel June 2026](https://petapixel.com/2026/06/15/adobe-adds-more-user-control-to-ai-features-inside-lightroom-and-photoshop/), [DPReview](https://www.dpreview.com/news/7335968853/adobes-latest-updates-let-you-cull-at-the-speed-of-light-room/) |
| **Excire Search 2026** | AI culling and focus detection inside Lightroom Classic. | [Digital Camera World review](https://www.digitalcameraworld.com/photography/photo-editing/excire-search-2026-review-ai-powered-image-searching-in-lightroom-classic) |

**What only we do:** the whole archive is laid out as one continuous hue-ordered scroll in
fixed perceptual chapters. I found no portfolio builder or library app that does this. The
closest is a [Webflow forum question](https://discourse.webflow.com/t/ordering-photos-by-color-value/190565)
asking whether it's possible. Colour gaps ("which hues you've never shot"), borderline-chapter
badges and burst detection that EXIF confirms are also ours alone.

**Gaps, checked against the code:**
- **No pick-a-colour search.** `src/pages/api/search.ts` is CLIP text only, and there's no
  colour input on `/`. Chapters are 30° bins, so finding "this exact dusty teal" means
  scrolling. Eagle, PhotoPrism, Cosmos and mymind all have it.
- **No chroma or lightness filter** ("only the muted ones", "only the high-key ones").
  The data is already in OKLCH, so this would be a filter on numbers we already store.
- **No per-photo palette with hex codes in the lightbox.** The zine computes k-means
  palettes (`src/lib/zine/colour.ts`) but the archive doesn't show them.

## B. Inspiration board

| competitor | what it does better | evidence |
| --- | --- | --- |
| **Cosmos** | Search your saves by keyword, **colour (shows the hex)** or visual similarity. Clusters, collaborative collections, a share extension. | [Cosmos support](https://www.cosmos.so/support), [App Store summary](https://mwm.ai/>/apps/cosmos-search-discover/1577975475) |
| **mymind** | Saves from anywhere (browser extension, iOS share sheet), auto-tags, pulls **five hex colours** per image, "Same Vibe" mood matching, reads text in images. Reviewers say search sometimes misses obvious things. | [mymind](https://mymind.com/?p=368), [Saner review](https://www.saner.ai/blogs/mymind-reviews) |
| **Eagle** | Colour filter, smart folders, browser extension. No spatial canvas. | [Fabric comparison](https://fabric.so/comparison/best-moodboard-app) (a competitor's page) |
| **Milanote** | A free-form canvas for arranging references spatially. One photographer calls it the closest digital tool to laying prints on a floor. | [The App Whisperer, June 2026](https://theappwhisperer.com/2026/06/best-sequencing-apps-for-photographers-in-2026/) |

**What only we do:** "Already in the archive" ranks your own photos against a reference **on
grade alone**, while find-similar works on composition and colour separately. And every
reference opens straight into Style Match.

**Gaps:**
- **Capture is manual.** `/api/inspiration/add` takes a URL or a file. There's no iOS share
  sheet target, so saving from Instagram or Safari on the iPad takes several steps. The
  PWA could register as a Web Share Target on iPadOS only if Safari supported it, and it
  doesn't. A Shortcuts action posting to the Mac would work.
- **No colour search on the board** (same gap as A).

## C. Style Match

| competitor | how it works | what it does better than us | where we win | evidence |
| --- | --- | --- | --- | --- |
| **Capture One Match Look** (16.5+, desktop) | AI-driven. Drop one or more references, apply to a selection. Four groups: Normalize, Light & Contrast, Color Adjust, Color Tone. Writes ordinary adjustments onto a layer you can fade. | **Adapts to each target photo, at batch speed** ("400+ images for a photo book in about 20 seconds"). With several references, each target is weighted toward the one it most resembles. | It matches tone and colour **only, no grain, vignette or clarity**. Reviewer: "90–95% of the way, 80% of the time", sometimes "doesn't work at all", brightness and contrast often off on film. No evidence, no refusal reasons. Not on iPad. | [Capture One support](https://support.captureone.com/hc/en-us/articles/22188770298269-Match-Look-Tool), [Thomas Fitzgerald review](https://blog.thomasfitzgeraldphotography.com/blog/2024/10/capture-one-165-match-look-a-remarkable-new-feature), [L-Camera forum](https://www.l-camera-forum.com/topic/414748-capture-one-introduces-match-look-literally-a-game-changer) |
| **FindPreset** (web) | **Reads the reference's embedded Lightroom settings first** (exact), and falls back to AI analysis (approximate). Outputs `.xmp`. | When a reference is someone's own export that still carries `crs:` metadata, it gives the **exact** preset, not an estimate. | Its AI path is "approximate, 70–85%" (its own blog's figure), JPEG/PNG only, no local masks. | [FindPreset comparison](https://findpreset.com/posts/ai-lightroom-preset-tools-compared) (vendor) |
| **Preset Generator** (web, paid) | Upload a photo, get three `.xmp` variations. Analyses the RAW data from DNG on paid tiers. | Three alternative readings to choose from. | Cloud, opaque, no evidence. | [presetgenerator.com](https://presetgenerator.com/) (vendor) |
| **Imagen** / **Aftershoot** | Learn *your* style from 2,000–3,000 of your past edits, then edit new shoots. Imagen in the cloud (about $0.08 a photo), Aftershoot locally. | Learn your own look and apply it across a whole shoot. | Can't copy someone else's look, which is the job Style Match does. Need thousands of edits. | [Imagen comparison](https://imagen-ai.com/post/imagen-vs-aftershoot/) (vendor), [Aftershoot AI presets](https://aftershoot.com/blog/what-are-ai-presets/) |
| **Photoshop Neural Filters: Color Transfer** | Pick a reference image and transfer its palette, then fade it with opacity. | Instant, live. | "Often too intense", palette only, not a Lightroom preset. Batching is unreliable. | [Phlearn](https://phlearn.com/tutorial/how-to-color-match-images-in-photoshop/), [Adobe Neural Filters FAQ](https://helpx.adobe.com/photoshop/using/neural-filters-list-and-faq.html) |
| **Lightroom itself** | Reference View (side by side, match by eye), Match Total Exposures (brightness only), adaptive presets (masks for sky, subject, portrait). **No reference-based match in 2026.** | Lives where Luca edits. | Our gap to fill. | [Adobe community](https://community.adobe.com/t5/lightroom-classic-discussions/match-color-feature-in-lr-like-ps/td-p/11718781), [DPS Reference View](https://digital-photography-school.com/match-image-processing-reference-view-lightroom/) |

**What only we do, confirmed in code:** measured evidence per region (sky, skin and subject
masks), refusals that state the reason, grain, vignette and texture from native-resolution
crops, `.xmp` that leaves out what wasn't measured, per-panel strength for Light, Colour and
Effects (`api/match/preset.ts`, finer than Capture One's on/off groups), several references
merged and weighted (`group.ts`, `solve.ts`), the Check tab round trip, and calibration
against real Lightroom exports. Nobody else closes the loop by measuring the finished edit.

**Gaps:**
1. **No exact path for a reference that still carries its settings.** The match pipeline
   writes `crs:` (`xmp.ts`) but never reads it from the reference. When a reference is your
   own past export, a downloaded preset sample, or a JPEG from Lightroom with metadata
   kept, its real slider values are sitting in the file. FindPreset's whole first step is
   reading them. We estimate instead. *Cheap to add and exact.*
2. **One preset for many photos, not one per photo.** Capture One adapts to each target.
   Ours solves for one target photo. Applied across a set in Lightroom, the same `.xmp`
   lands the same way on a bright frame and a dark one. A batch mode that solves each of
   several targets and hands back one preset per photo, or a shared preset plus per-photo
   exposure, is the Capture One feature worth having.
3. **No "three readings" choice.** Preset Generator offers three variations. We already
   compute a faithful and a restrained solve and blend them with a slider, so this is
   mostly covered. Not worth copying.

## D. Scout

A survey of 25 apps and a PhotoPills gap analysis were already done (see the
`colour-archive-scout` memory and SCOUT-HANDOFF.md). This pass refreshed that against 2026.

| competitor | what it does better | evidence |
| --- | --- | --- |
| **Planit Pro** (iPad-native) | The broadest planner: VR, AR, picture-view and **Street View viewfinders**, timelapse, sequence and star-trail **simulation**, eclipses, rainbow position, a Solar North indicator above 200mm (Aug 2026), automatic iCloud backups. | [Planit](https://www.planitphoto.jidesoft.com/), [App Store version history](https://apps.apple.com/us/app/planit-pro-photo-planner/id898876435) |
| **PhotoPills** | A dedicated **Meteor Shower pill** with an AR radiant marker. Large tutorial library. | [PhotoPills alignments update](https://www.photopills.com/blog/update-alignments), [Night Sky Pix review 2026](https://nightskypix.com/photopills-app-review/) |
| **TPE** (web + app) | Sightline analysis with curvature and refraction (same as our `profile.ts`). **Saved locations sync between web and app**, KML import/export. | [TPE sightline post](https://photoephemeris.com/fr/news/sightline-analysis-comes-to-tpe-web), [App Store](https://apps.apple.com/us/app/the-photographers-ephemeris/id366195670) |
| **ShadowMap** (web + app, €2.50/mo) | **First-person "walk or fly" 3D view** of buildings, terrain and trees under the simulated sun. Detailed tree data in Vienna, Madrid and Paris. | [ShadowMap for photographers](https://www.shadowmap.org/photography), [blog](https://shadowmap.org/blog/shadowmap-for-photographers) |
| **Sunlitt** | Landform shadows (Sept 2025), shadows in AR, offline timings. | [App Store](https://apps.apple.com/ca/app/id1628751457) |
| **PhotoHound / Locationscout** | Per-spot **community knowledge**: best months, best time of day, conditions, gear, crowd factor, EXIF. Locationscout reports 213,000 entries. | [PhotoHound](https://photohound.co/), [Adorama roundup](https://www.adorama.com/alc/best-digital-tools-for-scouting-locations/) |

**What only we do:** shadows qualified by weather, a sunset forecast taken along the sun's
own horizon with no made-up score, an alignment finder against the real merged skyline, a
"best right now" ranking of spots that know which way they face, gap shoots tied to the
archive's missing colours, and your own photos as pins. No competitor combines these.

**Gaps, checked against the code:**
1. **No meteor shower module, still.** `meteor` appears only in a comment in `stars.ts`.
   Same gap as the August audit. The moon phase, seeing and light pollution it needs are
   already in place.
2. **No first-person view from the pin.** We have a pitched 3D map with trees
   (`tree-client.ts`) and a live AR camera, but no "stand here at eye height and look along
   the aim" render. ShadowMap's FPV and Planit's VR finder are the closest. MapLibre can get
   most of the way: pitch 85°, camera at the pin's elevation plus 1.7 m, bearing from the
   frame's aim.
3. **Spot knowledge is thin.** Commons and Flickr pins carry a photo and sometimes an aim,
   but not "best in October, early morning, busy". Our per-spot notes are the right home.
   PhotoHound's data is theirs and can't be taken.
4. **No timelapse or star-trail *simulation*** (we calculate, Planit simulates). Low value
   for how Luca actually shoots.

The ICS export already carries `VALARM` (`ics.ts:109`), so that gap from the August audit
is closed.

## E. Book and Zine

| competitor | what it does better | evidence |
| --- | --- | --- |
| **Lightroom Classic Book module** | Single-page, spread and multi-page views. **Multi-photo page templates**, auto layout, page numbers, PDF export with a colour profile, sharpening and resolution. **Sends to Blurb** with a live price and Blurb trim sizes. | [Adobe: create photo books](https://helpx.adobe.com/uk/lightroom-classic/desktop/photo-books/create-photo-book.html) |
| **Black's Photobook** | AI that "looks for micro-stories" when ordering, and a layflat engine that **flows photos across the spread**. | [Google Play](https://play.google.com/store/apps/details?id=ca.blacks.photos&hl=en_US) |
| **Shutterfly / Mixbook / Photo9** | AI auto-fill across up to 111 pages, and Mixbook's Story Mode where you describe the book. Consumer-grade. | [Shutterfly](https://www.shutterfly.com/ideas/create-a-photo-book-with-ai-in-minutes/), [Mixbook](https://en.wikipedia.org/wiki/Mixbook) |
| **Milanote / Kunstmatrix** | **Sequencing boards**: singles, pairs and rests, mixed one- and two-image spreads, seeing what sits across the gutter. | [The App Whisperer](https://theappwhisperer.com/2026/06/best-sequencing-apps-for-photographers-in-2026/), [Nat's newsletter](https://buttondown.com/nat/archive/software-for-sequencing/) |
| **pdfimpose / Mini Magic Zine Imposer** | **16-panel** zines as well as 8. Imposing any PDF. | [pdfimpose](https://pdfimpose.readthedocs.io/en/latest/lib/onepagezine/), [itch.io](https://curioustype.itch.io/16-panel-mini-magic-zine-imposer) |

**What only we do:** sequencing **by colour** across a book. I found no photobook app that
orders by hue. [PhotoAIStudio](https://www.photoaistudio.com/blog/best-ai-photo-collage-makers-free-2026)
found it only in collage tools, and Journi and PastBook sort by date. The cover title
colours in the zine come from colour theory and Wada's combinations.

**Gaps, checked against the code (the biggest in the app):**
1. **One full-bleed photo per page, nothing else.** `scripts/export-print.ts` makes "one
   full-bleed plate per photograph" and says to "tune @page for your book". No two-up
   pages, no photo-plus-white-page, no spread view.
2. **No pairing view.** `book.ts` curates the order within a chapter, but you never see
   page 14 next to page 15. In sequencing, the pair across the gutter is the unit
   (Milanote and every sequencing guide say so).
3. **No print-service sizes.** No trim and bleed presets (Blurb, Saal, Newspaper Club),
   no page-count check, no PDF with a colour profile. "Print → Save as PDF" from a
   browser is the only route.
4. **Zine is 8 pages only.** 16 panels would be a second imposition table.

## Things competitors have that we should NOT copy

- **Accounts, sync, Stripe, social feeds** (Cosmos, PhotoHound, TPE sync). Colour Archive
  is single-user and local-first by decision. Scout is "public later", and only the data
  layer was kept clean for that.
- **AI style learned from thousands of your own edits** (Imagen, Aftershoot). A different
  job, and it needs a cloud or a GPU model that the "no network in the advice path" rule
  excludes.
- **A sunset quality score** (Alpenglow, SunsetWX). Rejected on purpose, and still right.
- **PhotoHound's spot database, ShadowMap's tree data, Blurb's templates.** These are
  their data, so they're out of scope and can't be cloned.

## Top improvements, ranked for Luca

| # | improvement | area | beats | size | why |
| --- | --- | --- | --- | --- | --- |
| 1 | **Spreads and pairs in Book**: a spread view, two-up and one-plus-blank layouts, trim and bleed presets, a print PDF with a page-count check | E | Lightroom Book, Milanote | M | largest gap in the app; a book is the archive's printed form |
| 2 | **Pick-a-colour search** on the archive and the board: a hex input or the spectrum, plus chroma and lightness sliders | A, B | Eagle, PhotoPrism, Cosmos | S | data is already in OKLCH; one ranking function |
| 3 | **Exact settings from the reference** when it carries `crs:` metadata, shown next to the measured estimate | C | FindPreset | S | exact beats estimated; also a free calibration source |
| 4 | **Batch Style Match**: one reference set, several of your photos, one adapted preset each | C | Capture One Match Look | M | the one thing Match Look does that we can't |
| 5 | **Meteor showers in Scout**: annual list, radiant altitude over the night, moon interference, "go tonight" integration | D | PhotoPills | S | still open from August, and the parts it needs are already built |
| 6 | **Eye-level view from the pin** along the frame's aim | D | ShadowMap FPV, Planit VR | S–M | MapLibre pitch plus terrain; trees and buildings already load |
| 7 | **Per-photo palette in the lightbox** (hex, copyable) | A | mymind, Cosmos | S | reuses `zine/colour.ts` |
| 8 | **Save to the board from the iPad share sheet** via an Apple Shortcut posting to `/api/inspiration/add` | B | mymind, Cosmos | S | capture friction is the board's real weakness |
| 9 | **16-page zine** | E | Mini Magic Zine Imposer | S | second imposition table |

Feature matrix: `replica/features.csv`. The `original` column names the best competitor
that has each feature. The `clone` column is Colour Archive's status.

---

# Round 3: clutter and clarity (2026-10-13)

Brief: "make this less cluttered and confusing, there's too much information", with an Apple HIG
audit leading the design language. Round 1 covered features and round 2 covered colour search and
Scout's speed. This round compares how much each screen shows at once, and how the best apps
decide what comes first. Screens of the current state are in `replica/round-3/screens-before/`
(iPad 1180×820 and iPhone 16 Pro).

## What the app shows today, measured

| screen | what is on it at once | finding |
| --- | --- | --- |
| Scout side panel (iPad) | **~1,920 px tall**: 3 weather paragraphs, 4 data rows each with an ⓘ, 9 time rows, a direct-sun block, 13 folds (each with an unexplained orange dot), "Best right now" with 8+ rows, a 4-line method note, then a facts table (Centre, Radius, "A 10 m wall", Buildings, Trees, Landform, Photographed, Light) | every fact gets equal weight. The one thing a photographer opens it for, *when is the good light and is it any good*, is spread across rows 1, 3 and 5 |
| Scout facts table | "Flickr needs an API key (FLICKR_API_KEY), which isn't configured for this deployment" | raw developer text in the UI. Breaks the quiet-errors rule |
| Scout "Best right now" | rows titled `13-08-hongkong-Ralf-10`, `13-08-08-hongkong-by-RalfR-127` | file names from Commons and Flickr used as titles |
| Scout, no place (iPad) | a 380×700 empty black panel beside the globe | an empty state that offers nothing: no recents, no kept spots, no locate |
| Scout time strip | labels "Sunrise Golden Noon Golden Sunset"; the jumps are Dawn…Dusk | "Golden" twice with no morning/evening cue |
| Book tiles | 4 overlays on every thumbnail (grip, ×, file name, chapter pill) + a duplicate badge | the chapter pill repeats the section heading it sits under; at phone width the overlays cover about a third of each photo |
| Add & remove tiles | 4 overlays (genre, medium, ×, chapter) | same problem |
| Book header | title, count, Share, Magazine, List/Spreads, size menu, page count, Bleed, Print PDF = 9 things | print settings sit in the header all the time, though they're only needed once |
| Inspiration | drop zone + two fields + Add take the first 400 px; the board starts below the fold | capture is shown over the content it captures |
| Zine editor | every control for every element shown at once: 8 typefaces, size, 6 colours, align, vertical, case, behind, border…; "TEXT" and "BORDER" set in tracked caps | breaks the sentence-case rule; the tab bar covers the bottom controls |

## Who does "show less, find more" best, per area

### Scout (planning light)

| reference | the pattern | source |
| --- | --- | --- |
| **Apple Weather** | Summary first (temp, high/low), then a grid of modules, each showing **one takeaway** ("rain expected at 3 pm"). Tapping a module opens its detail with a scrubbable chart. On iPad and Mac it's a tile grid with the same tap-for-detail model. | [Gadget Hacks, iOS 16](https://ios.gadgethacks.com/how-to/14-big-weather-app-updates-for-iphone-ios-16-0385062/), [Guiding Tech](https://www.guidingtech.com/use-apple-weather-app-on-iphone), [Pratt IxD critique](https://ixd.prattsi.org/?p=24153) |
| **Flighty** | **Smart states**: the same card template (headline, primary, secondary, one action) shows different content per phase of the trip. "Essential info only", one line per flight like a departure board. Colour only means status. | [Apple, Behind the Design](https://cur.at/VcCahLU?m=web), [Blake Crosley design study](https://blakecrosley.com/guides/design/flighty) (analysis, not Flighty's own words) |
| **Sunlitt** | Free tier shows the sun and the event times. Azimuth, altitude, shadow ratio, twilight details and weather are **PRO extras**, i.e. secondary by its own ranking. A simpler "Monolitt" mode for quick checks. The bottom sheet was reworked in 4.8, 4.9 and again in 4.11.1. | [App Store](https://apps.apple.com/ca/app/id1628751457) (vendor), [JustUseApp](https://justuseapp.com/en/app/1628751457/sunlitt/reviews) |
| **PhotoPills** | Breadth as separate "pills". **Weakness:** "too complex" even after tutorials; "overwhelming at the beginning"; relearning after a month away. PetaPixel advises starting from a few features and ignoring the rest. | [MavicPilots thread](https://mavicpilots.com/threads/does-anyone-use-photopills.100569/post-1129606), [Cambridge in Colour](https://cambridgeincolour.com/forums/thread34188.htm), [PetaPixel](https://petapixel.com/photopills/), [Shotkit](https://shotkit.com/photopills-review/) |
| **Planit Pro** | Deepest feature set. **Weakness:** "takes time to get used to", "not very intuitive", "clunky at times"; users point each other to YouTube. A stability report from April 2026 comes from an automated aggregator, so it's unverified. | [Grand Screen review](https://grand-screen.com/apps/planit-pro-photo-planner/), [worldsapps](https://worldsapps.com/reviews-planit-pro-photo-planner), [marlvel.ai](https://marlvel.ai/api/llm/apps/photo-video/com-yingwen-photographer-planit) (unverified) |
| **Clear Outside** | Plain hourly cloud grid (low, mid, high). **Weakness:** no at-a-glance verdict (Highpoint Scientific). | [Highpoint Scientific](https://www.highpointscientific.com/astronomy-hub/post/top-5-weather-apps-for-astronomy), [clearoutside.com](https://clearoutside.com/page/app/) |

**The opening:** the planners with the deepest feature sets (PhotoPills, Planit) are the ones
reviewers call overwhelming. Scout already has their depth. If it adopted Weather's and Flighty's
glance-first structure, it would be the deep planner that doesn't feel deep.

### Archive (browsing)

| reference | the pattern | source |
| --- | --- | --- |
| **Apple Photos, iOS 26** | After the iOS 18 single-page backlash ("buried your albums"), Apple went back to two tabs. Search is a larger button at the bottom right, and the sort controls only appear when you swipe down. | [TechCrunch](https://techcrunch.com/2025/06/09/after-user-backlash-apple-brings-back-tabs-to-the-photos-app-in-ios-26/), [Tom's Guide](https://tomsguide.com/phones/iphones/ios-26-has-brought-yet-another-photos-app-overhaul-for-your-iphone-heres-how-its-different), [AppleInsider](https://appleinsider.com/articles/25/06/12/photos-in-ios-26-brings-back-tabs-and-generates-spatial-photos) |
| **Lightroom Classic grid** | "Show clickable items on mouse over only": flags and rotate buttons appear on hover. A master "Show grid extras" switch shows bare thumbnails. | [Adobe, Library view options](https://helpx.adobe.com/lightroom-classic/desktop/viewing-photos/setting-library-view-options.html) |
| **Glass** | Photo-first, Liquid Glass chrome. 5.1 (Jan 2026) added a toggle to hide series previews, removing a layer from the grid. | [Glass 5.1](https://glass.photo/highlights/glass-5-1), [Glass updates](https://glass.photo/updates) (vendor) |

The archive's reading view is already quiet, and it's the app's strongest screen. The clutter is
on the *management* grids (Book, Add & remove), which is where Lightroom's hover-only extras apply.

### Inspiration board

| reference | the pattern | source |
| --- | --- | --- |
| **Cosmos** | Minimal black-and-white UI. Content first, with saving behind one control or the share extension. Search by keyword, colour or similarity. | [Cosmos support](https://www.cosmos.so/support), [TechRadar](https://techradar.com/computing/websites-apps/this-app-is-like-pinterest-if-it-were-cooler-and-ad-free) |
| **Are.na** | "Calm", distraction-free, minimal signifiers (Pratt critique, Feb 2026). **Weakness:** older reviews say sorting got hard to find after an update. | [Pratt IxD, Feb 2026](https://ixd.prattsi.org/2026/02/design-critique-are-na-ios-app-2/), [Sander web client](https://www.are.na/editorial/introducing-sander-our-new-web-client) |
| **mymind** | Save from anywhere; the board is the whole screen. | round 1 sources |

### Book and Zine

| reference | the pattern | source |
| --- | --- | --- |
| **Lightroom Book module** | Size and print settings live in a side panel, not over the pages. **Weakness:** "clumsy" on a 240-page book. | [Adobe](https://helpx.adobe.com/uk/lightroom-classic/desktop/photo-books/create-photo-book.html), [Adobe community](https://community.adobe.com/t5/lightroom-classic-discussions/book-module/m-p/9880096) |
| **Artifact Uprising** | Very little to decide, and reviewers praise the "quick workflow". **Weakness:** "rigid non-customizable templates". | [Tom's Guide](https://www.tomsguide.com/reviews/artifact-uprising), [AU editor post](https://www.artifactuprising.com/learnings-from-creating-photo-books) |
| **Canva** | A **contextual toolbar**: only the options for the selected element. Text gets type controls and an image gets crop and filters. "»" opens the full panel. | [Canva help](https://www.canva.com/help/glow-up/), [NSW Education transcript](https://education.nsw.gov.au/teaching-and-learning/technology-for-learning/resources/professional-learning-resources/canva-for-education/canva-foundations/transcript-canva-editing-tools) |

### Style Match

There was no new competitor movement in 2026. Capture One 16.7 and 16.8 didn't touch Match Look
([16.7 notes](https://support.captureone.com/hc/en-us/sections/31342577708317-Capture-One-16-7)).
Lightroom mobile in 2026 added Quick Actions on iPad, Denoise on iPad, and centred pop-ups in
place of bottom sheets on large screens
([release notes](https://helpx.adobe.com/lightroom/mobile/whats-new/adobe-lightroom-on-mobile-release-notes.html)),
but nothing reference-based. The round 1 verdict stands. The Match UI wasn't screenshotted this
round, and it's the next candidate for the same audit.

## Apple HIG audit, the findings that drive the shortlist

- `layout.md › Best practices`: "don't obscure it by crowding it with nonessential details. You can
  make secondary information available in other parts of the window, or include it in an
  additional view." → the Scout panel and the facts table. **High.**
- `disclosure-controls.md`: "Place controls that people are most likely to use at the top of the
  disclosure hierarchy … with more advanced functionality hidden by default", and "Use no more than
  one disclosure button in a single view." → Scout has 13 folds in one view. **High.**
- `design-principles.md › Simplicity`: "Include just what's necessary … keeps the important things
  close by and lets the others fall away." → the Book and Add & remove tile overlays. **Medium.**
- `sheets.md`: "consider supporting the medium detent to allow progressive disclosure." → the phone
  sheet already does this. Keep it.
- `writing.md`: "Choose exactly the words you need." → the weather notes, the method note, and the raw
  API-key text. **Medium.** The API-key text also breaks the quiet-errors rule. **High.**
- `typography.md › Conveying hierarchy`: weight, size and colour carry hierarchy. → On the Scout
  panel, 9 time rows, 4 data rows and 13 fold titles share one italic style, so nothing leads.
  **Medium.**
- Lens 3 craft, "is the boldness spent in one place?": yes on the map (the sun ring). No in the
  panel, where everything is italic serif at the same weight.

What works and must survive: the sun ring as the signature, the phone sheet's three detents, the
quiet corner note for errors, the archive's colour-ordered scroll, the notebook vocabulary
(Fraunces italic labels, hairlines, dotted leaders), and the refusal to show a made-up score.

## Round 3 outcome

Built on `declutter` (see `shortlist.md` › Status for commits): the glance-first Scout panel
(Apple Weather, Flighty), grouped folds (HIG disclosure), a calendar dropdown, a Scout empty
state (Apple Maps), quiet thumbnails (Lightroom, Photos), board-first Inspiration (Cosmos,
Are.na), a Print panel on Book (Lightroom Book), a folded Zine inspector (Canva) and a
copy/type sweep. Measured: the Scout panel is 56% shorter on iPad, the Book header on a phone
goes from four rows of controls to one, and the Inspiration board starts at the top of the
page instead of below a 400 px form. The Style Match workbench is the next area to put
through the same audit.

---

# Round 4: the whole app, depth and finish (2026-10-13)

Brief: "deep and broad improvements, taking reference and inspiration from alternative apps". Rounds
1 to 3 covered features, colour search and Scout's speed, and clutter. This round goes to the parts
that weren't audited yet (the **Style Match workbench**, the **archive lightbox**, the board's cards,
**Add & remove**) and to app-wide patterns the references have added in 2026 (command palettes,
keyboard search, recently added). Screens are in `replica/round-4/screens-before/` (iPad 1180×820 and
iPhone 16 Pro), with every Match tab at iPad size.

## What the app shows today, measured

| screen | measured | finding |
| --- | --- | --- |
| Match result (iPad) | stage **442 px** + slider bar 56 + group sliders 32 + tabs 40 + footer 66 under a 75 px header: the report gets **~180 px of 820** | the answer (what to set in Lightroom) starts below the fold on every tab; the Light tab shows one slider row |
| Match result (phone) | stage 377 + bar 113 + group sliders 93: the report starts at **~1,650 of 2,043 px** (device px) | the report is a strip behind the action bar; "sure of the measurements" is cut in half |
| Match result | **19 controls** visible at once on iPad, 18 on a phone | three group sliders are always on screen: `.mx-groupbar { display: flex }` beats the `hidden` attribute, so "Separate sliders ›" toggles nothing (**bug**) |
| Match result header | "008f7d3eff93aa1f-1280.avif · matched to DSC06160.b4490759aa4afe19" | file names and content hashes as the title (same issue round 3 fixed in Scout) |
| Match result | the link toggle is the glyph "⚭"; "Compare with the original" is a checkbox | an unfamiliar symbol; the compare gesture every photo editor uses (press and hold) is missing |
| Match result footer | Download preset, Without masks, Keep this match: three bordered buttons, two of them full-width on a phone | one primary is right, but the secondary download is a variant of the first, not a peer |
| Match start | reference shown as "DSC06160.b4490759aa4afe19.jpg"; drop zone with 3 lines; RAW select with 50-character options | file name again; the drop zone's mono sub-lines read as data |
| "Already in the archive" | 8 cards, each "Near it" + 5 mono measurements ("colour cast 0.2 · saturation 0.2 · contrast 0.6 · split toning 2.0 · tone curve 3.0") | ~40 numbers in a strip; the label repeats on every card |
| Archive lightbox | 6 icon-only buttons: play, ⓘ, ≈, ◐, a toggle glyph, ×; on a phone 5 circles in a row | ≈ (similar), ◐ (match) and the chapter glyph aren't standard symbols, and touch has no tooltip; details only open from ⓘ |
| Inspiration card | 4 overlays at rest: "Similar" chip, ×, +, Match | the overlays round 3 removed from Book and Add & remove are still here |
| Add & remove | the drop zone takes the first 380 px on iPad | round 3's "next candidate": the same pattern fixed on Inspiration |
| Zine (iPad) | How to fold, Fill from book, JPG and Start over sit under the floating tab bar | covered controls |
| Scout photo card | white MapLibre popup under the panel's light ink, ~1.1:1 | **fixed mid-round on request** (`fcd484f`) |
| everywhere | no `/` or ⌘K; arrow keys and `f`/`i`/`p` work only in the lightbox | no keyboard way to jump between areas, chapters or places |

## References, per area

### Style Match workbench

| reference | the pattern | source |
| --- | --- | --- |
| **Capture One Match Look** | One **Impact** control, and each tool can be excluded from the match. The result is ordinary adjustments you tweak afterwards. Up to 20 references, weighted. | [Capture One support](https://support.captureone.com/hc/en-us/articles/22188770298269), [alexonraw](https://alexonraw.com/?p=8580), [Phoblographer](https://www.thephoblographer.com/2024/10/23/capture-one-16-5-0-beta-1-review-is-this-the-end-of-presets/) |
| **Lightroom mobile** | **Press and hold the photo to see the original**, let go to see the edit (it replaced the old three-finger tap). Reference View puts two photos side by side. 2026 releases moved Geometry into Crop and used centred pop-ups on large screens, all to shrink always-visible chrome. | [Photography Life](https://photographylife.com/lightroom-before-and-after/amp), [Shotkit](https://shotkit.com/lightroom-before-and-after-tool/), [Lightroom Queen, Apr 2026](https://www.lightroomqueen.com/whats-new-in-lightroom-2026-04/), [Adobe release notes](https://helpx.adobe.com/ca/lightroom/mobile/whats-new/adobe-lightroom-on-mobile-release-notes.html) |
| **Lightroom Classic** | Loupe info: `I` cycles the overlay, `\` shows the before. Overlays are opt-in, not standing. | [Adobe shortcuts](https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/keyboard-shortcuts.html), [Photography Life](https://photographylife.com/lightroom-loupe-view-options/amp) |
| **Photomator** | A **split comparison slider** on the photo itself (3.3.9 fixed its issues), not a checkbox. | [release history](https://app.diandian.com/app/np2uguj0dxp0mi7/ios-ver?country=24) |
| **Darkroom** (iPad) | Photo strip while editing; 1–7 keys switch tools; drag a photo to edit two side by side. | [MacStories review](https://www.macstories.net/reviews/darkroom-4-0-the-macstories-review/), [iClarified](https://www.iclarified.com/72651/darkroom-photo-editing-app-gets-light-mode-multiple-spaces-shortcut-action-sound-effects-more/comments) (the iClarified update is from 2019, not 2026) |

**Weaknesses (openings):** Match Look is "90–95% of the way, 80% of the time" with no reasons (round 1).
Lightroom's duplicate detection on import gives no reason and no override, and users ask for one
([Adobe community](https://community.adobe.com/bug-reports-679/p-thinks-it-s-found-duplicates-on-import-but-is-mistaken-no-way-to-override-this-662084/index2.html)).
Style Match already gives reasons. The opening is to make them readable without 19 controls on top.

### Photo viewer (archive lightbox)

| reference | the pattern | source |
| --- | --- | --- |
| **Apple Photos, iOS 26** | **Swipe up on the photo for Info** (date, device, lens, ISO, place). Bottom row: share, favourite, info, edit, delete; less common actions in the top-right menu. | [9to5Mac](https://9to5mac.com/2025/10/23/heres-everything-new-for-apple-photos-in-ios-26/), [Tom's Guide](https://www.tomsguide.com/phones/iphones/ios-26-photos-brings-more-than-just-a-redesign-tweak-meet-the-new-tools-apple-has-added) |
| **Immich 2.4 / 2.6** | Rarely used viewer actions **moved into the kebab menu** "to free space for metadata"; 2.6 put **inline details** in place of a bottom sheet. | [Linuxiac, 2.4](https://linuxiac.com/immich-2-4-released-with-command-palette-and-ui-refinements/), [AlternativeTo, 2.6](https://alternativeto.net/news/2026/3/immich-2-6-improves-map-side-panel-asset-viewer-shared-link-slugs-and-presets-and-more) |
| **Glass 5.1** | Native Liquid Glass controls; a switch to hide a layer of chrome. | [Glass 5.1](https://glass.photo/highlights/glass-5-1) |

### App-wide: keyboard and finding things

| reference | the pattern | source |
| --- | --- | --- |
| **Immich 2.4** | **Command palette on ⌘K / Ctrl+K**: jump to pages by name, plus context actions. | [Linuxiac](https://linuxiac.com/immich-2-4-released-with-command-palette-and-ui-refinements/) |
| **mymind, July 2026** | **Keyboard search**: Enter focuses the search bar, arrows pick a type, Escape resets. | [mymind](https://mymind.com/did-you-notice-these-mymind-updates) (vendor) |
| **Immich v3, July 2026** | A **Recently added** page, sorted by when a photo arrived, not when it was taken. | [PixelUnion](https://pixelunion.eu/blog/2026/07/immich-v3/) |
| **Are.na, Sept 2026** | A customisable bottom tab bar on iPad: pin favourite channels. | [Are.na newsletter](https://buttondown.com/aredotna/archive/areal-download-party-revamped-homepage-new/) |

### Board, import, zine, planners (checked for 2026 movement)

- **Cosmos**: no dated 2026 changelog found; colour, keyword and similar search plus clusters stand ([App Store](https://apps.apple.com/gb/app/cosmos-search-discover/id1577975475), [Kim Klassen](https://www.kimklassen.com/blog/cosmosfindsimilar)). Round 3's board-first pattern holds.
- **Lightroom import**: "Previously Added" overlays on thumbnails at import ([Adobe help](https://helpx.adobe.com/lightroom-cc/using/add-photos.html)). Add & remove already flags duplicates.
- **Zine tools**: EZZINE (iPhone, Feb 2026, 8 images, A4/Letter) and ZineArranger (Jan 2026, many fold sizes) ([mwm.ai](https://mwm.ai/apps/ezzine/6758923332), [itch.io](https://nashhigh.itch.io/zinearranger)). Ours is ahead on colour; 16-panel is still the gap.
- **Sun Surveyor 2.9**: twilight start *and* end, shadow point in Live view; **Sunlitt 4.10.4** rewrote map gestures. Nothing that changes round 3's Scout verdict ([App Store](https://apps.apple.com/us/app/-/id525176875), [Sunlitt](https://apps.apple.com/dk/app/id1628751457)). PhotoPills: last update Mar 2026, no notes. No Planit Pro 2026 notes found (unverified either way).
- **Eagle 4.0**: no 2026 change to colour search ([changelog](https://eagle.cool/changelog)).

## Apple HIG audit, round 4

- `layout.md › Best practices`: "Make essential information easy to find by giving it sufficient space … don't obscure it by crowding it with nonessential details." → the Match report gets 180 of 820 px. **High.**
- `toolbars.md › Best practices`: "Make sure the meaning of each control is clear. Don't make people guess or experiment to figure out what a toolbar item does." → ≈, ◐ and the chapter glyph in the lightbox; ⚭ in Match. **High** on touch, where there are no tooltips.
- `toolbars.md`: "Add a More menu to contain additional actions. Prioritize less important actions for inclusion in the More menu." → slideshow and chapter move in the lightbox; "Without masks" in Match. **Medium.**
- `toolbars.md`: "Use the .prominent style for key actions … Only specify one primary action." → Match already does this; keep it.
- `writing.md › Best practices`: "put the most important information first"; `design-principles.md › Simplicity`: "Include just what's necessary … lets the others fall away." → the mono measurements on "Already in the archive", file names as titles. **Medium.**
- `sliders.md`: "Customize a slider's appearance if it adds value … communicate intent." → the None–Full slider is fine; the unlinked group sliders need a visible state, not a glyph. **Low.**
- `design-principles.md › Craft`: "Quality sets the tone." → a CSS rule that silently defeats `hidden` is a craft bug. **High** (it's the reason 3 extra sliders are always there).
- Lens 3, "is the boldness spent in one place?": in Match the boldest things on screen are the orange "10%" and the orange calibration warning, not the photo. The photo should own the boldness.

What works and must survive: Match's honesty (refusals with reasons, "the real move", the Check
round trip), one filled primary action, the lightbox's swipe-to-dismiss that tracks the finger, Book's
quiet tiles, Inspiration's board-first page, and the hue-ordered archive.

## Round 4 outcome

Built on `round-4` (see `shortlist.md` › Status for commits). Style Match got the same treatment Scout
got in round 3: the answer gets the room (stage 442 → 328 px on iPad, 19 → 13 controls), you press
and hold the picture for the original (Lightroom, Photos), file hashes became names, and the
measurements went behind a hover. Auditing it turned up a real bug: the subject matte was read with
the wrong stride, which striped every graded sky and fed the wrong pixels to the subject and
background measurements. The lightbox says Similar, Match and Chapter in words and opens details on
a swipe up (Photos). Board cards are quiet on touch like Book's. Add & remove puts the archive first and
can sort newest first (Immich v3). A ⌘K palette and `/` reach any page, chapter, place or colour from a
keyboard (Immich 2.4, mymind). Scout's times roll on to tomorrow morning after dark (Flighty). Also on
request, mid-round: the Scout photo card is now dark so it stands out on a pale map.

## Round 5 (2026-10-14): new neighbours

Full sources and screen notes are in `round-5/recon.md`; the list and status are in `round-5/shortlist.md`.
This round looked past the apps rounds 1–4 covered: sunset forecasters (Sunsethue's app launched in
July 2026; Alpenglow went to 7 days), culling (Narrative's Survey Mode, Photo Mechanic), colour theory
(Adobe Color's harmony rules), photobook editors (Artifact Uprising's Autofill and layout preview),
sequencing boards (a June 2026 roundup: "what sits on the next page is as important as what sits on
the current one"), and the 2026 releases of Glass, Immich (3.1 Undo, 3.2 search), Are.na, Google
Photos and Lightroom mobile.

What came out of it: remove then Undo (Immich, Gmail); colour partners round the painter's wheel with
counts (Adobe Color); a side-by-side survey for similar shots with a shared zoom (Narrative,
Lightroom); the week's sunsets in Scout's calendar as lit / clear / nothing, no score (Alpenglow,
Sunsethue); one picture with a draggable wipe in Match on a phone (Photomator); page actions in ⌘K
(Immich); and the 16-page zine as two nested sheets.

Not taken: sunset alerts (need push and a server), a quality score (against weather.ts), favourites
(the book is already the one pick), a custom tab bar (four tabs fit).
