# Design audit — Colour Archive, November 2026

Audited 2026-11-04 on branch `round-10`. I went through every route and its main states in headless Chromium at three sizes:

- **Desktop**: 1440×900.
- **iPad Pro 11**: 834×1194, touch.
- **iPhone 15 Pro**: 393×852, touch.

The "before" screenshots are in `design-shots/before/`. Route shots are named `<route>-<size>.png`, and state shots are `st-<state>-<size>.png`.

**Lenses:** the Apple HIG (`accessibility`, `layout`, `typography`, `color`, `tab-bars`, `buttons`, `motion`, `feedback`, `materials`/`liquid-glass`, `sheets`), the ui-ux-pro-max priority table, and the locked direction in memory. That direction is:

- the Whisper palette;
- Fraunces italic for titles only;
- the system UI face for controls;
- mono for data only;
- the darkroom-notebook vocabulary;
- minimal text;
- a 36px touch floor on phones.

## Summary

**Rating: needs work, with two critical findings.**

The archive's thesis is strong: photographs ordered along the hue, with chapters that wash the screen in their colour. The cover and the chapter colour wash are memorable. The problems sit around that core.

- **The chrome has drifted into four dialects.** There are:
  - glass pill capsules (Archive, Scout);
  - square, hard-edged boxes (Zine, the Inspiration add form, the Photographers form);
  - bare text links (the Book header, the Zine footer);
  - white rectangles (the Inspiration "Add" button).

  Moving between tabs feels like moving between apps.
- **Interaction feedback is uneven.** About 60 `:active` rules are spread over 16 files, each with its own scale and timing, and many buttons have none: Zine, Book view, ColourFilter, CommandPalette, LightPlan, Inspiration add. Segmented controls snap with no motion between states. Nothing scrolls with any life except the archive.

## Critical

1. **The tab bar is illegible over light content.**
   - **What:** `--glass-bg` is 58% of `--bg`. Over Scout's pale basemap (≈#e9e6df) the composite is ≈#6b6966. The inactive labels (`--secondary` #a8a49d) then measure **2.2:1**, and the active label 4.5:1.
   - **Where:** `scout-desktop.png` and `scout-ipad.png`, where "Archive / Inspiration / Book" can't be read. The same happens over the bright photos on Book and Upload (`book-desktop.png`, `upload-phone.png`), where the labels mix with the pictures.
   - **Rule:** `liquid-glass.md`: legibility of the functional layer comes first. `accessibility.md`: 4.5:1 for text.
   - The phone-only Scout override at `scout.astro:5257` proves the problem and patches one case of it.
2. **Phone tab labels are 9px.**
   - **What:** `.tab-label` is 0.5625rem (9px) at ≤640px.
   - **Rule:** `typography.md`: mobile minimum 11pt. The app's own token comment says "12px is the floor for anything meant to be read".
   - **Where:** `archive-phone.png`, bottom.

## High

3. **Four button dialects.**
   - Zine uses square 0-radius outlined boxes plus a white rectangle for "Download PDF" (`zine-desktop.png`). On the phone they wrap into two clumsy rows (`zine-phone.png`).
   - The Inspiration add form has a square white "Add" and an underlined input (`st-insp-add-*`). The Photographers form has three square white buttons (`st-insp-photographer-*`).
   - The Book header has "Share↗" and "Magazine" as plain grey text beside a pill "Print" (`book-desktop.png`).
   - The Zine footer is four underlined italic links (`zine-desktop.png`).
   - **Rule:** `buttons.md` › Best practices: "use a consistent style for buttons that perform similar actions". It is also a Familiarity break.
4. **Segmented controls look the same everywhere but never move.** Archive All/Digital/Film, Book List/Spreads, Upload Colour/Newest, Scout 2D/3D, Cards Metres/Feet, Zine pp/size, and the Inspiration group-by (slashes, an underline, not even a segmented control). The selected thumb snaps. Moving the selection is the one gesture where motion explains what changed (`motion.md`: "use motion to communicate how things change"), and it's missing everywhere.
5. **Chapter openers fall back to tracked mono capitals.**
   - **What:** "CHAPTER I" and "7 PHOTOGRAPHS" in uppercase JetBrains Mono at 0.2em tracking (`st-archive-chapter-*`). The shared Book view does the same ("COLOUR ARCHIVE", "CHAPTER I", `book-view-desktop.png`).
   - This contradicts the notebook direction (no tracked caps, mono for data only), and the title floats small in a big flat field. On desktop the opener is 58svh of grey with a 3.2rem title. That's the weakest hierarchy in the app on its most-seen screen.
