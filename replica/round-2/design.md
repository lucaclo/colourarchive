# Design, round 2: component specs

No new design system. The tokens in `src/styles/global.css`, the darkroom-
notebook vocabulary (sentence-case Fraunces italic labels, hairlines, no boxed
cards) and the minimal-text rule all stay. This file specs only the parts
round 2 adds or changes. New colour pairs are in `design/tokens.json`. They pass
`contrast.py` with **12 pairs, 0 failing AA**.

Copy is labels, counts and actions only. No explanatory sentences.

---

```
Colour results tray                                         S01, S03 (new)
  layout    a strip under the toolbar, full width, height 96 px desktop and
            iPad, 72 px phone; scrolls sideways (scroll-snap x, proximity);
            sits in the toolbar's glass so it reads as part of the search
  item      photo thumb (object-fit cover, aspect kept, height 72 / 56 px),
            then a 4 px bar under it: the matched swatches, width by share,
            in match order. No text on the item
  header    left: the query chips as small dots (12 px); right: the count
            ("32") in --font-data --t-caption --secondary. No label
  states    hidden (no colour); filled; empty: the dots, "0", and a "Clear"
            text button; loading never happens (all client-side)
  motion    slides down 180 ms var(--spring) on first colour; contents
            cross-fade 120 ms on change; reduced motion: opacity only
  tokens    bg --glass-bg-strong over the page; thumb radius --r-xs;
            hairline --glass-edge under it
  a11y      role="list", each item a <button> labelled with the photo's
            title and "n% match"; arrow keys move along; Enter opens the
            lightbox at that photo; the count is aria-live polite
  order     closest first (searchByColour score). The archive below keeps
            its hue order
```

```
Colour chips                                                 S02 (changed)
  layout    one row at the top of the popover: up to 3 chips, then "+"
  chip      36 px disc of the colour; the selected chip has a 2 px --mark
            ring; under it the share as a caption ("any", "10%", "25%",
            "50%"), tapping it cycles
  add       "+" is a 36 px dashed-ring button; hidden at 3 chips
  remove    the selected chip shows a small × at its top right (24 px hit
            min, 44 px with padding on touch)
  editing   the hex field and native wheel edit the selected chip
  states    one chip (exactly today's behaviour); 2–3 chips; invalid hex
            (dashed border, as today)
  a11y      chips are a radiogroup ("Colours"); each chip is a radio
            labelled by its hex and share; share cycle is a separate button
            labelled "Share of frame: 25%"
```

```
Suggested swatches                                           S02 (new)
  layout    one row of 18 px dots under the chips, 8 px gap; the archive's
            own chapter colours, in chapter order
  action    tap = set the selected chip to that colour
  a11y      buttons labelled with the chapter name ("Red", "Teal" …)
  states    filled only. On the inspiration board, the board's own colours
```

```
Two-thumb gradient range                                     S02 (changed)
  replaces  the two separate sliders per axis
  layout    legend (Fraunces italic, as today) then a 28 px tall row: an
            8 px track painted as a gradient, two 18 px round thumbs in
            --fg with a 1 px --bg edge; the span between thumbs is clear,
            outside it is dimmed by a 55 % --bg wash
  gradients chroma: oklch(0.65 0 h) → oklch(0.65 0.16 h), h = selected
            chip's hue (or 30 when none); lightness: oklch(0 0 0) →
            oklch(1 0 0)
  build     two overlaid <input type=range> with pointer-events only on the
            thumbs, so keyboard, VoiceOver and Switch Control are native
  states    full range (no filter, legend in --secondary); narrowed (legend
            in --fg); thumbs can't cross (min clamps to max)
  a11y      aria-label "Minimum chroma" / "Maximum chroma" etc., as today
```

```
Lightbox palette                                             S04 (changed)
  swatch    tap = search this colour (closes the lightbox, opens the tray
            with this colour as the one chip)
  copy      a "Copy" text button after the strip, --t-caption --secondary;
            it copies the hex of the last focused or hovered swatch, or
            all hexes when none is; feedback in the existing .lb-hex live
            region ("#3f6f8f copied")
  a11y      swatch aria-label "Search #3f6f8f"
```

```
Scout photo discs                                            S11, S13 (changed)
  single    as today (colour by state, number in --hotspot-ink) from z13;
            below z13 a 5 px dot in the state colour, no number, no halo
  cluster   GeoJSON cluster; a disc in --cluster-paper with a 1.5 px
            --cluster-edge stroke and the summed count in --hotspot-ink
            11 px semibold; radius by total: 1→12, 10→15, 60→20, 200→24
  action    tap a cluster = ease to its expansion zoom; tap a single = open
            the spot, as today
  why       ~150 discs at z12 become about 10–15; the sun ring and rays
            become the strongest marks again
```

```
Attribution                                                  S10, S11 (changed)
  state     folded on every width (the ⓘ button), open on tap; text in
            --font-ui --t-caption, ink #4a4740 on a light glass by day,
            --secondary on --glass-bg-strong by night
  position  unchanged (bottom right, above the scale bar)
```

```
Twilight labels                                              S11 (changed)
  fit       at panel width ≤ 380 px: Fraunces italic at --t-footnote
            (13 px) with letter-spacing 0, and space-between; if still too
            wide (container query), drop "Dawn" and "Dusk", keeping
            Sunrise, Golden, Noon, Golden, Sunset
  never     clipped or ellipsised
```

```
Scout phone tab bar                                          S13 (changed)
  fill      on /scout under 600 px only: --glass-bg-strong (80 % --bg) in
            place of --glass-bg, so map labels can't read through
            between tabs; blur unchanged
```

```
Scout scale bar                                              S13 (changed)
  phone     hidden while the sheet is in peek; at half and full detent it
            isn't visible anyway. Desktop unchanged
```

```
Scout empty state                                            S10 (changed)
  content   under the search field: "Kept" (Fraunces italic legend) then
            kept spots as rows (name, dotted leader, zone abbreviation);
            then "Recent" with the last five places. Rows are buttons. Max
            8 rows in all
  empty     no kept spots and no recent places: nothing, exactly as now
  a11y      two lists with headings; each row a button "Open London"
```

## Not changed, on purpose

- The sun ring, rays and disc: already the strongest part of Scout's look.
- The colour button (hue ring off, filled on): it reads well.
- The dark sheet over the day map: check on the iPad before changing it
  (recon S11).
