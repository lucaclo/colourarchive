# Round 13 plan

Fixes for `audit.md`, in the order that changes the most for the least risk. Each brief
follows the CLAUDE.md template and is ready to hand to a `builder`. The main session keeps
the Scout camera work (batch 2) and the decisions.

## Decisions for Luca first

**D1 · One home for the archive** (R13-06). Today there are two archives and neither is
running.
- **Recommended:** the Mac app is the engine.
  1. Point it at the repo's data, which is the newest copy and the one that publishes.
  2. Rebuild it from `main` after batch 1, and publish a `v0.2.0` release so `/get` hands
     out the current build.
  3. Reinstall it and turn on Open at Login.
  4. Retire `~/Pictures/Colour Archive` after a diff: 2 references and the photographers
     file differ.
  5. The dev server is then for development only.
- **Alternative:** a LaunchAgent that starts `npm run dev` at login. It's simpler, but it
  runs dev mode (no origin check, R13-02), and `/get` still hands out a stale app.
- **Questions:** which data folder is canonical? Should the app publish on its own, or only
  when asked?

**D2 · Keep the magazine with the archive** (R13-41). Store the zine as `zine.json` in the
data folder, like `book.json`, with photos from the device saved beside it. Then the Mac,
the phone and the app see the same zine. *Recommended: yes.*

**D3 · Book target sizes on the phone** (R13-43). `decisions.md` says to leave the Book's
look alone. Enlarging only the invisible hit area (padding or `::after`) to 36 px keeps the
look. *Recommended: allow hit areas only.*

**D4 · Removed originals** (R13-16). Either (a) a "Removed · 23" link on Add & remove that
lists them with Restore and Empty, or (b) empty anything older than 30 days on start.
*Recommended: (a). It's one link, and nothing is deleted behind your back.*

**D5 · Where Scout's five actions live** (R13-34). They are the month grid, save image, copy
plan, copy link and save offline.
- **Recommended:** a share button in the sheet head beside the star, opening a short menu
  with those five, and taken out of Layers.
- **Alternative:** move them to the top of Layers as their own group.

## Order and who does what

| Batch | What | Who | Parallel? |
|---|---|---|---|
| 0 | D1 setup: point, rebuild, release, reinstall | main session with Luca | after batch 1 |
| 1 | Data safety: R13-01, -31, -02, -07, -03/04/05 | 4 builders | yes, no shared files |
| 2 | Scout: R13-30, -32, then -33, -35, -36, -45 | main session, then 1 builder | no, all in `page.ts` |
| 3 | Phone reach: R13-08, -19, -24/25/26, -42, -43, -37 | 4 builders | yes, by file |
| 4 | Back, reload, keyboard: R13-17/18/21/22, -20, -09, -39 | 3 builders | yes, by file |
| 5 | Words: R13-10/12/13, -11, -27/28, -38, -40, -46 | 1 builder | single pass |
| 6 | After D2, D4, D5: R13-41, -16, -34 | builders, one each | yes |

**File-overlap groups.** Briefs touching the same file run one after another, in this order:
- `upload.astro`: 3a → 4c → 5
- `index.astro`: 3b → 4a
- `inspiration.astro`: 3c → 5
- `book.astro`: 1a → 3e → 4d → 5
- `src/lib/scout/view/page.ts`: 2a → 2b → 6c
- `scout.astro`: 2b → 3f → 6c

Builders in worktrees must start their own throwaway server on their own port
(`4401`, `4402`, …), because port 4400 serves the main tree.

**Every brief shares these:**
- **Setup:** a throwaway data copy, never the real archive.
  ```
  S=<scratch>; cp -Rc "$HOME/Desktop/Colour Archive/<data>" "$S/data"
  COLOUR_ARCHIVE_DATA="$S/data" COLOUR_ARCHIVE_INBOX="$S/inbox" \
    COLOUR_ARCHIVE_PHOTOS_LIBRARY="$S/none.sqlite" npx astro dev --port 44xx
  ```
  Desktop mode turns publishing off. In dev, `/img/*` is still served from the repo.
