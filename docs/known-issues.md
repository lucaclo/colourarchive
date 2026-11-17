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

## Testing safely
- Don't test writes against the real archive (it auto-deploys). Use a throwaway
  `COLOUR_ARCHIVE_DATA` dev server on :4400, plus `COLOUR_ARCHIVE_INBOX` /
  `COLOUR_ARCHIVE_PHOTOS_LIBRARY`. The shell can't read iCloud Drive or Photos (TCC).
- The Book size select writes `src/data/book.json`; never change it against the dev
  server. `tests/features.e2e.ts` mocks saves.
- Probe scripts in `node_modules/.cache/audit-*.mjs` block non-GET requests, so they're
  safe on :4321.
- After `npm install`, restart the dev server: stale Vite deps give 504s and scripts that
  silently never run.
- macOS has no `timeout` command; a check wrapped in it silently never runs.
- `/api/scout/places` 500s in dev without Full Disk Access (can't copy Photos.sqlite).
  Not caused by UI changes.
- With `COLOUR_ARCHIVE_DATA` set, dev still serves `/img/*` from the repo's `public/img`.
  A probe that uploads to the throwaway server must route `/img/**` to the throwaway
  folder, or new thumbnails 404.
- `/api/photos` lists only dated photos (83 of 110). Count the store file
  (`.archive/src/data/photos.json`), not that endpoint. Film/Digital overrides live in
  `photos.overrides.json`, so the store's `medium` can differ from what the page shows.
- `POST /api/book` merges and is versioned since round 13: it needs the `version` from
  GET or the page (`data-version` on `#book-savebar`), answers 409 when it's stale, and
  keeps `book.json.bak`. Still copy `book.json` before a test that saves the book.
- `npm run check` (its `astro sync`) rewrites `node_modules/.vite/deps` under a running
  dev server. The server then 504s on deps such as `earcut.js` and Scout's page never
  runs. Run `check` last, or restart the server with `npx astro dev --force` after it.
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

## Publishing
- `netlify deploy` 500s/400s uploading the two Scout functions (server-side, since Aug
  2026). Deploy static-only with `--no-build --functions <empty dir>`.

## Open
- Tailscale isn't installed on the Mac yet, so phone-from-anywhere isn't live.
- The installed Mac app and the `v0.1.0` release that `/get` downloads are the 19 Oct
  build, with its own drifted data copy, and nothing auto-starts a server (R13-06, D1).
- `.ghost` buttons in Scout have no styles.
