# Round 9: what would make a real difference

Date: 2026-10-29. Branch at the time: `round-8-hotspots`. Nothing was built this round; this is
the plan for choosing.

## How this was found

- **Reviews (replica-entrepreneur method, research mode):** 7,374 App Store reviews from Apple's
  public customer-reviews RSS feed, US and GB, for 17 neighbours: Lightroom, Photomator, Darkroom,
  VSCO (Match); PhotoPills, Sun Surveyor, Alpenglow, Atlas Photo (Scout); mymind, Cosmos, Are.na
  (Inspiration); Immich, Mylio (Archive); Chatbooks, Artifact Uprising, Mixbook (Book); Glass.
  Ranked with `reviews.py` → `feedback.md`; raw rows in `reviews.csv`. 1,805 are from 2026.
  Reddit refused unauthenticated requests (403), so it isn't in the sample. Hacker News was
  searched through the Algolia API (two useful threads, linked below).
- **A walk through the app:** every page at iPad (1180×820) and phone (390×844), in `tour/`.
- **The data itself:** what the archive holds and how it has been used.

## What the data says (the most important part)

| fact | number |
| --- | --- |
| photos | 110 (74 digital, 36 film) |
| film photos with no capture date | 27 of 36 |
| photo notes written (`src/data/notes.json`) | 0 (file doesn't exist) |
| photos placed on the map (`photos.locations.json`) | 1 |
| photos added since 2 Oct | 0, while 70+ feature commits landed |
| server running when this round started | no; "Nothing starts it for you" (GET-THE-APP.md) |
| Mac app reachable from the iPad | no; it binds 127.0.0.1:43210 |

Two conclusions:

1. **Features that ask you to type don't get used.** Notes and placement both exist and both are
   empty. Anything new should infer or need one tap.
2. **The weak link is getting photos in.** The iPad is where the editing happens, but adding a
   photo needs the Mac's dev server started by hand. The archive stopped growing.

## What neighbours' users say, in short

- **Prices, paywalls, accounts, ads** are the top four complaints in every category (1,197 + 314
  + 268 + 107 reviews). Colour Archive has none of them; it's an advantage, not a to-do.
- **Opaque scores that don't match the sky** dominate Alpenglow's 1–2★ reviews: *"It said poor,
  but it was gorgeous"*
  ([review](https://apps.apple.com/us/app/id978589174?see-all=reviews#review-11509336600)).
  Its fans love the **daily nudge**: *"I love receiving notifications every day it makes me feel
  like I'm in tune with the Earth"*
  ([review](https://apps.apple.com/us/app/id978589174?see-all=reviews#review-14595662370));
  *"It's keeps me off my phone and sends me outside"*
  ([review](https://apps.apple.com/us/app/id978589174?see-all=reviews#review-13857547859)).
- **AI fatigue** in editors: *"I don't Want to write prompts. I want to move sliders"*
  ([Lightroom](https://apps.apple.com/us/app/id878783582?see-all=reviews#review-14502116550)).
- **iPad can't cull or rate** (Photomator,
  [review](https://apps.apple.com/us/app/id1444636541?see-all=reviews#review-14681211102)).
- **Moodboards:** shuffle on pull
  ([mymind](https://apps.apple.com/us/app/id1520332347?see-all=reviews#review-13800213542)),
  re-importing a folder shouldn't duplicate
  ([Cosmos](https://apps.apple.com/us/app/id1577975475?see-all=reviews#review-14023798882)).
- **Books:** prints that come out *"muddled up and fuzzy"*
  ([Mixbook](https://apps.apple.com/us/app/id1562974920?see-all=reviews#review-13425459467));
  the date on the spine
  ([Chatbooks](https://apps.apple.com/us/app/id734887606?see-all=reviews#review-14549377566)).
  Sequencing is "mostly a sequencing problem, not a photography problem"
  ([SLR Lounge](https://www.slrlounge.com/how-to-create-a-photo-book-that-tells-a-story/)), and
  "nothing beats physical prints spread out on the floor"
  ([Storyflow](https://storyflow.so/blog/how-to-make-a-photo-book)).
- **Lightroom mobile added natural-language search in August 2026**
  ([release notes](https://helpx.adobe.com/lightroom/mobile/whats-new/adobe-lightroom-on-mobile-release-notes.html)),
  so text search alone is no longer a reason to open the archive. Colour and sequence still are.
- Hacker News on film scanning: *"Scanners sucked the joy out of photography"*, and sharing
  feels pointless next to generated images
  ([thread](https://news.ycombinator.com/item?id=49946148)).

## Ranked suggestions

Impact 1–5, size S/M/L. ★ = out-of-the-box.

| # | idea | area | impact | size |
| --- | --- | --- | --- | --- |
| 1 | **An inbox folder.** Lightroom on the iPad exports to an iCloud Drive folder, `Colour Archive Inbox`. The Mac app imports whatever lands there, when it next runs, and moves the originals into the archive. No server needs to be up while you edit. | ingest | 5 | M |
| 2 | **The Mac app as the archive's home.** It opens at login (an Electron login item, which you switch on yourself), and it serves the LAN on a `.local` name so the iPad's home-screen app works whenever the Mac is awake. `/get` then points the iPad at it. | ingest | 5 | M |
| 3 | **Places without typing.** (a) Now, no code: turn on location linkage in Sony's Creators' App, so the a7C II writes GPS from the phone ([Sony guide](https://helpguide.sony.net/dc/2210/v1/en/contents/TP1000934576.html)). (b) For the 110 already in: match each capture time with iPhone photos taken within ±20 min in the Mac's Photos library (read-only), suggest the place, one tap to accept. That fills Scout's "Your photos", captions and a map. | archive, Scout | 5 | M |
| 4 | **Print check in Book.** Per page: effective ppi at its treatment. About 20 film scans (≈1400×2048) land near 200 ppi full-bleed on the 10×8 trim. Flag them and offer "pair" or "border" instead. Add a spine (title and years) and a colophon page built from EXIF (cameras, films, dates, places). | Book | 4 | S |
| 5 | ★ **Sequencing help: rhymes and rhythm.** A thin strip over Spreads showing lightness and colour across the whole book, with jolts marked. "Rhymes" for each spread: photos whose shapes or lines echo this one (DINOv2) but whose colour turns the page. Keeps hue order as the default, adds the editor's eye. | Book | 4 | M |
| 6 | **Tonight at your spots.** A web push from the Mac (VAPID, no third-party service) when a kept spot's horizon reads *lit* this evening, or for aurora or a meteor peak. The reasons go in words, never as a percentage. Needs #2. Web push works for home-screen web apps on iPadOS 16.4+ ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). | Scout | 4 | M |
| 7 | ★ **The sky checks itself.** Once photos carry GPS (#3), a photo taken at a kept spot at sunset is measured, and its colour is set against what Scout said that evening. Over time this becomes an honest track record ("Scout said lit 9 times; 7 were") instead of a score. | Scout | 3 | M |
| 8 | ★ **Your own look.** The archive measures every photo's grade already (`looks.ts`). Show which photos drift from the rest of their chapter, and offer "match my own best" as a reference in Style Match: a house style made from your work, not someone else's. | Match | 3 | M |
| 9 | ★ **Colour clock.** A frame mode for the iPad on a stand: the archive follows the light outside. Blue chapter at blue hour, orange at golden hour, ash under a flat sky, using Scout's sun and cloud for your location. One photo at a time, slow fades. | Archive | 3 | S–M |
| 10 | **Film rolls.** Group film scans by scan batch (consecutive Noritsu numbers and the same `addedAt`) into rolls: a date range and a name ("Roll 4, Kyoto") where today there are 27 undated frames with identical captions. | Archive | 3 | S |
| 11 | ★ **Sequence on the floor.** Print work prints (16 per A4, each with a short code), lay them out, photograph the floor with the iPad, and the app reads the order and sets the book. It matches each print to the archive by image, so the codes are only a fallback. | Book | 3 | L |
| 12 | **Fixes found on the walk.** At 1180 px (iPad Air landscape) the top bar's Insights button runs into the edge. On a phone the zine editor's last controls sit under the tab bar. | all | 2 | S |
| 13 | **Retire or reshape the unused.** Notes (0 written) and hand placement (1) either become zero-typing (#3, a voice note) or fold away, so the lightbox carries less. | archive | 2 | S |

Not suggested: accounts, subscriptions or a feed (what neighbours' users hate most); a sunset
percentage (Alpenglow's worst reviews); AI generation or prompts (editor fatigue); a public
"likes" layer (Glass users value its absence).

## Suggested order

1. **#3a today** (a camera setting, no code).
2. **#1 + #2** together: the archive grows again, and they unlock #6 and #7.
3. **#4 and #10**: small, and they fix real print and caption problems.
4. Then pick one ★: **#5** (it uses data already measured) or **#9** (the most delight for the least work).
