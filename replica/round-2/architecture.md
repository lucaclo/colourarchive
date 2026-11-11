# Architecture, round 2

From `replica/round-2/recon.md`. These are nine changes inside an app that
already exists, so the stack is whatever is there now.

## Stack (unchanged)

| layer | choice | why |
| --- | --- | --- |
| app | Astro 5 + TypeScript, node adapter | it's the app |
| map | MapLibre GL 5 with custom WebGL layers | Scout is built on it |
| colour search | pure TS in the browser (`src/lib/colour-search.ts`) over `data-palette` | works offline and on the published static site; 111 photos needs no server |
| storage | none new | nothing in this round is persisted except the popover's last colours, kept in `localStorage` |
| tests | `node --test` units, Playwright e2e (`tests/features.e2e.ts`), `tests/load-scout.mts` and `tests/profile-scout.mts` for speed | already in place |

**No schema.** There's no database, and this round adds no stored entity. The
two new shapes are query-side types in `colour-search.ts`:

```ts
/** One colour in a multi-colour query. `share` is the part of the frame it
 *  should cover, 0–1; undefined = "some of it, any amount". */
interface QueryColour { L: number; C: number; H: number; share?: number }

/** Why a photo passed: per query colour, the swatches that matched it and the
 *  share of the frame they cover together. Drives the swatch bar on a result. */
interface MatchReason { parts: { colour: number; share: number; hex: string }[] }
```

## Colour match: how the query works

- **One colour** behaves exactly as today. `swatchScore` and its tuning stay
  as they are, because they were tuned on this archive.
- **Several colours (up to three)**: a photo must match **every** query colour
  (AND, like TinEye). For each query colour, `covered` is the summed share of
  every swatch that matches it, and the per-colour score is today's best
  swatch score. If the user set a share, add `|covered − share| × SHARE_MISS`.
  The photo's score is the mean. The rest of the frame is TinEye's wildcard,
  with no rule on it.
- **Accent swatches** (share 0, the dominant colour) can satisfy a colour but
  add 0 to `covered`, so a requested share can't be met by an accent alone.
- `searchByColour` keeps its signature and takes `ColourQuery | QueryColour[]`.
  It also returns a `reason` for each hit. Existing callers and tests still pass.

## Colour match: UI

| change | where | how |
| --- | --- | --- |
| ranked results tray | `src/pages/index.astro` | with a colour on, a horizontally scrolling **tray under the toolbar**, closest first, each thumb with a thin bar of its matched swatches sized by share. A tap opens the lightbox at that photo. The chapters below still filter in place, so the hue-ordered archive keeps its order. Phone: the same tray, 64 px thumbs |
| swatch tap searches | lightbox caption | tap = search this colour (closes the lightbox, opens the tray). Copy moves to a long-press or a small "copy" link beside the strip |
| up to three colours | `ColourFilter.astro` | colour chips at the top of the popover. "+" adds a chip (max 3). Each chip has the wheel/hex and an optional share (any, 10%, 25%, 50%) |
| suggested swatches | `ColourFilter.astro` | a row of the archive's own chapter colours (already computed on `/` for the chapter palette), passed in as a prop |
| two-thumb ranges | `ColourFilter.astro` | one track per axis, painted as a gradient (chroma: grey to the picked hue; lightness: black to white), with two overlaid `<input type=range>` so keyboard and screen-reader access stay native |
| state in the URL | `?colour=3f6f8f,c0563b` | so the share sheet and back/forward work. `replaceState` only, no history spam |

The events stay the same: `colourfilter` now carries `ranked: {id, score, reason}[]`
beside `ids`, so the inspiration board still works unchanged.

## Scout: speed

| change | where | how |
| --- | --- | --- |
| wall-curtain spatial index | `src/lib/scout/shadows.ts` new `BoundsGrid`; used in `castCurrentShadows` | bucket each prism's bounds into a uniform lon/lat grid (cell ≈ 150 m). Each building queries only the cells its bbox touches, and a Set dedupes. Same answer as the brute-force loop, which a unit test checks on random scenes. Target: the 95 ms/minute scrub under 16 ms |
| load settle | `page.ts` | profile the cold load the way `profile-scout.mts` profiles the scrub (new `--load` mode), then defer whatever isn't needed for the first view. Don't guess before measuring |
| shared CSS | none | the 48 KB "book" chunk on Scout is the shared global sheet (tokens, fonts, archive styles). It's named after the first page that uses it and cached across tabs. **No change** (recon item corrected) |

## Scout: look

| change | where | how |
| --- | --- | --- |
| attribution | `page.ts` ~L759 | fold it on every width, not just ≤820 px. Still one tap away, still credited. Set the ⓘ text in the UI sans, not JetBrains Mono |
| twilight labels | `scout.astro` CSS | fit the 360 px panel: smaller caption size, or drop to the five key labels at that width |
| ring centred | `frameRing` | its `fitBounds` padding ignores the dock, so the ring centres on the full map. Add the dock's left/bottom inset to the padding |
| calmer photo pins | the `scout-photos` layers | GeoJSON `cluster: true`, `clusterRadius: 44`, `clusterProperties: { total: ['+', ['get','count']] }`. A cluster is one disc with the total, and tapping it zooms to its expansion zoom. Single spots under z13 draw as small dots without a number |
| phone tab bar | `TabBar` on `/scout` | a stronger glass fill on Scout, so map labels don't read through it |
| phone scale bar | `page.ts` | move the scale bar to bottom-left above the sheet on phones, or hide it in peek |
| empty state | `scout.astro` S10 | the empty panel column lists kept spots and the last five places (labels only) |
| day sheet | — | check on the iPad first. Only change it if it really is dark over the day map |

## Routes

None new. Colour search runs entirely in the browser. The only "API" change is
the `colourfilter` event's detail, plus the `?colour=` parameter on `/`.

## The parts that bite

- **Hue identity vs ranking.** The tray must not reorder the archive. That
  order is the product.
- **Multi-colour tuning.** AND across three colours on 6-swatch palettes gets
  strict fast. Tune on the real archive like round 1 did: every chapter pair
  that co-occurs in a photo must find that photo.
- **The grid has to be exact.** A spatial index that drops a pair loses a wall
  curtain silently. Equality against brute force is the test, not a timing.
- **SwiftShader.** Speed numbers are CPU-side and relative. Look needs a check
  on a device before anything is called a regression.
- **Long-press on iPad** fights the system's own callout. Use a visible copy
  affordance and not only a gesture.

## Build order

1. **Slice (speed):** `BoundsGrid` with its equality test, wired in, re-profiled. One file, the biggest win, and it proves the measuring loop.
2. **Slice (colour):** ranked tray with one colour (S01–S03). Proves the event and layout path.
3. Must-haves: swatch tap to search (S04), attribution and twilight labels (S10, S11).
4. Should-haves: multi-colour query (lib, tests, then popover), ring centring, calmer pins, phone tab bar, load-settle profile and fixes.
5. Could-haves: suggested swatches, two-thumb ranges, scale bar, empty state.
