# Known issues and traps

Most of these fail silently: a wrong picture, no error. Each says how to check.

## Seeing the page
- The dev server on :4321 is HTTPS only. `http://localhost:4321` returns nothing and a
  headless shot comes out white. Nothing auto-starts it: check `lsof -iTCP:4321` first.
- Verify UI with headless Playwright (`ignoreHTTPSErrors: true`, wait ~1.2s, scroll with
  `mouse.wheel`). Scripts that import Playwright must live inside the project, e.g.
  `node_modules/.cache/`, not the scratchpad.
- The Chrome extension screenshots go black when its window is backgrounded. Prefer
  Playwright.
- Blank areas in full-page shots are usually the develop-on-scroll reveal. Check with a
  wheel scroll and `img.complete` before calling it a load failure.
- Scout in headless needs `--use-angle=metal` (or swiftshader, which is slow and sometimes
  blank: retake before concluding). Deep link:
  `/scout?at=51.5079,-0.0877&tz=Europe/London&n=London&d=2026-08-07&t=700&r=4`
  (`t` is minutes from solar midnight). Dev-only hooks: `window.scout.map()`,
  `window.scout.setMinute()`.
- Chrome on macOS 26 ignores Keychain trust for the local CA. Import it in
  chrome://certificate-manager. Don't use `security add-trusted-cert` from Claude.
- A dark strip of icons under the tab bar in a dev shot is Astro's dev toolbar,
  raised by a tap. Not in the app.
