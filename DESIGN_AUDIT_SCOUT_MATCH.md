# Design audit: Scout map, Inspiration and Match accuracy (round 2)

Audited 2026-11-08 on branch `round-10`. This is the second pass of the day. The first pass (controls, switches, folds and motion) is done and archived in `replica/design-pass-1/`. This round goes where that one didn't:

- the **detail, speed and accuracy of Scout's map**, its buildings, shadows, terrain, trees and satellite layer;
- the **Inspiration tab** as a whole;
- the **accuracy of Match**.

## How it was checked

- **Screens.** Every state in headless Chromium on the real Metal GPU (`--use-angle=metal`) at three sizes: desktop 1440×900, iPad Pro 11 (834×1194, touch) and iPhone 15 Pro (393×852, touch). The shots are in `design-shots/r2-before/`; the script is `node_modules/.cache/r2-states.mjs`.
  - **Scout:** the empty globe, the London deep link, the City at z15, z16.5 and z18 pitched, Midtown Manhattan, Lauterbrunnen in 3D, the Hyde Park trees, satellite, night, every sheet detent, layers and search.
  - **Inspiration:** the board, scrolled, grouped, the lightbox, the add form, the photographer sheet and the add page.
  - **Match:** start, working, result, every tab, separate sliders and More.
- **Computed styles.** `r2-cs.mjs` walks every control and text node at each size. It flags browser-default controls, serif fallbacks, hit areas below the floor (24px on desktop, 36px on phones), contrast against the real backdrop, clipped text, horizontal overflow and nameless icon buttons. The output is in `design-shots/r2-cs-before.txt`.
- **Map internals.** Read back from the renderer rather than guessed:
  - each layer toggled in isolation;
  - the shadow mask painted pure red;
  - GL draw calls wrapped, with a probe pixel read after each one;
  - layer order dumped;
  - stack traces captured for every page error.
- **Speed.** Frame timing during a scripted scrub and pan (`r2-perf.mjs`) and a CDP CPU profile of the 3D scrub (`r2-prof.mjs`).
- **Match accuracy.** `npm run match:bench`: 24 synthetic grade-recovery pairs and 16 real board pairs.
- **Lenses:**
  - Apple HIG: `accessibility`, `layout`, `color`, `typography`, `maps`, `sheets`, `searching`, `feedback`, `loading`, `writing`;
  - the ui-ux-pro-max priority table;
  - the decisions locked in memory: darkroom notebook, always-dark Scout chrome, the pastel paper map, "guessed must look different", and the nine Match decisions.

## Summary

**Rating: critical issues.**

The design layer from this morning holds up. The map underneath it has three defects that make Scout look broken, and Match has a blind spot for black-and-white references.

- **Scout's thesis** is "the light, on the map, now". In 2D at city zoom it delivers. Once you tilt, switch basemaps or look at the City in 3D, the map stops telling the truth about the light. It draws translucent ghost towers, it freezes, or it hides the shadows it computed.
- **Inspiration's thesis** is "a board of other people's light, and who made it". The board itself is calm and well made. Its empty and secondary states (the photographer shelf, the "Like your favourites" sheet, the add form) are older and plainer than the rest.
- **Match's thesis** is "your photo, graded like theirs". On a black-and-white reference it hands back a colour photograph.

## Critical

1. **Tilting the 2D map shows ghost towers.**
   - **What:** in 2D the real buildings are hidden, but right-drag, ⌃-drag and two-finger tilt still pitch the map (max pitch 88°). The shadow layer's wall curtains keep drawing walls for the hidden buildings, so every tower appears as a translucent lavender prism with roads showing through. It covers most of the City (`sc-city-3d-*`, `sc-city-z18-*`, `sc-nyc-3d-*`).
   - **Proven by:** hiding `scout-shadows-gl` alone, which removed all of it (`design-shots/r2-probe/g-noshadowgl.png`).
   - **Rule:** `maps.md`, and the Craft principle: nothing on the map may look like something it isn't.
2. **A basemap swap can freeze the map for the rest of the session.**
   - **What:** with 3D and satellite saved, loading Scout, or opening the night deep link, threw `Cannot read properties of undefined (reading 'shaderPreludeCode')`. From then on every frame threw "Attempting to run(), but is already running". The map stopped drawing: a blank beige page with only the sun ring (`sc-half-desktop`, `sc-layers-desktop`, `sc-search-ipad`).
   - **Stack:** `Marker._onMove` → `unproject` → terrain depth pass, while `style.projection` is undefined between styles.
   - **Root cause:** satellite reuses the light style, but the page still calls `setStyle(light)` on a map that already has it. A full teardown and rebuild buys nothing and opens the window in which terrain and markers crash MapLibre. An exception inside MapLibre's task queue leaves it flagged as running for good.
   - **Related:** going back from satellite threw eight `reading 'signal'` errors from MapLibre's image queue, because queued satellite tiles were torn down mid-request.
