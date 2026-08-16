# Calibrating Style Match

`src/lib/match/calibration.ts` converts a *measured* colour difference — so
many units of OKLab chroma, so many degrees of hue — into a Lightroom slider
value. That conversion is not derivable from first principles: Lightroom's
sliders are proprietary and non-linear, so the only way to know that "0.031 of
OKLab chroma" means "Saturation +18" is to apply +18 in real Lightroom and
measure what actually happened.

Nobody has done that yet. `DEFAULT_CALIBRATION` is a set of estimates, chosen
so a mid-strength move lands somewhere sensible — good enough to ship, not
good enough to trust. The "Slider calibration: estimated" badge in the Match
UI is this file's admission of that. `scripts/match-calibrate.ts` is the
harness that replaces estimates with measurements, once someone with a
Lightroom installation runs it.

## The idea

Every calibration constant is the slope of a straight line: apply a **known**
slider value to a probe photo, measure how much a **specific number** in the
app's own pixel maths moved, and the ratio between the two is the constant.
Do that for several slider magnitudes on one control at a time — never two
controls in the same probe, or the measurement can't tell them apart — and
average out the noise with a through-the-origin linear fit.

Two commands, run in order:

```bash
npx tsx scripts/match-calibrate.ts probes <base.jpg> --out=calibration-probes
#  ... apply each .xmp in Lightroom, export, see below ...
npx tsx scripts/match-calibrate.ts fit <base.jpg> <exportsDir> --out=calibration.json
```

## Step by step

1. **Pick base photos.** Most probes share one requirement — visible colour,
   nothing already blown out or crushed — but a few want something specific
   (a photo with real grain already in it, to calibrate Noise Reduction; a
   photo with a strong red subject, to calibrate the Colour Mixer). `probes`
   prints exactly what each one needs.

2. **Generate the presets.**
   ```bash
   npx tsx scripts/match-calibrate.ts probes photos/my-base.jpg --out=calibration-probes
   ```
   This writes one `.xmp` per (calibration constant × slider value) — around
   forty files. Each one moves exactly one Lightroom control and leaves
   everything else at zero; that is what makes the later measurement mean
   anything.

3. **Apply and export, one probe at a time.** In Lightroom: import a copy of
   the base photo, apply one `.xmp` via *Settings > Import Settings…* (or sync
   the preset in first), export as JPEG at full resolution with **no other
   edits**, and name the export **exactly** what the console printed —
   `saturationGain_60.jpg`, not "my-base-edit-3.jpg". The `fit` step parses
   the calibration key and slider value back out of the filename; get that
   wrong and it silently skips the file rather than measuring the wrong
   thing. Drop every export into one flat folder.

4. **Fit.**
   ```bash
   npx tsx scripts/match-calibrate.ts fit photos/my-base.jpg calibration-probes-exports --out=calibration.json
   ```
   This re-measures the base photo and every export using `analyze.ts` — the
   *same* measurement code a live match runs through, not a simplified
   stand-in — computes the slope for each constant that had exports, and
   prints a full `Calibration` object next to the current
   `DEFAULT_CALIBRATION` for comparison.

5. **Look before you paste.** The script deliberately does not edit
   `calibration.ts` for you. Sanity-check the printed numbers — a constant
   that moved by 5× or dropped to zero almost always means a probe was
   misapplied or misnamed, not that the estimate was wildly wrong — then copy
   the values you trust into `DEFAULT_CALIBRATION` by hand.

## What this does and doesn't cover

Every probe's `measure` function is the algebraic inverse of one specific
line in `solve.ts` — the comment on each probe in `match-calibrate.ts` names
it. If `solve.ts` ever changes how it uses a constant, the probe measuring
that constant needs to change with it, or the fit will confidently produce a
number for a formula that no longer exists.

Three constants are declared in `Calibration` but not probed here:

- **`sharpenUnit`** — `solve.ts` doesn't currently set `adj.sharpenAmount`
  from any measurement, so there is no forward formula to invert. Measuring
  it now would produce a number the solver never reads. Worth knowing: this
  means Style Match currently never recommends a Sharpening value at all.
- **`localTempUnit`, `localTintUnit`, `localSaturationGain`** — these drive
  mask (Select Subject/Sky/Background) adjustments. Lightroom regenerates
  mask XMP from its own AI segmentation on import rather than accepting a
  fixed block the way a global slider does, so isolating one local control
  needs a mask actually drawn in Lightroom and a measurement restricted to
  that mask's region — a different, heavier harness than probing a global
  slider. Left as a follow-up.

## Why a linear fit is the right model

Everything downstream of a slider probe assumes the relationship is linear
through the origin — value 0 does nothing, and value 2×V does roughly twice
what value V does. That's not universally true of Lightroom's sliders across
their *entire* range (Saturation −100 does not do 100/60 times what −60
does), but it holds well enough over the moderate range Style Match actually
recommends, which is the range that matters here. Probing several magnitudes
per constant, rather than just one, is what makes it possible to notice if a
particular control turns out not to behave that way — a fit whose points
don't lie anywhere near the resulting line is telling you something the
single-point version of this harness could not.
