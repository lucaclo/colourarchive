# Test plan, round 2

Flows from `recon.md`. Automated cases live in `tests/features.e2e.ts` under
`R2-`, and run against `astro dev`:
`node --import tsx --test tests/features.e2e.ts`. Unit tests are in
`colour-search.test.ts` and `shadows.test.ts` (`BoundsGrid`). Speed comes
from `tests/load-scout.mts` (production build) and `tests/profile-scout.mts`.

Not applicable here, because the app has no accounts, payments, second
users or server state for these flows: expired session, second user's
data, card declined, two tabs.

## F01 find photos that hold a colour

| ID | case | how |
| --- | --- | --- |
| R2-F01-H1 | a colour shows a ranked tray at the top, closest first, count = ranking | e2e |
| R2-F01-H2 | the colour goes into `?colour=` and comes back on reload | e2e |
| R2-F01-E1 | a colour nothing has: tray shows 0 and Clear, which resets the URL | e2e |
| R2-F01-E2 | a garbled `?colour=` is ignored | e2e |
| R2-F01-E3 | on a phone the tray stays on screen | e2e |
| R2-F01-K1 | keyboard: arrows walk the tray, Enter opens the photo | e2e |
| F01-H1…E4 | round 1's colour cases still pass (filter, tone, invalid hex, empty, phone, Escape) | e2e |
| R2-F01-P1 | speed: a two-colour search over 111 photos | 0.02 ms (script) |

## F02 more like this colour, from a photo

| ID | case | how |
| --- | --- | --- |
| R2-F02-H1 | a lightbox swatch searches: lightbox closes, tray opens, URL set | e2e |
| F03-H1 | Copy copies the pointed-at hex (changed from tap-to-copy) | e2e |

## F03 several colours

| ID | case | how |
| --- | --- | --- |
| R2-F03-H1 | two colours give fewer results, and exactly the library's answer | e2e |
| R2-F03-H2 | a share of 50% narrows and is written as `:50` | e2e |
| R2-F03-H3 | a chapter swatch sets the colour | e2e |
| R2-F03-E1 | three colours is the most; + hides | e2e |
| R2-F03-E2 | a range's two thumbs can't cross | e2e |
| unit | one colour as a list scores exactly as before; all must be present; reasons; accent covers 0; share prefers close; cap at 3 | `colour-search.test.ts` |
| tuning | 23 of 24 real photos with two distinct colours are found by them | script |

## F10 open Scout on a place

| ID | case | how |
| --- | --- | --- |
| R2-S-H1 | the credit starts folded on a desktop | e2e |
| R2-S-H2 | the time words fit the panel at 1440 and 390 px | e2e |
| R2-S-H3 | the pin sits mid-way across the free map beside the panel | e2e |
| R2-S-H4 | photo spots cluster, and a tap on a cluster zooms in | e2e (skips its tap when the photo sources are unreachable) |
| R2-S-H5 | places opened lately show in the empty search | e2e |
| R2-S-H6 | light pollution decodes in a worker | e2e |
| R2-S-N1 | without WebGL: "No map in this browser", the rest works, no page errors | e2e |
| R2-S-N2 | a map problem is a small corner note, the reason behind a tap, closed stays closed | e2e |
| R2-S-N3 | styling a missing layer is not shown as a basemap failure | e2e |
| R2-S-P1 | cold load, settled | `load-scout.mts` |

## F11 scrub time in a dense city

| ID | case | how |
| --- | --- | --- |
| R2-S-P2 | 240 slider minutes, central London z15.4, 4,000 buildings | `profile-scout.mts`: 15.4 ms a minute |
| unit | `BoundsGrid` finds exactly what a full scan finds, in four kinds of scene | `shadows.test.ts` |

## Manual, on the iPad (not done here)

- Scout look and speed on a real GPU: settle time, scrub smoothness, the
  hillshade cost, and the dark band under the tab bar seen in SwiftShader.
- The day sheet: is it dark over the pastel day map?
- The Book toolbar at the iPad's widths, portrait and landscape.