6. **Inconsistent page headers.**
   - Inspiration's page is titled "Reference" while its tab says "Inspiration", and the header has no count.
   - Book has "107 of 110" in the UI face. Upload has "110" in mono beside a second title, "In the archive", so there are two Fraunces titles on one page.
   - Zine has a back link inline with the title.
   - None of them collapse on scroll. The big title scrolls away, and the actions (Print, Add photos, Add) go with it.
   - **Rule:** `layout.md`: keep primary actions reachable. `toolbars.md`.
7. **The lightbox toolbar is crowded and flat.**
   - **What:** seven separate glass circles and pills in a row on desktop: Play, Info, Similar, Same roll, Match, Share, Chapter, plus Close. On a phone the row scrolls sideways with no affordance, and "Share" and "Chapter" are off-screen (`st-lightbox-phone.png`).
   - **Rule:** `toolbars.md`: group related items, prefer fewer items, and the overflow goes to More.
   - The caption is set in tracked mono for words ("Ash · Leica Mini Zoom"), which isn't data.
8. **The archive phone toolbar strands three icons.** Overview, Get the app and Insights sit on a second row as three loose circles under the filter capsule (`archive-phone.png`). They read as unrelated floating buttons, not a toolbar.
9. **The Inspiration empty shelf wastes the fold.** With no favourite photographers, a 100px crop-marked "+" box plus an "Add" caption takes the first screen (`inspiration-desktop.png`). The board, which is the point of the page, starts below the fold on the phone.

## Medium

10. **No scroll-linked feedback outside the archive.** The Book, Upload and Inspiration grids pop in as the page loads, with no entrance and no reveal as you scroll. Photos have a blurred placeholder in the archive only.
11. **Press feedback is ad hoc.** Scales of 0.92, 0.94, 0.96 and 0.98, durations from 110 to 140ms, with `ease-out` and no release spring. Many controls have none at all: ColourFilter, CommandPalette rows, Zine, the Book view, LightPlan, the Get page links, and the `.lb-copy` swatches.
12. **Hover is inconsistent.** Some buttons brighten their background, some change colour, and Zine buttons do nothing. There is no lift or highlight vocabulary.
13. **Insights reads as a generic SaaS settings page.** Boxed rounded cards with labels inside, a left-aligned narrow column, and the close button far away at the screen corner (`st-insights-desktop.png`). It doesn't follow the notebook vocabulary (hairlines, not boxes).
14. **The Book print popover is dense and mixed** (`st-book-print-*`). A native checkbox and a native number input sit beside pills. Its secondary buttons are outlined while Make PDF is filled, which is fine, but their heights vary.
15. **The Zine editor's bottom area.** About 120px of dead space sits above the tab bar on desktop. The page rail on the phone is cut off under the tab bar (`zine-phone.png`: the "Pages 2–3" labels collide with the tab bar).
16. **Masonry ends ragged.** Ash, with 7 photos in 3 columns, leaves a large black hole at the end of the chapter (`st-archive-photos-desktop.png`). This is a property of the contiguous-run balancing. See remaining issues.
17. **Scout map controls (top right) mix two materials.** The 2D/3D segment is a white pill beside black circles, and the MapLibre ⓘ attribution sits as a black disc in the corner, foreign to the glass system (`scout-desktop.png`).
18. **Upload.** The search field and the "On a chapter edge" chip are stacked full-width on the phone, with heavy air above the grid. "In the archive" repeats the page title's job.

## Low

19. The cover's "↓" scroll hint glyph is tiny (12px) and grey. It's fine on desktop, but on the phone the hairline animation is the only cue.
20. ⌘K group labels ("This page", "Go to") are 11px italic. Acceptable.
21. The Get page is clean. It only lacks press feedback on the platform links.
22. The Hyperfocal cards page is a print preview and correctly quiet.

## What works — keep

- The colour wash between chapters and the chapter-tinted `--accent` in the chrome.
- The cover: Fraunces display title and the spectrum band.
- The photo flight between grid and viewer (`flyPhoto`), the overview morph, and the cross-document tab-pill glide.
- The quiet-error pattern (corner note).
- The Scout sheet with detents and the dark glass dock.
- The ⌘K palette.
- Reduced-motion and reduced-transparency coverage is unusually thorough. Every new motion must keep it.
