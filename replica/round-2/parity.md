# Parity, round 2

2026-10-13. `replica/round-2/features.csv`, scored with `parity.py`. Here
`original` is the best competitor for each row and `clone` is Colour
Archive.

| | start of round 2 | now |
| --- | --- | --- |
| feature score | 30.4 | **94.6** |
| must-haves | 3 of 8 | **8 of 8** |

| area | now |
| --- | --- |
| archive colour | 97.5 |
| Scout look | 94.1 |
| Scout speed | 88.9 |

## Measured

| | before | after | how |
| --- | --- | --- | --- |
| time scrub, central London z15.4 | 95 ms a minute | **15.4 ms** | `profile-scout.mts`, best of 5 |
| desktop London, settled | 7.2 s | **6.0 s** | `load-scout.mts`, prod build, median of 5 |
| phone London, settled | 4.5 s | **4.2 s** | same |
| our own load stalls removed | — | shader compile 0.7 s, probe context 0.36 s, raster decode 0.2 s, and MapLibre's 1.5 s of compile checks queued behind ours | CDP profile |
| colour search, two colours | — | 0.02 ms over 111 photos | script |
| photo discs at z12, London | ~150 | 9 clusters | screenshot |

All in SwiftShader (WebGL on the CPU). Compare these with each other, not
with an iPad.

## Still missing, in build order

1. **[should] Settle under 4 s on a city.** What's left is MapLibre's
   hillshade framebuffers (2.6–3.2 s here) and the globe readback
   (0.75–0.9 s). Both are inside the library, and SwiftShader overstates
   them. Measure on the iPad, then decide whether relief detail is worth
   trading for them (a z12-capped hillshade source is the lever).
2. **[could] Light sheet over the day map.** Check on the iPad first.
3. **[could] Suggested swatches on the inspiration board.** It has no
   chapters. Its own k-means colours would do.

## Behaviour against the best competitor

| flow | best competitor | Colour Archive now | keep or fix |
| --- | --- | --- | --- |
| find a colour | Eagle: a grid in under 0.5 s | ranked tray at once, the archive's hue order kept underneath, the matched swatches shown on each result | keep |
| several colours | TinEye Multicolr: 5 colours, weights | 3 colours, share of frame per colour, the rest a wildcard | keep. Three is enough for photographs with six-swatch palettes |
| more like this colour | Eagle Swatch Book: tap a swatch | tap a swatch in the lightbox | keep |
| scrub the day | Sunlitt: "smoother" (claim) | 15 ms a minute with real building, tree and wall shadows | keep |
| read a city at a glance | PhotoPills: one pin | clusters with totals, the sun ring dominant again | keep |
| a problem with the map | (none surveyed) | a small corner note with the reason behind a tap | keep |

## Verdict

**Shippable for you.** All 8 must-haves are done, and no S1 or S2 bug is
open (the one S2, scrub speed, is fixed). The last should-have needs an
iPad measurement, not more code.