- iOS home-screen apps can report a bottom safe-area gap that isn't there. Never move
  a control by the measured `--vgap`: the tab bar went below the screen (fixed #162).
  Only Scout's map may reach into it. Desktop emulation can't show this; a phone can.

## Testing safely
- Don't test writes against the real archive (`~/Pictures/Colour Archive`, D1). Use a
  throwaway `COLOUR_ARCHIVE_DATA` dev server on :4400, plus `COLOUR_ARCHIVE_INBOX` /
  `COLOUR_ARCHIVE_PHOTOS_LIBRARY`. The shell can't read iCloud Drive or Photos (TCC).
  Plain `npm run dev` uses the repo's development copy, which no longer publishes.
- `check:photos` (`--fix`, `--prune` write), `doctor`, `drift`, `deploy:site` and any
  `PUBLIC_STATIC=true` build read the real archive, found from the app's settings.
  Point them elsewhere with `COLOUR_ARCHIVE_DATA` (or `COLOUR_ARCHIVE_PROFILE` for a
  fake settings file).
- `paths.ts` reads `COLOUR_ARCHIVE_DATA` once, when it loads. `astro.config.mjs` imports
  `publish.ts`, which loads it, so `static-archive.ts` must stay the config's first
  local import, and `use-real-archive.ts` each script's first import. Otherwise the
  build stamp counts one archive and the pages show another.
- The Book size select writes `src/data/book.json`; never change it against the dev
  server. `tests/features.e2e.ts` mocks saves.
- After `npm install`, restart the dev server: stale Vite deps give 504s and scripts that
  silently never run.
- macOS has no `timeout` command; a check wrapped in it silently never runs.
- `/api/scout/places` 500s in dev without Full Disk Access (can't copy Photos.sqlite).
  Not caused by UI changes.
- Copy a throwaway archive with `ditto <from> <to>`, not `cp -cR`: the clone nested the
  folder and dropped `.archive/src`, so the server showed no photos and every Archive
  e2e timed out. Check `curl -sk <origin>/ | grep -c 'class="frame'` before a run.
- A dev server another session started can't be stopped from this one. Start your
  own on a free port (`E2E_ORIGIN` points the e2e at it).
- Scout e2e treat a 502 from `/api/scout/weather` or `/seeing` as a problem; the Mac
  answers 502 when the forecast service drops out. Rerun that one test
  (`--test-name-pattern`) before blaming the change.
- With `COLOUR_ARCHIVE_DATA` set, dev still serves `/img/*` from the repo's `public/img`.
  A probe that uploads to the throwaway server must route `/img/**` to the throwaway
  folder, or new thumbnails 404.
- `/api/photos` lists only dated photos (83 of 110). Count the store file
  (`.archive/src/data/photos.json`), not that endpoint. Film/Digital overrides live in
  `photos.overrides.json`, so the store's `medium` can differ from what the page shows.
- On the :4400 throwaway archive, `features.e2e.ts` F01-E2 and R2-F01-E1 fail on `main`
  too: `#00ff00` matches photos there, so the "nothing has it" state never shows.
- `*{animation:none}` doesn't reach `::before`/`::after`: the Archive cover's scroll hint
  kept looping, and a page a failed test left open starved every later Scout test under
  SwiftShader. Close contexts in `afterEach`, and include the pseudo-elements.
- `POST /api/book` merges and is versioned since round 13: it needs the `version` from
  GET or the page (`data-version` on `#book-savebar`), answers 409 when it's stale, and
  keeps `book.json.bak`. Still copy `book.json` before a test that saves the book.
- `npm run check` or `npm run build` (both run `astro sync`) rewrites
  `node_modules/.vite/deps` under a running dev server. The server then 504s on deps
  such as `earcut.js` and Scout's page never runs. Run them last, or restart the server
  with `npx astro dev --force` after.
  `npx tsc --noEmit` and `npx tsx scripts/check-astro-scripts.ts` are safe with the
  server up; only `astro sync` breaks it.
- Run long Playwright suites under `caffeinate -i`. The Mac sleeps while a turn waits,
  a test stalls ~16 min and then fails mid fly-in (the dev log shows a 17-minute request).
- Editing a source file while an e2e runs on the shared :4400 server hot-reloads the
  page mid-test and drops pending work. Don't edit during a run, or give it its own port.
- The zine lives on the Mac since round 13, so a new browser context opens the last
  saved zine, not a blank one. Tests reset `<data>/.archive/zine.json` or set the format.
- `/get` offers "Download for Mac" to every Mac user agent, Chromium's headless default
  included. Test the Chrome and Firefox paths with Windows user agents.
- Every write to `/api` needs this server's own Origin (or Referer), or none at all
  (`src/middleware.ts`). A curl test sends `-H "Origin: https://localhost:4400"`;
  Playwright's request context JSON-encodes a string body, so send a Buffer.
- Code passed to `page.evaluate` from a tsx-run test can't define named inner
  functions (tsx adds a `__name` helper the page lacks). Pass a string instead.
- Six parallel workers on the main model ran out the 5-hour usage limit twice, with
  nothing saved. For a sweep, run scripted probes from the main session, or at most two
  workers that each write findings to a file as they go.

## Type and alignment
- `[data-seg]` prepends a `.seg-thumb` span (`lib/ui/segments.ts`), so `:first-child`
  on its items never matches. Use `:first-of-type`. Scout's Sun tile sat 10 px in.
- In `inspiration.astro` the "Last of the tracked capitals" block comes after the
  notebook block and wins. A notebook label listed there falls back to the system
  face in italic at 12 px.
- JetBrains Mono ships no italic: a count inside a Fraunces italic heading renders
  fake-oblique. Give data spans in italic headings `font-style: normal`.
- To check type across the app, run `node node_modules/.cache/type-audit/probe.mjs <out>`
  then `summarize.mjs <out>` (in the same folder): faces outside the three, sizes off
  the scale, tracked capitals, mono words, system italic, and stacked text that starts
  1 to 6 px apart. `states.mjs` does the same for menus, sheets and Match.
- A probe that clicks inside Add & remove's grid can remove photos. Mock every non-GET
  `/api` request in a probe, not a list of routes.
- A fixed or absolute pill at `left: 50%` with `translate(-50%)` only shrink-wraps into
  half the screen and wraps its text. Give it `width: max-content; max-width: calc(100% - 2rem)`.

## Astro
- Scoped `<style>` doesn't reach elements built at runtime. Wrap those selectors in
  `:global(...)`. Symptom: UA-default styling, zero-width lazy images that never load.
- Astro trusts Host only for `allowedDomains`; behind a tunnel or in prod, POSTs get a 403
  origin error that dev never shows. The remote gate rewrites Host and Origin.
- `npm run preview` refused every write until `localhost` was in `allowedDomains`: a prod
  build reads the request as "localhost" with no port, so `src/middleware.ts` saw the
  browser's real Origin as another site. Check any build with a POST carrying its own
  Origin: 400 from the route means it got through, 403 means it didn't.
- `public/sw.js` must keep only `/_astro/` and `/img/` cache-first, or dev CSS goes stale.
- `.claude/hooks/security_reminder_hook.py` blocks any Write/Edit whose text contains one
  of its listed risky substrings, even in docs or comments. Read its `substrings` lists
  before writing about them. Build DOM with `createElement`; spawn with `execFile`.

## MapLibre / WebGL
- Add sources and layers on `style.load`, not `load`.
- `setPaintProperty` on a missing layer fires `error` instead of throwing: check
  `getLayer` first.
- Vector tiles load in a worker; they don't show in main-thread resource timing.
- Custom layers get a zero-width `depthRange`, clears are masked like draws, and MapLibre
  caches GL state: set `depthRange(0,1)`, open masks before clearing, save and restore
  everything. Verify by reading pixels.
- Don't expand screen-space line ribbons in a custom layer (hung the GPU process).
- Clustered HTML markers must rebuild on `render` with a dirty flag; images inside
  markers and popups need eager loading.
- `fitBounds` throws ("reading 'center'") when its padding plus the map's own padding
  leaves no room, which happens on a phone with the sheet up. Anything after it in the
  same function never runs (R13-30). Guard `cameraForBounds` and fall back to `flyTo`.
- Esri imagery sends a 2,521-byte grey "Map data not yet available" JPEG with HTTP 200
  where it has none. `?blankTile=false` gives a 404 instead, but that 404 has no CORS
  header (a console error per tile). `satellite-protocol.ts` spots the size and uses an
  ancestor tile instead.
- Mapterhorn elevation stops at different depths by place (z17 Alps, z16 Lake District,
  z12 Patagonia) and 404s below that; `terrarium-tile.ts` cuts the tile from an ancestor.
  The east–west stripes over Patagonia are in Mapterhorn's data, not our decoding.
- `queryTerrainElevation` returns 0, not null, before the terrain tiles load. Wait for
  `idle` or terrain `sourcedata` before placing anything on the ground.
- Standing (Eye level), MapLibre's tile zoom fails both ways. Its glancing-angle penalty
  uses the camera's height over the centre, about 0, so every tile came in at z0.
  `setSourceTileLodParams` zeroes the penalty only at one exact value (horizon 89.25°);
  just off it, it becomes a boost of ~25 zooms and the page locks up. Use the
  per-source `calculateTileZoom` hook (`eye-camera.ts`).
- Terrain draws draped layers into a pool of 30 textures. Each unbroken run of draped
  layers is a "stack", and stacks steal each other's slots: with 2 or more stacks, or
  more than ~28 terrain tiles, every tile redraws every frame (220 ms against 18).
  Check `map.painter.renderToTexture._stacks.length` and
  `map.terrain.tileManager.getRenderableTiles().length`. `keepDrapedTogether` in
  `view/page.ts` keeps one stack: on every style change it lifts each non-draped layer
  (circle, symbol, fill-extrusion, custom) above all draped ones. So a new layer's
  `beforeId` only orders it among layers of its own kind.
- `getStyle().layers` leaves out custom layers; `getLayersOrder()` has them all.
- ScaleControl's move handler calls `unproject`, which with terrain reads pixels
  back from the GPU (185 ms per move while standing). Standing removes it.
- MapLibre bug: past the elevation's maxzoom, `getTerrainData` assumes the elevation
  tile is the overscaled tile's own parent, so a coarser one floats buildings off the
  hillside. Keep each source's tile zoom at or under its own `maxzoom`.
- `getCameraAltitude()` is NaN on the globe transform. Work it out from
  `transform.elevation`, pitch and `cameraToCenterDistance`.
- Under SwiftShader (no GPU) the 2D map takes 0.6 s a frame and standing 2.5–6.5 s
  while tiles load. The page freezes, Vite's reload socket drops, and the console fills
  with "send was called before connect". Run eye-view tests on Metal (`gpu: true` in
  `tests/features.e2e.ts`).
- Arrow keys step Scout's time from a document keydown handler. Anything else using
  arrows (standing, night free-look) needs a capture-phase listener and
  `stopImmediatePropagation`.

## Publishing
- Netlify's upload refused the two Scout functions from Aug 2026, so there are none now:
  the published Scout reaches Nominatim through `public/_redirects` (`/nominatim/*`,
  200 proxy) and parses in the page. Don't add a functions directory; every
  `netlify deploy` would try that upload again. `npm run drift` says whether the proxy
  answers.
- A Netlify proxy forwards the query string as is; Nominatim answers it from Netlify's
  IPs. If it ever starts refusing, Photon (komoot) sends CORS headers and needs no proxy.
- "Netlify looks old": compare it with the Mac app (`127.0.0.1:43210`, the real archive),
  never with :4400, which is often a session's test server on a throwaway archive
  (`ps eww <pid>` shows its `COLOUR_ARCHIVE_DATA`). The public site has only the Archive,
  Scout, `/get`, `/book/view` and the 404.

## Mac app updates
- `app.getVersion()` in a packaged app reads `Contents/Resources/app/package.json`, not
  Info.plist. A hand-made test version needs both changed, then `codesign --force
  --deep -s -`. `node_modules/.cache/updater/e2e.mts` does the whole round trip in scratch.
- An app relaunched by `open` gets no environment: test copies pass `COLOUR_ARCHIVE_*`
  through the install script (`open -n --env`), or the relaunch opens the real profile.
- Each build is signed ad hoc, so macOS may ask again for Location, Microphone or a
  protected folder (Desktop, Documents) after an update.
- GitHub refuses retired runner images (`macos-14` failed the first release). The
  release job runs on `macos-latest`.

## Open
- Tailscale isn't installed on the Mac yet, so phone-from-anywhere isn't live.
- Nothing publishes by itself since D1: after photo changes in the app, run
  `npm run deploy:site` (`npm run drift` says whether the site is behind). Publishing
  from the app itself isn't built: it would need the app to reach the repo on the
  Desktop (a TCC prompt after every self-update) and run its build.
- Standing doesn't model the earth's curve: peaks 100 km off are drawn ~0.45° high.
