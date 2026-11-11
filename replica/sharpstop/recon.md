# Recon: SharpStop Depth of Field Calc

Recon date 2026-11-01. Purpose: not a clone. Map what SharpStop does and use
it to improve and reinforce Colour Archive (mostly Scout, also Book and the
archive). Clean-room: public listing only, no binary, no network capture.

## Scope

- **App:** SharpStop Depth of Field Calc, iOS (iPhone; also runs on Apple
  silicon Macs and visionOS as an iPhone app). Developer Yaniv van der
  Stigchel. $4.99, no in-app purchases, no account, no ads. v1.1.4.
- **Slice:** all of it. It is a small offline field calculator (3.4 MB).
- **For:** ideas for Colour Archive's own users (one photographer, iPad and
  Mac), filed as GitHub issues.

## Sources

| source | url | notes |
| --- | --- | --- |
| App Store listing (description, version history, privacy label) | https://apps.apple.com/us/app/sharpstop-depth-of-field-calc/id6814971826 | the only substantial public source |
| Privacy policy | https://miniapps.publicapidata.com/privacy | shared "mini apps" policy |
| Developer site, help centre, changelog, videos | none found | searched 2026-11-01 |
| Reviews | none yet | "not enough ratings" |

Screenshots exist on the listing but carry no caption text; none were saved.

## Screen inventory (inferred from the listing)

| ID | screen | how you get there | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Welcome | first launch | intro pages | paged cards | fit-all-devices fix (1.1.1) |
| S02 | Depth of field | main tab | sharp zone for a lens setting | side-view diagram (camera, subject, horizon), shaded near→far zone, focal / aperture / distance inputs, one-tap hyperfocal, plain-language result line, front/back split explanation | at hyperfocal, normal |
| S03 | Focus stack plan | tab | cover a near→far range | near and far inputs, shot count, per-shot focus distances, stacked-zone diagram | — |
| S04 | Stack field checklist | from S03 | tick off frames on site | large tap targets, share as text | — |
| S05 | Milky Way & star trails | tab | when and where the core is | site or coordinates, core-up-in-darkness window, moon %, facing direction, three best nights in 30 days, NPF vs 500 rule | "tonight plan" banner (1.1) |
| S06 | Night log | from S05 | record shoots | list | — |
| S07 | ND filter | tab | long exposure | base shutter, stops / OD / ND factor, result, >30 min warning | warning |
| S08 | Field of view | tab | what fits | subject distance, frame size, person figure to scale | close-focus accuracy fix (1.1.3) |
| S09 | Kit | settings | saved bodies and lenses | list, one-tap load, six sensor formats each with own CoC | — |
| S10 | Hyperfocal card | from S09 | printable PDF per lens | PDF export | — |
| S11 | Reference | tab or menu | glossary, units, feedback, rate | glossary, metres/feet, feedback form, rate link | — |
| S12 | Places | from S05 | custom sites | name, coordinates, own time zone (1.1.3) | — |

## Flows

```
F01 Is this sharp?           S02 set focal, aperture, distance -> read "Sharp from 1.8 m to ∞" (3 inputs)
F02 Hyperfocal in one tap     S02 -> hyperfocal button (1 tap after lens chosen)
F03 Plan a focus stack        S03 near + far -> shot list -> S04 tick frames on site -> share text
    edge: far = infinity, near closer than minimum focus, overlap
F04 Milky Way tonight         S05 pick site -> window, moon, direction, best 3 nights, NPF
F05 Long exposure             S07 base shutter + filter -> result; warning past 30 min
F06 Will it fit?              S08 distance -> frame width/height, person to scale
F07 Load my kit               S09 -> pick body + lens -> every tool updates
F08 Print a hyperfocal card   S09 -> S10 PDF
```

## Components

Side-view zone diagram (S02, S03); number fields with smooth counting (1.1);
segmented sensor picker; big-target checklist rows (S04); banner (S05);
non-blocking info sheet (1.1); amber-on-black theme throughout.

## Inferred data model

```
Body     name, sensor_format (1 of 6), circle_of_confusion, megapixels?      confidence: medium (listing: "six sensor formats, each with its own CoC"; NPF needs pixel pitch)
Lens     name, focal_length (or range), max_aperture?                        confidence: medium
Place    name, lat, lon, time_zone                                           confidence: high (1.1.3 note)
NightLog date, place, notes                                                  confidence: low (only named)
Settings units (m | ft), theme fixed                                         confidence: high
```

## Feature matrix

See `features.csv`. Columns there: feature, area, priority (for Colour
Archive), original (what SharpStop does), clone = what Colour Archive already
has, notes = the gap.

## What Colour Archive already has (and where it is weaker)

| SharpStop | Colour Archive today | gap |
| --- | --- | --- |
| DoF drawn as a side view, plain answer, one-tap hyperfocal | `frame.ts` depthOfField/hyperfocal (#42), shown as one text line in the frame fold; focus from a fixed list | no drawing, no hyperfocal button, no plain one-line answer |
| CoC per sensor, stated as a print standard | CoC = pixel pitch × N px (pixel-level) | never says which standard; no print-size standard; Book knows the print size |
| Focus stack plan + checklist | nothing | whole feature; Scout's DEM could supply the near point |
| Core window, moon, direction, NPF vs 500 | `galactic.ts`, `astrophoto.ts` (NPF from pixel pitch), core fold (#20) | only the chosen night; no "best nights in 30 days" |
| ND: stops, OD, factor, >30 min warning | `exposure.ts` ND + countdown | no OD/factor, no long-exposure warning, no film reciprocity (the archive has film) |
| Field of view, person to scale | frame cone, dome, monolith slab, AR | no person figure, no "width × height at distance" readout |
| Saved kit | megapixels default 33, sensor picked by hand | the archive's EXIF already knows every body and lens owned |
| Hyperfocal card PDF | `pdf-pages.ts` (book, work prints) | none |
| Amber-on-black for night vision | dark theme only | no night-vision mode |
| Glossary, metres/feet | infotips per control; metric only | no glossary sheet, no feet |
| Night log, custom places in own time zone, tonight banner | visits log, kept spots with time zone, go-tonight | parity |
| Offline, no account, no ads | same ethos (local-first, PWA offline) | parity |
| "What it is not" honesty | "About this view" fold, quiet notes | parity |

## What can't (or shouldn't) be taken

- SharpStop's name, icon, amber theme as a brand, copy text: not taken; the
  issues describe behaviour in our own words.
- Its CoC table and glossary text: write our own from first principles.
- Five-language localisation: out of scope for a one-person archive (skip).
- Rating prompt after a usable result: an App Store concern (skip).

## Size

12 screens, 8 flows, 5 entities. For Colour Archive the useful part is
medium: about ten issues, most of them Scout additions on top of existing
pure modules. Hardest parts: the focus-stack near point from the DEM; a
night-vision mode that covers the map's own colours; an honest CoC switch
that keeps every existing DoF number consistent.

## Issues filed (2026-11-01)

#150 depth of field drawn, answer first, one-tap hyperfocal · #151 sharpness
standard (print vs pixel) · #152 focus-stack plan with the near point from the
terrain · #153 kit from your own EXIF · #154 best core nights in 30 days ·
#155 ND density/factor, long-exposure warning, film reciprocity · #156 field of
view to scale · #157 night-vision mode · #158 hyperfocal cards for your lenses ·
#159 glossary and feet · #160 plan this shot again from a photo.
