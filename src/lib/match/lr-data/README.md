# Lightroom measurement data

Measured data about how Lightroom / Camera Raw renders, used to make Style Match's model of
Lightroom match the real thing. None of it is Adobe's code or images.

All files here come from [RAWmakase](https://github.com/pch/rawmakase) (MIT, see
`LICENSE-rawmakase`). They were fetched on 2026-10-14 from `main`.

| file | origin | what it is |
| --- | --- | --- |
| `lightroom-point-curves.json` | `tests/data/` | Lightroom Classic 15.5.1 16-bit exports of synthetic sRGB ramps under known point curves (identity, an S curve, per-channel curves, clipped curves), at Refine Saturation 100. Rows: 7 strips × 32 samples; columns: linear, s, rgb, clipped, rgb-clipped. Used as ground truth by `curve.test.ts` and `lr-model.test.ts`. |

The curves behind each column are in RAWmakase's `scripts/make-curve-fixtures.py`:
S = (0,0) (48,24) (128,142) (200,224) (255,255); clipped = (32,16) (96,120) (200,224).
