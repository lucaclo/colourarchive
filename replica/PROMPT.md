# Prompt: improve Colour Archive with the Replica pack

Copy everything below the line into a new Claude Code session opened in this repo. Fill in the
two blanks under **This round** first. Leave them as they are to run a whole-app round.

---

Use the Replica pack to improve Colour Archive by learning from the best existing apps. Don't
clone any single app. For each area I name, find the best-in-class reference apps, work out
exactly what they do better, then adapt those patterns into my app in my own way. Work in
phases and stop at every ⏸ checkpoint unless I say "execute everything".

## This round

- **Focus:** ____ (e.g. "the Style Match workbench", "Scout at night", "the whole app")
- **Problem in my words:** ____ (e.g. "too cluttered", "too slow", "missing X"). Attach
  screenshots if you have them. Treat them as the starting evidence.

## What the app is (so you don't have to rediscover it)

Colour Archive is my own photography app, a web PWA used mainly on iPad (Astro 5, TypeScript,
MapLibre). It's single-user and local first: there's **no login, no Stripe, no email**, and
that is decided. The areas:

| area | route | main files |
| --- | --- | --- |
| Archive (hue-ordered scroll, colour search, lightbox) | `/` | `src/pages/index.astro`, `src/components/ColourFilter.astro`, `src/lib/colour-search.ts` |
| Inspiration board + Style Match workbench | `/inspiration` | `src/pages/inspiration.astro`, `src/lib/match/*` |
| Scout (sun, moon, shadows, weather, astro planning map) | `/scout` | `src/pages/scout.astro`, `src/lib/scout/view/page.ts` (~10k lines), `src/lib/scout/*` |
| Book (sequence, spreads, print PDF) | `/book` | `src/pages/book.astro`, `src/lib/book*.ts` |
| Zine maker | `/book/zine` | `src/pages/book/zine.astro`, `src/lib/zine/*` |
| Add & remove | `/upload` | `src/pages/upload.astro` |

Earlier rounds, read before starting:

- `replica/competitors.md`: rounds 1 to 3 of research and the outcome of each. Build on it,
  don't redo it.
- `replica/shortlist.md`: the last shortlist, what was built, deferred, and next candidates.
- `replica/round-2/`, `replica/round-3/`: recon, reports, before and after screenshots.
- My memory notes (MEMORY.md), especially the design rules below.

## The Replica pack, used in reverse

Eleven skills in `~/.claude/skills/`, in this order: replica-recon → architect → design →
build → backend → test → diff → entrepreneur → brand → launch → deploy. They are written for
cloning one app. Here the "target" is a different reference app per area, and the output is
improvements to my existing codebase. Read each SKILL.md and its bundled files first, and
follow them except where this table says otherwise:

| skill | what it means here |
| --- | --- |
| replica-recon | Research the reference apps per area. Write into `replica/competitors.md` as a new "Round N" section, not a new `recon.md`. Every claim gets a source link, and anything unverified is marked. |
| replica-architect | Where the change fits in the existing code. **Extend existing modules first.** Ignore the default stack (Next.js, Supabase): this is Astro plus local JSON. Pure logic goes in a small `src/lib/...ts` with a `.test.ts`. |
| replica-design | Adapt the pattern to my existing tokens in `src/styles/global.css` and my look. Don't make a new token file. Never copy a reference's pixels, branding, copy, icons or assets. |
| replica-build | Implement it. Cover empty, loading, error, a brand-new user, phone and iPad. |
| replica-backend | Only if genuinely needed, and **ask me first**. No accounts, payments or email. |
| replica-test | `npm test`, `npm run check`, `npm run lint`, a production build, and the e2e suites in `tests/` (not `e2e/`). Add tests where the project already has them. |
| replica-diff | Compare against the reference *pattern*, not a pixel layout score: where it matches, where it's better, what's still missing. Include before and after screenshots. `parity.py` is offline and fine to run. |
| entrepreneur → deploy | Only if I explicitly ask. Launch material stays a draft, and deploy runs dry first. |

Before running any script that makes network calls, installs packages, touches files outside
this repo, or deploys anything, tell me and wait. Web search for research is fine.

## Phases

**Phase 0: orient (no code changes).** Read the skills, the earlier rounds and the memory
notes. Map the focus area's code. Confirm a clean baseline: `npm test`, `npm run check`,
`npm run lint`, and `npx astro build --outDir node_modules/.cache/perf-build`. Screenshot every
screen in the focus area at iPad (1180×820) and iPhone 16 Pro sizes, and **measure** the
problem (panel height in px, controls per row, overlays per tile, ms per interaction). Numbers
beat adjectives.

