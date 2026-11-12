---
name: reflect
description: End-of-session review for Colour Archive. Lists what went wrong or took too long this session and proposes the smallest edit to a skill, agent, CLAUDE.md or docs/ that would have prevented it. Use when wrapping up, or when asked to "reflect".
---

## Steps
1. Go through this session and list each thing that went wrong or took too long:
   a wrong first guess, a check that failed, a worker sent back, a trap rediscovered,
   a question Luca had to answer twice. One line each, with the evidence (command,
   error, or what Luca said).
2. For each, find the file that would have prevented it:
   - wrong steps or missing check → the skill or agent file
   - a trap that cost time → `docs/known-issues.md`
   - a call Luca made → `docs/decisions.md`
   - how we work → `CLAUDE.md`
   - repeated exact steps → a script in `scripts/`, called from the doc
3. Propose the smallest edit for each: show the file and the exact lines to add, change
   or delete. Prefer deleting or tightening over adding. Skip anything that happened once
   and won't recur.
4. Also propose lines to cut: anything in CLAUDE.md or docs/ that's stale, said twice,
   or that you'd do anyway without being told.
5. Update `docs/progress.md` (dated log line, Now, Next). This one needs no approval.
6. Stop and wait for Luca's OK. Apply only the approved edits.