- **Constraints:**
  - Single user, local-first.
  - Minimal copy: labels, counts and actions.
  - Errors go in a quiet corner note, never a centre card.
  - Phone controls use `var(--hit)` (36 px).
  - Use the design system: `.btn`, `[data-seg]`, `.field`, `[data-reveal]`, `.page-head`.
  - No `:active { transform: scale() }`.
  - Overlays get `role=dialog` + `data-modal` + a label.
  - Scout chrome is always dark.
  - The Book's look stays.
  - Photos, locations and photographer names stay out of git.
  - The security hook blocks some substrings in Write/Edit; see `docs/known-issues.md`.
- **Base check:** `npm test && npm run check && npm run lint`.
- **New tests:**
  - UI cases go in `tests/round13.e2e.ts` (same pattern as `round6.e2e.ts`), run with
    `E2E_ORIGIN=https://localhost:44xx node --import tsx --test tests/round13.e2e.ts`.
  - Logic tests go beside the code as `*.test.ts`.
- **Repro aids:** the probes in `node_modules/.cache/r13/` (untracked) reproduce each bug.
  Read them, but don't depend on them.

---

## Batch 1 · Data safety

**1a · Book saves that can't lose work** (R13-01, R13-31, R13-40)
```
Goal: a book save can never empty book.json, and a stale tab is told rather than
  overwriting a newer save.
Read: src/pages/api/book.ts (whole); src/pages/book.astro:953-1010 (save), :1563-1580
  (PDF waits for save); src/lib/book*.ts for the curation shape.
Constraints: book.json is written by the UI (CLAUDE.md folder map); quiet notes; Book look
  unchanged.
Do:
  - Validate the body. Unknown trim → 400. Missing keys keep their saved values (merge)
    instead of becoming empty.
  - Version every save. The GET or page render carries a version (hash or mtime). POST
    sends it. On a mismatch, answer 409 and change nothing.
  - On 409, the page's save bar says "Changed elsewhere · Reload", with Reload as the
    action. On other failures, show a plain line ("Couldn't save") with the detail only
    in the console.
  - Keep one backup: book.json.bak before each write.
  - The PDF button builds only after a save that actually succeeded.
Done when:
  - Unit tests in src/lib cover: {} and {"trim":"banana"} leave book.json unchanged; the
    merge keeps the other keys; a version mismatch answers 409.
  - The round13 e2e case "two tabs" passes: tab A moves a photo, tab B (stale) excludes
    one, B shows "Changed elsewhere" and the file still has A's move.
  - The base check passes.
```

**1b · Writes only from the app itself** (R13-02)
```
Goal: POST/PUT/DELETE under /api answer 403 unless the request's Origin (or Referer) is
  this server's own origin, or an allowed remote origin from the gate's config.
Read: astro.config.mjs (host, security.checkOrigin); src/middleware.ts if present;
  desktop/remote-gate.mjs (how phone-from-anywhere requests arrive); src/lib/paths.ts.
Constraints: must keep working for the Mac app, the phone on the Wi-Fi via Let My iPad In,
  and the Funnel route through the gate; no login.
Done when:
  - curl -k -X POST -H 'Origin: https://evil.example' -H 'content-type: text/plain'
    https://localhost:44xx/api/remove -d '{}' answers 403.
  - The same request with the server's own Origin passes the origin check.
  - The round13 e2e "upload, remove, undo" passes in a browser.
  - The base check passes.
```

**1c · A failed import leaves nothing behind** (R13-07, R13-11, R13-14, R13-15)
```
Goal: originals are kept only for photos that made it into the store; the reasons are
  plain; accented names fold.
Read: src/lib/ingest-batch.ts (saveOriginal before processPhoto); src/lib/ingest.ts:30-60
  (name slug); src/lib/inbox.ts (inbox note text).
Do:
  - Delete the saved original when processPhoto throws.
  - Map image-library errors to "Not a picture we can read" / "Empty file".
  - Slug with NFKD + strip diacritics (café été → cafe-ete).
  - Below 200 px on the long side, accept with the note "Very small (30 × 30)".
  - Add a one-off `npm run check:photos -- --orphans` listing (not deleting) files that no
    entry owns.
Done when:
  - Unit tests: a failing buffer leaves no file in the originals dir; slug('café été') is
    'cafe-ete'.
  - check:photos lists the throwaway's orphans.
  - The base check passes.
```

