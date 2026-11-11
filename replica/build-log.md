# Build log

Branch `competitor-gaps`, 2026-10-09. Nothing committed (left for review).

| screen | date | status | what's missing | harder than expected |
| --- | --- | --- | --- | --- |
| S01 archive: colour search | 2026-10-09 | done | — | Plain OKLab distance found 1 red photo out of 10 in the Red chapter: k-means palettes are duller than what people pick on a wheel. Switched to hue-led matching plus the dominant colour as a zero-share accent; tuned until every chapter's photos are found by its own colour and a vivid version. Chroma slider rescaled to the archive's real range (0.02–0.09). |
| S01 archive: lightbox palette | 2026-10-09 | done | — | — |
| S03 inspiration: colour search | 2026-10-09 | done | — | — |
| S03 inspiration: batch Style Match | 2026-10-09 | done | — | Preset code moved into `match/preset-download.ts` so a batch preset is exactly a single one. Test downloads wrote calibration records; deleted. |
| S07 share-sheet page | 2026-10-09 | done | the Shortcut itself is made by hand once (README) | Shared links are usually pages, so the fetch follows `og:image`. |
| S05 book: spreads, layouts, print PDF | 2026-10-09 | done | — | Save replaces the curation wholesale, so layout rides along with every save. PDF writer streams to disk: 116 pages, 142 MB, 21 s. |
| S04 scout: meteor showers | 2026-10-09 | done | — | Leading with the highest ZHR picked a shower that peaked yesterday; leads with the best rate tonight at the pin instead. |
| S04 scout: eye level | 2026-10-09 | done | — | MapLibre's camera-from-position call put the centre 10 km away below sea level and broke the globe matrices; placing it by solved zoom works. Must wait for a DEM tile under the pin. |
| S06 zine: 16 pages | 2026-10-09 | **not built** | all of it | Needs duplex imposition (verified by a fold simulation), a new fold and cut, 7 spreads instead of 3, and a two-sided PDF with the right flip edge. A rework of the zine maker, not an option on it. |
