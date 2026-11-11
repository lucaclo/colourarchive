# Shortlist, round 3: less clutter, clearer hierarchy

Date: 2026-10-13. Evidence: `competitors.md` › Round 3. Screens: `round-3/screens-before/`.
Scores: impact 1–5, effort S/M/L, fit = how well it suits Colour Archive's identity (darkroom
notebook, local first, photos over chrome, no invented scores).

## Matrix summaries

### Scout

| | Colour Archive | Apple Weather | Flighty | Sunlitt | PhotoPills / Planit |
| --- | --- | --- | --- | --- | --- |
| glance answer at the top | no (spread over rows 1, 3 and 5) | yes | yes | yes (times) | no |
| detail behind a tap | partly (13 folds) | yes, per module | yes | PRO sheet | separate pills or screens |
| content changes with the time of day | no | partly | **yes, 15 states** | no | no |
| depth (shadows, weather decks, alignment, astro) | **deepest** | n/a | n/a | medium | deep |
| raw or internal text on screen | yes (API key, file names) | no | no | no | no |
| empty state | empty black panel | n/a | onboarding | n/a | tutorials |

- **Missing table stakes:** a one-line answer at the top; an empty state with recents and locate.
- **Where we win:** depth, shadows qualified by weather, the sun ring, no made-up scores.
- **Patterns to adapt:** Weather's summary-plus-modules; Flighty's smart states.
- **Polish gaps:** one type style for everything; 13 folds; the doubled "Golden" label.

### Book and Add & remove

| | Colour Archive | Lightroom grid | Apple Photos | Artifact Uprising |
| --- | --- | --- | --- | --- |
| overlays on a thumbnail at rest | 4 + badge | 0 (on hover) | 0 | 0 |
| print settings | always in the header | side panel | n/a | chosen once |

- **Where we win:** colour sequencing, spreads, the page-count check.
- **Patterns to adapt:** Lightroom's hover-only extras; Photos' Select mode on touch.

### Inspiration

| | Colour Archive | Cosmos | Are.na | mymind |
| --- | --- | --- | --- | --- |
| content visible on first screen | no (capture form first) | yes | yes | yes |
| add | big drop zone + 2 fields | one control / share | one control | one control / extension |

### Zine

| | Colour Archive | Canva |
| --- | --- | --- |
| controls shown | all, for all elements | only those for the selection, » for the rest |
| label style | mixed (tracked caps "TEXT", "BORDER") | consistent |

### Archive and Style Match

The archive's reading view is already lean, and the HIG audit finds nothing above Low. Style Match
saw no competitor movement in 2026, and its UI wasn't audited this round (next candidate).

## Ranked shortlist

