# Design Review: Style Match (Inspiration)

Reviewed against: the app's "Whisper" system (`.design/visual-refresh/DESIGN_BRIEF.md`) and the feature's own stated intent (README's Style Match section, inline comments in `src/pages/inspiration.astro` and `src/lib/match/`). No feature-specific brief exists — the prior visual-refresh brief explicitly left "Inspiration's Style Match measurement UI internals" out of scope, touching only chrome tokens. This is the first design pass on the workbench itself.

Philosophy: Refined editorial/archival minimalism ("Whisper") — warm near-black ground, Fraunces italic display, JetBrains Mono labels, hairline chrome.

Date: 2026-08-29

## Screenshots Captured

All in `.design/style-match-review/screenshots/`, from a real match run (an archive photo matched against a board reference) on the local dev server.

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `mx-start-desktop-1280.png` | Desktop | Start screen: reference, drop zone, "Already in the archive" |
| `mx-viewport-top.png` / `mx-viewport-scrolled.png` | Desktop (900h, real viewport) | Light tab, unscrolled and scrolled |
| `mx-colour-viewport-top.png` / `-scroll200.png` | Desktop (real viewport) | Colour tab: grading wheels, mixer |
| `mx-result-details-desktop-1280.png` | Desktop | Details tab: masks |
| `mx-result-measured-desktop-1280.png` | Desktop | Measured tab: region-by-region bars |
| `mx-result-notes-desktop-1280.png` | Desktop | Notes tab |
| `mx-curve-enlarged-desktop-1280.png` | Desktop | Enlarged tone curve overlay |
| `mx-mobile-viewport-top.png` / `-scroll400.png` | Mobile (375×812, real viewport) | Light tab on phone |
| `mx-mobile-tabs-zoom.png` | Mobile | Crop confirming the tab-bar clip |

Note on method: several early full-page captures showed the archive board bleeding through beneath the panel. That's a Playwright artifact (`position:fixed` elements don't repaint across a stitched full-page canvas), not something a real user sees — every finding below was re-confirmed against a real, un-stitched 900×1280 / 812×375 viewport before being reported. Two suspected bugs (a "ghost cursor" circle, a "missing" wheel label) turned out to be exactly this kind of false alarm and are not included.

## Summary

