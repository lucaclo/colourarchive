# Design audit: Scout and Match, November 2026

Audited 2026-11-08 on branch `round-10`, on top of the app-wide system from `DESIGN_AUDIT.md` and `DESIGN_PLAN.md` (`.btn`, `[data-seg]`, the `lib/ui` press springs).

I went through every Scout state and every Match state in headless Chromium at three sizes:

- **Desktop**: 1440×900.
- **iPad Pro 11**: 834×1194, touch.
- **iPhone 15 Pro**: 393×852, touch.

The "before" shots are in `design-shots/sm-before/`. Scout states are named `sc-*` and Match states `mx-*`.

The script is `node_modules/.cache/sm-states.mts`, run with tsx. It drives:

- the deep link;
- each sheet detent;
- the tiles;
- search;
- every group and fold;
- the tools tabs;
- layers;
- the date picker;
- the month grid;
- the glossary;
- night;
- the cards page.

For Match it uploads a real archive photo and walks every result tab, the separate sliders and the More menu.

A second script, `sm-ua.mts`, opens every fold and lists each control with its computed style. That's how the unstyled buttons below were found; screenshots alone would have missed most of them.

**Lenses:**

- the Apple HIG (`buttons`, `toggles`, `segmented-controls`, `sheets`, `motion`, `feedback`, `text-fields`, `accessibility`);
- the ui-ux-pro-max priority table;
- the locked direction in memory:
  - darkroom notebook;
  - always-dark Scout chrome;
  - minimal text;
  - Fraunces italic for titles;
  - mono for data only;
  - a 36px phone hit area;
  - the nine Match decisions.

## Summary

**Rating: needs work, with one critical rendering bug.**

Both features have a strong core.

- **Scout's thesis** is "the light, on the map, now". The map, the thick sun ring and the twilight scrub strip carry it beautifully, and the dark sheet with its italic group titles is the most finished piece of chrome in the app.
- **Match's thesis** is "your photo, graded like theirs, with the numbers to do it". The before/after stage and the single strength slider are exactly right.

What lets them down is the layer underneath: controls that never got styled, toggles drawn as 2px boxes, and a tab strip that doesn't say which tab you're on. Almost nothing moves:

- folds snap open;
- toggles snap;
- tabs snap;
- the Match result appears all at once.

## Critical

1. **A black bar across the bottom of the Scout map.**
   - **What:** at the zoom a place opens at (z≈12), with the sidebar's padding, MapLibre's globe leaves a strip of its canvas unpainted along the bottom edge. It measured about 30×970px, under the tab bar on desktop. The haze canvas behind the map has a `#05070f` background, so the strip showed as a solid black bar. It's visible in every desktop Scout shot except the first frame, and it reproduces on the real Metal GPU, not only in swiftshader.
   - **Found by:** hiding every one of the 148 style layers in turn. The strip never changed, so it isn't any layer; with the map canvas hidden, the navy is all that's left.
   - **Rule:** `feedback.md`: nothing should look broken. Craft.

## High

2. **Ten Scout buttons are completely unstyled.**
   - **What:** `.ghost` has no rule on the Scout page, so these render as the browser's default control: a flat #6b6b6b square with no radius, no hover and no focus ring of our own.
     - `#align-run` "Find dates";
     - `#align-ics` "Add to calendar";
     - `#aurora-refresh`;
     - `#meteor-go`;
     - `#tonight-run`;
     - `#plan-copy`;
     - `#mine-show`;
     - `#mine-fit`;
     - `#gap-run`;
     - `#gap-weather`.
   - **Where:** `sc-group-plan-*`.
   - **Rule:** `buttons.md` › Best practices: "use a consistent style for buttons that perform similar actions". The rest of the sheet uses glass pills.
3. **Match's phone tabs look broken.**
   - **What:** the stats and caveats block (81%, 47% and three caveat lines, about 170px) sits above every tab panel inside a scroll area only about 150px tall on a 393px phone. Tapping Colour, Details, Measured or Notes changes nothing you can see; the panel starts below the fold (`mx-tab-*-phone`).
   - **Rule:** `feedback.md`: an action needs a visible result. `tab-bars.md`: a tab switch must show its content.
4. **The Match footer is rectangles.**
   - **What:** "Download preset", "Keep this match" and "⋯" have 2px corners. The Download button is a cream slab and Keep is a hairline box, unlike every other action in the app since the `.btn` pill. The More menu opens with no motion and white hairline edges.