3. **Shadows are invisible in 3D.**
   - **What:** in 3D in the City (09:26, sun at 34°), no cast shadow can be seen (`p-3d-evening.png`). Painting the mask red proves it is computed and composited (`red-3d.png`). In a dense centre almost all of it lands under buildings or on narrow streets, at about 46% navy over near-white paper. Only 5.5% of pixels change when the layer is toggled, against 59% in 2D. The flagship feature disappears in the view people use to judge it.
   - **Rule:** Purpose. `color.md`: contrast must carry meaning.

## High

4. **Saved satellite plus 3D was the only path that broke the restore.** Restoring a saved satellite view ran the same pointless style swap on every return visit (see 2). Light to satellite should be instant: add or remove one raster layer.
5. **The satellite hybrid ignores the pastel decisions.** Over imagery the light style's full stock paint comes back: saturated yellow and orange roads, A-road shields, shop and transit icons, dotted white footpaths and one-way arrows (`s1-sat2d.png`, `sc-satellite-*`). Roads compete with the sun ring, the rays and the shadows, the content HIG `maps.md` says a muted map should defer to.
6. **Map labels fetch a font the server doesn't have.** Scout's own symbol layers ask for `Open Sans Regular, Arial Unicode MS Regular`. OpenFreeMap doesn't serve that stack, so every load gets 404s on glyph ranges and the cluster and plan digits fall back to a local font. They don't match the map's Noto labels, and the console fills with warnings.
7. **Map buildings are flat and low in contrast.**
   - **What:** in 3D the pastel buildings run #d3d2cf–#efeeeb under a light whose directional intensity is only 0.32–0.52. Walls and roofs land within a few levels of each other (`j-3d-close.png`, `sh-3d-on.png`), so a block reads as one pale mass and setbacks vanish. The footprint hairline that separates neighbours exists on the dark map only.
   - **Rule:** `layout.md` and Craft: hierarchy from value.
8. **The 3D scrub drops to 32 fps.**
   - **Measured:** 2D holds 60 fps scrubbing at z12. In 3D at z16, scrubbing runs at 32 fps (23 frames over 34 ms, worst 62 ms) and panning at 32 fps with one 274 ms hitch.
   - **Profile (4 s of scrubbing):** `castCurrentShadows` takes 1.93 s.
     - The wall-curtain match takes 380 ms: `shadowCeilingAt` plus `pointInConvexRing` for every building against nearby prisms, every frame.
     - Terrain elevation sampled per shadow vertex takes about 410 ms (`groundElevationAt` plus `sampleAt`). About half those vertices are fixed building footprints that never move.
     - `getParameter` takes 115 ms. The shadow layer reads six GL states with synchronous calls every frame.
     - The sheet's `setDetent`/`resettle` takes 113 ms. A MutationObserver re-measures the sheet whenever any element in the dock toggles `hidden`, which the readouts do on every minute.
   - **Rule:** `feedback.md`: interaction stays responsive. ui-ux-pro-max §3 main-thread budget.
9. **Search appends to the current place name.** Opening search leaves "London" in the field, so typing "Kyoto" searches "LondonKyoto" and answers "No place by that name" (`sc-search-ipad`). Every search after the first starts with a wrong query.
   - **Rule:** `search-fields.md`: a search field starts ready for a new query.
10. **Match keeps the colour of a black-and-white reference.**
    - **What:** matching to the Fan Ho reference (`mx-result-*`) gives a muted colour Pantheon, with blue sky and warm umbrellas. The engine has no idea of monochrome. The colour solver pushes saturation down, but the prior toward small moves pulls it back, and the "restrained" answer deliberately protects colour that a B&W reference doesn't have. The XMP writer hard-codes `SupportsMonochrome="False"`.
    - **Bench baseline:** real-pair ΔE 5.72 mean (untouched 9.89); synthetic grade recovery 4.42 per pixel.
    - **Rule:** Purpose. This is the feature's one job.

## Medium

