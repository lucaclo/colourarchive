# Progress

## Now
- `main` at 1ea6032: round 12 shipped (phone from anywhere, phone a11y pass).
- Branch `workflow-omega`: this file, CLAUDE.md, worker agents, reflect skill.
- Branch `round-13` (from workflow-omega), pushed at ed6f4ed: the sweep in
  `replica/round-13/audit.md` and its fixes, batches 1–6 of `plan.md`. Everything but D1
  (R13-06) is done. Netlify is live with this build (2026-11-17, static-only deploy).

## Next
- Luca, D1 (R13-06): which data folder is the real one (repo vs `~/Pictures/Colour
  Archive`, which differ in 2 references and the photographers file); then rebuild the
  app from `main`, cut `v0.2.0` so `/get` hands it out, reinstall, Open at Login.
- PR `round-13` → `main` once `verify` is green.
- 9 files in the real archive belong to no entry: `npm run check:photos -- --orphans`.
- Install Tailscale on the Mac, switch on "Let My Phone In From Anywhere", redeploy.
- Style the `.ghost` buttons in Scout.
- Round 9 ideas not yet picked up: `replica/round-9/ideas.md`.

## Log
One line per session, newest first: date · branch · what changed · what's open.

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