**1d · API answers in plain words** (R13-03, R13-04, R13-05)
```
Goal: bad requests get 400 with a short reason, never 500 or a parser message.
Read: src/pages/api/notes.ts, remove.ts, upload.ts, inspiration/add.ts, scout/weather.ts.
Do:
  - Notes for an unknown id → 404.
  - Malformed JSON → 400 "Not valid JSON".
  - Empty upload → 400 "No files".
  - Weather without lat/lon → 400.
Done when:
  - Unit or e2e tests for each case pass.
  - The base check passes.
```

## Batch 2 · Scout (main session, then a builder)

**2a · Search goes where it says, on the phone** (R13-30). Main session; this is MapLibre
camera work.
```
Goal: choosing a search result on the phone moves the map, the address, the weather and the
  photos to that place, like on the desk.
Read: src/lib/scout/view/page.ts:2220-2230 (frameRing), :5830-5870 (place setter),
  :11590-11630 (padMap).
Do:
  - Make frameRing never throw. Compute the padding from the space the sheet leaves; if
    cameraForBounds can't fit, fall back to flyTo the centre at a zoom for the radius.
  - Run save, loadWeather, loadPhotos and afterPlaceKnown before the camera move, or guard
    them, so a camera failure can't strand the place.
Done when:
  - round13 e2e "phone search": at 402×874, search "Brighton pier", Enter → the address
    has n=Brighton+Pier, there are no page errors, and the ring is on screen (screenshot).
  - The desk case still passes.
```

**2b · Panels close like panels** (R13-32, R13-33, R13-35, R13-36, R13-45). Builder, after 2a.
```
Goal: closing a panel never moves the pin; Escape closes Layers and the month grid;
  search lists each place once with a plain label; the Sunset button lands on the minute
  the list shows.
Read: page.ts:2004 (map click), :7975 (layers toggle), :11186 (outside click);
  month-grid.ts:60-80; scout.astro:1172 (#layers), :1301 (#save-offline-note),
  :1308 (#monthgrid); src/lib/ui/modal.ts; src/lib/scout/geocode.ts; the code behind the
  jump buttons.
Do:
  - A click that closes Layers or the night panel is swallowed, not passed to the map.
  - Escape closes Layers (focus back on its button).
  - Add data-modal to #monthgrid, and Escape closes it.
  - De-duplicate results by name + rounded coordinate. Map OSM classes to words (man_made
    pier → Pier) or drop the label.
  - Jump buttons and the event list use the same rounding.
  - Give #save-offline-note aria-live=polite.
Done when:
  - round13 e2e cases pass: open Layers, click the map → the pin hasn't moved (the copied
    link is unchanged); Escape closes Layers and the month grid, and focus returns.
  - A geocode unit test: duplicates collapse.
  - A unit test: the Sunset jump minute equals the listed minute for 3 dates.
```

## Batch 3 · Phone reach

**3a · Add & remove: the bulk bar follows you** (R13-08). Read `upload.astro:280-320`. Make
`#bulk-bar` sticky or fixed above the tab bar on phones while something is selected.
Done when: a phone screenshot after selecting two photos deep in the grid shows the bar
fully on screen.

**3b · Archive lightbox row fits the phone** (R13-19). Read the lightbox toolbar in
`index.astro` (`#lb-info` … `#lb-share`). On phones, overflow the less-used tools into a More
button, or wrap to two rows. No hard cut. Done when: at 402 px, every lightbox tool's box is
inside the viewport (e2e asserts it) and a screenshot shows it.

**3c · Inspiration on the phone** (R13-24, R13-25, R13-26). Read the Match tab row
(`#mx-tab-check`), the cell controls (`.cell-remove`, `.cell-match`, the group and "who"
buttons), the photographer link ×, and the selection tray in `inspiration.astro`.
- Tabs fit or show that they scroll.
- Controls are at least 36 px on touch.
- The tray wraps inside the screen.

Done when: at 402 px, the e2e asserts every control in a tapped cell is ≥ 36×36, the Check
tab is inside the viewport, and the tray's box is inside the viewport.

