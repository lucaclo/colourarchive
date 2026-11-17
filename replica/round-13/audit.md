# Round 13: whole-app sweep

2026-11-12 to 13, branch `round-13`. Every tab, page and button, on the desk (1440×900),
an iPad (1180×820, touch) and a phone (iPhone 16 Pro, 402×874, touch), driven by
headless Playwright. Writes went to a throwaway copy of the archive served at
`https://localhost:4400` (desktop mode, so nothing publishes). The real archive, board and
book were never written. Probe scripts: `node_modules/.cache/r13/*.mjs`. Screenshots
(git-ignored): `design-shots/audit-13/<area>/`.

**Baseline:** `npm test` 2182 of 2182 · `npm run check` clean · `npm run lint` 0 errors,
46 warnings · `npm run build` clean in 3.7 s · `npm run a11y` (phone, axe WCAG 2.2 AA)
0 findings on 15 pages and states. The automated checks pass. Everything below was found
by using the app.

**Severity:** S1 data loss, or a wrong result shown as right · S2 broken or unsafe, no
workaround · S3 broken with a workaround, or visibly wrong · S4 cosmetic or wording.

| | S1 | S2 | S3 | S4 | to check |
|---|---|---|---|---|---|
| count | 4 | 1 | 17 | 21 | 5 |

The plan for fixing these is in `plan.md`.

## The ten that matter most

Ranked by how much each changes a normal week of using the app.

1. **R13-06 · The app you'd open is a month old, and nothing is running.** The Mac app, and
   the `/get` download, are the 19 Oct build. Every way of adding photos without the Mac
   (inbox, Let My iPad In, phone from anywhere) only works while `npm run dev` is typed by hand.
2. **R13-31 · Two Book tabs, or the Mac and the phone, overwrite each other.** Whichever
   saves last wins, silently. Reproduced: a move made in one tab was gone after the other tab
   saved.
3. **R13-30 · Scout on the phone: picking a search result goes to the wrong place.** The
   sheet shows the new name, but the map, the link and the weather stay on the old place.
4. **R13-01 · Any partial book save wipes the book file.** `{}` empties chapter order,
   exclusions, moves and trim.
5. **R13-02 · The local server accepts writes from any website or any device on the Wi-Fi.**
6. **Phone reach (R13-08, -19, -24, -25, -26).** On the phone, the bulk bar, the lightbox's
   Share and Chapter buttons, Match's Check tab and the Inspiration tray are off-screen, and
   reference controls are 15–26 px.
7. **R13-17 / R13-18 · Back and reload lose your place in the Archive.** Closing a photo with
   × costs an extra Back. Film/Digital, genre and search are gone after a reload.
8. **R13-41 · The magazine lives in one browser.** The Mac app, Chrome and the phone each
   start with an empty zine.
9. **R13-32 · Clicking the map to close a Scout panel also moves the pin.**
10. **R13-07 · A photo that fails to import still leaves its file behind.** The real
    `photos/` folder already has 11 files the archive doesn't know about.

---

## Data and setup

**R13-06 · S1 (setup) · One archive, running, on the current build**
- The installed `/Applications/Colour Archive.app` is the 19 Oct build. Its bundle has no
  inbox, no Open at Login, no Let My iPad In, no remote gate and none of rounds 10–12.
  `desktop/dist/Colour-Archive-arm64.dmg` has the same date.
- `/get`'s "Download for Mac" fetches GitHub's latest release (`src/lib/install.ts:65`).
  That release is `v0.1.0` of 2026-10-19, so installing from `/get` today installs the old app.
- The app's data folder `~/Pictures/Colour Archive` is a separate copy from 2 Nov that has
  already drifted: 11 references against 13, and no photographers file.
- Nothing starts either server. There's no listener on 4321 or on the app's ports, no
  login item and no LaunchAgent.
- **Effect:** every "add without touching the Mac" route built since October only works
  while `npm run dev` is typed by hand. There are two archives: one publishes, and neither
  is running.
- **Needs Luca:** decision D1 in `plan.md`.

