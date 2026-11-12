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

## Astro
- Scoped `<style>` doesn't reach elements built at runtime. Wrap those selectors in
  `:global(...)`. Symptom: UA-default styling, zero-width lazy images that never load.
- Astro trusts Host only for `allowedDomains`; behind a tunnel or in prod, POSTs get a 403
  origin error that dev never shows. The remote gate rewrites Host and Origin.
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

## Publishing
- `netlify deploy` 500s/400s uploading the two Scout functions (server-side, since Aug
  2026). Deploy static-only with `--no-build --functions <empty dir>`.

## Open
- Tailscale isn't installed on the Mac yet, so phone-from-anywhere isn't live.
- `.ghost` buttons in Scout have no styles.