11. **Landform shadows are a pink-brown stain.** In 3D Alps (`sc-alps-3d-desktop`) the terrain-shadow raster covers sunlit slopes in a warm mauve-brown, which reads as a rendering fault rather than shade. Building shadows on the same map are a cool navy, so one meaning has two colours (`color.md`: one colour, one meaning).
12. **Country and place labels show two scripts at globe zoom.** "Libya ليبيا", "Saudi Arabia" plus Arabic, and Sri Lanka in a local-fallback script (`sc-globe-desktop`) crowd the welcome globe. The Liberty style prints `name:latin` plus `name:nonlatin`. Scout's chrome is English, and a muted map should carry one name.
13. **Trees are clones.** Every tree in Hyde Park has the same crown, height and green (`sc-trees-desktop`). That's fine as a sign, but it reads as a stamped pattern at z17 where the reference app shows varied canopy. Mapped trees with a `height` tag are drawn the same as estimated ones.
14. **The map's scale bar and credit button are stock MapLibre.** The scale is a white box with a black hairline and a #333 10px label (`TINY` 10px on phone in the style audit). The ⓘ is a 24px white-on-black disc. Both sit beside the dark glass chrome as the only light-styled controls on the page.
15. **The photo cluster sits on the pin.** On the phone the 162-photo cluster bubble (47px) covers the place pin and its diamond (`sc-day-phone`), and place labels run through the ring. Clusters can't be read and the pin can't be grabbed.
16. **"Best right now" meta lines are clipped mid-word.** `.best-where` overflows by 14–36px with no ellipsis ("terrain onl", "terrain oı"), at every size (CLIP in the style audit).
17. **Info tips are 13×13.** `button.infotip` ("i") in Depth of field and Stack is 13px square at every size, below the desktop minimum of 20 and far below the phone floor of 36 (HIT).
18. **Phone chips are under the 36px floor.** Play, Now, the jump labels, Today, ±day and date measure 30px tall; "All times", "All 8" and "Glossary" 30px; kit chips and `.btn-sm` 32px; the sheet grabber's hit area is 16px tall. The locked direction is 36 (`phone-compact-chrome`).
19. **Inspiration credits and "Who?" are tiny targets.** `button.credit` is 18px tall and `.cell-who` 32×15 at every size, below the desktop minimum of 20 and the phone floor of 36. The group-by segments are 30px on phones.
20. **"Like your favourites" is an empty slab.** With no favourite starred, the sheet opens at nearly full height around one 12px italic line, "Star a photographer first." It has square corners, a white hairline border, a bare × glyph, and "Look" as an underlined grey word acting as a button (`in-photographer-desktop`). Every other sheet in the app since this morning has a rounded glass surface, `.btn` pills and a sized-to-content body.
    - **Rule:** `writing.md` empty states invite the next action; `sheets.md`.
21. **The Inspiration add form uses the old underline inputs.** "Or paste a link to the image" and "Whose is it? (optional)" are 1px-underlined fields. The app's text inputs are filled `.field` wells.
22. **The Photographers shelf with nobody in it is a heading and a line.** No invitation, so the section looks broken. Two "+ Add" pills (Add, Add a photographer) also compete for the primary action at the top.
23. **Match subtitles show file slugs.** "Your photo in the look of approaching-shadow-hong-kong-by-fan-ho" (phone) and "…of DSC06160" (desktop). Names should come from what people recognise (`writing.md`).
24. **Match status lines are jargon.** "Your photo was read as: rendered image" and an orange "Slider calibration is estimated for now" both warn without saying what to do.
25. **"Hold for the original" is unreadable over bright pictures.** On the phone it sits on white umbrellas with only a text shadow (`mx-result-phone`). Carried over from round 1, item 21.
26. **Match's phone tabs hide Check.** The sixth tab is off the right edge with no fade or other hint that the row scrolls.

## Low

27. **The custom cursor ring covers control labels.** Over Scout's segmented controls the 40px ring with its dot sits on the label ("Satellite", "Light", "3D") (`s1-sat2d.png`). It should shrink to the press state over controls.
28. **Instagram-style handles read as filenames.** "More by cineplex.jpg" is a real handle. Shown with its @, it would read as a person.
29. **The sheet MutationObserver** re-measures on any `hidden` toggle anywhere in the dock (see 8). Harmless to the look, but it costs a layout on every minute of the scrub.

## What works (keep)

- The pastel paper map at 2D city zoom, the sun ring with its hour beads, the rise and set rays and the twilight strip.
- Real 3D trees with lighter estimated shadows, and the GL shadow renderer's maximum blending. Crossing shadows never pool, which is exactly right.
- Satellite *from a clean start*, and the galaxy behind the globe.
- Load speed: the map idles 1.0–1.7s after the deep link, and 2D scrubbing holds 60 fps.
- Inspiration: the masonry board, the italic colour-group headings with counts, the folding page head, the crop-marked drop zone, and the lightbox with "Shoot this light".
- Match: the result arrives in about 2s from cache. The stage, verdict line, wipe, phone picture-in-picture and footer pills from this morning hold up at all three sizes.
- No browser-default control is left anywhere in the three features (UA count 0), and no page scrolls sideways at any size.
