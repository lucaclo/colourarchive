# Architecture: closing the competitor gaps

Reads `replica/competitors.md` and `replica/features.csv`. Date: 2026-10-09.

## Step 1: the stack (unchanged, on purpose)

| layer | choice | why |
| --- | --- | --- |
| web app | Astro 5 + TypeScript, existing pages | everything already lives here; no second app |
| styling | `src/styles/global.css` tokens, handcrafted darkroom-notebook look | already decided (UI overhaul, handcrafted restyle) |
| mobile | the PWA on iPad | iPad is the client, Mac the server |
| database | **none: JSON files on the Mac** (`photos.json`, `book.json`, …) | single user, already the pattern, git-diffable |
| files | `photos/`, `public/img/`, `.cache/` | already the pattern |
| auth, payments, email | **none** | the user chose this on 2026-10-09; local-first, single-user |
| jobs | `npm run` scripts for backfills | already the pattern (`backfill:clip`) |
| hosting | Mac server + static Netlify publish | unchanged |

## Step 2: the "schema", as JSON shapes

No SQL. These are additions to existing files, every one optional so old records still load.

```ts
// photos.json, Photo (src/lib/types.ts)
palette?: { L: number; C: number; H: number; share: number }[]
//   up to 5 OKLCH swatches, share = fraction of pixels, sum ≈ 1, sorted by share.
//   Computed at ingest from the 512px derivative; backfilled by `npm run backfill:palette`.
//   KEPT in the client manifest (~5×4 numbers per photo) so colour search runs in
//   the browser, offline and on the published static site.
//   evidence: Eagle, PhotoPrism, mymind all store a per-image palette. confidence: high

// book.json, BookCuration (src/lib/book.ts)
layout?: Record<photoId, 'bleed' | 'border' | 'pair'>
//   bleed  = full-bleed plate on its own page (today's only behaviour, the default)
//   border = photo centred with a white margin on its own page
//   pair   = shares one page with the NEXT included photo in the same chapter (two-up)
blankBefore?: photoId[]     // insert a blank page before this photo (forces it to a right/left page)
trim?: TrimId               // last chosen trim, so the spread view and the PDF agree

// src/lib/book-pages.ts (new, pure)
type TrimId = 'blurb-sq-8' | 'blurb-sq-12' | 'blurb-land-10x8' | 'blurb-port-8x10' | 'a4-portrait' | 'a4-landscape' | 'a5-portrait'
Page   = { kind: 'divider', chapter } | { kind: 'photo', ids: [id] | [id, id], treatment } | { kind: 'blank' }
Spread = { left: Page | null, right: Page | null }  // page 1 is a right-hand page
```

```ts
// src/lib/scout/meteor.ts (new, pure): static table, no storage
Shower = { code, name, peakSolarLongitude, activeFrom, activeTo /* solar longitude */,
           radiantRA, radiantDec /* at peak, J2000 */, driftRA, driftDec /* deg per day */,
           zhr, velocityKmS, populationIndex }
//   evidence: IMO 2026 Meteor Shower Calendar working list. confidence: high for the major showers
```

```ts
// batch Style Match: no new storage. Each target is its own analyse request and its own
// session, as today. The batch is a client-side list of session ids, and the zip is built on
// download from those ids.
```

```ts
// zine doc (localStorage zine:doc:v1)
pages?: 8 | 16      // 16 = double-sided sheet; reviveDoc defaults old saves to 8
```

Access rules: there's one user and it's the Mac. Every write route stays `prerender = false`
and Mac-only, as now. Nothing new is published except the client manifest's `palette`.

## Step 3: the API

