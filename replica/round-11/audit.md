# Round 11 — whole-app audit

2026-11-09, branch `round-10`, working tree as it stood that day (uncommitted).
Read-only: every write to the app was blocked in the probes, so nothing in the
archive, the board, the book or Scout was changed.

**How it was checked**

- `npm run check`: clean. `npm test`: 2169 of 2169 pass. `npm run lint`: 0 errors and 54 warnings (50 are `no-explicit-any`, 4 are `no-useless-assignment`).
- A headless crawl of all 10 routes plus a bad URL, on a 1440×900 desktop and an emulated iPhone 16 Pro. It recorded console and page errors, HTTP ≥400, horizontal overflow, tap targets under 24 px, unlabelled controls, missing `alt` text, duplicate ids and text contrast. Script: `node_modules/.cache/audit-crawl.mjs`.
- A scroll pass on the long pages, to tell real image-loading failures from screenshot artefacts. Script: `audit-scroll.mjs`.
- Two interaction passes. They opened the lightbox and its tools, Insights, ⌘K, the colour filter, Genres and Overview, Inspiration's group-bys, Add and Add a photographer, Match, the Scout deep link with its tools, night mode and eye level, Book's Spreads and Print, the Magazine's preview, colours, fold and pages, and Add & remove's sort, search and edge filter. Scripts: `audit-interact.mjs` and `audit-interact2.mjs`.
- Then the code behind anything that looked wrong was read.

Screenshots are in `design-shots/audit-11/` (gitignored, because they show archive photos). Names there are `<size>-<page>.png` (crawl), `i-…`/`j-…` (interactions) and `scrolled-…`.

Severity: **S1** broken or wrong result · **S2** misleading or blocks a flow · **S3** visible flaw · **S4** polish.

---

## Summary

