# Shortlist, round 4: the whole app, depth and finish

Date: 2026-10-13. Evidence: `competitors.md` › Round 4. Screens: `round-4/screens-before/`.
Round 3's shortlist moved to `round-3/shortlist-r3.md`.
Scores: impact 1–5, effort S/M/L, fit = how well it suits Colour Archive (darkroom notebook, local
first, photos over chrome, no invented scores).

## Matrix summaries

### Style Match workbench

| | Colour Archive | Capture One Match Look | Lightroom mobile | Photomator |
| --- | --- | --- | --- | --- |
| share of the screen for the answer (iPad) | **~22%** (180 of 820 px) | adjustments panel beside the photo | panel beside the photo | panel beside the photo |
| strength | one master + 3 group sliders, always shown (bug) | one Impact + exclude tools | n/a | n/a |
| before / after | checkbox | layer on/off | **press and hold** | split slider on the photo |
| reasons for a weak match | **yes, unique** | no | no | no |
| title | file names and hashes | the photo | the photo | the photo |

### Viewer and app-wide

| | Colour Archive | Apple Photos | Immich 2.4–3.0 | mymind |
| --- | --- | --- | --- | --- |
| details | ⓘ button / `i` | **swipe up** | inline details | n/a |
| actions with an unfamiliar icon | 3 of 6 | 0 (rare actions in a menu) | 0 (kebab) | n/a |
| jump anywhere by keyboard | no | n/a | **⌘K palette** | **Enter → search** |

### Board and Add & remove

Inspiration cards: 4 overlays at rest, against Book's 0 since round 3. Add & remove: a 380 px drop
zone first, against Inspiration's Add button since round 3.

## Ranked shortlist

| # | item | area | reference and pattern | impact | effort | fit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Match result, answer first.** Fix the `hidden` bug so the group sliders fold away; a shorter stage that gives the report at least half the screen on iPad and a phone; **press and hold the picture for the original** (keep the checkbox's job as a small button for keyboard and VoiceOver); the header names the photos ("Your photo · Reference"), not hashes; ⚭ becomes a labelled "Linked" state; "Without masks" goes into a More menu beside the one filled Download. | Match | Lightroom mobile hold-to-compare; Capture One one Impact; HIG toolbars | 5 | M | high |
| 2 | **Match start, quiet.** Reference rows show the picture and "Reference" (file name on hover); the drop zone has one line; the RAW start becomes a short select ("Mac decode · Zero-slider JPEG · Camera preview"); "Already in the archive" cards drop the mono list for one word ("Near it") and reveal the measurements on hover or tap. | Match | HIG writing, Simplicity; round 3's "no internal text" | 4 | S | high |
| 3 | **Lightbox: clear controls.** Visible: Details, Similar, Match (text-labelled on a phone bar, symbols with tooltips on iPad), a More menu (Slideshow, Move to chapter), Close. **Swipe up on the photo opens Details**, swipe down closes them. | Archive | Apple Photos swipe-up; Immich kebab; HIG toolbars | 4 | S–M | high |
| 4 | **Quiet board cards.** At rest only the photo; Similar, Match, + and × on hover (pointer) or after a tap on touch, the same model as Book. | Inspiration | Lightroom grid extras on hover; round 3 item 5 | 3 | S | high |
| 5 | **Add & remove, archive first.** An Add photos button in the title row opens the picker; the drop zone only appears while files are dragged over the page; the grid starts at the top. | Upload | Inspiration (round 3), Cosmos | 3 | S | high |
| 6 | **Jump anywhere: ⌘K and `/`.** A small palette (glass sheet, one field, a list) that jumps to a page, a chapter, a colour ("teal" → colour search), a kept or recent Scout place, and a few actions (Overview, Insights, Print, Magazine, Add photos). `/` focuses the archive search. Works with the iPad Magic Keyboard. | all | Immich 2.4 ⌘K; mymind keyboard search; Linear | 4 | M | high |
| 7 | **Recently added** in Add & remove: a sort switch "Colour / Newest", newest-first reading `addedAt` (or file mtime) so the last import is the first thing you check. | Upload | Immich v3 Recently Added | 2 | S | medium–high |
| 8 | **Zine footer clears the tab bar**, and the four links become one quiet row above it. | Zine | HIG layout safe areas | 2 | S | high |
| 9 | **Scout times after dark roll forward** to tomorrow's blue hour, sunrise and golden hour (deferred in round 3). | Scout | Flighty smart states | 3 | S–M | high |
| 10 | **Match sweep:** the tracked-caps kickers (`.mx-h`, `.mx-kicker`, mixer heads) to sentence-case italic, and orange reserved for warnings, so the photo owns the boldness. | Match | own rules; HIG typography | 2 | S | high |

Not shortlisted: undo for removing a photo (it deletes files; a soft delete is a backend change, so
ask first); the 16-panel zine (deferred twice, needs its own round); reading `crs:` from a reference
(not chosen in round 1).

## Status (2026-10-13, branch `round-4`)

| # | item | result | commit |
| --- | --- | --- | --- |
| — | (requested mid-round) Scout photo card stands out from the map | built: always-dark card, one filled action | `fcd484f` |
| 1 | Match result, answer first | built; report starts ~450 px instead of ~640 on iPad; 19 → 13 controls | `7ca2d47` |
| — | (found in item 1) subject matte read with the wrong stride | fixed: striped skies in the preview, wrong pixels in the subject/background measurements | `8afc11d` |
| 2 | Match start, quiet | built | `96b2c27` |
| 3 | Lightbox: words for Similar/Match/Chapter, swipe up for details | built; no More menu (5 controls fit) | `7e240b4` |
| 4 | Quiet board cards on touch | built | `0596592` |
| 5 | Add & remove, archive first | built | `f2831c0` |
| 6 | ⌘K palette and `/` | built | `4ef0afb`, `1a7894a` |
| 7 | Colour / Newest order | built | `85b8b12` |
| 8 | Zine footer clears the tab bar | no change needed (it scrolls clear) | — |
| 9 | Scout times roll on to tomorrow after dark | built | `bbe48de` |
| 10 | Match tracked-caps sweep | no change needed (computed-style scan found none) | — |

Checks at the end: 1,910 unit tests pass, typecheck clean, lint 0 errors (52 warnings, as before),
production and static builds pass, feature e2e 41/41 (one earlier full run had 5 timing failures that
all pass on their own and in the next full run).

Scout smoke, full runs: 9/4/13 and 11/9/6 (pass/fail/cancelled) against round 3's 17/3/6. Both runs
overlapped other load (a probe, then a Scout edit that reloaded the page mid-run, which explains the
`window.scout` undefined errors). Run alone, the groups that newly failed pass: the world view 3/3,
light pollution 2/2, a spot from a link 6/7. Its one failure (photographed spots, which need
Commons/Flickr data) fails the same way with the Scout files reset to the round 3 commit. The
alignment finder, retroactive light, ghost frame, phone and "date row pushed off" failures are the
same ones round 3 had.

### Deferred

- **Undo for removing a photo** (Gmail-style "Removed · Undo"): removing deletes files, so it needs a
  soft delete on the server. Ask before touching the backend.
- **A single wipe picture on a phone in Match** (Photomator's split slider): would give the report
  another ~150 px on a phone.
- **16-panel zine**: deferred for the third time; it needs its own round.

### Next candidates

1. The Match phone layout: one picture with a draggable before/after wipe instead of two side by side.
2. The Scout smoke suite's old failures (3 fail, 6 cancelled since 9 Oct).
3. A ⌘K entry for actions on the current page (Print on Book, Match on a board card), Immich-style
   context actions.
