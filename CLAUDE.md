# Colour Archive

A personal photo archive and toolkit for one photographer (Luca). Astro 5 + Node server
run from the Mac; a static copy publishes to Netlify. Tabs: Archive (chapters by colour),
Book and Zine, Inspiration with Style Match (Lightroom look matching), Scout (sun, moon
and shadow planning on a MapLibre globe), Add & remove. Also an Electron Mac app.
The repo is public. Photos, locations and photographer lists stay out of git.

## Read first, every session
- `docs/progress.md` — where we are, what's next, a dated line per session
- `docs/decisions.md` — settled product and design calls; don't re-open them
- `docs/known-issues.md` — traps that fail silently, and how to check for them
- `npm run feedback` — notes and pictures Luca sent from the app, with picture paths to
  open. When one is fixed: `npm run feedback -- done <id> "Fixed in #…"`

## How we work: orchestrator and workers
- The main session plans, writes briefs and checks results. Hand bulk, well-specified
  work to the `builder` agent and diff review to the `reviewer` agent.
- Keep for yourself: design calls, anything touching WebGL/MapLibre custom layers,
  the Match model, and anything where the brief would be longer than the change.
  Workers run on the same model as the main session (`model: inherit`).
- Send research and wide code searches to `Explore` so only the summary comes back.
- Parallel builders only on files that don't overlap. Use worktree isolation otherwise.
- Every brief has: Goal, Files to read, Constraints (from decisions.md), and
  `Done when:` a command to run or a thing to see.
- Before accepting a worker's result, rerun its `Done when:` check yourself. On a
  fail, send it back with the output. Never pass a worker's report on unchecked.

### Brief template
```
Goal: <one sentence>
Read: <files, with line ranges when known>
Constraints: <relevant lines from docs/decisions.md and docs/known-issues.md>
Done when: <npm run … passes | a Playwright shot shows … | grep finds …>
Report: the commands you ran and their output, and the files you changed.
```

## Checks (the "Done when" toolbox)
| What | Command |
|---|---|
| Unit tests | `npm test` |
| Types + Astro scripts | `npm run check` |
| Lint | `npm run lint` |
| Build (CI `verify` = test + check + build) | `npm run build` |
| Scout smoke (network-dependent, not required) | `npm run smoke` |
| Accessibility, WCAG 2.2 AA on a phone | `npm run a11y` |
| Phone preview | `npm run mobile` |
| Photos vs manifest | `npm run check:photos` |
| Published vs local | `npm run drift` |
| Match accuracy | `npm run match:bench` |
| Health of the local setup | `npm run doctor` |

UI changes are done when a headless Playwright screenshot shows them, not when the
code looks right. See "Seeing the page" in `docs/known-issues.md`.

## Folder map
- `src/pages/` routes and API endpoints (`src/pages/api/`)
- `src/lib/` logic, tests beside it as `*.test.ts`; `lib/scout/`, `lib/match/`,
  `lib/ui/` (design-system scripts), `lib/photographers/`, `lib/floor/`
- `src/components/` shared Astro components (TabBar, CommandPalette, …)
- `src/styles/global.css` tokens and the design system
- `src/data/` generated manifest and book data (book.json is written by the UI)
- `scripts/` CLI tasks behind the npm scripts
- `tests/` Playwright e2e and the Scout smoke test
- `desktop/` Electron app and the remote gate
- `netlify/` functions for the static site
- `replica/round-N/` plans, audits and notes for each round of work
- `.claude/agents/` workers; `.claude/skills/` skills, including `reflect`

## Rules
- Branch per round or fix; `main` is protected and merges by PR with `verify` green.
- Commit or push only when Luca asks.
- Test against a throwaway data dir, not the real archive (see known-issues).
- Keep copy minimal: labels, counts and actions.

## End of every session
1. Add a dated line to `docs/progress.md` and update Next.
2. Add new settled calls to `docs/decisions.md` and new traps to `docs/known-issues.md`.
3. Run the `reflect` skill: propose the smallest edits to skills or this file, with the
   evidence from this session. Apply only after Luca says yes.
