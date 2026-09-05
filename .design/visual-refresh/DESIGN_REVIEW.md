# Design Review: Visual Refresh (Whisper, extended)

Reviewed against: DESIGN_BRIEF.md
Philosophy: Refined editorial/archival minimalism — Whisper, evolved, not replaced.
Date: 2026-08-21

## Screenshots Captured

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-archive-cover-desktop-1280.png` / `-tablet-768.png` / `-mobile-375.png` | 1280 / 768 / 375 | Cover frontispiece — thicker spectrum, bigger title ceiling |
| `screenshots/review-archive-chapter-desktop-1280.png` / `-tablet-768.png` / `-mobile-375.png` | 1280 / 768 / 375 | "Deep Yellow" chapter, post-entrance |
| `screenshots/review-archive-topbar-hover-desktop-1280.png` | 1280 | Topbar link hover, accent-mix engaged |
| `screenshots/review-archive-lightbox-desktop-1280.png` | 1280 | Lightbox open, accent-hair on tool buttons |
| `screenshots/review-archive-insights-desktop-1280.png` | 1280 | Insights overlay (unmodified content, accent-aware close button) |
| `screenshots/review-upload-desktop-1280.png` / `-tablet-768.png` / `-mobile-375.png` | 1280 / 768 / 375 | Add & remove, dropzone + manage grid |
| `screenshots/review-inspiration-desktop-1280.png` / `-tablet-768.png` / `-mobile-375.png` | 1280 / 768 / 375 | Reference board |
| `screenshots/review-scout-desktop-1280.png` / `-tablet-768.png` / `-mobile-375.png` | 1280 / 768 / 375 | Map (viewport-only — full-page on a full-bleed map isn't meaningful) |

> All screenshots are in `.design/visual-refresh/screenshots/`.

## Summary

All ten `TASKS.md` items are built and verified: typecheck clean, all 1353 unit tests passing, and all four pages captured error-free at three breakpoints. The two riskiest items — accent contrast across the full hue wheel, and the chapter-gap sync bug — were checked numerically and fixed rather than assumed. Two pre-existing issues turned up during the screenshot pass that are unrelated to any file this brief touched; noted below rather than silently fixed, since fixing them wasn't in scope.

## Must Fix

None found. No broken functionality, no accessibility failures, no major deviation from the brief.

## Should Fix

1. **Topbar brand wraps to two lines ("COLOUR" / "ARCHIVE") at the ~768px tablet width.** See `screenshots/review-archive-cover-tablet-768.png`. This is a pre-existing layout gap between the "hide brand under 640px" rule and full desktop width — `.brand`'s sizing/white-space was never touched by this brief (only its hover/focus *colour* was), so this isn't a regression from this pass. _Fix: give `.topbar .brand` a `white-space: nowrap` and let it shrink via `font-size` or abbreviate, the same way `.topbar a` already handles small widths — but that's a structural nav change, which this brief explicitly excluded. Worth its own small follow-up._
2. **Upload's manage-grid genre badges show overlapping/truncated text on some cells** (visible as stray "ELLOW" fragments in `screenshots/review-upload-desktop-1280.png`, lower rows). `.manage`/`:global(.cell-genre)` weren't touched by this brief — pre-existing. _Fix: needs its own investigation into the badge's overflow/z-index handling; out of scope here._

## Could Improve

1. **Motion timing is unverifiable from stills.** The chapter-wipe reveal (title/index rise, 650–750ms) and the cover's staggered entrance (80–860ms) are both by-design subtle — a screenshot can't show whether the *felt* timing lands right. Worth Luca doing one live scroll-through before considering this fully settled.
2. **`--accent-hair` on Inspiration's structural dividers (`mx-panel`, `mx-tabs`, etc.) is a small shift from the plain `--hair` it replaced** — by design (it's a hairline, not a focal point), but worth a live look against a busy, colourful board to confirm it registers at all rather than reading as noise.
3. **Scout's accent tokens are wired but permanently inert** (no natural colour source on that page, per the brief). If Scout ever wants its own colour moment, the sun/light data it already computes could be a legitimate future source — new scope, not this brief.

## What Works Well

- **The accent chain is measurably robust, not just eyeballed.** Computed contrast (via `culori`, matching the exact `color-mix(in oklab, …)` formulas) holds 12.4–13.0:1 for `--accent-mix` against `--bg` across all 12 chapter hue bins *and* the achromatic chapter — nothing close to a legibility risk anywhere on the hue wheel.
- **The real defect behind "flat crossfade" got found, not just reskinned.** The ambient wash previously lagged a chapter behind because it only updated once a photo (not the gap itself) was centred — fixed at the source via a `.chapter-gap` IntersectionObserver, which also let the title/index get a genuine entrance instead of a static appearance.
- **The cover reads as a frontispiece now.** Thicker spectrum band, a higher title-size ceiling, and a wider choreography stagger are all visible in the cover screenshots at every breakpoint tested.
- **Propagation to Inspiration/Upload used real data, not an invented signal** — both seed `--accent` from their own manifest's first chapter, the same colour language the archive itself speaks. Scout was correctly left with no accent source rather than forcing something contrived, and documented as such.
- **Caught its own bug during the accessibility pass**: a CSS specificity conflict would have left the cover title briefly invisible under `prefers-reduced-motion: reduce` before popping in. Found by reasoning through the cascade, not by luck, and fixed before this review.
- **Zero regressions**: 1353/1353 tests passing, clean typecheck, no console or page errors across 4 pages × 3 breakpoints.
