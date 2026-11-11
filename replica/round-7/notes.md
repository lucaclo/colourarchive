# Round 7: whole-app UX audit (2026-10-17/18)

Branch `round-7` from `main` (bd881bb). Method: screenshots of every page at 1440×900 and iPhone 16 Pro
(`before/`), clicked flows (`flows/`), axe-core over every page on both sizes, a 30-stop Tab walk per page,
then fixes checked again (`after/`). Lenses: Apple HIG (accessibility, conventions, craft, interaction,
writing) and ui-ux-pro-max priorities (accessibility, touch, feedback, navigation).

## Fixed

| # | finding | severity | fix | commit |
| --- | --- | --- | --- | --- |
| 1 | Search returned the same 35 photos for any text: 75 of 110 had no CLIP embedding and the API had no relevance cut | Critical (feature broken) | backfilled embeddings; keep photos lifted over a "a photo." baseline (≥0.014 and ≥½ of best). "zzzqqq"/"dog" → 0, "boat" → 5, "temple" → 15 | 66b9d03 |
| 2 | Searching from the cover filtered a grid a screen below; nothing visible happened, even for no matches | High | results in the tray under the toolbar, best first; "Nothing in the archive looks like …" + Clear | 74934b1 |
| 3 | Grid photos had empty alt and weren't focusable: no keyboard or screen-reader way to open one | Critical (a11y) | each frame is a named button (kind, chapter, month); Return/Space opens; focus returns to the last photo viewed | 74934b1 |
| 4 | Overview pressed on the cover zoomed out off-screen; looked dead | High | lands on the overview | 74934b1 |
| 5 | Insights bars each started where their label ended, so lengths couldn't be compared | Medium | one grid, one start | 74934b1 |
| 6 | Book flagged two different beaches (film, no time) as duplicates | High | no capture time → also need CLIP ≥ 0.9 (bursts 0.81–0.95 always have time; false pairs 0.84–0.85) | d4226d5 |
| 7 | "1 possible duplicate" looked tappable, did nothing; 110 chapter menus named only by `title` (axe serious) | Medium | it opens the first group; menus get a name | d4226d5 |
| 8 | Match labelled references with raw Instagram ids / temp_image UUIDs | Low | read as "Reference" | (names commit) |
| 9 | Phone cover band curved away at both ends (pill radius on a 44px hit box showing 4px) | Medium | round only what shows | (names commit) |
| 10 | Add & remove: search had no visible field, Colour/Newest pressed state 3% apart, blank grid on no match | Medium | bordered field, Book's pressed style, one-line answer | 5a7aecb |
| 11 | Photo caption: stray leading dot, double gaps, US date 8/16/2026, bare "100" | Low | "Camel · 16 Aug 2026 · … · ISO 100" | 6d66358 |
| 12 | Scout scale "3000 km" cut off at the globe zoom | Low | box fits its words | 6d66358 |
| 13 | Similar view didn't say what its right half was; close button sat on the first result | Medium | "Closest in your archive" heading | 8f39a77 |
| 14 | Unhandled AbortError when a second filter skipped a morph | Low | caught | 8f39a77 |

## Checked and fine

Tab bar (the label clipping in the first shots was Astro's dev toolbar), top bar returns on scroll-up, ⌘K,
lightbox and its focus trap, Book spreads and survey, zine on a phone (scrolls clear of the tab bar),
Scout with a place on both sizes, Inspiration tap-to-reveal on touch (by design), focus rings everywhere
except the two search inputs (they change background and show a caret). The "Offline" pill seen once was
a real network drop during the run (ERR_NETWORK_CHANGED), not a false positive.

## Not done / next

- Zine on a phone: editing the cover's title puts the preview a screen away.
- Lightbox counter pill overlaps the photo's corner on wide screens.
- Film photos without dates share names ("Landscape photograph on film, Ash"); a place or frame number would separate them.
- e2e: round 5 18/18 after updating R5-3-H1 (it assumed the beach pair came first). Features 39/41; F01-H1 passes alone, R2-S-N2 is the known flaky Scout note test.
