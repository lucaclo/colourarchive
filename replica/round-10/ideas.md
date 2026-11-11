# Round 10: the Inspiration tab, ranked

Date: 2026-11-02. **Update, same day:** A1–A6, B1–B4, C1 and C2 are built on branch `round-10`, without
the Flickr API (it's paid). Flickr is read through the public feed each profile page links to,
alongside Bluesky, Mastodon, Are.na and any site's RSS. C3–C7 are not built. The evidence is in
`recon.md`, the matrix in `features.csv`.

**The one-line diagnosis:** the board has 11 references, none credited, and none added in nine
weeks. It can only grow by hand. Favourite photographers turn it from a pinboard into something
that brings work to you. Credit has to be inferred, because typed fields go unused.

**The unique angle:** neighbours find similar *images*. Colour Archive can find similar
*photographers*, and say why in darkroom terms, because it already measures the grade of every
picture locally.

## A. Favourite photographers (what you asked for)

| # | idea | impact | size |
| --- | --- | --- | --- |
| A1 | **Credit without typing.** On add, read who took it: the share link's page (og:title / author meta), the Flickr owner, the Bluesky author, the Are.na source, EXIF `Artist` / IPTC creator. A small caption under each tile: *Name · Flickr ↗*. For the 11 already there: a one-time "Who took these?" tray, with unknowns grouped by look so one name can cover several. | 5 | S |
| A2 | **Favourites shelf.** A star on any credit. Above the board, one row of favourites: their best reference as a cover, the name in Fraunces italic, and *3 new* when there is something. Plus a 4th group-by: *Photographer*. | 5 | S |
| A3 | **Link a profile once.** Paste any profile link: flickr.com/photos/…, bsky.app/profile/…, are.na/…, unsplash.com/@…, or a site with RSS. The resolver identifies the platform and resolves the real id through the API (the `notable.ts` rule: never guessed). Instagram and Glass links are kept for linking out. | 5 | M |
| A4 | **Their work (the subsection).** Tap a favourite and a sheet opens: on top, *Yours from them* (pinned refs) and their look card; below, *More from them*, a grid of public photos not on the board. Thumbnails are hotlinked (Unsplash requires this). Tap to view large, **Pin** to store the original with credit, link and licence; **Pass** to hide. On the phone: swipe right to pin, left to pass. | 5 | M |
| A5 | **New since you last looked.** When the board opens (and when the Mac app runs), check favourites. One quiet row: *6 new · Mia, Oscar*. Oldest first, and it **ends**: *That's everything since Tuesday.* No infinite feed, no ranking. | 4 | S |
| A6 | **Seed it from your Instagram export.** Instagram's "Download your information" ZIP (your own data) lists your saved posts and who you follow. Import it once to get a favourites list ranked by how often you saved each person. No typing, no API, within the terms. (Check the JSON paths against your actual export; Meta moves them.) | 4 | S |
| A7 | *Optional:* Instagram **professional** accounts' recent posts through Business Discovery. It needs your account switched to Professional (free), your own Meta developer app, and a token refreshed every 60 days. It covers creators and businesses only. Without it, Instagram stays share-to-pin, and A1 fills the credit. | 3 | M |

Sources by how well they work: **Flickr** (Scout's `FLICKR_API_KEY`; no `.env` on this Mac right now, so it needs adding; licence per photo) →
**Bluesky** (public, no auth; tested) → **Are.na** (public reads; tested) → **Unsplash** (free
key, 50/h) → **site RSS / og:image** → Instagram (A7 only) → Glass, VSCO, Cosmos (link out).

## B. Similar photographers

| # | idea | impact | size |
| --- | --- | --- | --- |
| B1 | **A style fingerprint per photographer**, computed locally from thumbnails of their pinned and public work: grade (`looks.ts`: black point, curve, split-tone hues, saturation by band, grain), palette (OKLCH), content (CLIP), and form (DINOv2). Every pipeline exists. | 4 | M |
| B2 | **Candidates from your favourites' world.** There's no global index of photographers, so take who they follow on Bluesky, their Flickr contacts and the owners of their Flickr faves, and the other artists in Are.na channels that hold their work. Then filter to accounts that mostly post photographs and have at least 12 public images. | 4 | M |
| B3 | **Rank and explain.** Compare each candidate with the *nearest* favourite, not an average (taste has several modes), and keep the list varied. A card: name, a 6-frame contact strip, one reason line from measured numbers and `names.ts`. For example: *Same lifted blacks and teal shadows as Oscar K. Warmer skin.* Actions: **Favourite** · **Later** · **Not for me**. Not for me moves that direction down next time. | 4 | S on top of B1/B2 |
| B4 | **Similar photographer from a single picture.** In the lightbox, next to *Similar* (in your archive): *Who else shoots like this?*, using the same ranking for one reference. | 3 | S |

## C. Bigger leaps (out of the box)

| # | idea | impact | size |
| --- | --- | --- | --- |
| C1 | **A photographer's look as a preset.** On a favourite's sheet: *Match their look*. It feeds all their pinned refs into Style Match's existing multi-reference group and writes one named `.xmp` (e.g. *Oscar K.xmp*) to the preset zip. Mostly glue; the effect is "my favourites, in Lightroom". | 4 | S |
| C2 | **Shoot this light.** From a reference or a whole photographer, read the light: CLIP words (golden hour, blue hour, overcast, backlit, night flash) checked against measured colour temperature and contrast. Then Scout gives *the next time this light happens* at your kept spots or here: *Low warm backlight · Thu 16:40 · 3 of your spots.* Inspiration becomes a shoot plan. | 4 | M |
| C3 | **Daily nudge.** One push a day, opt-in: one new photo from a favourite, plus the matching light this evening if C2 finds it. It's the nudge Alpenglow's fans love, without a score. (`push.ts` exists, so the push needs nothing new.) | 3 | S after A5/C2 |
| C4 | **Study card.** One tap on a reference: composition (horizon, thirds, subject position, negative space), light direction, lens guess where EXIF exists (Glass users love seeing metadata), palette and grade, all in notebook style. It turns liking a picture into learning from it. | 3 | M |
| C5 | **Taste vs work.** A quiet map: your inspirations by photographer and your own archive in the same space. Shows the styles you love and never shoot, and the favourite your work sits closest to. | 3 | M |
| C6 | **Sets.** Make the transient group tray a saved set (*Iceland*, *Zine 3*), usable as the reference for Match, the brief for a Scout trip, or the mood page in a zine. | 3 | S–M |
| C7 | **Board basics found on the walk.** On the iPad, 11 refs render as one giant tile per row (see `round-9/tour/ipad-board-1.png`), so add a denser contact-sheet option. Add a near-duplicate guard (DINOv2) when pinning from feeds, and *shuffle*. | 2 | S |

## Not suggested

An algorithmic or infinite feed, likes or follower counts, a taste-picker onboarding, scraping
Instagram or Glass, and saving full-res copies of photos you didn't pin. Those are the things
neighbours' users complain about, or that break the platforms' terms.

## Decisions to make before building

1. Which sources, beyond Flickr + Bluesky + Are.na: Unsplash (key)? Instagram via A7?
2. Fetch only while the board is open, or in the background from the Mac app (needed for A5 push)?
3. Keep `photographers.json` gitignored (recommended; the repo is public)?
4. Does a suggestion need your approval before its photos are fetched (privacy-quiet), or fetch
   on sight?

## Suggested order

1. **A1 + A2**: credit and favourites. Small, and everything else hangs on them.
2. **A3 + A4 + A5**: the subsection and the new-since row (Flickr, Bluesky, Are.na first).
3. **A6**: seed favourites from the Instagram export (solves the cold start).
4. **C1**: the photographer preset (quick win on existing Match).
5. **B1 → B3**: similar photographers.
6. Then one leap: **C2** (most useful) or **C4** (most learning).
