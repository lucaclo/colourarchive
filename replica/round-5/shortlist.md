# Shortlist, round 5

Evidence: `recon.md`. Impact 1–5, effort S/M/L, fit as in round 4.

| # | item | area | reference | impact | effort | fit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Remove, then Undo.** Removing a photo (one or many) takes it off the grid at once and shows "Removed · Undo" for 6 s; the server call only goes out when that runs out, or on leaving the page. The two-tap confirm goes, because Undo makes it unnecessary. No server change. | Add & remove | Immich 3.1 Undo, Gmail, Glass confirm | 4 | S–M | high |
| 2 | **Colours that go with it.** In the colour popover, once a colour is picked: Complementary · Analogous · Triad. Each one adds its colours to the query (we already take up to 3), using the painter's RYB wheel the zine already uses. | Archive, Board | Adobe Color harmony rules | 3 | S–M | high |
| 3 | **Look at a burst before keeping one.** Tapping ⧉ on Book opens the group side by side (survey), at the same size, and you tap the one to keep. The old instant "keep this one" happened without seeing the others. | Book | Narrative Survey Mode, Lightroom Survey | 4 | M | high |
| 4 | **The week's sky in the calendar.** Days the forecast reaches get a small mark when the sunset (or sunrise) horizon reads *lit*, a lighter one for *bare*, nothing for *blocked*; the reason is on hover/long-press. No score. | Scout | Alpenglow 7-day, Sunsethue | 4 | M | high |
| 5 | **Match on a phone: one picture with a wipe.** Below 640 px the stage shows your photo full width with a draggable divider between graded and original; the reference is a small thumbnail you tap to see. Fixes the overlapping labels. | Match | Photomator split slider | 4 | M | high |
| 6 | **⌘K knows where you are.** Page actions at the top: Book (Print, Spreads, List, Magazine), Archive (Colour, Overview, Insights), Scout (Now, Today, Keep this place), Inspiration (Add). | all | Immich ⌘K context actions | 2 | S | high |
| 7 | **16-page zine from one sheet.** An 8 / 16 switch in the zine maker; 16 imposes two sides of one sheet (the "mini magic" fold), with a PDF of two pages for duplex printing and fold instructions. | Zine | 16-panel Mini Magic Zine Imposer | 3 | L | medium–high |

Not shortlisted: alerts (need push), a sunset score (against weather.ts's rule), favourites (Book
inclusion is already the one pick), a custom tab bar, field reports.

## Status (2026-10-14, branch `round-5`)

| # | item | result | commit |
| --- | --- | --- | --- |
| 1 | Remove, then Undo | built; the two-tap confirm is gone, no server change, ⌘Z works too | `1137b84` |
| 2 | Colours that go with it | built, **changed in the build**: the rules' colours are offered one at a time (seven partners round the wheel, each with its count). Three-colour triads and splits found 0 photos for every chapter colour on this archive | `22c280f` |
| 3 | Look at a burst before keeping one | built; hold to zoom every photo to the same spot. Titled "Similar shots", not "Same moment": the first group surveyed held two different beaches | `2e94b7d` |
| 4 | The week's sky in the calendar | built; each evening read along its own bearing, a week is about 3 requests (bearings round to 2°) | `b5ae6d9` |
| 5 | Match on a phone: one picture with a wipe | built; the wipe line is draggable on every size | `e239a14` |
| 6 | ⌘K knows where you are | built, declarative (`data-cmdk` on any control); an open lightbox narrows it to its own actions; Go to drops the page you're on | `9d04f7d` |
| 7 | 16-page zine | built as **two nested sheets**, not the one-sheet duplex "magic" fold: that imposer's layout is only in its template (behind a login), and nesting reuses the fold already checked against Dirty Little Zine | `35eb673` |

Checks at the end: 1,940 unit tests pass (was 1,910), typecheck clean, lint 0 errors (52 warnings,
as before), production and static builds pass. Round 5 e2e (`tests/round5.e2e.ts`) 18/18. Feature e2e
37/41 in the full run; the four failures (F05-H2 eye level, R2-F01-H1 colour tray, R2-S-N2 and N3
map notes) all pass run on their own, and N3 also passes with round 4's Scout files, so they are the
timing tests round 4 already flagged, not regressions.

Scout smoke, full run: 16 pass / 4 fail / 6 cancelled (round 4: 9/4/13 and 11/9/6; round 3: 17/3/6).
The failing groups (alignment finder, retroactive light, ghost frame, phone, a spot from a link) are the
same ones that failed before this round.

### Next candidates

1. **Field notes after a sunset** (Alpenglow's reports): a one-tap "how was it" on a kept spot's
   evening, so the calendar's marks can be checked against what happened.
2. **The duplicate detector is loose**: the first ⧉ group pairs two different beaches. Now that the
   survey shows them side by side, tighten `duplicates.ts` (EXIF time gap, embedding distance).
3. **A one-sheet duplex 16-page fold**, if a documented imposition turns up; the slot model takes
   it as a third format.
4. The Scout smoke suite's old failures.

Parity (`replica-diff/parity.py` over `replica/features.csv`): 94.9, with 11 of 12 must-haves. The one
missing is reading exact `crs:` settings from a reference, which was turned down on 2026-10-09. Round 1's
"Zine 16-page" row is now done.
