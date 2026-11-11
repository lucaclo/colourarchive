# Bugs

Found while building and testing branch `competitor-gaps`, 2026-10-09. Each
was reproduced; each fix has a test that failed first or a browser check
that showed it. Nothing is committed yet, so "fixed in" names the file.

| ID | sev | what | steps | expected | actual | fixed in |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | S2 | Colour search missed most of its own chapter | `/`, pick `#d11f27` | the Red chapter's photos | 1 photo (plain OKLab distance; palettes duller than a picked colour) | `colour-search.ts`: hue-led match + dominant-colour accent; tests "a vivid query finds the duller reds", tuning harness 100% recall per chapter |
| B2 | S2 | Chroma slider could not reach any photo | `/`, chroma min 45% | the most colourful photos | 0 (scaled to 0.37 C; photos top out at 0.09) | `colour-search.ts` TONE_CHROMA_SPAN 0.12; F01-H2 |
| B3 | S3 | Phone: colour popover under the search row, chapter text through it, off the right edge | `/` at 390px, open colour | popover on top, readable, on screen | covered, see-through, clipped | `ColourFilter.astro` opaque surface, lift while open, clamp to viewport; F01-E3 |
| B4 | S3 | Book header showed a stale page count after a layout change | `/book` Spreads, Two-up | one count, current | header 116, check 114 | `book.astro`: count lives only in the check line |
| B5 | S4 | First spread's empty left page drew as a grey block; opener page number in the title's italic | `/book` Spreads | blank space; small number | grey box; large italic "1" | `book.astro` styles |
| B6 | S2 | Meteor fold led with "~0 an hour" | Scout, 9 Oct | the shower worth going out for | Draconids (peaked the day before) | `meteor-panel.ts`: lead by tonight's best rate at the pin; F05-H1 |
| B7 | S2 | A peak near New Year landed in the wrong year | `dateAtSolarLongitude(283.15, 2026)` | 3 Jan 2026 | 3 Jan 2027 | `meteor.ts`; test "peaks land on their usual dates" |
| B8 | S1 | Eye level threw and froze the map | Scout, Eye level | camera at the pin | `Cannot read properties of null` in MapLibre's globe matrices | `page.ts`: zoom solved directly, not camera-from-position |
| B9 | S2 | Eye level threw on first press in hills | Scout, Eye level just after 3D | camera at the pin | `Out of range source coordinates for DEM data` | `page.ts`: wait for a DEM tile under the pin; F05-H2 |
| B10 | S1 | Share page let any website add to the board and make the Mac fetch inside the network | another site embeds `/inspiration/add?url=…` | refused | accepted | `inspiration/add.astro` Sec-Fetch-Site check; `inspiration.ts` private-address refusal; F07 |
| B11 | S3 | Two PDF builds at once shared a temporary file | two Print PDF presses | two files | one could clobber the other | `book-print.ts` unique temp name |

Bugs by severity: S1 2, S2 6, S3 3, S4 1. All fixed. Open: none from this work.

## To check (not reproduced as caused by this branch)

- **`npm run smoke`: 3 of 26 suites fail, all timeouts.** Desktop: the suite clicks
  `#panel-head`, which `#dock .panel-head { display: none }` hides. That rule is on
  `main` too, and the smoke file was last changed on 27 August, before the
  map-first redesign. Phone: `waitForTheMap` times out under software WebGL. Worth
  updating the smoke selectors to the redesign.
- **`npm run lint`: 1 error**, `builtLabel` unused in `index.astro:160`. Also on `main`.
- **`npm audit`: critical/high advisories** in `astro`, `@astrojs/node`,
  `@fastify/busboy`, `devalue`. Needs a deliberate Astro upgrade.
- Eye level on the iPad's real GPU: the ground looked striped in software
  WebGL at twilight. Needs a look on the device.
