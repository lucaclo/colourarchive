# Bugs, round 2

All reproduced, all fixed in the working tree (uncommitted, so no commit
hashes). Each has a test that failed before its fix.

| ID | sev | bug | steps | expected | actual | fix | test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | S2 | Scrubbing time in a dense city stutters | central London z15.4, drag the time | under 16 ms a minute | 95 ms: every building tested against every shadow box | `BoundsGrid` in `shadows.ts` | `shadows.test.ts › BoundsGrid`; profile 15.4 ms |
| B2 | S3 | The sun ring sits half under the panel on desktop | open a place on a ≥821 px screen | ring centred in the free map | the padding ease was cancelled by the fly-in and never retried (pin at x=698, free centre 911) | retry on `moveend` when padding didn't land | R2-S-H3 |
| B3 | S3 | A layer slip shows as "The basemap could not load" in a big card | load Scout (the user's screenshot: "Cannot style non-existing layer scout-tree-crowns") | nothing shown; the basemap is fine | MapLibre fires `error` for a missing layer instead of throwing, so the try/catch never caught it, and the message matched `/style/` | setters check `getLayer` first; the handler ignores layer slips | R2-S-N3 |
| B4 | S3 | Tapping a colour's share caption closes the popover | open the colour popover, tap "any" under a chip | share cycles, popover stays | the chips re-render, the clicked button leaves the document, and "click outside" fired | `composedPath()` in place of `contains` | R2-F03-H2 |
| B5 | S3 | The data credit opens across the map on desktop | open Scout at 1440 px | folded ⓘ | a 1,270 px mono bar; MapLibre re-opens it after `load` when a source brings its credit | fold whenever MapLibre opens it, until opened by hand | R2-S-H1 |
| B6 | S3 | "Sunset" clipped in the panel | desktop panel, 360 px | all words visible | scroller with no fade on desktop | spread to fit; Dawn/Dusk drop below 380 px | R2-S-H2 |
| B7 | S3 | Places opened from a link were never remembered | open `/scout?at=…`, come back later | London under Recent | `save()` doesn't run on link arrival | remember on link arrival and on every `setCentre` | R2-S-H5 |
| B8 | S4 | The colour URL reads `colour=3f6f8f%2Cc0563b` | pick two colours | `colour=3f6f8f,c0563b` | `,` and `:` escaped | unescape them in `writeUrl` | R2-F03-H1 |
| B9 | S4 | Book on a phone: "fits Blurb" runs off the screen | /book at 393 px | wraps | `nowrap` | wraps under 640 px | screenshot |

## Design changes asked for during this round

- **Scout error messages** (asked mid-round): the big centre card is now a
  small note bottom-left beside the panel. Title only, the reason one tap
  away, × closes it for the visit, and it folds itself after 9 s unless
  someone is reading it. "No WebGL" stays up. Titles are plain ("Part of the
  map didn't load"), and raw error text goes to the console only. Test
  R2-S-N2.
- **Book header** (asked mid-round, audited against the HIG): title row
  with Share and Magazine trailing, the count as a caption, one hairline,
  every control one height, the size status beside the size, and Print PDF
  the one filled button. Screens: `clone-screens/book-head-*.png`.

## To check (not reproduced)

- A dark band under the tab bar inside the WebGL canvas on desktop. Seen
  only in SwiftShader; check on the iPad.
- The day sheet is dark over the pastel day map. Maybe a regression from
  the redesign rule, maybe intended. Check on the iPad.
- Hillshade framebuffers take 2.6–3.2 s of a cold load in SwiftShader,
  which overstates a GPU's cost. Measure on the iPad before trading relief
  detail for it.
- On a phone at r=4 km, everything gathers into one cluster that covers
  the pin. A tap opens it, but the pin is hidden until then.
