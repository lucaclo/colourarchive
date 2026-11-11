# Test plan: competitor-gap features

Automated cases live in `tests/features.e2e.ts` (node:test + Playwright, the
project's own pattern, run against `astro dev`):

    node --import tsx --test tests/features.e2e.ts

Every page there fails on an uncaught error, a console error from the app's
own origin, or a 5xx. Nothing touches real data: saves, PDF builds and
analyses are answered by route mocks, so book.json, the board and
.match-calibration are never written.

| ID | flow | case | how |
| --- | --- | --- | --- |
| F01-H1 | archive colour search | pick a red: fewer photos shown, count matches, every one shown passes the ranking | auto |
| F01-H2 | archive colour search | chroma floor alone filters by tone | auto |
| F01-E1 | archive colour search | bad hex marks the field invalid and filters nothing | auto |
| F01-E2 | archive colour search | a colour nothing has: empty state names it; Clear filters brings all back | auto |
| F01-E3 | archive colour search | 390px: popover inside the viewport | auto |
| F01-E4 | archive colour search | Escape closes and returns focus to the button | auto |
| F02-H1 | board colour search | filter hides references and empty groups; Clear restores | auto |
| F03-H1 | lightbox palette | details show the swatches; tapping copies the hex | auto |
| F04-H1 | book spreads | Spreads shows page 1 alone on the right, then pairs | auto |
| F04-H2 | book layout | Two-up joins two photos, page count drops, save bar appears, save sends layout | auto (save mocked) |
| F04-E1 | book layout | Two-up on a chapter's last photo falls back and says why | auto |
| F04-E2 | book layout | arrow keys move the selected page | auto |
| F04-E3 | book trim | changing size updates the page check | auto |
| F04-H3 | print PDF | progress counts up, then a download link | auto (stream mocked) |
| F04-N1 | print PDF | a failed build says so, button comes back | auto (mocked) |
| F05-H1 | scout meteors | fold names a shower, the moon, and offers the best hour | auto |
| F05-H2 | scout eye level | camera at ~85° pitch facing the sun; leaving restores the old view | auto |
| F06-H1 | batch match | two photos: each row ends Ready, Download links both ids | auto (analyse mocked) |
| F06-N1 | batch match | one refused: its reason shows, the other still downloads | auto (mocked) |
| F07-N1 | share page | cross-site request refused | auto |
| F07-N2 | share page | private address refused | auto |
| F07-E1 | share page | no url: says nothing was shared | auto |
| M-1 | print PDF | open the real PDF in Preview, check a full-bleed page and the trim box | manual (done: PDFKit read 116 pages, boxes right) |
| M-2 | share sheet | make the Shortcut on the iPad, share a Safari page and a photo | manual, needs the iPad |
| M-3 | batch match | import the zip into Lightroom on the iPad | manual, needs the iPad |
| M-4 | eye level | real GPU on the iPad: no striping on the ground | manual, needs the iPad |
