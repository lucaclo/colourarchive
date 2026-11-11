# Shortlist, round 6: Match accuracy in Lightroom

Evidence: `recon.md`. Impact 1–5, effort S/M/L.

| # | item | gap | impact | effort |
| --- | --- | --- | --- | --- |
| 1 | **Lightroom's curve.** Natural cubic spline everywhere a curve is evaluated (solver, preview, round trip), with fitted curves kept monotone. Tested against real Lightroom exports. | G1 | 5 | S |
| 2 | **One Lightroom model.** `lr-model.ts`: linear exposure, RGB tone in Melissa, the measured mixer/Saturation/Vibrance and Colour Grading tables, Lightroom's stage order, masks as before. | G2 G4 G5 G6 | 5 | L |
| 3 | **Simulate, then refine.** A pixel sample stored with each analysis; the solver's answer is rendered through the model and corrected until the measured gaps stop shrinking. Faithful aims at the reference, Restrained at its own intent. | G3 G8 | 5 | M–L |
| 4 | **The preview is the model.** The WebGL shader runs the same stages (curve LUT in Melissa, mixer grid and grading gains as textures). | G1 G2 G6 | 4 | M |
| 5 | **How close it will get.** Predicted ΔE per zone and region, in plain words on the result. | G7 | 4 | S |
| 6 | **Accuracy benchmark.** `npm run match:bench`: synthetic grades with known answers plus real archive pairs; before/after numbers in `diff.md`. | — | 4 | M |
| 7 | **References weighted by likeness.** With several references, each one's default weight follows how much it resembles your photo. | Capture One | 2 | S |

## Status (2026-10-15, branch `round-6`)

| # | item | result | commit |
| --- | --- | --- | --- |
| 1 | Lightroom's curve | built; matches Lightroom's exports to 0.01 of a level | `030b7f0` |
| 2 | One Lightroom model | built, plus Lightroom's measured HSL band edges and a pixel sample per analysis | `4e9135d` |
| 3 | Simulate, then refine | built, **changed in the build**: the benchmark showed refinement chasing content, so it gained a prior toward smaller moves, Exposure as a refinable control, and composition re-weighting of the reference | `db601d6` |
| 4 | The preview is the model | built; within 2 levels of the CPU model in the browser, masks included | `8846566` |
| 5 | How close it will get | built, as one distance that counts colour and contrast (zone ΔE alone misled) | `8846566` |
| 6 | Accuracy benchmark | built: `npm run match:bench`, numbers in `diff.md` | `db601d6` |
| 7 | References weighted by likeness | built; each reference is also composed before blending | `e4378f3` |
| 8 | Point Color (added 2026-10-16, from Next) | built for skin, foliage and water: corrections that used to be "draw this mask yourself" now travel in the preset; the writer matches Adobe's Film 07 swatch exactly | `bfcba40` |

### Next candidates

- A Lightroom zero-slider export as the default baseline for RAWs (removes the exposure caveat).
- Fit the masks' local sliders the way the global ones were.
- Restart `astro dev`: its stale Vite hash breaks Scout in dev (and the R5-4 tests).
- Point Color Variance and wider use (any colour the reference treats differently, not only segmented regions).
