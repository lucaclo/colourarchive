# Round 4 diff report: against the reference patterns

Branch `round-4`, from `declutter` at `dcfeccf`. Before: `screens-before/`. After: `screens-after/`.
Each item is compared against the *pattern* it borrows, not a pixel layout.

| # | item | reference pattern | matches | better than the reference | still missing | commit |
| --- | --- | --- | --- | --- | --- | --- |
| — | Scout photo card stands out (requested mid-round) | n/a | always-dark card, border and shadow, one filled action | — | — | `fcd484f` |
| 1a | Subject matte stride bug | n/a (found while auditing) | — | the preview's sky stripes are gone, and subject/background are measured through the right pixels; one false note disappeared (4 → 3) | the dither stays as a general deband | `8afc11d` |
| 1b | Match result, answer first | Lightroom hold-to-compare, Capture One one Impact, HIG toolbars | press and hold (or `\`) shows the original; one filled Download, variants in More; the three group sliders fold away | the report still names *why* a match is weak, which Match Look never does | the stage is still two pictures side by side on a phone; a single wipe picture would give more room | `7ca2d47` |
| 2 | Match start, quiet | HIG Simplicity, writing | file names → names people say; the measurement strip is pictures at rest | distances on hover double as VoiceOver labels | — | `96b2c27` |
| 3 | Lightbox controls | Apple Photos swipe up; Immich kebab | swipe up opens details, swipe down closes them first | Similar / Match / Chapter in words, no guessing | slideshow and chapter weren't moved into a More menu: five controls fit on a phone, so a menu would add a tap for nothing | `7e240b4` |
| 4 | Quiet board cards | Lightroom grid extras on hover; Book (round 3) | first tap reveals, second enlarges | — | — | `0596592` |
| 5 | Add & remove, archive first | Inspiration (round 3), Cosmos | Add photos button, page-wide drop veil, paste | — | — | `f2831c0` |
| 6 | ⌘K palette, `/` search | Immich 2.4 ⌘K, mymind keyboard search | pages, chapters, places, hex colour, words | chapters carry their swatch, and Scout places come from your own kept and recent lists | no fuzzy search *inside* photos (the archive's own search does that) | `4ef0afb`, `1a7894a` |
| 7 | Colour / Newest | Immich v3 Recently added | newest first, remembered | switching back restores the exact served colour order | — | `85b8b12` |
| 8 | Zine footer under the tab bar | HIG safe areas | — | — | **no change needed**: the page scrolls, and the links clear the bar at the bottom of the scroll | — |
| 9 | Scout times after dark | Flighty smart states | the list rolls on to tomorrow morning; the headline counts down to first light | tapping a tomorrow row moves the date and the slider in one go | — | `bbe48de` |
| 10 | Match tracked-caps sweep | own rules | — | — | **no change needed**: a computed-style scan found no uppercase text on Inspiration, Match (all 6 tabs), Book, Upload or Zine; the archive's "Chapter I" small caps are kept on purpose (round 3) | — |

## Measured

| | before | after |
| --- | --- | --- |
| Match result, iPad: where the report starts | ~640 px of 820 | ~450 px |
| Match result: controls visible at once (iPad) | 19 | 13 |
| Match result: sky in the graded preview | horizontal stripes every 3 rows | clean |
| "Already in the archive": numbers on screen at rest | ~40 | 0 |
| Lightbox: icon-only actions without a standard symbol | 3 | 0 |
| Inspiration card overlays at rest (touch) | 4 | 0 |
| Add & remove: where the grid starts (iPad) | 600 px | 400 px |
