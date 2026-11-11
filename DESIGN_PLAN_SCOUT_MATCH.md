# Design plan: Scout map, Inspiration and Match accuracy (round 2)

Follows `DESIGN_AUDIT_SCOUT_MATCH.md`; numbers in brackets are its findings. It keeps every locked direction:

- always-dark Scout chrome over the pastel paper map;
- "guessed must look different";
- mono for figures only;
- the 36px phone floor;
- the nine Match decisions;
- no new explanatory text.

## Direction

**"The map tells the truth at every angle."** Round one made the controls feel like instruments. This round makes the instrument's dial honest:

- what you see tilted must be what is there;
- a basemap change must never cost you the map;
- the shadows the page computes must be visible in the view you judge them in;
- a black-and-white reference must give a black-and-white answer.

The signature stays the light: the sun ring, the rays and the shadow. Everything added below either makes the shadow easier to read or gets out of its way.

**Self-critique.** Is darkening 3D shadows a lie about contrast, given that `shadowOpacity` was tuned to physical skylight? No. The 2D ramp is unchanged. In 3D only the *ground* is visible between buildings, and at a 46% coat over near-white paper the strip at the foot of a wall measured as no shadow at all. The 3D lift makes it read as the same shadow the 2D map shows. The opacity still follows altitude and cloud, so the ordering of moments is untouched. Kept.

## Priority order

### P0: correctness (Critical)

| # | Change |
| --- | --- |
| [1] | **2D stays flat.** In 2D, `setMaxPitch(0)`; 3D restores 88. A tilt gesture in 2D promotes the view to 3D, as two-finger tilt does in Apple Maps, so the gesture still does something real. Wall curtains are only computed in 3D. |
| [2][4] | **Satellite is a layer, not a style.** Light and satellite share one style, so switching between them adds or removes the imagery and toggles the ground fills in place. No `setStyle`, no teardown, so it's instant. `setStyle` runs only when the URL really changes (dark ↔ light). Terrain is turned on only through one guarded helper that waits for `isStyleLoaded()`. The satellite source is removed before a real swap, so its queued tiles can't hit MapLibre's image-queue bug. |
| [3] | **3D shadows read.** On the paper map in 3D the composite coat is lifted ×1.45 (capped at 0.68) and its tint deepened a step. The 2D ramp and the dark map are untouched. |

### P1: detail and speed (High)

| # | Change |
| --- | --- |
| [5] | **The satellite hybrid gets the pastel treatment.** Shields, one-way arrows and POI icons are hidden as on paper. Roads become thin white lines at 55% opacity with no casings. Paths and rail fade. Labels are white with a dark halo. |
| [6] | **One font stack.** Every Scout symbol layer uses `Noto Sans Regular`/`Bold`, which OpenFreeMap serves. No 404s, and digits match the map. |
| [7] | **Buildings get form.** On paper, directional intensity rises from 0.32–0.52 to 0.42–0.62, so walls step clearly below roofs, and the ambient-lit side keeps a cool cast. The footprint hairline now draws on the paper map too, in the pastel edge colour. |
| [8] | **The 3D scrub back towards 60 fps.** Ground elevation is memoised on a ~1m grid that resets when the DEM field or uploads change. Wall curtains are skipped in 2D, and while scrubbing in 3D they're deferred to one trailing frame 140ms after the slider settles. The shadow layer reads previous GL state from MapLibre's own context cache instead of `getParameter`. The sheet's MutationObserver ignores mutations outside the sheet and timebar and is coalesced to one frame. |
| [9] | **Search starts fresh.** Opening search selects the current text, so typing replaces it. |
| [10] | **Monochrome references.** `monochrome.ts` reads the reference's chroma: coverage-weighted zone C, and the spread of its a/b. *Mono* means saturation −100, vibrance 0, no HSL saturation or hue, no Point Color, wheels at 0 and masks' colour moves at 0. HSL luminance is kept; in Lightroom it acts as the B&W mix. *Toned* is the same but keeps the grading wheels, so the tint survives (Lightroom grades after saturation, so the model can reproduce it). This is applied to the full and restrained answers before refinement and re-asserted after it, so the prior can't pull colour back in. One plain note says so. Measured with `npm run match:bench` before and after. |

