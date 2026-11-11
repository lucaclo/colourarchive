# Parity: Colour Archive against its competitors

2026-10-13. `replica/features.csv`, where `original` is the best competitor for
each feature and `clone` is Colour Archive. Scored with `parity.py`.

## Scores

| | before (2026-10-09) | now |
| --- | --- | --- |
| feature score | 60.3 | **92.6** |
| must-haves | 8 of 12 | **11 of 12** |

| area | now |
| --- | --- |
| archive | 100 |
| inspiration | 100 |
| book | 93.3 |
| scout | 92.9 |
| match | 81.2 |

**No layout score, on purpose.** This pass closes gaps in what the app does. It
doesn't copy anyone's screens, so there's nothing to diff a layout against.
Screenshots of the new screens are in `replica/clone-screens/`.

## Still missing, in build order

1. **[must] Read exact settings from a reference's own metadata** (FindPreset).
   Not chosen on 2026-10-09. It's the one must-have left, and it's small: read
   `crs:` from the reference's XMP, then show it beside the measured estimate.
2. **[could] 16-page zine.** Deferred: it means duplex imposition (checked by a
   fold simulation), a new fold, and reworking the zine maker. See the build log.
3. **[could] Timelapse and star-trail simulation** (Planit). Low value for how
   the archive is shot.

Left out on purpose, not scored: per-spot community data, account sync, a
style learned from your own past edits, and a sunset score.

## Behaviour differences

| flow | best competitor does | Colour Archive does | keep or fix |
| --- | --- | --- | --- |
| find a colour | Eagle: pick a shade, results in under 0.5 s | pick a shade or type a hex, plus chroma and lightness ranges; runs in the browser, works offline and on the published site | keep |
| match a look across a set | Capture One: AI, tone and colour only, ~20 s for 400 photos | one measured solve per photo, including grain, vignette and texture, with refusal reasons; about 10–20 s a photo on the Mac | keep; slower but it says why |
| plan a meteor night | PhotoPills: AR radiant, peak dates | peak, radiant hours, moon and site darkness at the pin, one tap to the best hour; no AR radiant | keep; AR is a possible follow-up |
| stand at a spot | ShadowMap: walk/fly first-person view | stand at the pin facing the frame or the sun, with real shadows, buildings and trees | keep |
| make a book | Lightroom Book module: templates, Send to Blurb | spreads, border / bleed / two-up / blank, Blurb and A-size trims, 300 dpi PDF with TrimBox and BleedBox; upload to Blurb by hand | keep |
| save a reference from the iPad | mymind / Cosmos: share sheet in one tap | a Shortcut set up once, then one tap; follows page links to their image | keep |

## Verdict

**Shippable for you, by the skill's own terms almost.** No open S1 or S2 bugs,
and the feature score is 92.6. Strictly it's "not shippable" because one
must-have is missing, but that's the one you chose not to build.

## Top five next

1. Exact `crs:` settings from a reference (the last must-have, small).
2. Update `tests/scout.smoke.ts` to the map-first redesign: 3 suites time out
   on selectors the redesign hid. This was already broken on `main`.
3. Upgrade Astro and `@astrojs/node` for the `npm audit` advisories.
4. 16-page zine, done properly.
5. An origin check on every POST route; the existing ones accept cross-site forms.
