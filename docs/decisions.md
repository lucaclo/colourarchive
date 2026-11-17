# Decisions

Settled calls, newest first within each section. Don't re-open one without a reason
from this session; if you do, say which line and why. Add new ones with the date.

## Product
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