### P2: consistency (Medium)

| # | Change |
| --- | --- |
| [11] | Landform shadows use the building shadow's cool tint. |
| [12] | Place, country and state labels print one name: `name:en`, then `name:latin`, then `name`. |
| [13] | Trees vary: crown radius ±18% and height ±15% from a hash of position (stable between loads), and the green shifts ±6% in lightness. A mapped `height` tag is used when present. Estimated trees keep their lighter shadows. |
| [14] | The scale bar and the credit button are restyled as dark glass. The scale label is 11px in the UI face. |
| [15] | Photo clusters are capped at 34px (26px on a phone) and fade out inside about 36px of the pin, so the pin stays visible and grabbable. Place labels get `text-optional` collision padding against the ring. |
| [16] | `.best-where` ellipsises. |
| [17] | Info tips get a 28px invisible hit area (36px on phones) around the 13px glyph. |
| [18] | On phones, chips, events-all, kit chips and `.btn-sm` reach 36px; the grabber's hit area is 32px tall. |
| [19] | Credits and "Who?" get a 24px hit area (36px on phones) by padding with a negative margin, so the layout doesn't shift. Group-by segments reach 36px on phones. |
| [20] | The "Like your favourites" sheet is rounded glass and sized to content. The close button is `.btn .btn-icon`, "Look" is `.btn .btn-sm`, and the empty state offers "Star someone on the shelf" as a button that closes the sheet and scrolls to the shelf. |
| [21] | The add-form inputs become `.field`. |
| [22] | The empty shelf shows one quiet line with the add button, and the page-head "Add" stays the only primary action. |
| [23] | Match subtitles use the reference's credit, or its file name humanised: slug to words, camera file names left out ("your photo in this look"). |
| [24] | "Read as: rendered image" becomes "Read as a finished JPEG", and the calibration line becomes a muted note, not orange. |
| [25] | "Hold for the original" becomes a dark capsule like the caption chip. |
| [26] | Match tabs on phones get a right-edge fade while the row can scroll. |

### P3: polish (Low)

| # | Change |
| --- | --- |
| [27] | Over Scout chrome the cursor ring takes its small `.down` size. |
| [28] | Credits whose name equals their handle show "@handle". |

## Verification

1. Re-shoot every state at three sizes into `design-shots/r2-after/`, and re-run the probes:
   - tilt in 2D;
   - satellite → 3D → reload → light;
   - the night link with satellite and 3D saved;
   - a red-mask read of the 3D shadows.
2. Re-run `r2-perf.mjs` and `r2-prof.mjs`. Targets: 3D scrub ≥ 45 fps, and `castCurrentShadows` share halved.
3. Re-run `r2-cs.mjs`: HIT, CLIP and TINY lists empty for the items above.
4. `npm run match:bench`: real-pair ΔE must not regress, and B&W pairs must improve.
5. `npm run check`, `npm test`, `npx eslint` on the touched files.

## Constraints

- Keep every ID, `data-*` hook, ARIA attribute, ⌘K entry and dev hook (`window.scout`).
- No new visible copy beyond the empty-state button and the monochrome note.
- Reduced motion, reduced transparency and increased contrast keep working.
- The dark chrome is never lightened.

## Status (implemented 2026-11-08)

Everything above is built, with these differences from the plan.

- **[1] Kept tilting.** In 2D a tilt promotes the view to 3D instead of being blocked, and wall curtains are computed in 3D only. A programmatic pitch in 2D now shows ground shadows only, never towers.
- **[2] Terrain guard.** It checks `style.projection`, the exact thing MapLibre dereferences, not `isStyleLoaded()`. `isStyleLoaded()` is still false inside the `style.load` handler that wants terrain back. `disableFreeLook`'s terrain call goes through the same guard; it was the other unguarded path.
- **[7] No second hairline.** The paper map's stock building layer already outlines footprints in the pastel edge colour, so only the lighting changed: directional intensity 0.44–0.64.
- **[8] Changes from the plan:**
  - **Deferred: the GL state cache.** Reading previous GL state from MapLibre's cache instead of `getParameter` saves about 1 ms a frame. MapLibre's cache going stale is the trap recorded in memory (`maplibre-custom-layer-gl-traps`), so it isn't worth it.
  - **Added: per-hotspot memo.** Hotspot light is memoised by the buildings around each hotspot.
  - **Added: skyline culling.** `buildSkyline` skips buildings that provably can't raise any bearing. The randomised check against the committed version is identical (0 bin difference, 0 count mismatches) and about 23% faster.