**R13-31 · S1 · Two Book tabs (or two devices) overwrite each other**
- Steps: open `/book` in tab A and tab B. In A, move the first photo of the first chapter
  one place right (arrow key) and wait for "Saved". In B, which still shows the old order,
  leave out a photo and wait for "Saved".
- Expected: both changes kept, or B told that the book changed elsewhere.
- Actual: A's move is gone. The file and a reload of A show the original order. B said
  "Saved" with no warning.
- Cause: `book.astro:978` posts the whole curation from whatever the tab has on screen, and
  `src/pages/api/book.ts:34-63` writes it over the file. Nothing compares versions.
- Since round 12 the phone reaches the same server, so the Mac and the phone open at once is
  a real case.
- Probe: `book-flows.mjs`.

**R13-01 · S1 · A partial book save wipes the book file**
- `POST /api/book` with `{"trim":"banana"}` or `{}` answers `{"ok":true}` and leaves
  `book.json` as `{}`. Chapter order, exclusions, moves and trim are all gone, with no backup.
- Cause: `api/book.ts:34-63` builds a fresh curation from the body.
- The page adds layout only if `window.bookLayoutState` exists at that moment
  (`book.astro:980`), so a save that runs before that script loses trim and layout too.
- Fix together with R13-31 (same file, same idea: validate, merge, check the version).

**R13-02 · S2 · The local server accepts writes from any origin**
- A `text/plain` POST with `Origin: https://evil.example` to `/api/remove` answers 200.
- Why it's possible: in dev, Astro's origin check is off; the server listens on every
  interface (`host: true`); and photo ids are public in the published site's image names.
- So any page open in a browser that trusts the local certificate, or any device on the
  Wi-Fi, can remove or relabel photos or wipe the book.

**R13-07 · S3 · A file that fails to import is still saved as an original**
- Files that fail to decode (`r13-text.….jpg`, `r13-zero.….jpg`) are on disk in `Photos/`,
  but not in the store.
- Cause: `src/lib/ingest-batch.ts` calls `saveOriginal` before `processPhoto` and doesn't
  remove the file on failure.
- The real `photos/` folder already holds 11 files the store doesn't know. `npm run build`
  warns "9 file(s) no entry owns".

**R13-16 · S4 · Removed originals pile up with no way to see them**
- `photos/.trash` holds 23 removed originals (47 MB).
- Nothing in the app shows, restores or empties them.

**R13-03 · S4** `POST /api/notes` stores a note for an id that doesn't exist (`{"id":"nope"}` → ok).

**R13-04 · S4** Malformed JSON gets a 500 with the parser's own message (`/api/remove`,
`/api/inspiration/add`). An empty `POST /api/upload` gets a 500 about Content-Type. These
should be 400 with a plain reason.

**R13-05 · S4** `GET /api/scout/weather` with no coordinates fetches a forecast for 0°, 0°
and answers 200.

## Add & remove (`/upload`, the inbox)

**R13-08 · S3 · Phone: the bulk bar is off-screen while selecting**
- The bar ("2 selected · Film · Digital · Genre · Chapter · Remove · Clear") sits at the
  top of the grid in the page flow.
- Selecting photos further down shows nothing: the bar was measured at y = −444.
- `upload.astro:297`. Shot: `ingest/phone-03-two-selected.png`.

**R13-09 · S3 · Selecting photos needs a mouse or a finger**
- Cells have no tabindex or role.
- A keyboard reaches four buttons per photo but can't select a photo.
- `upload.astro:152`.

**R13-10 · S3 · Upload results don't show the photo**
- Each row names the file by name plus hash and shows four neighbours' thumbnails, never the
  photo itself.
- Shot: `ingest/phone-02-batch-done.png`.

**R13-12 · S4** The summary says "6 added · 2 skipped" when 5 of the 11 files didn't go in.
Duplicates, RAWs and non-images aren't counted (`upload.astro:676`).

**R13-11 · S4** The reason shown is the image library's own text: "Input buffer contains
unsupported image format", "Input Buffer is empty". This shows in the upload rows and in the
inbox note.

