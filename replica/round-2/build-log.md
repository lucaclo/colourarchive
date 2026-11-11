# Build log, round 2

All on branch `competitor-gaps`, uncommitted, on top of round 1's
uncommitted work (left for review, as round 1 was). No per-screen commits:
nothing has been committed in this round.

| ID | date | status | what's missing | harder than expected |
| --- | --- | --- | --- | --- |
| speed: scrub | 2026-10-13 | done | | 86% of the scrub was one O(n²) loop (wall curtains). `BoundsGrid` in `shadows.ts`, with a test that it finds exactly what the full scan finds; ties broken by index so the answer is identical. 95 → 15.4 ms per slider minute |
| S03 ranked tray | 2026-10-13 | done | | the tray had to live in the topbar so it hides with it; sized to its content with a flex break |
| S02 popover | 2026-10-13 | done | | a Swatch passed as a query carries `share: 0`, which read as "wants none of the frame". Lone colours now drop it |
| lib multi-colour | 2026-10-13 | done | | share penalty tuned to 2 so an accent alone can't meet "half the frame"; 23/24 real two-colour photos found (the miss is a near-grey olive at the chroma floor) |
| S04 lightbox | 2026-10-13 | done | | |
| S02 suggestions | 2026-10-13 | partial | not on the inspiration board (it has no chapters) | |
| S11 attribution, labels | 2026-10-13 | done | | |
| S11 ring centring | 2026-10-13 | done | | not a fitBounds bug: the padding ease was cancelled by the fly-in and never retried |
| S11/S13 pins | 2026-10-13 | done | | |
| S13 tab bar, scale bar | 2026-10-13 | done | | |
| S10 empty state | 2026-10-13 | done | | kept spots already appeared; the headless profile just had none. Recents added |
| speed: load | 2026-10-13 | partial | MapLibre hillshade framebuffers (2.6–3.2 s in SwiftShader) and the globe readback (0.75–0.9 s) | removed: our shader compile stalls (0.7 s, and MapLibre's own 1.5 s that waited behind them), the WebGL probe context (0.36 s), the light-pollution decode (0.2 s, now a worker) |
| day sheet colour | — | not started | needs an iPad look first | |