- **[15] Pin unaffected.** The pin is a DOM marker drawn above the canvas, so a cluster never actually covered it. Cluster bubbles are capped at radius 17.
- **[22] Kept as is.** The empty shelf already collapses to one line ending in "Add a photographer", which is the invitation, and the page head's Add stays the only primary.
- **[26] Widened.** The tab-row fade already existed (`updateTabsOverflow`); it's now 3.5rem so it reads.
- **[10] Bench.**
  - Real pairs: ΔE 5.72 → 5.52, tone 18.0 → 16.8.
  - Synthetic recovery: unchanged at 4.42.
  - The first, looser toned rule took colour from five low-colour synthetic scenes (4.42 → 4.61) and was tightened.
- **[11] Wrong cause in the audit.** The mauve-brown over the Alps wasn't landform shadow; that is already navy. It was the 3D **fog**, pinned to the sky colour of a 2° sun (#966c58) at every hour. The fog now follows the real sun and pales toward haze as it climbs (`fogColour`). The hillshade highlight was softened as well (40% toward white, half alpha).
- **Verification.**
  - The style audit (`design-shots/r2-cs-after.txt`) went from 170 to 126 HIT, 18 to 0 CLIP and 1 to 0 TINY. The remaining HIT entries are elements whose invisible hit extension the bounding box can't see (info tips, grabber, switches inside label rows) and the 34px tab bar. The remaining CONTRAST entries are colours the probe can't parse (`oklab()`) and disabled buttons.
  - The after run threw no page errors.
  - Checks: `npm run check` clean; `npm test` 2166/2166.

## Follow-up, 2026-11-09: shadows running up hillsides

Reported in Tai Hang, Hong Kong, in 3D with satellite: low-sun shadows climbed a kilometre up Mount Butler as pale sheets. There were three causes; all are fixed.

1. **Shadow length ignored the slope.** Each shadow was cast at its flat-ground length (h / tan altitude), and the per-pixel height test was meant to cut it where the hill rises. That test only holds looking straight down: in 2D the mask matched a DEM ray-march to within one 50 m sample, but tilted, parts of the long flat sheet survived up the slope.
   - **Fix:** `terrainReach` (shadows.ts, tested) marches each shadow over the elevation grid from the footprint's down-sun corner and stops it where the ground rises to meet the roof-to-sun line. `castPrisms` takes it as a per-building `reachM`. It is skipped where the ground under the gathered buildings varies by under 4 m, as in the City of London.
   - **Result:** in that view 1,566 of 3,492 buildings have their shadow stopped by the ground. Example: a 183 m tower with the sun at 13° throws 793 m on the flat, and the terrain stops it at 335 m.
2. **Shadows made the map lighter.** The composite used `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`, which also wrote a·a into the canvas alpha. Every shadowed pixel left the WebGL canvas part-transparent, and the light page behind showed through. Measured at one pixel: ground 106,95,69 became 122,114,94 under a black shadow.
   - **Fix:** `blendFuncSeparate(…, ONE, ONE_MINUS_SRC_ALPHA)` in the shadow, window and dome layers.
   - This was also the real reason 3D shadows looked faint on paper. The ×1.45 "lift" added for [3] compensated for it and has been removed; shadows are back on the physical ramp. In the City 3D test, toggling shadows now changes 31% of pixels, against 6% before.
3. **The satellite tint.** On satellite the shadow tint is near-black, so it darkens the photograph rather than laying a grey-blue coat over it.