**Phase 1: recon.** For each area in focus, find 3 to 6 references: direct competitors *and*
strong apps from outside photography whose patterns transfer. Last round's best were Apple
Weather (summary → modules → detail), Flighty (show only what this phase needs), Apple Maps,
Lightroom's grid, Apple Photos, Cosmos, Are.na and Canva. For each, capture the core loop, the
features and their depth, the interaction patterns, and the weaknesses from reviews and forums
(those are my openings). Run the **apple-design** skill's audit on my current screens too,
quoting the HIG file and heading for each finding.

**Phase 2: gap analysis and shortlist.** Per area: a matrix against the references, then
missing table stakes, where I already win (protect it), patterns worth adapting (the reference
app and the exact screen or interaction), and polish gaps. Score each candidate on impact 1–5,
effort S/M/L and fit. Write **at most 10** ranked items to `replica/shortlist.md`.

⏸ **Checkpoint 1:** show me the matrix summaries and the shortlist, then stop.

**Phase 3: build loop, one item at a time.** For each approved item: architect → design →
build → test → diff, then commit. ⏸ **Checkpoint 2** after each: what changed, which reference
inspired it, the diff verdict, and screenshots.

**Phase 4: refinement.** Walk the focus area as a new user against the best references, and fix
quick inconsistencies in layout, type, motion and wording. Then update `competitors.md`
(a "Round N outcome") and `shortlist.md` (built, deferred, next candidates), and save a
memory note for the round.

## My design rules (these override the references)

- **The darkroom notebook look.** Fraunces italic in sentence case for headings and labels,
  the system UI sans for controls and value rows, JetBrains Mono only for data. Hairline rules,
  not boxed cards. **No tracked uppercase labels.** The dark "Whisper" palette.
- **Minimal text.** Only labels, counts and actions. No explanatory sentences; put detail behind
  an ⓘ or a disclosure if it's needed at all. No em-dash-heavy or aphoristic copy.
- **Answer first, detail behind a tap.** One level of grouping, not a wall of folds (HIG:
  "no more than one disclosure button in a view").
- **Quiet errors.** A small corner note with the title only, the reason one tap away, and
  dismissible. Never a centre card, never raw error text (that goes to the console).
- **Phone sizing.** On ≤640 px the touch floor is `var(--hit)` = 36 px, by my request. Never
  hard-code 44 px there.
- **Never invent scores** (e.g. a "sunset quality" number). Guessed data must look different
  from measured data.
- The floating glass tab bar and the tokens in `global.css` are shared by every page.

## Working rules and known traps

- **Branch:** work on a feature branch, never on main. Make one commit per item with a clear
  message ending in the co-author line. Leave `replica/` untracked: it's large and the repo is
  public.
- **The dev server is HTTPS only** (`https://localhost:4321`). Verify with headless
  Playwright scripts kept in `node_modules/.cache/` (imports fail from the scratchpad), using
  `ignoreHTTPSErrors: true`. Hide `astro-dev-toolbar` before clicking anything near the tab bar.
  Use the iPhone 16 Pro descriptor without `defaultBrowserType`. Chrome MCP screenshots go blank
  when the window is backgrounded.
- **Never change saved settings in a test against the dev server.** The Book size select
  writes straight to `src/data/book.json`. If a data file changes, check `git diff src/data`
  and restore it from git. `tests/features.e2e.ts` mocks all saves and is safe to run.
- **Scout deep link:** `/scout?at=lat,lon&tz=Zone&n=Name&d=YYYY-MM-DD&t=MIN&r=KM`. `t` counts
  minutes from *solar* midnight. In dev, `window.scout.map()` and `window.scout.setMinute()`
  exist.
- **Scout smoke suite** (`npm run smoke`) takes more than 10 minutes and was already failing
  before round 3 (17 pass, 3 fail, 6 cancelled). Compare against that baseline, and prove a
  failure is old by running it on the previous commit with `git stash`.
- **Runtime-built DOM** in `.astro` files needs `:global()` styles. New `let` state in
  `page.ts` belongs at the top of the closure (beside `spotWindows`) to avoid TDZ errors.
  Opening a fold from code fires `toggle`, which opens its `.group` parent.
- **MapLibre:** check `getLayer` before `setPaint` or `setLayoutProperty`. Outside-click checks
  use `composedPath()`, because re-rendered children break `contains()`.
- **Report honestly:** when tests fail, give the output. When something was skipped or
  deferred, say so.

## Deliverables at the end of the round

1. `replica/competitors.md` with a new Round N section and its outcome, every claim sourced.
2. `replica/shortlist.md` with the matrix summaries, the ranked list and a status table
   (item, result, commit).
3. `replica/round-N/` with before and after screenshots and a short diff report per item.
4. Commits on a feature branch, with tests, check, lint and build all green, and the e2e
   suites compared against their baseline.
5. A plain-language summary for me: what changed on each screen, what was deferred, and what
   to do next.