The panel is honest, dense, and well-reasoned — every number on screen is explained, hedged, or refused with a stated reason, which is the feature's whole ethos and it comes through. The gap is presentation: this is the one surface in the app that never once uses the display typeface or picks up any hue, so it reads as a spreadsheet dropped into an otherwise considered, warm interface — and there's one real regression (the enlarged tone curve's own point list) and one real mobile bug (a tab that's clipped, not hidden, with no hint it's swipeable).

**Status: all items below implemented and re-verified against the running app (desktop 1280×900 and mobile 375×812), plus `npm test` (1671 passing), `npm run check`, and `eslint` (no new warnings).** Fresh screenshots in `screenshots/after/`.

## Must Fix

1. **~~The enlarged tone curve's point list runs its numbers together — `In 0Out 0` instead of readable rows.~~ Fixed during this review.** Two compounding bugs: the container was styled as `.curve-lb-list` when the actual element carries `id="curve-lb-list"` (no such class), so the rule never matched anything at all; and the `.row` children are created at runtime via `document.createElement` in `openCurveLb()`, which never carry Astro's build-time scoping attribute, so even a corrected selector needed `:global(...)` to reach them — the project's own documented gotcha (`astro-scoped-styles-runtime-elements` in memory) recurring in new code. Both fixed in `src/pages/inspiration.astro`; verified with a fresh screenshot (`mx-curve-enlarged-FIXED2.png`) showing "In 0" / "Out 0" correctly split across the row.

2. **~~On a 375px phone, the "Notes" tab is clipped at the edge with no indication it's reachable by swiping.~~ Fixed.** Added `updateTabsOverflow()`, which toggles a `.has-overflow` class on `.mx-tabs` whenever there's genuinely more to scroll to (and clears it once scrolled to the end, so it never claims content that isn't there). That class applies a right-edge `mask-image` fade instead of a hard clip. Runs once when the result panel first becomes measurable (`showResult`) and on resize/scroll. Verified: `mx-tabs` carries `has-overflow` on a 375px viewport; `mx-tabs-zoom.png` (in `after/`) shows "Notes" fading rather than cutting off.

## Should Fix

3. **~~The Colour Grading wheel cluster leaves roughly 40% of its own bordered box empty.~~ Fixed.** Balance/Blending now sit beside the wheel cluster (`.mx-gradestats`, a new flex sibling of `.mx-gradewheels` inside `.mx-gradebox`) instead of stacking full-width underneath — using exactly the space that used to sit empty. Wraps below on narrow viewports. Verified in `after/colour-gradestats.png`.

4. **~~The wheel in the large "hero" slot isn't always the one carrying a value.~~ Fixed — and the actual bug was worse than a tie-break.** `gradeUi.active` was initialised to the literal string `'midtones'`, not `null` — so `gradeUi.active ?? …sort by sat…` never reached the sort at all; the "biggest move greets you" logic was dead code from the very first render, every time, for every match. Changed the initial value to `null` (and widened its type to allow that). Re-verified live: the hero slot now reads `{className:"mx-cw mx-cw-lg", range:"shadows", v:"228° · 14"}` — the actual highest-saturation range — instead of the empty Midtones wheel. See `after/colour-top.png`.

5. **~~`.mx-groupreveal` has no visual button treatment.~~ Fixed.** Given the same hairline-chip treatment (border, radius, padding) as the confidence/calibration badges, with hover/expanded states matching `.mx-globaltoggle`'s pattern. Visible in `after/mobile-top.png`.

## Could Improve

6. **~~The Measured tab's region-by-region bars don't visibly scale with their own numbers.~~ Addressed — the scaling was already correct, the bar was just too thin to see it.** Traced `bar()`: it normalises against a fixed max per metric (0.15 for light, 0.05 for colour) and does scale correctly — "Whole frame" (−0.051) and "Shadows" (−0.092) really do draw different lengths, at 34% and 61% of half-track respectively. At the original 3px height that difference didn't read at a glance. Bumped to 5px. See `after/measured.png`.

7. **~~The tone curve thumbnail sits in a box sized for something bigger.~~ Fixed.** Enlarged from 116px to 144px — the same scale as the large Colour Grading wheel (`.mx-cw-lg`, 9rem), the panel's other "authoritative" control, so the two now carry equivalent visual weight.

8. **~~Nothing inside the result panel uses the app's display face.~~ Fixed.** `.mx-strengthlabel` — the sentence that changes live as the strength slider moves ("Restrained — adopts the reference's character, protects skin") — now renders in Fraunces italic at a real display size, the same idiom the archive's own chapter titles use. It's a genuine verdict line, not a measurement, so it's the right single place to spend this: everything below it stays exactly as dense and mono as before. See `after/light-top.png`.

9. **~~The stage photos are quite small even on desktop.~~ Nudged.** Raised the base allotment from `9vh + 30vh·s` to `11vh + 32vh·s` — a modest, low-risk increase that didn't touch the scroll-collapse interaction itself (the speculative "grow when the group sliders collapse" idea from the original note would need its own follow-up if still wanted; this only addresses the baseline size).

## What Works Well

- **The confidence/gap/baseline/calibration badge row** is a genuinely good pattern: plain language, colour reserved only for the two that need attention (gap closable, calibration estimated), everything else stays neutral. Nothing competes for alarm.
- **"Already in the archive" on the start screen** — measured evidence per candidate (colour cast, saturation, tone curve distance), not just a thumbnail grid — is a real, well-justified feature and a strong first thing to show.
- **The Notes tab's caution/info blocks** (left accent bar, panel tag, plain prose) read clearly and carry the same honest "here's what we couldn't do, and why" voice as the rest of the codebase.
- **The enlarged tone curve itself** (once the row-spacing bug above is fixed) is a strong, well-targeted addition — gridlines plus exact input/output numbers on Lightroom's own 0–255 axes is exactly what makes a measurement-first tool usable by hand rather than just informative.
- **Per-group strength unlinking** (Light/Colour/Effects each able to break off the master slider) is thoughtful interaction design: linked by default, one unlink button away from independent control, without needing three sliders visible all the time.
