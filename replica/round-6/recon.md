# Recon, round 6: how accurately Style Match lands in Lightroom

Scope (from the request, 2026-10-14): Style Match only, judged by one question. When the preset
is applied in Lightroom (cloud, iPad and Mac, v9.6), how close does the photo come to the
reference? The research covers the apps that do the same job and what is publicly known about
how Lightroom's sliders actually move pixels. The locked decisions in
`colour-archive-style-match` still hold: local-only, no LLM in the advice, `.xmp` out, and both
the restrained and faithful solutions on one slider.

## Sources

| source | what it gave |
| --- | --- |
| [Capture One, Match Look (16.5)](https://support.captureone.com/hc/en-us/articles/22266038214173-Match-Look) | the nearest competitor: one-click match into normal tools, grouped Normalize / Light & Contrast / Color Adjust / Color Tone, an Impact level, several references weighted by similarity |
| [Thomas Fitzgerald on Match Look](https://blog.thomasfitzgeraldphotography.com/blog/2024/10/capture-one-165-match-look-a-remarkable-new-feature) | "90–95% of the way about 80% of the time"; tone and contrast are often off; no grain, clarity, vignette or dehaze; worse when the content differs |
| [Capture One forum, Match Look](https://support.captureone.com/hc/de/community/posts/22949827057949-Match-Look-question) | users call the results inconsistent; layered references are read from the base layer only |
| [Pixelmator Pro ML Match Colors](https://www.pixelmator.com/blog/2019/05/14/pixelmator-pro-updated-with-new-core-ml-powered-ml-match-colors-feature/) | ML picks 37 ordinary adjustments, which stay editable afterwards |
| [FindPreset comparison](https://findpreset.com/posts/ai-lightroom-preset-tools-compared) | reference → `.xmp` tools read embedded `crs:` first; the image-only estimate "captures most of the look". Nobody publishes an accuracy method |
| [Deep Preset (WACV 2021)](https://arxiv.org/pdf/2007.10701) | trained on 600k renders from scripted Lightroom with 69 settings. The lesson: accuracy comes from checking against what Lightroom actually renders |
| [Colourlab AI](https://mixinglight.com/color-grading-tutorials/computer-assisted-shot-matching-with-colourlab-ai-part-1) | pixel-based shot matching with several perceptual models; no Lightroom path |
| [Lightroom Reference View](https://digital-photography-school.com/match-image-processing-reference-view-lightroom/) | Adobe's own answer is matching by eye beside a reference. No automatic match as of 9.6 |
| [Lightroom 9.6 notes](https://community.adobe.com/announcements-678/lightroom-v9-6-is-live-transform-photos-with-prompt-to-edit-and-enhanced-reflection-removal-1644292) | Prompt to Edit and Reflection Removal; Variance arrived in Point Color in 9.3 |
| [Refine Saturation (Julieanne Kost)](https://jkost.com/blog/2024/08/the-tone-curve-panel-in-lightroom-classic-2.html) | the point curve changes saturation as well; the default of 100 is the old behaviour |
| [Incremental Temp/Tint bug thread](https://community.adobe.com/t5/lightroom-classic-bugs/p-preset-hover-preview-incorrect-for-incremental-temperature-tint/idi-p/12249132) | `IncrementalTemperature` is the non-raw control; on raws its preview is wrong. Keep the cast in Colour Grading |
| [RAWmakase](https://github.com/pch/rawmakase) (MIT), [parity gaps](https://github.com/pch/rawmakase/blob/main/docs/parity-gaps.md), [colour mixer](https://github.com/pch/rawmakase/blob/main/docs/color-mixer.md), [Point Color PR](https://github.com/pch/rawmakase/pull/144) | an open RAW developer fitted to Camera Raw 18.7 renders. Gives the stage order, the working spaces, and **measured tables** for the Colour Mixer, Saturation, Vibrance and Colour Grading, plus real Lightroom exports of curve ramps |
| Lightroom 9.6 on this Mac, `Contents/Resources/Settings/**.xmp` (990 Adobe presets) | the real field vocabulary: `PointColors` (19 numbers), `ColorVariance`, `CurveRefineSaturation`, `IncrementalTemperature`, `LocalPointColors` |

## What was verified, not assumed

Each one was checked against data, with the scripts in the scratchpad and the results below.

1. **Lightroom's point curve is a natural cubic spline in sRGB-encoded space.** Against
   Lightroom Classic 15.5.1 exports of a gray ramp under two known curves (RAWmakase
   `tests/data/lightroom-point-curves.json`), a natural spline reproduces Lightroom to 0.00
   levels mean and 0.01 max. Colour Archive draws straight lines between the points, which is
   off by **3.3 levels mean and 6.9 max** on the S curve, and 2.5 / 7.7 on the clipped curve.
   A gamma-1.8 encoding is far worse (5–8 levels), so the space is sRGB-encoded.
2. **On colours the master curve is hue-preserving RGB tone (DNG `RefBaselineRGBTone`) in
   Melissa RGB** (ProPhoto primaries, sRGB transfer). Mean error 0.86 levels across the six
   coloured ramps, against 7.4 per channel in sRGB and 2.95 per channel in Melissa. So an
   S-curve in Lightroom **raises saturation**, and Colour Archive's model, which moves
   lightness only, doesn't know.
3. **Stage order** (RAWmakase `pipeline/pixel.rs`): exposure → profile → tone curves →
   Colour Mixer / Saturation / Vibrance → Point Color → Colour Grading. Colour Archive applies
   Global grading *before* the mixer.
4. **The mixer works in HSV of linear ProPhoto RGB**, measured as 36 hues × 6 saturations × 6
   values for each band and slider sign. Colour Archive centres its bands on OKLCH hues, and
   Magenta (350°) sits 22° from where sRGB magenta is (328°).
5. **Colour Grading is a per-channel gain curve in linear ProPhoto**, shaped by Blending and
   Balance, measured at 12 hues × 4 saturations. Colour Archive adds a fixed OKLab offset
   (`colorGradeUnit = 0.06`, an estimate).
6. **Exposure is a gain in linear light**, so it scales a and b as well as L in OKLab.
   Colour Archive's shader scales L only, so brightening also desaturates.
7. Adobe's own presets use `IncrementalTemperature` (B&W 02, Film 02/08), but on raws it is a
   different control with a known preview bug, so the cast stays in Colour Grading.

## Screens (Match only)

| ID | screen | how you get there | purpose | states |
| --- | --- | --- | --- | --- |
| S01 | Board drop | /inspiration, drag a photo onto a reference | start a match | idle, dragging, decoding, error note |
| S02 | Match start | after the drop | baseline choice, measurements on hover | RAW, JPEG, preview baseline |
| S03 | Match result | after solving | answer first, live preview, strength and group sliders, notes, preset download | restrained, faithful, phone wipe, masks off, low reachability |
| S04 | Check tab | the result's Check | drop the Lightroom export back in; gaps closed; calibration | eligible, ineligible with reasons |

## Flows

```
F01 Match my photo to a reference
    S01 drop -> S02 baseline -> S03 result -> download .xmp -> Lightroom
    happy path: 2 drops, 1 tap to download
    edge: content differs, RAW with preview baseline, reference over-graded, no sky in one photo
F02 Check the result
    S03 -> S04 drop export -> gap table -> follow-up preset
```

## Where Colour Archive loses accuracy today

| # | gap | evidence | cost |
| --- | --- | --- | --- |
| G1 | curve drawn as straight lines, Lightroom draws a spline | verified 1 | tones land up to ~7 levels off between points; the preview disagrees with Lightroom |
| G2 | the curve's saturation lift isn't modelled | verified 2 | contrasty matches overshoot Saturation in Lightroom |
| G3 | the solver predicts from region averages, stage by stage, never by simulating pixels | solve.ts header | a mean pushed through a curve isn't the curve of the mean (Jensen), and stages interact |
| G4 | the mixer, Saturation, Vibrance and Grading use guessed linear gains | calibration.ts "estimates" | wrong slider magnitudes, unless the user calibrates by hand with round trips |
| G5 | Global grading is applied before the mixer | verified 3 | the zone and mixer residuals are computed in the wrong order |
| G6 | exposure scales L only | verified 6 | the preview desaturates on brightening; Lightroom doesn't |
| G7 | no number says how close Lightroom will get | UI | "reachability" covers only the frame mean |
| G8 | different content skews whole-frame tone targets | Capture One reviews, Deep Preset | a sky-heavy reference brightens a ground-heavy photo |

## Competitor features worth taking

| feature | who | fit |
| --- | --- | --- |
| verify the result through the real renderer before answering | Deep Preset (training), RAWmakase (parity tests) | core of this round: simulate, then refine |
| several references weighted by similarity to *your* photo | Capture One | high: merge already exists, but weights are manual |
| grouped adjustments you can switch off | Capture One | already built (group strengths) |
| say how close the match will get | none does it | high: an honest predicted ΔE |
| read `crs:` from the reference file | FindPreset | declined before (2026-10-09); not re-opened |

## Can't be cloned

Lightroom's engine itself (closed; we model it from public measurements), Adobe's AI masks
(Lightroom regenerates them on import, as now), Capture One's trained model.

## Size

M. One forward model, a pixel sample, a refinement loop, a preview port and a benchmark. The
hard parts: porting the measured tables faithfully (G4), keeping the strength slider blendable
(shared curve x), and the WebGL1 preview of 3D tables.
