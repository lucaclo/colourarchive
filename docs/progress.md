# Progress

## Now
- `main` at 57be6ec: polish-type (#164) and phone-fixes (#165) merged. Netlify has the
  2026-11-18 19:50 build, made from `~/Pictures/Colour Archive`: 110 photographs, search
  live. Luca's installed app is 0.2.4; v0.2.7 is out ("Restart to Update").
- CI `smoke` fails in the same 15 Scout tests on `main` as on #163 (not required,
  network-dependent); worth a look.

## Next
- Feedback (branch `feedback`, not committed): to use it from the phone, make a
  fine-grained token (the sheet's "New token" fills in the form; pick only the
  `colourarchive-feedback` repo), paste it once in the phone's app (bubble, or
  `#feedback` in a Safari tab), then `npm run deploy:site`. The Mac app gets the bubble,
  Help › Send Feedback… and the window picture with the next release after merge.
- Luca: publishing is now by hand (`npm run deploy:site`). Want the app to publish on
  its own after a photo change? It needs a one-time Desktop permission, asked again
  after each update, or the repo moved off the Desktop.
- The repo's own `photos/`, `inspiration/`, `public/img` (1.0 GB) are now only a dev
  copy; they could go once round 14 ships. Backup of the 2 replaced files:
  `~/Pictures/Colour Archive/.archive/.before-merge-2026-11-18/`.
- 9 files in the real archive belong to no entry: `npm run check:photos -- --orphans`.
- Install Tailscale on the Mac, switch on "Let My Phone In From Anywhere", redeploy.
  Needs Luca: `brew install --cask tailscale-app` asks for his password, then sign-in,
  and the new app build (the 19 Oct app has no such menu item).

## Log
One line per session, newest first: date · branch · what changed · what's open.

- 2026-11-25 · feedback · Feedback from the app: a bubble beside the tab bar (also ⌘K,
  Help › Send Feedback…, `#feedback`) opens a sheet for up to four pictures (Add, paste,
  drop; the Mac app starts with a picture of its window) and a note, sent with page,
  device, window and build. Pages the Mac serves keep it in `.archive/feedback/`; the
  published site files an issue in the new private repo `lucaclo/colourarchive-feedback`
  with the device's token. `npm run feedback` pulls issues in and lists what's open with
  picture paths; `done <id>` closes. Checked: 2364 unit, feedback e2e 10/10 three runs
  (Mac and published servers), a11y clean incl. the open sheet, shots desk/phone/375 px,
  one real issue filed, pulled and closed (then deleted); reviewer pass, 8 small fixes
  (freeze while sending, rate-limit 403 keeps the token, 413 cap). Not run: the capture
  inside a packaged app.

- 2026-11-25 · fix/updates-to-book · The Updates button moves from the Archive's top bar
  (in the way) to the Book's page head, beside Share and Magazine. The published site has
  no Book page, so a phone on Netlify opens the panel only through `#updates`.
- 2026-11-25 · updates-panel (stacked on mac-signing: #167/#168 committed locally as
  3c4fb27 at Luca's say-so) · Updates panel on every page: app menu "Check for Updates…",
  ⌘K "Updates", the Archive top bar in the app window. The Mac app shows version, status,
  where it's installed (Show in Finder), when it last updated, and Update now (swap and
  relaunch at once onto the same page with the panel open); phones and browsers show
  their own build and Reload (drops the saved copy). The Mac lists the published build
  and devices that opened pages from it. Builds bake version + builtAt. Checked: 2341
  unit, panel e2e 12/12 three runs, a11y, shots at desk and iPhone, the scratch round
  trip with a new Update Now step. Merged as #182, released as v0.2.12 and installed on
  the Mac (08:15). Found: `~/Desktop/Colour Archive.app` was a Chrome shortcut to the dev
  server (localhost:4321), not the Mac app; Luca deleted it.

- 2026-11-18 · phone-refresh · Luca's phone still looked old after the deploys. Service
  worker v2 (every device drops its saved copy once; `/publish.json` never cached) and the
  published pages reload themselves on return to the screen when a newer build is live.
  Checked in WebKit at iPhone size against a local v1 → v2 switch and a newer stamp.
- 2026-11-18 · phone-fixes · Chapter count: number in mono, "photographs" in the UI face.
  The offline pill and Scout's note no longer wrap at half width on a phone (`left: 50%`
  shrink-wrap). "Netlify looks old" was a comparison with :4400, another session's test
  server on a throwaway archive (114 photos); Netlify matched the Mac app exactly.
