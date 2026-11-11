# New components

Every component uses the tokens already in `src/styles/global.css`. No Tailwind (the
app doesn't use it). They follow the darkroom-notebook vocabulary (handcrafted restyle)
and the minimal-text rule: labels, counts and actions only, with details behind an info tip.
Contrast: `python3 contrast.py replica/design/tokens.json`, 15 pairs, 0 failing.

Shared rules
- Controls: `--font-ui` at `--t-footnote` (13px); data (hex, counts, rates) in `--font-data`.
- Touch targets: `min-height: var(--hit)` (44px, 36px on phones by request).
- Input borders: `--mark` (4.66:1). Not `--leader`, which is 1.71:1 and fails for inputs.
- Focus: `outline: 2px solid var(--mark); outline-offset: 2px` on `:focus-visible`.
- Runtime-built elements: style them with `:global()` (see the Astro scoped-styles memory).
- Motion: `--dur-fast` with `--ease`; respect `prefers-reduced-motion`.

---

Colour search (`/` archive toolbar, `/inspiration` toolbar)
  parts     a swatch button (current colour, or a hollow ring when off) opening a popover with:
            native `<input type="color">`, hex text field, Chroma and Lightness range pairs
            (min and max), a "Clear" text button, and a result count in mono
  states    off (ring, no filter) · on (filled swatch, results ranked) · no results
            ("No photos near this colour", plus Clear) · achromatic query (chroma slider
            disabled, matches by lightness)
  tokens    popover bg --surface-2, radius --r-md, rules --rule; swatch 28px circle with a
            1px --mark ring
  a11y      the swatch is a real <button aria-expanded>; hex field is <input inputmode="text"
            pattern="#?[0-9a-fA-F]{6}">, invalid shows aria-invalid; sliders are labelled <input
            type="range">; Escape closes the popover and returns focus to the swatch
  used on   S01 archive, S03 inspiration

Palette strip (lightbox)
  parts     up to 5 swatches, width ∝ share, each a <button> that copies its hex; a
            mono hex under the tapped one for 1.5s ("Copied")
  states    default · copied · missing (palette not computed yet: strip hidden)
  tokens    height 14px, radius --r-xs on the strip ends only, gap 0
  a11y      button aria-label "Copy #a1b2c3"; status via an aria-live polite region
  used on   S01 lightbox

Book spread view (`/book`)
  parts     toggle "List · Spreads"; in Spreads, pairs of pages side by side at the trim's
            aspect ratio, with a gutter hairline; page numbers in mono under each page;
            trim <select>; page count with a Blurb check ("24 pages · fits Blurb" or
            "18 pages · Blurb needs 20")
  states    empty (nothing curated) · normal · odd photo in a pair falls back (a dotted
            underline on that page with an info tip) · over 240 pages
  tokens    page bg #fff for paper (it's a page preview, not UI), stage bg --surface-1,
            selected page ring 2px --mark
  a11y      each page is a <button> that selects it; arrow keys move the selection between
            pages; selected page has aria-pressed
  used on   S05 book

Page layout control (shown for the selected page)
  parts     a segmented control: "Full bleed · Border · Two-up", plus a "Blank before"
            toggle button
  states    each option default, hover, selected (fill --fill-active), disabled (Two-up on
            the last photo of a chapter, with a reason in the tip)
  a11y      role="radiogroup" with radio inputs; the blank toggle is aria-pressed
  used on   S05 book

Print PDF button
  parts     primary-style button "Print PDF" plus a Bleed checkbox
  states    default · building (label "Building… 12 of 80", disabled) · done (download starts)
            · error (one line under the button, in --fg, not red)
  used on   S05 book

Meteor panel (Scout sheet, a fold beside Aurora and the galactic core)
  parts     the next shower with its peak date, a mono "~45 an hour at best", the hours the
            radiant is up and the sky is dark, a moon line ("Moon 82% · up until 02:10"); a
            list of the year's major showers as dotted-leader rows
  states    active shower · none active (next one, days away) · radiant never rises at this
            latitude ("Not visible from here") · bright site (light pollution zone 8 or above,
            rate dimmed with a tip)
  a11y      heading for the fold; rows are a <dl>
  used on   S04 scout

Eye-level button (Scout map controls)
  parts     icon button (a small eye glyph drawn in SVG, no icon font) next to the 3D control;
            when on, a "Back to map" pill
  states    off · on (camera at 1.7 m above the pin, pitch 85°, bearing = frame aim or
            sun azimuth) · unavailable (no terrain loaded: disabled with a tip)
  a11y      <button aria-pressed>, label "Eye level"
  used on   S04 scout

Batch match list (Style Match drop zone)
  parts     dropping several of your photos makes a list: thumbnail, filename, status
            (queued, measuring, done, refused with reason), and a strength summary; "Stop";
            "Download presets (n)" as a zip
  states    queued · running (one at a time, count "3 of 7") · done · refused · stopped
  a11y      the list is a <ul> with aria-live polite on the count
  used on   S03 inspiration (match)

Zine pages toggle (`/book/zine` paper row)
  parts     segmented "8 pages · 16 pages"; at 16 the sheet preview shows a front/back flip
  states    8 · 16 · switching from 16 to 8 when pages 9–16 hold photos (confirm in place:
            "Pages 9–16 will be hidden", not deleted)
  used on   S06 zine

Share-sheet page (`/inspiration/add`)
  parts     a centred one-line result: thumbnail + "Added to the board", or the error; link
            "Open the board"
  states    adding · added · already there · not an image · server unreachable
  used on   S07 (new)