**R13-13 · S4** "View the archive →" is a browser-default purple underlined link.

**R13-14 · S4** Accents are dropped from file names instead of folded: `café été` becomes
`caf-t-` (`src/lib/ingest.ts:43`).

**R13-15 · S4** A 30×30 image is accepted without a word.

## Archive (`/`)

**R13-17 · S3 · Closing a photo with × leaves a dead Back step**
- After ×, the next Back does nothing (URL `/`, same scroll). Escape is fine.
- Cause: `index.astro:1966` registers `closeLightbox` directly as the click handler. The
  click event arrives as the `fromHistory` argument, so `history.back()` at `:1805` is
  skipped.

**R13-18 · S3 · Filters other than colour aren't in the address**
- Colour is in the address (`/?colour=464020`). Film/Digital, genre and search aren't.
- Film → 49 photos, reload → 110. Search → 9, reload → 110. A shared link loses them too.

**R13-19 · S3 · Phone lightbox: Share and Chapter are off the right edge**
- They sit at x = 386 and 462 on a 402 px screen, and the row ends in a hard cut through
  "Match".
- Shot: `archive/phone-01-lightbox.png`.

**R13-20 · S3 · The command palette isn't a dialog**
- No `role=dialog`, `aria-modal` or `data-modal`.
- Six Tabs walk out of it, past the list and the page body into the top bar behind.

**R13-21 · S4** Escape inside the lightbox is uneven. From Similar and Chapter it closes just
the panel. From Details, Same roll, Share and the slideshow it closes the whole lightbox.

**R13-22 · S4** The first Tab stop on the page is the hidden "Back to the cover" button.

## Inspiration and Style Match (`/inspiration`)

**R13-24 · S3 · Phone Match: the Check tab is off the right edge**
- The Check tab (the edit round trip) is past the edge of the tab row, with no sign that
  the row scrolls.
- Shot: `inspiration/phone-02-m-answer.png`.

**R13-25 · S3 · Phone: reference controls are too small to hit**
- A tapped reference shows remove and group at 26×26, Similar at 57×25, Match at 54×25 and
  "who" at 32×15.
- All are under the app's own 36 px phone size, and one is under 24.
- In a photographer's panel, the × that deletes a link is 18×16, right beside the link.

**R13-26 · S3 · Phone: the selection tray is wider than the screen**
- After adding two pictures, the "… references selected · Clear · Find mine like these ·
  Match the look" tray is cut off on both sides.
- Shot: `inspiration/phone-03-add-image-link.png`.

**R13-27 · S4** A link that fails says "That link answered 400.", which is HTTP-speak.

**R13-28 · S4** Match names photos by file name: "DSC06549 in the look of DSC00424-2".

## Scout (`/scout`)

**R13-30 · S1 · Phone: picking a search result goes to the wrong place**
- Steps (phone): open `/scout?at=51.5079,-0.0877&tz=Europe/London&n=London`, search
  "Brighton pier", then tap the result or press Enter.
- Expected: the map flies to Brighton and the link, weather and photos follow.
- Actual: the sheet says "Brighton Pier · Lower Esplanade, Kemptown, Brighton", but the map
  stays on London and the address still says `n=London`. The weather and photo pins aren't
  reloaded and a reload goes back to London, so the sheet's times don't match the map you
  see. A page error is thrown: `Cannot read properties of undefined (reading 'center')`.
- The same search on the desk works.
- Stack: `fitBounds` → `frameRing` (`src/lib/scout/view/page.ts:2220-2230`), called from the
  place setter at `:5863`. `save()`, `loadWeather()`, `loadPhotos()` and `afterPlaceKnown()`
  come after it and never run.
- Likely cause: on the phone, the fixed `{top 70, bottom 190}` padding plus the sheet's own
  camera padding (`padMap`, `:11598`) leaves no room, so MapLibre can't fit the bounds.
- "Use my location" uses `flyTo` and works.
- Probes: `scout-phone2.mjs`, `scout-search-err.mjs`. Shot: `scout/phone-02-s2-placed.png`.

