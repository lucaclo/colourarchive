# Decisions

Settled calls, newest first within each section. Don't re-open one without a reason
from this session; if you do, say which line and why. Add new ones with the date.

## Product
- 2026-11-25 · Feedback from the app (`components/Feedback.astro`, `lib/feedback.ts`):
  pictures and a note, never sent to the public repo (screenshots show photos and places).
  A page the Mac serves keeps it on the Mac (`<data>/.archive/feedback/<id>/note.md`
  beside `1.jpg`…); the published site, which has no server, files an issue in the
  private `lucaclo/colourarchive-feedback` with a fine-grained token kept on that device
  (Contents and Issues, write, that repo only). `npm run feedback` is the one inbox.
- 2026-11-25 · Updates panel, on every page (`src/components/Updates.astro`): opened from
  the app menu's "Check for Updates…" (it no longer opens a dialog), ⌘K "Updates", and
  an Updates button in the Book's page head beside Share and Magazine (moved off the
  Archive's top bar the same day: it was in the way). Each device answers for
  itself. The Mac app: version, status, where it's installed (Show in Finder), when it
  last updated, and "Update now", which swaps and relaunches at once onto the same page
  with the panel open; asked from another device, the Mac comes back in the background.
  Phones and browsers: their own build and "Reload", which drops the saved offline copy.
  The Mac also lists the published build (Up to date or Behind its archive) and the
  devices that opened pages from it (`<data>/.archive/devices.json`: name, home-screen or
  not, last seen, build; never the user agent or address). The Mac can't see phones that
  load from Netlify. Pages served by the Mac reload themselves on return when its build
  changed. Every build bakes `version` and `builtAt` (`src/lib/build-info.ts`), and
  `publish.json` carries the same `builtAt`.