**3d · Magazine strip clear of the tab bar** (R13-42). Add bottom padding of tab-bar height
plus `--vgap` on phones. Done when: a phone screenshot at first view shows the strip labels
uncovered.

**3e · Book hit areas** (R13-43, after D3). Hit areas only, via `::after`, for `.book-move`
and `.book-exclude` on touch. The look stays. Done when: e2e measures the effective hit box
at ≥ 36 px.

**3f · Scout touch sizes** (R13-37, after 2b). On touch, give the tool sliders a 36 px tall
hit area, and the info tips and dof-more a 36 px hit area via padding. Raise the iPad 30 px
buttons to `var(--hit)`. Done when: an iPad e2e measures them.

## Batch 4 · Back, reload, keyboard

**4a · The Archive keeps your place** (R13-17, R13-18, R13-21, R13-22; after 3b)
```
Read: index.astro:1790-1830 (closeLightbox), :1960-1970 (handlers), the filter and search
  code, the lightbox sub-panels.
Do:
  - Wrap the × handler so it calls closeLightbox() with no argument.
  - Put medium, genre and q in the address with replaceState, and restore them on load.
  - Escape in any lightbox sub-panel closes just that panel.
  - "Back to the cover" is out of the Tab order while hidden.
Done when: round13 e2e passes for
  - open → × → Back leaves the page;
  - Film + reload keeps 49;
  - search + reload keeps the results;
  - Escape from Details leaves the lightbox open;
  - the first Tab lands on a visible control.
```

**4b · Command palette is a dialog** (R13-20). Read `src/components/CommandPalette.astro`
and `src/lib/ui/modal.ts`. Add role=dialog, aria-modal, data-modal and a label. Done when: an
e2e opens it, presses Tab ×10, and focus is still inside.

**4c · Select photos by keyboard** (R13-09; after 3a). Read `upload.astro:140-170`. Cells
get tabindex=0, role=checkbox, aria-checked, and Space toggles. Done when: an e2e selects two
photos with Tab and Space, and the bulk bar shows "2 selected".

**4d · Print popover closes with Escape** (R13-39; after 3e). Done when: e2e.

## Batch 5 · Words (one builder, one pass; after the batches above on the same files)

| ID | Now | Make it |
|---|---|---|
| R13-10 | file name + hash, neighbours' thumbnails | the photo's own thumbnail; name without hash |
| R13-12 | "6 added · 2 skipped" (11 sent) | "6 added · 5 not added", with the reasons listed under it |
| R13-13 | purple underlined link | `.btn` "View in the archive" |
| R13-27 | "That link answered 400." | "That link didn't give a picture" |
| R13-28 | "DSC06549 in the look of DSC00424-2" | the title or chapter if known, else "Your photo in this look" |
| R13-38 | first-visit paragraph | one line: "Search a place or use your location" |
| R13-46 | Book `:active` scale | remove the five rules |

Done when: grep finds none of the old strings, e2e checks the new ones, and the base check
passes.

## Batch 6 · After decisions

- **6a · Magazine in the data folder** (R13-41, D2). Add `GET`/`POST /api/zine` storing
  `zine.json` (versioned like 1a) and device photos under `<data>/zine/`. On first load,
  move any localStorage zine across once. Done when: a title typed in one browser profile
  shows in a second profile after reload.
- **6b · Removed originals** (R13-16, D4). Add a "Removed · N" link on Add & remove → a list
  with Restore (back into the store) and Empty. Done when: an e2e removes a photo, waits out
  Undo, restores it from Removed, and the count is back.
- **6c · Scout share menu** (R13-34, D5). A share button in the sheet head opens the five
  actions; they leave Layers. Done when: a phone screenshot shows the menu, and Layers holds
  only layers.

## After the fixes

1. Rerun every probe in `node_modules/.cache/r13/`, and `npm run a11y` against the
   throwaway server.
2. Run the existing `tests/*.e2e.ts` against `E2E_ORIGIN=https://localhost:4400`. They
   weren't run in this round.
3. Batch 0 (D1): rebuild the app from `main`, cut `v0.2.0`, and check that `/get` downloads
   it.