5. **Match tabs have no visible selection.**
   - **What:** the active tab is only a slightly brighter grey (the 1px underline sits on the hairline and disappears). On desktop "Light" and "Colour" read as equal. The underline jumps with no motion. The buttons carry `role="tab"` but never `aria-selected`.
   - **Rule:** `segmented-controls.md` and `tab-bars.md`: the current item must be clear. `accessibility.md`: state must be exposed.
6. **Scout's toggles are 15px squares.**
   - **What:** the Layers panel's 14 switches, and the night panel's 6, are hollow 2px-radius boxes that fill white. They read as checkboxes in a form, not as switches that turn a map layer on and off, and they snap.
   - **Rule:** `toggles.md`: "use a switch to turn an option on or off". The Match "Before / after" control is a raw native checkbox, a third idiom.

## Medium

7. **Folds and groups snap open.**
   - **What:** the sheet holds 5 groups and 19 folds, and opening one jumps the content in with no height motion. The +/− glyph swaps as text. It's the most frequent interaction on the page, and the least alive.
   - **Rule:** `motion.md`: "use motion to communicate how things change".
8. **The Scout tile selection doesn't glide.**
   - **What:** Sun, Sky and At the pin have an orange underline that blinks from tile to tile.
9. **The Scout search field is the old outlined box.**
   - **What:** a square 8px field with a white edge (`sc-search-*`), next to the app's filled `.field` wells.
10. **Camera selects are bare.**
    - **What:** Sensor, Focal length, Resolution and Aperture, plus the 7 selects in Long exposure and Time-lapse, are plain bordered native selects with an 8px corner and the system chevron. The Match RAW-baseline select and the Check tab select are an underlined field and a white system select.
11. **Text links acting as buttons.**
    - **What:** "All times", "All 8", "Glossary", "Print hyperfocal cards for these lenses", "Use the focus distance", "Lens and focus" and "A person, 1.75 m" are underlined grey text. "All times" is a toggle (`aria-pressed`) with no pressed look. Match's "Separate sliders ›" is a hairline pill whose chevron never turns.
    - **Rule:** `buttons.md`. It's also a Familiarity break.
12. **Match captions float away from the pictures.**
    - **What:** on desktop and iPad, "Yours, graded" and "The reference" sit at the corner of their grid cell, not of the image. "The reference" is 240px left of the picture (`mx-result-desktop`).
13. **The Match strength slider is the system range.**
    - **What:** a thin native track with `accent-color`, unlike the Scout scrubber's white thumb. It's the feature's main control, and it has no press response; the global press module deliberately skips ranges.
14. **Mono for words.**
    - **What:** the moon line "Waning crescent · 34% lit" is set in JetBrains Mono (`sc-group-night-*`), and so are the month grid's row labels ("Sat 1").
    - **Rule:** the locked direction: mono for data only.
15. **The Match result arrives in one frame.**
    - **What:** after up to a minute of measuring, the stage, slider and tabs all appear at once. That's the payoff moment of the feature, and nothing marks it.
16. **The phone peek detent clips the jump labels.**
    - **What:** "Sunrise · Golden · Noon" is cut in half at the bottom of the collapsed sheet (`sc-day-phone`).

## Low

17. **Month grid steppers** use "−" and "+" for months, where the date picker uses ‹ ›.
18. **The Match tone curve sits on a flat 4% grey square** with a 2px corner.
19. **The Match More menu** (the item list) has hairline white rows.
20. **The glossary on a phone** runs to the bottom edge, under the faded tab bar.
21. **Match "Hold for the original"** and "Yours, graded" overlap on bright skies on the phone. The caption chip is fine; the hint relies on a text shadow alone.

## What works — keep

- The map, the sun ring with its hour beads, and the rise/set rays.
- The always-dark glass dock and the five-icon Tools tabs (already a gliding `[data-seg]`).
- The italic group titles ("Camera", "Night sky", "Plan") and the dotted-leader value rows.
- The twilight scrub strip. It's the best control in the app.
- Match's crop-marked drop zone, the "Already in the archive" strip, the stage that gives its height back as you scroll, the verdict line in italic Fraunces, the wipe divider, and the phone's picture-in-picture reference.
- Reduced motion and reduced transparency are handled everywhere. Every new motion must keep that.