| # | item | area | reference and pattern | impact | effort | fit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Glance-first Scout panel.** At the top, one line answering "what is the light doing": e.g. *"Soft light now · golden hour in 5 h 41 m"*. Below it, three tap-to-open tiles: **Sun** (azimuth, altitude, shadow), **Sky** (weather and decks, as one sentence), **Times**. The times list shows only the events in the **current phase** (morning: blue, sunrise, golden; evening: golden, sunset, blue; night: moon, core), with "All times" for the rest. Everything else sits behind a single disclosure. | Scout | Apple Weather (summary → modules → detail); Flighty (smart states, one template) | 5 | M | high: keeps every feature, changes only what comes first |
| 2 | **One "More" for the 13 folds.** Group them into three labelled sets: *Night sky* (Twilight, Moon, Milky Way, Aurora, Meteors), *Plan* (Behind a target, Go tonight, Day plan), *Yours* (Your photos, Missing colours, Notebook). Each set is one row that opens; the orange dots become a count only where something is happening tonight. | Scout | HIG disclosure controls ("no more than one disclosure button"); PhotoPills' weakness | 4 | S | high |
| 3 | **No internal text in Scout.** The facts table (Centre, "A 10 m wall", Buildings…) moves behind an ⓘ "About this view". The Flickr API-key line goes (silent, or the quiet corner note). Commons and Flickr file names become "Photo spot · 2 km N · 3 photos". The method note shrinks to one line behind ⓘ. | Scout | HIG writing; the quiet-errors rule; Flighty's "essential info only" | 4 | S | high |
| 4 | **Scout empty state.** The empty panel shows Kept, Recent, and a Use-my-location row, with nothing else. On a first visit with no history, only the search field and Locate. | Scout | Apple Maps' search card with recents | 3 | S | high |
| 5 | **Quiet tiles on Book and Add & remove.** At rest, only the photo. Grip, ×, file name and tags appear on hover (pointer) or in a **Select** mode (touch), Photos-style. Drop the chapter pill inside its own chapter section. Keep the duplicate badge, the one overlay that's a warning. | Book, Upload | Lightroom "clickable items on mouse over only"; Apple Photos Select | 4 | S | high |
| 6 | **Book header down to essentials.** Title + count, List/Spreads, Share, Magazine, Print. Size, bleed and the page-count check move into a **Print** popover that opens before the PDF is made. | Book | Lightroom Book's side panel; Artifact Uprising's "choose once" | 3 | S | high |
| 7 | **Board first on Inspiration.** The capture form collapses into one **Add** button (a popover with link and credit). The drop zone appears only while a file is dragged over the page, and pasting an image or link anywhere adds it. | Inspiration | Cosmos, Are.na, mymind | 4 | S | high |
| 8 | **Contextual zine inspector.** Show only the controls for the selected element (Cover text, Photo, Page), in three short groups, with "More" for the rest. All labels in the notebook's sentence-case italic, and bottom padding so the tab bar never covers a control. | Zine | Canva's contextual toolbar | 3 | M | medium–high |
| 9 | **Consistency sweep.** Tracked-caps kickers ("110 · 8 CHAPTERS", "TEXT", "BORDER") → sentence case; "Golden" → "Golden am / pm" or a sun glyph; one type ramp for the Scout panel (value rows in the UI sans, Fraunces italic only for headings); fix the one lint error. | all | HIG typography and writing; own memory rules | 2 | S | high |

Not shortlisted: an archive toolbar change (already lean); Style Match (needs its own audit first);
any new feature (this round is about subtraction).

## Status (2026-10-13, branch `declutter`)

| # | item | result | commit |
| --- | --- | --- | --- |
| 1–3 | Scout panel: headline, three tiles, half-day times, 4 groups, no internal text | built; iPad panel 1,923 → 854 px | `3913f25` |
| — | (requested mid-round) calendar dropdown from the date chip | built; replaces a sheet that opened behind the dock on iPad and off-screen on a phone | `882b80d` |
| 5 | Quiet thumbnails on Book and Add & remove | built | `8db9244` |
| 7 | Inspiration board first, Add button, page-wide drop and paste | built | `0a62ed8` |
| 4 | Scout empty state: Use my location, card hugs its content | built; also fixed a blank date after a first tapped spot | `ac8d931` |
| 6 | Book header: List/Spreads + Print panel | built | `fb01f03` |
| 8 | Zine: Text and Border fold under their current setting | built | `3e96741` |
| 9 | Consistency sweep (sentence case, labelled jumps, lint) | built; lint 1 error → 0 | `038bc2d` |
| — | Refinement: "flat light" under a 13% sky | fixed | `dcfeccf` |
| — | e2e tests follow the new flows | 41/41 pass | `5083e98` |

Checks at the end: 1,892 unit tests pass, typecheck clean, lint 0 errors, production build
passes, feature e2e 41/41. Scout smoke: 17 pass, 3 fail, 6 cancelled, the same as the 9 Oct run.
The one changed phone failure fails on the baseline commit too.

### Deferred

- Times list after dark: roll forward to tomorrow morning (Flighty). Needs the next day's times.
- The archive's "Chapter I" small caps and the shared book page's kickers: kept, as a deliberate
  book convention.
- The visible "Golden" twice on the time strip: labelled for screen readers and on hover, but
  the visible words are unchanged.

### Next candidates

1. **Style Match workbench audit.** It's the one area not screenshotted this round, and it still
   has tracked-caps labels (`.mx-h`, `.mx-kicker`, the mixer headers).
2. Scout's smoke suite: the 3 failures and 6 cancellations predate this round. They're worth a
   dedicated fix so the suite can guard the next change.
3. Upload page: the drop zone still leads the page above the archive grid, the same pattern
   fixed on Inspiration.