| # | Sev | Area | Issue |
|---|-----|------|-------|
| A1 | S2 | Scout | `/api/scout/places` returns 500 on every Scout load when Photos.sqlite can't be read |
| A2 | S2 | Scout | With no Flickr key, hotspots and "Best right now" are all Wikimedia Commons, the source chosen to be off by default |
| A3 | S2 | Match | A black-and-white reference lists 8 colour photos as "graded like it" |
| A4 | S2 | Inspiration | Removing a reference leaves the counts stale and an empty group heading |
| A5 | S2 | All | No 404 page: Astro's default page, no viewport meta (980 px wide on a phone), no way home |
| A6 | S3 | Archive | Archive search has no visible field (`#search-input` is 0×0); it's only reachable through ⌘K |
| A7 | S3 | Archive | The results strip from ⌘K search doesn't show the query, and "temple" returns 15 results including a mountain, Tokyo Tower and the Vittoriano |
| A8 | S3 | Lightbox (phone) | Share and Chapter are off-screen in a horizontally scrolling bar with nothing to show it scrolls |
| A9 | S3 | Book | The Print popover is taller than the viewport and its last rows sit under the tab bar |
| A10 | S3 | Magazine | Preview of an untitled zine is a blank page; the editor shows "Name your zine" |
| A11 | S3 | Magazine (phone) | The cover editor keeps two columns at 402 px, so the typeface chips stack 5 rows deep in a narrow column |
| A12 | S3 | Archive | While scrolling, the next chapter's giant title shows through behind the sticky top bar |
| A13 | S3 | Inspiration | Escape doesn't close the Add panel or Add a photographer |
| A14 | S3 | Inspiration | The Photographers shelf is empty with no hint, although 4 references are credited to one photographer |
| A15 | S3 | Scout | The night-vision offer stays up after night mode is turned off, including over daytime eye level |
| A16 | S3 | Scout | Eye level: the ground is pale blue with moiré banding |
| A17 | S3 | Scout | "Sunrise · Golden · Noon · Golden · Sunset" are evenly spaced jump buttons but read as axis labels that don't line up with the bar |
| A18 | S3 | Scout | Hotspot titles are raw Commons filenames ("St Paul's Cathedral Nave, London, UK - Diliff") |
| A19 | S3 | Scout | "At the pin: In sun" while the sky reads "Overcast, 85% cloud" |
| A20 | S3 | Scout | Hotspot cluster badges overlap each other ("83"/"44") and the pin ("162" on the phone) |
| A21 | S3 | Archive (phone) | The top bar wraps to two rows, and the second row is three icon-only buttons with no labels |
| A22 | S3 | Overview | Once in Overview the top bar has scrolled away; the only ways out are tapping a tile or scrolling up |
| A23 | S3 | A11y | Tap targets under 24 px: colour-strip segments 7 px tall, spectrum rail 8 px wide, credits 18 px tall, "who" 32×15, book duplicate badges 21 px, book exclude 22×22, Scout photo pins 22×22, upload search field 20 px tall |
| A24 | S3 | A11y | `/book/view` photo links have only `alt=""` images, so they're unnamed links |
| A25 | S4 | A11y | `/scout` and `/inspiration/add` have no `<h1>` |
| A26 | S4 | Inspiration | Two input styles on one screen: boxed `.field` for references, an underline field for photographers |
| A27 | S4 | Inspiration | The open toggle reads "× Add a photographer" instead of becoming Cancel or Close |
| A28 | S4 | Book | The Spine input is a browser-default box, not `.field` |
| A29 | S4 | Book | "34 photos may print soft" offers no next step in the popover |
| A30 | S4 | Archive | The cover reads "110 · 8 chapters"; 110 of what? |
| A31 | S4 | Insights | The Deep Yellow swatch (#4a4320-ish) almost disappears on the dark background |
| A32 | S4 | Scout | Ocean labels on the globe are white italic on light blue with a heavy outline: hard to read and heavy-looking |
| A33 | S4 | Scout | The scale bar and ⓘ button float at mid-right instead of sitting in a corner |
| A34 | S4 | Lightbox | The "1 / 110" counter pill has a soft gradient edge that bleeds over the photo |
| A35 | S4 | Code | Lint: 4 useless assignments (`colourResidual`, `features`, `settings`, `target`) and 50 `any`s |

By severity: S2 5, S3 19, S4 11. There are no S1s: nothing crashed, no page threw, no uncaught errors appeared on any route.

---

## Detail

### A1 · S2 · Scout places API 500s on every load
- **Steps:** open `/scout` on a Mac where the dev server has no Full Disk Access.
- **Actual:** `GET /api/scout/places` returns 500. The console shows `EPERM: operation not permitted, copyfile '…/Photos.sqlite'`, on desktop and phone alike, every visit. It also breaks the features e2e Scout tests, which the design-system notes already flagged.
- **Cause:** `src/pages/api/scout/places.ts:38`. Only `LibraryProblem` is turned into the soft `{ ok: true, suggestions: [], problem }` reply, and an `EPERM`/`EACCES` from the copy isn't wrapped in it.
- **Fix:** map `EPERM`/`EACCES` to `LibraryProblem` with "Give Colour Archive Full Disk Access to suggest places from your iPhone photos". The fold then shows the reason quietly, in the corner-note style.

### A2 · S2 · Commons fills hotspots when Flickr has no key
- **Steps:** `/scout?at=51.5079,-0.0877&…`, with `FLICKR_API_KEY` not set (the Flickr API is paid, so this is the normal state).
- **Actual:** "Best right now" lists "St Paul's Cathedral High Altar, London, UK…", "St Paul's Cathedral Nave, London, UK - Diliff" and "St Bride's Church, London - Diliff". Those are Commons Quality and Featured files, the kind rejected on 2026-10-19 ("images anyone standing there could have taken"). The map shows 6 to 83 badges from the same source.
- **Code:** `page.ts:4740–4770` treats Flickr as a tier that's skipped without a key, so Commons ends up the only real source.
- **Decision needed:** either hide hotspots and "Best right now" when Commons is the only source (and say why), or keep Commons behind the reference toggle as decided, and let `/api/scout/shared` photos and favourite photographers' geotagged work be the default source.

### A3 · S2 · Match suggests colour photos for a B&W reference
- **Steps:** Inspiration › Fan Ho "Approaching shadow" › Match.
- **Actual:** "Already in the archive: 8 of mine are graded like it". All 8 are full-colour photos (a red taxi, a green hillside, a pool, a Swiss façade…). Screenshot: `j-desk-match-03-match-12s.png`.
- **Expected:** for a monochrome reference (`monochrome.ts` already detects it), either rank by tone and contrast only and say "closest in tone", or show none.
- **Where:** the `/api/match/resemble` caller at `inspiration.astro:2733`. The resemble ranking ignores the monochrome result.

### A4 · S2 · Board remove leaves stale counts
- **Code:** `inspiration.astro:2186`. On success it only does `btn.closest('.insp-frame').remove()`.
- **Actual:** the page count (`.ph-count`, "13"), the group's count ("Red 4") and, when the last item goes, the empty group heading and rule all stay until reload. A failed remove silently resets to "×" with no reason given, which breaks the quiet-error-note rule.
- **Fix:** decrement both counts, remove an empty `<section>`, and on failure show the corner note with the server's error. Undo would match the archive's undo-remove.

### A5 · S2 · No custom 404
- `/nope-404` renders Astro's bare "404: Not found". There's no layout or tab bar, no `<meta viewport>` (the phone lays it out 980 px wide), and no link home.
- **Fix:** add `src/pages/404.astro` using `Layout` and `TabBar`, with a line of copy and a link back to the Archive. A stale shared Scout link is the likeliest way anyone lands here.

### A6 · S3 · Archive search is invisible
- `index.astro` renders `#search-input` (two conditional copies in source), but on both sizes it measures 0×0. The only way to search is ⌘K, and the phone has no ⌘K, so the phone can't search at all unless the palette has a touch entry I didn't find. Either show a search button in the top bar, or add "Search" to the phone's icon row.

### A7 · S3 · Search results strip
- After ⌘K › "temple" › Return, a strip of 15 thumbnails appears, with a magnifier and "15". The query isn't shown and there's no visible clear (×). Results include Sigiriya rock, Tokyo Tower, the Vittoriano and a Swiss peak. The lift rule from round 7 seems too loose for single-concept queries. `j-desk-home-10-cmdk-enter.png`.
- The Genres pill also gains a dot, and the colour button shifts right by about 11 px when results show (a layout shift).

### A8 · S3 · Phone lightbox bar hides actions
- At 402 px the bar shows ▶ ⓘ Similar · Same roll · Match, with Share and Chapter clipped off the right edge. There's no edge fade or partial chip to say it scrolls (`j-phone-home-04-lb-info.png`). There's also about 600 px of empty black above the photo, and the photo sits low.
- **Fix:** a right-edge mask fade, or collapse Share and Chapter into a "More" button.

### A9 · S3 · Book Print popover overflows
- On desktop at 900 px tall, the popover runs from y=255 to past the bottom of the screen. "Hyperfocal cards" and its caption sit under the tab bar and the + button (`i-desk-book-02-print.png`). It needs a `max-height: calc(100dvh - top - var(--tabbar-space))` and to scroll internally.
- *(The Book page was reverted on 2026-11-04 at your request. This item and A28/A29 are functional, not restyling.)*

### A10 · S3 · Zine preview blank
- With no title, the editor's cover shows the "Name your zine" placeholder, but Preview › Pages › Cover is an empty dark rectangle (`i-desk-book-04-zine-preview.png`). Either render the placeholder faintly in the preview too, or show "Untitled" so it doesn't look broken.

### A11 · S3 · Phone zine editor layout
- At 402 px, the "Add photo" slot keeps its column on the left, so the title, subtitle, author and typeface controls get about 280 px. The 8 typeface chips stack into 5 rows (`phone-book_zine.png`). Stack the photo slot above the fields under about 560 px.

### A12 · S3 · Chapter title shows behind the sticky bar
- When scrolling into a chapter on desktop, the opener's 130 px title ("Green") peeks out above and around the "Colour Archive" wordmark. The sticky bar's band is the chapter colour, 150 px tall, but doesn't clip the title (`scrolled-desk-home.png`). A faint second capsule outline also shows under the Overview / Get the app / Insights group.

### A13 · S3 · Escape doesn't close Inspiration panels
- After opening Add (`#add-toggle`) and pressing Escape, the drop zone stays open with "Done" showing (`i-desk-insp-04-group-Photographer.png`). The same happens with Add a photographer. Every other overlay in the app closes on Escape.

### A14 · S3 · Empty Photographers shelf
- The shelf section is a heading, a rule and a button, with no names. Yet group-by Photographer shows "Adrien Sanguinetti 4". If the shelf means pinned favourites only, say so ("Pin someone to follow their new work"), or offer the credited names as one-tap pins.

### A15 · S3 · Night-vision offer outlives night mode
- `page.ts:9186`. The offer is shown while the night button is pressed and the *real* sun is down, but nothing hides it when night mode is turned off. It then sat over a daytime (11:24) eye-level view reading "It's dark out" (`i-desk-scout-05-eye-later.png`). Hide it on night-off. Also consider checking the *planned* minute rather than `new Date()`.

### A16 · S3 · Eye level ground
- At street level in the City, the ground is pale sky-blue with diagonal moiré bands, roads are white strips, and buildings have no ground contact shadow (`i-desk-scout-05-eye-later.png`). This happens on Metal ANGLE, not only SwiftShader, so it's not the software-GL artefact noted in round 2. Eye level was also noted as needing an iPad check.

### A17 · S3 · Timeline jump labels look like an axis
- The five jump buttons are spaced evenly under the day bar, but sunrise sits about 25% in and the golden bands sit elsewhere. Either place each button under its event (as a tick), or set them apart visually as buttons (chips) so they stop reading as an axis.

### A18 · S3 · Hotspot names
- "St Paul's Cathedral Nave, London, UK - Diliff": the photographer's handle and file-title punctuation are left in, and "6 photographers, 8 photos · terra…" is clipped. There's a `photoName`-style cleaner for Match; use it here, and drop the trailing " - Author".

### A19 · S3 · "In sun" under overcast
- The geometry says the pin is lit, but with 85% cloud, "In sun" and "lit until 16:12" overstate it. Suggest "Sunlit if it clears" or "Lit (overcast)" when cloud ≥ 70%.

### A20 · S3 · Cluster badges collide
- On desktop, "83" and "44" overlap near Tower Bridge. On the phone, "162" covers the pin diamond (`i-phone-scout-01-placed.png`). Raise the cluster radius, or set `icon-allow-overlap: false` with a pin-exclusion offset.

### A21 · S3 · Phone top bar wraps
- At 402 px: row 1 is All / Digital / Film / Genres plus the colour button; row 2 is three unlabelled icons (Overview, Get the app, Insights). That's 150 px of chrome on the cover. Fold row 2 into a single "⋯" menu, or into the colour button's row.

### A22 · S3 · Leaving Overview
- Overview from the cover scrolls you into the archive, and the top bar has hidden itself by then (`i-desk-home-03-overview.png`). There's no visible way back except scrolling up, tapping a tile or pinching. Keep the bar visible while in Overview, or show a "Done" pill.

### A23 · S3 · Small tap targets
Measured from the crawl (`report.json`):
- Archive colour strip `button.cs-seg`: 7 px tall on desktop.
- Spectrum rail `button.spectrum-seg`: 8 px wide on desktop, and 18–24 × 26 on the phone.
- Inspiration `button.credit`: 18 px tall. `button.cell-who`: 32×15.
- Book `button.book-dup`: 28×21. `book-dup-summary`: 20 px tall. `book-exclude`: 22×22 on the phone.
- Scout `mine-pin` markers: 22×22. `#dock-grabber`: 16 px tall on the phone (the visual handle can stay small, but the hit area should be ≥ 24).
- Add & remove `#manage-search-input`: 20 px tall inside its 36 px capsule. The capsule should be the hit area.

Pad the hit areas with `::before` insets, not the visuals.

### A24 · S3 · Unnamed links on the share view
- `src/pages/book/view.astro:62`: `<a href=…avif><img alt=""></a>`. Give the image `alt={photo name}` or the link an `aria-label`.

### A25–A35 · S4
- **A25** `/scout` and `/inspiration/add` have no `<h1>`. Use a visually hidden "Scout" or "Add to the board".
- **A26** Inspiration mixes boxed `.field` inputs ("Or paste a link", "Whose is it?") with an underline-only "Profile link or name". Use `.field` for both.
- **A27** The open state of "Add a photographer" shows "× Add a photographer". Say "Cancel".
- **A28** Book Print › Spine is a raw browser input (white border, no radius). Use `.field` and `-sm`.
- **A29** "34 photos may print soft" is orange text with nothing to tap. `#book-ppi-fix` exists, but it wasn't visible here.
- **A30** The cover line "110 · 8 chapters" should read "110 photographs · 8 chapters".
- **A31** In Insights › Colour, the Deep Yellow dot and bar are too dark on the dark background. Lift the swatch's lightness for display only.
- **A32** Globe ocean labels (OpenFreeMap's water labels) are white with a dark halo on light blue. Use a dark-blue text colour with no halo for `water_name`.
- **A33** The scale bar and ⓘ sit at y≈680 and 720 on the right edge, floating. Anchor them bottom-right above `--tabbar-space`.
- **A34** The lightbox counter pill's gradient edge bleeds over the photo. Use a solid capsule like the tool bar.
- **A35** Lint: remove the 4 useless assignments. The `any`s are mostly in `inspiration.astro` and `scout.astro` scripts and the test helpers.

---

## Checked and fine

- No uncaught page errors and no app console errors on any route or size, apart from A1.
- No horizontal page scroll on any route, on either size. Scout's haze canvas is wider than the viewport, but it's clipped.
- No duplicate ids in the rendered DOM, and no `<img>` without an `alt` attribute.
- Every lazy image loads when scrolled to. The blank areas in full-page captures of Add & remove, Inspiration and Book are capture artefacts of the develop-on-scroll reveal, not bugs.
- The lightbox opens, steps with the arrows and closes on Escape. Similar ("More like this") and Insights open and close. ⌘K opens and searches.
- Scout's deep link places the pin, the sun ring draws, 2D/3D and night toggle, and the Tools tabs switch.
- The Magazine's 8/16 pp, paper size, Colours, How to fold and page thumbnails all respond.
- All pages load quickly (25–200 ms to `load` on the dev server).

## Not app issues (seen, ignored)

- "SSL certificate error … sw.js": headless Chromium doesn't trust the dev CA, so the service worker can't register. This is known ([Local CA trust] memory).
- The Astro dev toolbar overlaps the tab bar in every dev screenshot. It's dev-only.
- WebGL "READ-usage buffer was written, then fenced" warning: a MapLibre-internal `readPixels` call, already noted in round 2.

---

## Fixed, 2026-11-10

All 35 items were worked through. `npm test` passes 2173 of 2173, `npm run check` is clean, and lint has 0 errors and 46 warnings. A re-crawl of every route on both sizes shows no page errors and no overflow (`design-shots/audit-11-after/`).

Where a fix differs from the suggestion above:
- **A2:** Commons is now a Layers toggle, "Include Wikimedia Commons", off by default. The default sources are archive-shared photos plus favourite photographers' geotagged Flickr work, read keylessly from their photostream RSS (`georss:point`).
- **A3:** a monochrome reference is compared only against monochrome archive photos. Today there are none, so it says "Nothing in the archive is black and white like this."
- **A4:** Remove now works as Remove → Undo, like Add & remove does.
- **A6:** search was in the Genres menu all along. The Genres button now carries a magnifier.
- **A7:** the query and Clear show in the strip, and the dot no longer shifts the bar. The lift cut is unchanged. Measured: valid "sea" hits go down to 0.025, while the wrong "temple" tail is 0.034–0.035, so no cut separates them.
- **A16:** the cause was OpenFreeMap's `road_area_pattern` hatch moiréing at a grazing angle (the pin is on London Bridge), not fog. The pastel map now draws pedestrian areas flat.
- **A17:** the jump words are pills in a centred row. They were not placed under their events because sunrise and golden hour collide in winter.
- **A19:** at 70% cloud or more it says "Open to sun" and "open to sun until …".
- **A35:** the 4 useless assignments and 4 easy `any`s are fixed. The rest are transformers.js model handles and untyped page-script JSON, left as they are.

Found on the way: `public/sw.js` served every own `.css` cache-first, so the dev server's `global.css` went stale. That caused the "empty cell next to 2D" in Scout. Now only `/_astro/` and `/img/` are cache-first. Also, Inspiration's Add button lost its + icon after the first open; fixed.