- 2026-11-18 · polish-type · Type, alignment and copy pass over every page and state
  (probes in `node_modules/.cache/type-audit/`). Buttons no longer fall back to Arial;
  Inspiration, Add & remove and the Book share one column and head (the Book's count
  beside its title, Share and Magazine as icon buttons on a phone); Scout's sheet text
  on one left edge (tiles were 10 px in, times 2 px), slider labels out of mono, the ND
  field a well like the selects; Match labels back in Fraunces italic; zine Remove styled;
  "NaN m" scale hidden; 404 and Insights lose their explanatory lines; curly apostrophes
  and no em-dash asides in ~130 UI strings (a builder did the lib ones). e2e 44/44 on a
  throwaway archive (one Scout rerun after an upstream 502). Merged as #164; Netlify
  deployed from `main`.
- 2026-11-18 · remove-pin-undo · Scout's "Pin moved · Undo" note is gone (map tap and
  "Scout here" from a photo); the R13-32 and R14 tap e2e now check the sheet name.
- 2026-11-18 · round-14 · Shipped the phone tab bar fix (#162). Built: Archive bars hide on
  scroll; Scout sheet min detent; no Esri grey tiles; Mapterhorn terrain with ancestor
  fill; "Stand here" at 1.7 m with head-turn drag, 150 km view, still frame 16–19 ms, a
  drag 0.7–0.9 s (was 5–11 s). Checked with WebGL shots in 5 places and on a phone.
  Then: one draped stack in every view (3D scrub redraws 35–50 → 4–5 tiles a step; the
  pictures are the same apart from the sun-path end dots, no longer half covered);
  night free-look arrows no longer scrub the time; features e2e 28 min → 2.5 min
  (pages closed after each test). Later: the minimised sheet is a small tab with the
  short name only (Repulse Bay). D1 settled: `~/Pictures/Colour Archive` is the one
  archive (repo's 2 Fan Ho refs, photographers file and caches merged in); public builds,
  publish, drift, check:photos and doctor read it; dev auto-deploy removed. Proved by
  a public build from a test archive (stamp, cover and images all followed it); drift
  says the live site matches. Shipped: #163 merged, v0.2.6 released, Netlify deployed
  from the real archive and confirmed live.
- 2026-11-17 · round-13 · The Mac app updates itself from GitHub releases, one per merge
  to `main`; the app menu shows "Up to Date · Version 0.2.N". Checked end to end in
  scratch (0.2.0 → 0.2.1, relaunch, up to date). Not yet run on GitHub; the installed
  app (0.1.0) needs the first 0.2.x installed by hand once.
- 2026-11-17 · round-13 · Scout search is back on the published site: `/nominatim/*`
  proxy in `public/_redirects`, parsed in the page by the Mac's parser
  (`scout/nominatim.ts`); the two Netlify functions are gone, so a plain
  `npm run deploy:site` works again. Scout `.ghost` buttons styled. Round 9 ideas: all
  built already (#7 sky-check is #143). Deployed and checked live on a phone viewport.
- 2026-11-17 · round-13 · Finished 3f (Scout touch sizes) and 6c (share menu); review of
  6a/6b found 3 data-loss paths (failed zine move saved a blank zine, a second browser's
  zine stranded, Restore deleting a lone original) and 9 smaller ones, all fixed with
  tests. Saves checked on `npm run preview` and the app build. Phone sweep: every
  control ≥ 36 px. Older e2e brought up to date (`/get` Mac path, server zine). Pushed
  and deployed. D1 open; a short revealed Inspiration tile puts its credit mid-photo.
- 2026-11-16 · round-13 · Batches 1–6 built (D2–D5 decided): versioned book saves, origin
  lock, clean imports, Scout phone search, phone reach, keyboard, words, zine on the Mac,
  Removed list.
- 2026-11-13 · round-13 · Whole-app sweep on a throwaway copy (desk, iPad, phone): 4 S1,
  1 S2, 17 S3, 21 S4. Plan written. Nothing fixed yet; D1–D5 open.

- 2026-11-12 · workflow-omega · Orchestrator/worker setup: CLAUDE.md, docs/, builder +
  reviewer agents, reflect skill, effort and autocompact settings.
- 2026-11-11 · round-12 · Mac-as-engine remote gate, `npm run a11y`, phone tab bar gap.
- 2026-11-09 · round-10 · Round 11 audit, all 35 items fixed (`replica/round-11/`).
- 2026-11-04 · round-10 · Design system pass; Book overhaul reverted.
- 2026-11-02 · round-10 · Favourite photographers, keyless sources, monochrome Match.
- Oct 2026 · rounds 4–9 · Match accuracy model, colour search, book spreads, zine, ⌘K,
  Scout map-first. Notes per round in `replica/round-N/`.
- Jul–Sep 2026 · Style Match, Scout, Mac app, UI overhaul.