**R13-32 · S3 · Clicking the map to close a panel also moves the pin**
- With Layers open on the desk, a click on the map closes Layers and also places the pin
  where you clicked.
- The next "Copy a link" gave `n=Great Russell Street`, not the London spot that was loaded.
- `page.ts:11186` closes Layers on any outside click, and the map's own handler (`:2004`)
  still treats the click as "put the pin here".

**R13-33 · S3 · Escape doesn't close Layers or the month grid**
- Layers has no Escape handler and no role.
- The month grid (`scout.astro:1308`) says `role=dialog aria-modal=true` but lacks
  `data-modal`. Focus stays on the page behind, Tab walks out, and Escape does nothing.
- `month-grid.ts:67-76` only toggles `hidden`.

**R13-34 · S3 · Phone: the useful actions are buried at the bottom of Layers**
- Layers on the phone is 373×407 and scrolls through 30 rows.
- "The month, hour by hour", "Save as an image", "Copy the plan", "Copy a link to this spot"
  and "Save this area for offline" are all at the very bottom (`scout.astro:1296-1300`).
- These are actions, not layers.

**R13-37 · S3 · Touch: tool sliders and tips are tiny**
- On the iPad, the Tools sliders (`#frame-focus`, `#fov-subject`, `#stack-near`,
  `#stack-far`, `#tl-length`, `#tl-photosize`) are 353×16.
- The info tips and the depth-of-field "more" tip are 13×13.
- "Use the focus distance" (155×30) and "Clear ticks" (85×30) are under the 36 px the app
  uses on phones. The phone's time slider is 24 px tall.

**R13-35 · S4** Search lists the same place twice ("Brighton Pier · Lower Esplanade" ×2), and
the label beside it is the map data's raw tag "man made". Shot: `scout/phone-01-s2-results.png`.

**R13-36 · S4** The Sunset button puts the time at 16:14 while the day's list says Sunset
16:15. One rounds and the other floors. Small, but this is a precision tool.

**R13-38 · S4** The first-visit note is a long explanatory paragraph, against the
minimal-copy rule.

**R13-45 · S4** "Save this area for offline" reports into `#save-offline-note`, which isn't a
live region, so a screen reader hears nothing.

## Book (`/book`, `/book/view`)

**R13-43 · S3 · Phone: a photo's controls are tiny**
- On the phone, a tapped photo's chapter select is 31×18. Leave out is 22×22 (32×32 with its
  hit pad).
- These are size fixes only. The Book's look stays as it is (decision D3).

**R13-39 · S4** Escape doesn't close the Print popover.

**R13-40 · S4** The save bar shows the server's raw error text: a refused save showed
`EACCES: permission denied, open '…/book.json'`.

**R13-46 · S4** The Book still has five `:active { transform: scale() }` rules
(`book.astro:417-509,1816`), which the design system retired. Not a look change, just the
press effect.

## Magazine (`/book/zine`)

**R13-41 · S3 · The magazine lives in one browser**
- Steps: type a title in Chrome and reload; it's kept. Open `/book/zine` in a second browser
  profile; the title is empty.
- Cause: the zine is kept in `localStorage` (`zine.astro:624-682`). Each origin has its own,
  so the Mac app, Chrome on 4321, Safari on the phone and the Funnel address each hold a
  different zine, and clearing site data loses it.
- The Book's own curation lives in the archive's data folder. The zine should too
  (decision D2).

**R13-42 · S4** Phone: at first view, the page strip's labels ("Pages 2–3") sit under the
tab bar (strip 525–646, tab bar 525–647). Shot: `zine/phone-07-phone-top.png`.

## To check (seen, not reproduced cleanly)

- **R13-23** · The Archive's colour popover opens with the hex field focused. On a real phone
  that may raise the keyboard over the swatches. Needs a device.
- **R13-29** · Match opened with no reference (seen once, from a forced click): the server
  says "Pick a reference first." and the bar stays on "Reading the file · Stop waiting" for
  two minutes.
- **Book PDF after a failed save** · `book.astro:1573` waits at most 5 s for the save to
  finish, then builds from whatever was saved, even if that save failed. This is from
  reading the code.
