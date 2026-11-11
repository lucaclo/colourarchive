# Items 1–3: Scout panel, answer first

Date 2026-10-13 · branch `declutter`

## Architect

- Extended, not added: `scout.astro` (panel markup regrouped by moving whole blocks, no
  element ids changed), `view/page.ts` (renderGlance, filterEvents, tile and group wiring),
  `view/orientation.ts` (unread dots removed).
- One new pure module, `src/lib/scout/glance.ts` (lightWord, nextLight, phaseRows,
  readableTitle) with `glance.test.ts` (12 tests).
- No data, storage or API changes.

## Design

- Headline in Fraunces italic (1.5 rem), the next sun event under it in the sun amber.
- Three tiles split by hairlines, not boxes (notebook vocabulary). One open at a time, with an
  amber underline on the open tile. Each tile shows one takeaway: Sun (bearing, height), Sky
  (condition, cover), At the pin (in sun or shade, and when that changes).
- Value rows in the UI sans; Fraunces italic kept only for the headline and group names
  (HIG typography: weight and face carry hierarchy).
- 13 folds → four groups (Night sky, Plan, Yours, About this view). The inner folds are second
  level: UI sans, no rule.

## Diff against the references

| | Apple Weather / Flighty | Scout before | Scout now | verdict |
| --- | --- | --- | --- | --- |
| an answer at the top | summary line / headline | none | "Flat light · Golden hour in 5 h 41 m · 17:30" | matches |
| one takeaway per module, detail on tap | yes | 4 data rows + 3 weather paragraphs, always shown | 3 tiles, detail behind a tap | matches |
| content follows the phase | Flighty: 15 states | 9 rows always | the half of the day still ahead (5 rows), "All times" for the rest | partly: no morning view after dark (see below) |
| essential info only | yes | API key text, file names, 4-line method note | console only, "Photo spot", 1-line note | matches |
| levels of folding | one | 13 folds at one level | 4 groups | better than PhotoPills and Planit; matches the HIG |
| panel height (iPad, Hong Kong at 11:49) | n/a | 1,923 px | 854 px | −56% |

Where Scout is better: the headline is honest. With no forecast it falls back to the sun phase,
never to a made-up score, and it agrees with the cloud-deck reading (a low deck in front of the
sun says "Flat light", where the old panel said "soft-edged" and "flat" in consecutive lines).

Still missing:
- After last light, the times list shows the evening that has passed. Flighty would roll
  forward to tomorrow morning, but Scout's day model is one solar day, so that needs the next
  day's times computed.
- The time-strip labels still say "Golden" twice (item 9).

Screens: `screens-before/ipad-scout-place*.png` vs `screens-after/ipad-scout*.png`,
`phone-scout*.png`.
