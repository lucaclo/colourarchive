# Diff, round 6: Match accuracy in Lightroom

Branch `round-6` (from `round-5` at 35eb673). Parity on `features.csv`: **100/100** (13 of 13).
The one declined item (reading `crs:` from the reference, declined 2026-10-09) is not re-opened.

## What changed in how Lightroom is modelled

| | before | now | evidence |
| --- | --- | --- | --- |
| point curve | straight lines between points | natural spline, sRGB-encoded | Lightroom's ramp exports: 3.3 → 0.00 levels mean |
| curve on colours | lightness only | hue-preserving RGB tone in Melissa RGB | Lightroom's coloured ramps: 0.86 levels mean |
| Colour Mixer, Saturation, Vibrance | guessed linear gains in OKLab | tables fitted to Camera Raw 18.7 | RAWmakase (MIT) |
| Colour Grading | fixed OKLab offset, estimated size | per-channel gain curves with Blending/Balance | RAWmakase (MIT) |
| stage order | Global grading before the mixer | mixer, then grading | RAWmakase pipeline |
| exposure | scaled lightness only | gain in linear light | physics |
| HSL band edges | estimated centres | Lightroom's measured edges (skin is Orange, sky blue is Blue) | sweep of the tables |
| preview | its own approximations | the same model, on the GPU | e2e R6-H2: under 2 levels from the CPU model |

## How close the preset lands (npm run match:bench)

Every figure is simulated through the model above. ΔE is OKLab × 100, where about 1 is
the smallest difference anyone sees side by side.

**Grade recovery**: your photo under the preset vs under the true grade, per-pixel ΔE.

| case | doing nothing | before round 6 | round 6 |
| --- | --- | --- | --- |
| identical content (24) | 6.04 | 2.77 | **1.08** |
| reference framed differently (24) | 6.04 | 6.25 | **4.99** |
| framed differently, segmented as in the app (16) | 5.45 · median 5.13 | 6.92 · median 7.75 | **4.53 · median 3.73** |

**Real pairs** (16 board references against archive photos; no true answer, so the gap to
the reference itself):

| | zone ΔE | tone (levels) |
| --- | --- | --- |
| doing nothing | 10.55 | 51.2 |
| before round 6 | 7.61 | 22.8 |
| round 6, unsegmented | **5.83** | **17.9** |
| round 6, segmented and composed | 6.84 · median **5.63** | 34.3 |

On real pairs the composed engine trades some whole-frame closeness for not copying the
reference's composition. That is the intended trade: in the segmented recovery test, the
version without composition came out worse than doing nothing (median 6.66 against 5.13).

Refinement adds 0.4–0.7 s to a match, which already takes about 17 s.

### After Point Color (item 8, 2026-10-16)

Segmented, framed differently: grade recovery 4.53 → **4.33** (median 3.73 → **3.52**); real
pairs 6.84 → **6.57** ΔE (median 5.63 → **5.01**). The synthetic grades are global, so they
give Point Color little to do. Its gain shows on real references, where skin or greens are
treated on their own. The predictions now also leave out manual masks, which a preset
can't carry, so these numbers describe what the `.xmp` alone does.

## What the benchmark taught

1. Before this round, the solver's statistics were close, but its grade was not. With a
   differently framed reference, every solver that matched whole-frame statistics ended
   further from the true grade than doing nothing. The fix was a prior (smaller moves win
   ties) plus composition re-weighting. Neither was visible without a per-pixel recovery test.
2. Zone ΔE alone made Full look worse than the middle on a real pair, while its tone was
   clearly closer. The result now quotes one distance that counts colour and contrast.

## Checks

- Unit tests: 1,970 pass (was 1,940 on round 5)
- Typecheck and page-script check: clean
- Lint: 0 errors, warnings unchanged
- Production and static builds: pass; the tables ship under `match-lr/`
- `tests/round6.e2e.ts`: 4/4 (R6-H4 checks Point Color in the preview against the CPU model)
- `tests/round5.e2e.ts`: 16/18. Both failures are the Scout calendar (R5-4-H1, R5-4-E1).
  Cause found: the long-running dev server (up since 10 Sep) hands out a stale Vite
  dependency hash, so `maplibre-gl.js?v=2e732185` answers 504 and Scout never starts.
  Restarting `astro dev` fixes it. No Scout file changed this round.

## Still approximate

- Exposure acts on the rendered photo. Lightroom applies it before the profile curve, so
  big moves compress highlights a little more in Lightroom. A Lightroom zero-slider export
  as the baseline removes this.
- Masks use Style Match's own model; Lightroom's local sliders are not in the measured set.
- The tables were fitted on Camera Raw 18.7. Lightroom 9.6 uses the same engine family,
  but the Check tab's round trip is still the only test against your own Lightroom.
- Point Color swatches are written for skin, foliage and water only (colour-defined regions
  with no automatic mask). Their operator is RAWmakase's fit; Range shapes and Variance are
  approximations by its own account, so Variance stays at 0.