- **Magazine save when storage is full** · `zine.astro` ~682 swallows a failed
  `localStorage` write. This is from reading the code. It goes away with R13-41.
- **iOS standalone bottom gap** (round 12) · still unverified on a device.

## Checked and fine

- **API:** path traversal on `original/[id]` and `match/asset/[...file]` is refused, and so
  are `file:` and local or private addresses on `photographers/thumb` and `inspiration/add`.
- **Add & remove:** the picker opens in one tap. 9 files go in in 1.6 s and a 9000×6000 frame
  in 0.8 s. Duplicates are caught by content. Remove → Undo restores the cell, the count and
  the store. A refused remove puts the photo back with a quiet note. Search answers in 0.9 s
  with a clear empty state. The edge filter works. The inbox imports a settled file in 7 s.
- **Archive:** loads in 74–154 ms. A lightbox deep link reopens the photo. Similar answers in
  under 1 s and search in 1.3 s. Colour filter, More menu, Overview, Insights and palette
  actions inside the lightbox all work. No console errors.
- **Inspiration:** add by file in 1.3 s, by link in 1.4 s. Every group-by works, and remove →
  Undo works on the desk. Match answers in 13.5 s (desk) and 15.3 s (phone). The preset is
  valid XMP (107 settings) matching the numbers on screen. A failed analysis gives the drop
  zone back with the reason. Escape returns focus to the Match button. Adding a photographer
  by name finds their site and work in 15–18 s.
- **Scout map and time:** desk search; Use my location (granted: placed in about 5 s;
  refused: the row says "Location isn't available", then resets); time jumps; day ± and the
  calendar (37×36 cells on the phone); Today; the three tiles; tapping the time track. Scrub
  frames take 33 ms median, 36 ms worst. Odd deep links (lat 95, no zone, bad date, t=99999,
  polar night, a DST day) load without errors.
- **Scout sharing:** "Save as an image" gives a 1.8 MB PNG in 0.4 s. Copy the plan, Copy a
  link and the night mode all work. Offline save explains itself when the service worker
  isn't ready.
- **Scout's numbers, checked by hand** (full frame, 33 MP):
  - 24 mm ƒ/8 for print: hyperfocal 2.5 m, near limit 2.0 m at 10 m.
  - 35 mm ƒ/8: hyperfocal 5.4 m, near 3.5 m at 10 m (c ≈ 0.029 mm).
  - Field of view at 10 m with 24 mm: 15 × 10 m.
  - Focus stack, pixel-sharp, 3 m to ∞: 5.2 m covering 3–20 m, then 7.1 m covering 3.5 m–∞.
  - ND: 1/60 s through 6 stops is 1.07 s, shown as "1 s".
  - Time-lapse: 10 s at 24 fps at 5 s intervals is 240 frames over 20 min, 7.2 GB, 120×.
  - All match. The cards page (`/scout/cards`) prints to a 161 KB PDF.
- **Book:** arrow keys move a photo and keep focus on it. Autosave works. Leave out → Undo
  works. A refused save keeps the button and a retry saves. Leaving with unsaved changes
  asks first. The PDF is 116 pages, 142 MB, built in 22 s with progress. `/book/view` reads
  well on both sizes.
- **Magazine:** Fill from book, the Colours, Preview and How to fold dialogs, PDF (0.3 s)
  and JPG (0.1 s). Every dialog closes with Escape. Start over asks first. A reload keeps
  the zine.
- **Get the app:** one button, detected steps, no layout problems.

## Not covered this round

- The existing e2e suites in `tests/` (they target :4321 by default).
- The Electron app itself (it's the old build, R13-06).
- The remote gate and Tailscale Funnel (Tailscale isn't installed).
- The published Netlify copy.
- Voice notes.
- Sequence on the floor (work prints and reading the floor from a photo).
- Placing "Your photos" by hand.
- Hotspots.
- Night sky panels beyond opening them.
- Plan, Behind a target, Go tonight.
- Missing colours, tides.