- 2026-11-24 · The Mac app also installs a downloaded update by itself at a quiet moment
  (#168; re-opens the 2026-11-17 line, which swapped only on quit or Restart to Update):
  10 minutes with no window in front, no request in flight (an upload, a book PDF), no
  scan or other busy job, and nothing from the phone. It reopens the page that was open,
  without taking focus, or comes back hidden. An update already downloaded goes in at
  launch, before the server starts. One try per version; every swap is logged in
  `~/Library/Logs/Colour Archive/update.log`.
- 2026-11-23 · Mac app releases are self-signed with one stable certificate, "Colour
  Archive Release" (20 years; kept as two repository secrets, never in the repo), so
  every build has the same designated requirement and macOS keeps its permissions
  across updates. The updater refuses a download that doesn't satisfy the running
  app's own requirement; a running ad hoc app skips that check, so the first signed
  release installs. Still no Developer ID (#167).
- 2026-11-18 · The published site keeps itself current on a phone: when a page comes back
  to the screen and `/publish.json` names a newer build, it reloads. The service worker
  never caches `/publish.json`; bump its `VERSION` to make every device drop its saved
  copy once (v2, 2026-11-18).
- 2026-11-18 · One archive (D1): the Mac app's folder, `~/Pictures/Colour Archive`, the
  same kind of folder anyone who installs the app gets. The repo's `photos/`,
  `public/img` and `src/data` are a development copy (the tracked JSON stays as CI's
  fixture). A public build on the Mac, `deploy:site`, `drift`, `check:photos` and
  `doctor` all read the app's folder (`src/lib/archive-home.ts`); `COLOUR_ARCHIVE_DATA`
  overrides it, and with neither they refuse. Nothing publishes by itself: the dev
  server's auto-deploy is gone (it published the checked-out branch from the copy).
- 2026-11-18 · Scout's "Stand here" (the eye button) puts the camera exactly at the pin,
  1.7 m above the real ground (no exaggeration). Drag or arrow keys turn the head,
  60° down to 30° up; the view reaches 150 km. While standing, walls are solid and lit
  windows and flat labels are hidden, and a tap doesn't move the pin. Escape leaves.
- 2026-11-18 · Scout elevation comes from Mapterhorn (open survey data, 512 px tiles).
  Missing deep tiles are cut from an ancestor, never left flat.
- 2026-11-18 · Satellite: where Esri has no imagery, the tile is cut from the nearest
  ancestor that has some (up to 8 zooms up), never Esri's grey placeholder.
- 2026-11-17 · The Mac app updates itself: every merge to `main` publishes release
  `v0.2.<run>` (`.github/workflows/app-release.yml`); the app checks 30 s after launch
  and every 4 h, downloads in the background, and swaps on quit or "Restart to Update"
  (`desktop/updater.cjs`, not electron-updater: unsigned). The app menu's line under
  About says the version and whether it is the newest.
- 2026-11-17 · The published Scout searches through a same-origin proxy rule
  (`public/_redirects`), not server functions, and reads Nominatim with the Mac's own
  parser (`src/lib/scout/nominatim.ts`). The rule ships inside `dist/client`, so a Drop
  deploy has search too.
- 2026-11-16 · The zine is kept on the Mac as `zine.json` in the data folder, with device
  photos in `<data>/.archive/zine/`, so every device opens the same one (D2, R13-41).
  Saves are versioned like the book. A browser's pre-round-13 zine moves across once;
  a second browser's own zine is offered ("Use it"), never dropped.
- 2026-11-16 · Removed originals stay in `Photos/.trash` until asked: a "Removed · N" link
  on Add & remove lists them with Restore and Empty. Nothing auto-empties (D4, R13-16).
  Empty deletes only the names the list showed.
- 2026-11-16 · Book saves merge and are versioned: a stale tab gets "Changed elsewhere ·
  Reload" and writes nothing; one `book.json.bak` is kept (R13-01, R13-31).
- 2026-11-16 · Writes to `/api` come only from this server's own origin, or with no
  Origin at all (Shortcuts, curl). No login (R13-02, `src/middleware.ts`).
- 2026-11-11 · Phone reaches the Mac from anywhere ("Mac as engine", Tailscale Funnel
  behind `desktop/remote-gate.mjs`). No cloud storage, no sync. Full editing on Netlify
  was rejected: fs-bound server, local ML models, function size limits.
- 2026-11-02 · No Flickr API (paid; tried). Hotspot and photographer sources are keyless.
- 2026-10-19 · Scout hotspots need a point of view, not documentation. Wikimedia Commons
  is an opt-in reference layer (`?commons=1`), off by default.
- 2026-10-09 · Single-user and local-first: no login, Stripe or email.
- 2026-09-28 · Photo locations are hand-placed (no archive photo has GPS), stored in the
  git-ignored `photos.locations.json`, Mac-only, never baked into the static build.
- 2026-07-31 · Scout: a tab inside the app; typed place + radius, draggable pin; sun
  direction plus real terrain and building shadows; weather only scales shadow strength;
  full date control.
- 2026-07-29 · Style Match: fully local, no network and no LLM in the advice path.
  RAW + JPEG; Lightroom cloud (not Classic) as the target; lives in the Inspiration
  board; faithful↔restrained slider; output is evidence, slider numbers, `.xmp`, and a
  live WebGL preview. Scope: colour, light, grain, vignette, texture/clarity,
  sharpening, NR.

## Design
- 2026-11-25 · Feedback is a round glass bubble after Add & remove in the tab bar (an
  action, so a button). On the published site it shows to a device with a token, while a
  draft waits, and in an installed copy (the home-screen app has no address bar for
  `#feedback`, and its own storage); a visitor in a browser never sees it. Up to 4 pictures; errors are the sheet's own
  quiet line ("Couldn’t send", reason on a tap) and the draft stays; sent is the "Sent"
  pill. At 400 px and under, tabs lose a little padding so the bar fits 375 px.
- 2026-11-18 · Big-title pages (Inspiration, Add & remove, the Book) share one column and
  one head: `--page-max` (68rem) and `--page-pad` (20 px on a phone, 48 px at the desk),
  `.page-head` with the count beside the title and icon-and-word actions that drop to the
  icon on a phone. The Book's head is `.page-head ph-static` (no fold).
- 2026-11-18 · Type roles, app-wide: the UI face for anything read or tapped, labels
  included; JetBrains Mono only for values; Fraunces italic for titles and notebook
  labels and notes. Never the system face in italic, never mono in italic. 11 px
  (`--t-caption-2`) is the dense tier: Scout's sheet, field labels, tab labels.
- 2026-11-18 · Copy: curly apostrophes; no em-dash asides in UI strings (a colon, a full
  stop, a comma or brackets instead); a count follows its label after a space, no "·"
  ("Removed 24", like "On a chapter edge 18").
- 2026-11-18 · Scout: moving the pin (a map tap, or "Scout here" from your photos) shows
  no note and no Undo. The pin and the sheet's new name say it moved.
- 2026-11-18 · Phone and tablet Archive: the top bar and tab bar slide away on scroll
  down and come back on scroll up (fade in place with Reduce Motion). Desk keeps them.
- 2026-11-18 · Scout's phone sheet has a "min" detent: a small centred tab with the
  place's short name and nothing else ("Repulse Bay", not "淺水灣 Repulse Bay": the half
  in the reader's script, then Latin; `scout/short-name.ts`). Tapping it opens peek. The
  grabber cycles min → peek → half → full; a pull past peek settles at min.
- 2026-11-17 · Scout's `.btn.ghost` (Tools-fold actions: Check now, Find dates…) is a
  clear capsule with a 26% `--fg` hairline; hover fills, pressed loses the line.
- 2026-11-17 · On touch, segments, tabs and small buttons answer out to their capsule's
  edge with an invisible `::after`. The drawn pill keeps its size; every control's target
  is ≥ 36 px on a phone (`node_modules/.cache/r13/phone-sweep.mts` checks).
- 2026-11-16 · Scout's five actions (month grid, save image, copy plan, copy link, save
  offline) open from a share button in the sheet head, beside the star. Layers holds only
  layers (D5, R13-34).
- 2026-11-16 · The Book may grow invisible hit areas (`::after`, padding) to 36 px on
  touch; its look stays (D3, R13-43).
- 2026-11-04 · Design system in `global.css` + `src/lib/ui/`: `.btn`, `[data-seg]`,
  `.field`, `[data-reveal]`, `.page-head`. Press feedback is `lib/ui/press.ts`; don't add
  `:active { transform: scale() }` rules (opt out with `data-no-press`).
- 2026-11-04 · Leave the Book page alone unless asked (overhaul reverted as "no value").
- Nov 2026 · Scout chrome is always dark; tools live in one Tools fold with icon tabs.
- 2026-10-13 · Errors are quiet: a small corner note, title only, reason one tap away,
  dismissible for the visit. Raw error text goes to the console. Only a truly blocking
  failure (no WebGL) may stay up.
- 2026-10-02 · Minimal text app-wide: labels, counts and actions. No kickers, ledes,
  keyboard hints or explanatory sentences; detail goes behind an info tip if anywhere.
- 2026-10-01 · "Darkroom notebook" look for Scout and Inspiration: sentence-case Fraunces
  italic labels, hairline rules instead of boxed cards, crop marks, contact-sheet
  captions, dotted leaders. Avoid em-dash-heavy, aphoristic copy.
- Phone controls use `var(--hit)` (36px), not literal 44px. Photos beat the HIG floor.
- New full-screen overlays carry `role=dialog` and `data-modal`.
