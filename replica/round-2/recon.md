# Recon, round 2: colour match on the Archive, and Scout's design, look and speed

Date: 2026-10-13. Branch `competitor-gaps`. Round 1 (all five areas) is in
`replica/competitors.md` and `replica/features.csv`, and it's left untouched.

Like round 1, this is competitor research, not a clone. For each focus area it
maps the best competitors, checks Colour Archive against them in the code and
in a running production build, and lists what to change.

## 1. Scope

| | |
| --- | --- |
| app | Colour Archive, web PWA, iPad first, plus desktop and phone |
| slice | (A) **colour match on `/`**: pick a colour, see the photos that hold it. (B) **Scout's design, look and speed**: first load, a place loading, the time scrub, and how the map and chrome read. |
| for | Luca's own use. Single user, local first, no accounts (same decision as round 1) |
| out | Scout's feature list (round 1 covered it), Style Match, Book, Zine |

## 2. Sources

| source | what it gave | url |
| --- | --- | --- |
| Eagle blog (vendor) | colour search UX: tap or drag a palette, or type HEX, RGB or HSL; "less than half a second" over "tens of thousands of files" | [eagle.cool](https://eagle.cool/blog/post/still-manually-scanning-for-the-right-color-eagles-color-search-finds-any-shade-in-half-a-second) |
| Eagle help | recommended colours, custom colour, a colour code | [en.eagle.cool](https://en.eagle.cool/support/article/search-by-color) |
| Eagle Swatch Book plugin | per-image palettes in the inspector; "clicking a swatch gives a visual grid of every image that contains that color family" | [community.eagle.cool](https://community-en.eagle.cool/plugin/A1C4296F-5C7E-4C6D-A5B9-3FDE278E8B11) |
| TinEye MulticolorEngine | **up to five colours with a weight each**, plus a **wildcard** share for "the rest, anything"; results as a grid | [wildcard demo](https://multicolorengine.tineye.com/sandbox/wildcard_color.html), [404techsupport on Multicolr](https://www.404techsupport.com/2012/08/03/search-for-photos-by-color-with-tineyes-multicolr/) |
| Google Arts & Culture Art Palette | pick five colours, or upload a photo and get its five, then find artworks with that palette | [Wallpaper*](https://www.wallpaper.com/art/google-arts-and-culture-art-palette), [Core77](https://www.core77.com/posts/76088/Experimental-Google-Tool-Lets-You-Search-Art-by-Palette) |
| Adobe Stock search features | colour picker or HEX, and "Find similar → Color" from an image | [stock.adobe.com](https://stock.adobe.com/in/search-features), [find similar](https://helpx.adobe.com/stock/web/search-for-assets/find-similar-assets.html) |
| Cosmos | search by keyword, colour (hex) or visual similarity; a palette tool that also suggests palettes from results | [cosmos.so llms.txt](https://www.cosmos.so/llms.txt), [Wix review](https://www.wix.com/studio/blog/category/development/cosmos-app) |
| TPE Web 4.x forum | 4.0 (2 Jul 2026): 3D view with Orbit and First person. 4.4: Shot Plans, Library, deep links for everyone. 4.8: 3D for all users, presets, a search and command palette | [4.0](https://forum.photoephemeris.com/t/tpe-web-4-0-is-live/1250), [4.4](https://forum.photoephemeris.com/t/tpe-web-4-4-beta/1277), [site](https://photoephemeris.com/en/) |
| Sunlitt App Store, What's New | 4.11.1: time slider carried on the screen's edge, a reworked bottom sheet "smoother and more reliable". 4.10: gestures rewritten so pan, zoom, tilt and rotate "won't overlap". 4.8 and 4.9: "major performance and memory usage improvements", "background app activity now reduced to zero" | [App Store](https://apps.apple.com/ca/app/id1628751457) |
| ShadowMap pricing | worldwide 3D buildings, terrain and trees free; first-person view with focal length; satellite and outdoor bases; "high quality rendering options" | [shadowmap.org/pricing](https://www.shadowmap.org/pricing) |
| Protomaps themes | light, dark, white, grayscale and black flavours, overridable per colour; PMTiles from static hosting | [docs.protomaps.com](https://docs.protomaps.com/basemaps/themes) |
| **our own build** | production build (`npx astro build --outDir node_modules/.cache/perf-build`), timed with `tests/load-scout.mts` (new) and `tests/profile-scout.mts`; screenshots in `screens/before/` | local |

Couldn't read: TPE's own pages (403 to the fetcher), the PhotoPills and Planit
2026 changelogs (nothing public turned up). No measured speed numbers exist for
any competitor. Where speed is compared below, it's against vendor claims, and
they're marked as claims.

## 3. Screen inventory (the screens in scope)

| ID | screen | route | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Archive, hero | `/` | entry, chapter bar | toolbar, colour button, search, chapter strip | filled |
| S02 | Colour popover | `/`, colour button | pick a colour, tone ranges | native colour input, hex field, count, two pairs of range inputs, Use and Clear | empty, colour set, invalid hex (dashed), phone |
| S03 | Archive with colour on | `/` scrolled | the photos that pass | chapters filtered in place, masonry repack | filtered. **No ranked view; the matched swatch isn't shown** |
| S04 | Lightbox palette | `/`, a photo | the photo's colours | swatch strip, area-weighted | filled; a tap **copies** the hex, it doesn't search |
| S10 | Scout, no place | `/scout` | first open | globe on the galaxy, side panel with search | empty: panel is an empty black column, attribution expanded |
| S11 | Scout, place by day | `/scout?at=…` | read the light | sun ring, rays, photo pins, side sheet with clock, strip, weather, times | filled, desktop and phone |
| S12 | Scout, place at night | same, `t` after dusk | night map | dark basemap, stars | (see the note on `t` below) |
| S13 | Scout, phone sheet | 393 px | the same, in a bottom sheet | sheet with detents, control row, tab bar | peek |
| C01 | Eagle colour filter | competitor | pick a colour, see a grid | palette, code field | |
| C02 | TinEye Multicolr | competitor | several colours with weights | five pickers, weight bars, wildcard | |
| C03 | Art Palette | competitor | five-colour palette or photo upload | palette row, image upload | |
| C04 | TPE Web 4.8 | competitor | planner | map, 3D Orbit and First person, command palette | |
| C05 | Sunlitt | competitor | sun map | edge time bar, bottom sheet, 3D shadows | |

Note on S12: `t` in a share link counts minutes from **solar** midnight
(`sun.ts` `dayStart = noonJD − 0.5`), not clock midnight. The app's own links
round-trip correctly. A hand-written `t=700` opens at 12:46 in London in
August, not 11:40. That's not a bug, but it's a trap for anyone writing links by hand.

## 4. User flows, with the numbers to beat

```
F01 Find photos that hold a colour (archive)
    S01 -> colour button -> S02 pick or type -> close -> scroll to S03
    clicks: 3 plus a scroll. The hero doesn't move, so nothing shows the
    result except a tiny count ("30") beside the hex field.
    Eagle: 2 (open the filter, tap a swatch), results in the same view.
    edge: a colour nothing matches (count 0, archive empties); grey query;
    a phone, where the popover covers the toolbar's second row

F02 "More like this colour" from a photo
    S04 lightbox -> tap swatch -> (copied) -> close -> colour button -> paste -> close
    clicks: 5. Swatch Book: 1 (tap the swatch, get the grid).

F03 A photo with two colours ("teal and orange")
    not possible: one colour at a time. TinEye and Art Palette: pick two to five.

F10 Open Scout on a place and read the light
    cold load -> map visible -> place named -> scene settled
    production build, SwiftShader, median of 3 (tests/load-scout.mts):
      desktop, no place: canvas 475 ms, settled 2.7 s, 2.8 s long tasks, 48 requests, 4.1 MB
      desktop, London:   canvas 488 ms, named 494 ms, settled 7.2 s, 4.1 s long tasks
      phone, London:     canvas 190 ms, named 196 ms, settled 4.5 s, 2.0 s long tasks
    our own assets: 1.87 MB uncompressed (MapLibre 1.03 MB, scout script 248 KB,
    scout.css 155 KB, book.css 48 KB that Scout doesn't use)

F11 Scrub time through the afternoon in a dense city
    tests/profile-scout.mts, central London z15.4, 4,000 buildings cast:
      95 ms per slider minute (best of five; runs 95-119 ms). A smooth drag
      needs under 16 ms. Round 1's memory recorded 5.24 ms on this scene
      before trees and wall curtains.
    86% of it is ONE loop: castCurrentShadows' wall curtains test every
    building against every prism (4,000 x 4,000 bbox checks a frame).
      castCurrentShadows self 62%, boundsOverlap 24%, shadowCeilingAt 2.4%
```

## 5. Components

| component | variants and states | screens | finding |
| --- | --- | --- | --- |
| colour button | off (hue ring), on (filled with the colour) | S01 | good, and unique: reads as "colour" without a word |
| hex field | empty, valid, invalid (dashed) | S02 | fine |
| native colour input | | S02 | the OS picker is different on every platform, and on iPad it's a sheet that covers the popover |
| tone ranges | **two separate sliders per axis** (min, max) | S02 | reads as four unrelated sliders. Competitors don't have this filter, so there's nothing to copy, but a single two-thumb range over a gradient track would say what it does |
| suggested swatches | missing | S02 | Eagle has "recommended colours"; ours would be the archive's own chapter colours |
| results count | tiny mono numeral | S02 | the only feedback while the hero fills the screen |
| lightbox swatch | copy on tap | S04 | should also search |
| Scout side sheet | dark, opaque | S11 | dark over the pastel day map; the redesign's rule was "light over the day map" (memory). Needs checking on a device before calling it a regression |
| twilight label row | Dawn … Sunset | S11 | **clipped**: "Sunse" runs off the 360 px panel |
| attribution | MapLibre compact | S10, S11 | **opens expanded**: a 1,270 px monospace bar across the map (`maplibregl-compact-show`, JetBrains Mono) |
| photo-location pins | numbered orange discs | S11, S13 | ~150 discs at z12 bury central London; most say "1". Round 1 already noted them as "visually heavy" |
| sun ring | thick ring, ticks, disc, rays | S11 | strong, and our signature. **Centred on the pin, not on the free map area**: on desktop the panel covers its left edge |
| scale bar | | S13 | on the phone it sits top right over place labels |
| tab bar over the map | glass | S13 | on the phone, map labels show through between the tabs ("Inspiration Croydon Scout") |
| unverified | | S11 | a dark band under the tab bar inside the WebGL canvas. It may be a SwiftShader artefact; check on the iPad |

## 6. Data model (what colour match runs on)

```
Photo.palette   up to 6 Swatch {L, C, H (deg), share 0..1}, from k-means at 96 px
                (palette.ts, reusing zine/colour.ts); plus the dominant colour
                appended as a share-0 accent for search (searchPalette)
                evidence: src/lib/palette.ts, colour-search.ts, data-palette on .frame
                confidence: high (it's our code)
ColourQuery     {L, C, H} from a hex. Today one per search
ToneRange       chroma [lo, hi], lightness [lo, hi], 0..1
--- inferred from competitors, to add ---
MultiQuery      up to 3-5 ColourQuery with a weight each, weights sum <= 1,
                the rest a wildcard (TinEye)                     confidence: high
MatchReason     which swatch matched and its share, so a result can show
                "38% of the frame"                               confidence: medium (design choice)
```

Ranking already exists (`searchByColour` sorts closest first). The page drops the
order because it only keeps a `Set` of ids, so results stay in hue order inside
chapters.

## 7. Feature matrix

`replica/round-2/features.csv`. `original` is the best competitor that has the
feature, and `clone` is Colour Archive today.

## 8. What can't be cloned (skip rows)

- Eagle's and Cosmos's libraries, Art Palette's museum collection. Their content.
- ShadowMap's high-quality building and tree datasets (Germany, Vienna, Tokyo),
  and Google's 3D tiles. Licensed data.
- TPE's and Sunlitt's cross-device sync. That needs accounts, which are out by decision.

## 9. Size

| | |
| --- | --- |
| screens touched | 4 archive, 4 Scout |
| flows | 5 |
| entities | 1 new (`MultiQuery`), 1 view-only (`MatchReason`) |
| hard parts | (1) keeping the scrub under 16 ms in dense cities without losing wall curtains; (2) a ranked results view that doesn't fight the hue-ordered archive, which is the app's identity; (3) checking look and speed on a real iPad when headless WebGL is SwiftShader |
| size | **S to M**: about a week. Speed is the biggest and most certain win |

## Ranked for Luca

| # | change | area | beats | size | evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | **Scrub speed**: a spatial grid over prism bounds in the wall-curtain loop (from 16 M box tests to a few thousand) | Scout speed | Sunlitt "smoother" | S | 95 ms a minute, 86% in one loop |
| 2 | **Ranked colour results**: with a colour on, a "closest first" strip or grid above the chapters, each with its matched swatch and share | Archive | Eagle, TinEye | S | F01: the result is invisible from the hero |
| 3 | **Tap a lightbox swatch to search it** (long-press or a second button copies) | Archive | Swatch Book | S | F02: 5 clicks to 1 |
| 4 | **Up to three colours with weights** ("teal and orange") | Archive | TinEye, Art Palette | M | F03 impossible today |
| 5 | **Suggested swatches** from the archive's chapters in the popover, plus one two-thumb range per axis | Archive | Eagle | S | S02 components |
| 6 | **Scout chrome fixes**: attribution collapsed, twilight labels fit, ring centred in the free map area, phone scale bar and tab bar legibility | Scout look | Sunlitt, TPE | S | screens/before |
| 7 | **Calmer photo pins**: cluster harder at city zoom (one disc per area with a count), small dots up close | Scout look | Locationscout, PhotoPills single pin | S | ~150 discs at z12 |
| 8 | **Faster settle**: London takes 7.2 s with 4.1 s long tasks. Profile the load (not the scrub) and defer what isn't on screen; drop the unused `book.css` from Scout | Scout speed | Sunlitt "background activity zero" | S to M | F10 |
| 9 | **Empty state**: the empty panel column becomes kept spots or recent places (labels only, under the minimal-text rule) | Scout look | TPE Library | S | S10 |