| method path | what it does | caller | input | output | feature |
| --- | --- | --- | --- | --- | --- |
| *(none)* | colour search is client-side over `palette` | archive / board page | hex, chroma, lightness | ranked ids | colour search |
| GET `/api/book/pdf` | builds the print PDF from the originals at 300 dpi for the trim, with bleed | book page | `trim`, `bleed=1` | `application/pdf` download | book |
| POST `/api/book` *(existing)* | now also saves `layout`, `blankBefore`, `trim` | book page | JSON | curation | book |
| POST `/api/match/analyse` *(existing)* | called once per target in the batch | inspiration page | form (unchanged) | session id | batch match |
| GET `/api/match/presets.zip` | one `.xmp` per session, named after the target photo, as a zip | inspiration page | `ids`, strengths | `application/zip` | batch match |
| GET `/inspiration/add?url=&source=` *(new page)* | adds a URL to the board and shows a confirmation; the target for an Apple Shortcut's "Open URL" | Shortcut / Safari | query | HTML | share-sheet |
| POST `/api/inspiration/add` *(existing)* | the target for a Shortcut that shares an *image* (multipart `images`) | Shortcut | form | JSON | share-sheet |

Background job: `npm run backfill:palette` (one-off, idempotent, touches only `palette`).

## Step 4: the parts that bite

- **Colour search metric.** Search in OKLab with ΔE, weighted by the swatch's share, so
  a tiny red sign ranks below a red wall. Achromatic queries (C < 0.035) must still match
  greys by lightness. Hue alone is meaningless at low chroma.
- **Palette determinism.** k-means seeded deterministically, so re-ingest gives the same
  palette and the backfill is a no-op on the second run.
- **PDF memory.** 80 originals at 300 dpi can reach hundreds of MB. Encode one page at a
  time and stream it to a file in `.cache/`, never all in memory. The images are sRGB JPEG;
  the ICC stays sRGB (DeviceRGB is the PDF's assumption; say so).
- **Two-up pages and an odd photo.** A `pair` on the last photo of a chapter has no partner,
  so it falls back to `border` and the spread view says why.
- **Page count.** Blurb needs 20–240 pages (Lightroom doc) and an even count; pad with blanks
  and report it.
- **Meteor rates.** HR = ZHR × sin(radiant altitude) × r^(LM − 6.5). It's an *upper* estimate
  for one observer with a whole sky. Say so; no false precision. The radiant below the horizon
  means zero, not negative.
- **Peak date from solar longitude.** Solve sun apparent longitude = λ for the year; the
  wrap from 360 to 0 for showers near the vernal equinox.
- **Eye-level view.** MapLibre's max pitch is 85°, and terrain must be on, or the camera sits
  at sea level. Return to the saved camera on exit.
- **Batch match time.** Each analyse is a few seconds with the masks on 50MB RAWs, so the
  batch runs one request at a time with a real progress count and a stop button, like upload.
- **16-page zine imposition.** The double-sided fold is easy to get wrong. Derive it by
  simulating the fold in a test, not by drawing it by hand.
- **The user's uncommitted work** in `book.astro`, `scout.astro`, `global.css` and
  `package.json` (phone compact chrome) must survive. Edit around it, never revert it.

## Step 5: build order

1. **Vertical slice: palette and colour search.** `palette` at ingest, the backfill, the
   client ranking, a colour control on `/`. Proves the data path end to end.
2. **Must-haves: Book.** `book-pages.ts` (pure, tested), spread view and layout controls on
   `/book`, multi-page PDF writer, `/api/book/pdf`.
3. **Should-haves.** Colour search on the board, the meteor module and panel, batch Style
   Match with the zip, the share-sheet page and Shortcut recipe, the eye-level view.
4. **Could-haves.** Palette in the lightbox, 16-page zine.

| milestone | screens | data | routes |
| --- | --- | --- | --- |
| 1 | `/` | `Photo.palette` | none |
| 2 | `/book` | `BookCuration.layout/blankBefore/trim` | `/api/book`, `/api/book/pdf` |
| 3 | `/inspiration`, `/scout`, `/inspiration/add` | none new | `/api/match/presets.zip` |
| 4 | `/` lightbox, `/book/zine` | `zine doc.pages` | none |
