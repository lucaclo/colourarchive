# Round 5 recon: what alternative apps do that we don't yet

Date: 2026-10-14. Branch `round-5` (from `round-4` at 13e0860).
Scope: the whole app again, but looking at **new** neighbours that rounds 1–4 didn't cover: sunset
forecasters, culling tools, colour-theory tools, photobook editors, sequencing boards, portfolio
apps, and the 2026 releases of the apps we already follow.
Rules as before: public pages only, every claim linked, vendor pages marked (vendor).

## Sources

| app | area | what it gave | source |
| --- | --- | --- | --- |
| Sunsethue (app launched 23 Jul 2026) | Scout | 3-day sunrise/sunset quality with **uncertainty, rarity, sun visibility at the horizon, cloud by altitude**; Glow tier adds alerts over a threshold, maps, widgets | [mobile app](https://sunsethue.com/mobile-app) (vendor), [launch post](https://sunsethue.com/news/mobile-app-launch) (vendor) |
| Alpenglow (Jul 2026 listing) | Scout | quality forecast **7 days ahead** (was 4), forecast maps, AR sun path, Live Activities countdown, **field reports after a sunset** | [AppFollow listing](https://apps.appfollow.io/ios/sunset-predictions-alpenglow/978589174?country=us) |
| PhotoPills (v2.13, Mar 2026) | Scout | no 2026 notes; nothing that changes the verdict | [AppFollow](https://apps.appfollow.io/ios/photopills/596026805?country=dk) |
| Narrative Select (2026) | Book, Archive | **Survey Mode**: near-identical frames side by side, zoom and pan together, pick the keeper; Scenes view; Close-ups panel | [Fstoppers, sponsored](https://fstoppers.com/sponsored/best-photo-culling-software-2026-how-narrative-keeps-story-your-hands-904050), [Narrative](https://narrative.so/use-cases/wedding-photographers) (vendor) |
| Photo Mechanic | Archive | one key tags (`t`), number keys rate or colour-class, auto-advance | [Camera Bits docs](https://docs.camerabits.com/support/solutions/articles/48001143067), [colour classes](https://docs.camerabits.com/support/solutions/articles/48001142942) |
| Adobe Color | Colour search | **harmony rules from a base colour** (analogous, monochromatic, triad, complementary, split complementary, square, compound, shades); extract a theme from an image with a mood | [Adorama guide](https://www.adorama.com/alc/adobe-color-wheel), [Adobe FAQ](https://helpx.adobe.com/si/creative-cloud/adobe-color.html) |
| Artifact Uprising | Book | Autofill that respects aspect ratio; a live preview of a layout with your photo before you commit; Manage Pages view | [help: layouts](https://help.artifactuprising.com/hc/en-us/articles/22007832055963-Layouts-for-Photo-Books) (vendor), [what's new](https://www.artifactuprising.com/diy/whats-new-editor) (vendor) |
| Sequencing roundup, Jun 2026 (Milanote, Lightroom survey, Affinity, Kunstmatrix) | Book | "page turns, spacing, **pairings** and pacing", "what sits on the next page is as important as what sits on the current one"; Lightroom survey for relationships | [The App Whisperer](https://theappwhisperer.com/2026/06/best-sequencing-apps-for-photographers-in-2026/) |
| Glass (Jun 2026) | Add & remove | **deleting a photo asks first** so you don't remove work by accident; a clear message instead of a silently disabled button | [Glass updates](https://glass.photo/updates) (vendor), [5.1](https://glass.photo/highlights/glass-5-1) (vendor) |
| Immich 3.1 (29 Jul 2026), 3.2 | Add & remove, search | **Undo archive**; search v2 with include/exclude sets and ranges; a redesigned search modal | [Immich blog](https://immich.app/blog?type=post), [August recap](https://immich.app/blog/2026-august-recap) (vendor) |
| Apple Photos, iOS 26 | Archive | Pinned collections you edit; Favourites as the first pin | [Apple support](https://support.apple.com/en-ca/121870) |
| Are.na (Sep 2026) | app-wide | a customisable bottom tab bar on iPad | [newsletter](https://buttondown.com/aredotna/archive/areal-download-party-revamped-homepage-new/) |
| Google Photos 7.82 (Jul 2026) | Zine | collage templates grouped by kind, with a Borders view | [Android Authority](https://www.androidauthority.com/google-photos-collage-updates-3686396/) |
| 16-panel Mini Magic Zine Imposer | Zine | 16 pages from **one sheet printed both sides**, one cut, no staples | [itch.io](https://curioustype.itch.io/16-panel-mini-magic-zine-imposer), [onepagezine](https://sites.google.com/view/onepagezine/start) |
| Lightroom mobile 11.5–11.6 (Aug–Sep 2026) | Match | generative expand and photo-to-video only; nothing for comparison or presets | [Adobe release notes](https://helpx.adobe.com/lightroom/mobile/whats-new/adobe-lightroom-on-mobile-release-notes.html) (vendor) |
| Cosmos | Board | no dated 2026 changelog found (searched again) | — |

## Screens seen today (before), `screens-before/`

| screen | state | what stands out |
| --- | --- | --- |
| S01 Archive, iPad | filled | calm; colour popover is clear |
| S02 Lightbox, iPad and phone | filled | words for Similar/Match/Chapter work since round 4 |
| S05 Match result, **phone** | filled | two pictures side by side at ~290 px each; "Hold for the original" sits on top of "Yours, graded"; the left picture runs off the left edge. The report starts at ~1,100 of 2,000 px |
| S07 Book list, phone | filled | ⧉2 badges keep one and drop the rest in **one tap**, with no look at them side by side |
| S10 Scout place, iPad | filled | the date chip and calendar know nothing about the sky on other days; the horizon forecast lives only on the day you're looking at |
| S11 Add & remove | filled | Remove asks twice (armed state) but can't be undone |
| Book, Zine (iPad) | filled | an "Offline" pill appeared once in the screenshot run; it did not reproduce (navigator.onLine stays true), so it's noted and not chased |

## Inferred patterns worth taking (and the ones we skip)

| pattern | from | take? | why |
| --- | --- | --- | --- |
| Several days of sky at a glance, no score | Alpenglow 7-day, Sunsethue | **yes** | we already compute an honest horizon verdict (lit / bare / blocked) for one day; the calendar can carry it for every forecast day |
| Alerts when the sky clears | Sunsethue Glow, Alpenglow Pro | no | needs push and a server; Scout stays local |
| A quality score out of 100 | Sunsethue, Alpenglow | no | weather.ts refuses a score on purpose |
| Survey near-identical frames side by side, then pick | Narrative, Lightroom | **yes** | Book's ⧉ badge acts in one blind tap |
| Undo after removing | Immich 3.1, Gmail | **yes**, client-side | the delete waits a few seconds in the page; no server change |
| Harmony rules from a base colour | Adobe Color | **yes** | colour search already takes up to 3 colours; the zine already has RYB harmony maths |
| One picture with a wipe on a phone | Photomator (round 4 ref) | **yes** | the phone stage is broken (overlapping labels) and halves both pictures |
| Context actions in the palette | Immich ⌘K | **yes** | round 4's next candidate |
| 16 pages on one sheet | Mini Magic Zine Imposer | **yes** | deferred three times; the imposition is now documented |
| Favourites / ratings | Photo Mechanic, Apple Photos | no | "in the book or not" already is our one pick; a second flag would split it |
| Customisable tab bar | Are.na | no | four tabs fit; nothing to pin |
| Field reports after a sunset | Alpenglow | could | later; it needs a place to keep them |
