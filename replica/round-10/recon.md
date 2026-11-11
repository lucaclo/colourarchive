# Round 10 recon: the Inspiration tab, photographers and discovery

Date: 2026-11-02. Branch at the time: `round-9`. This is competitor research, not a clone. The
neighbours are studied for what they do. None of their code, assets or copy is taken.

## Scope

- **App:** Colour Archive `/inspiration` (the board, plus Style Match inside it). Mostly used on
  the iPad, also on the phone and the Mac.
- **Slice:** collecting references, crediting them, following photographers, and discovering new ones.
- **For:** one photographer, single user and local-first. No login, Stripe or feed (see the
  `competitor-recon-2026-10` decisions).

## What the board is today (measured, not guessed)

| fact | value |
| --- | --- |
| references on the board | 11 |
| references with a `source` (credit) | **0 of 11** |
| last reference added | 2026-08-28 (none in 9 weeks) |
| where they came from | 4 own Sony files (`DSC…`), 4 Instagram CDN downloads (`…_n.jpg`), 2 share-sheet `temp_image` webp, 1 screenshot |
| measured per reference | DINOv2 embedding, CLIP embedding (on the newest 4), OKLCH palette, colour grid, chapter, genre |
| actions per tile | Similar (in your archive), Match, + group, remove |
| group-by | Colour / Genre / Similar, plus the colour tray |
| published? | no: `prerender = false`, the board never reaches the build. Originals in `inspiration/` are gitignored. `src/data/inspiration.json` (metadata) **is** committed to the public repo |
| existing pieces to reuse | `fetchImageFromUrl` (og:image, SSRF-guarded), share-sheet capture, `FLICKR_API_KEY` + `scout/sources/flickr.ts`, `notable-photographers.json` (provenance rule: ids resolved, never guessed), `push.ts` (web push), Style Match `group.ts` (multi-reference match), `looks.ts` (grade fingerprint), `names.ts` (colour words), `clip.ts` (text↔image) |

Two conclusions, matching round 9:

1. **The "Whose is it? (optional)" field is never filled.** Credit has to be inferred.
2. **The board stalled because feeding it is manual.** Every reference needs a trip to another
   app, a download or share, then an upload. The board has nothing that brings new work to you.

## Sources

| source | what it gave | url |
| --- | --- | --- |
| Cosmos help: Discovery | "similar elements" by style, colour, mood, composition; follow profiles and clusters | https://help.cosmos.so/en/articles/11717949-discovery |
| Cosmos support / App Store | follow friends and tastemakers, personalised feed, credits on images, AI filter | https://www.cosmos.so/support · https://apps.apple.com/us/app/cosmos-search-discover/id1577975475 |
| Cosmos Series A (Jan 2026) | expanding "social discovery and attribution" | https://pulse2.com/cosmos-15-million-series-a-closed-as-it-expands-social-discovery-and-attribution-features |
| Savee blog | "More Like This"; find people to follow from the detail page; "no algorithm" | https://inspire.savee.com/ · https://inspire.savee.com/we-made-some-nice-updates-to-savee/ |
| Are.na API v2 docs (deprecated → v3) | public reads with no auth: channels, contents, blocks, and which channels a block is in | https://dev.are.na/documentation/channels · https://dev.are.na/documentation/blocks |
| Bluesky `getAuthorFeed` | `filter=posts_with_media`, public host. **Tested here with no auth: works** (images + follows) | https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed |
| Flickr API | `people.getPublicPhotos`, `contacts.getPublicList`, `favorites.getPublicList`, licence per photo. The key already exists for Scout. The public feed `photos_public.gne` **tested: works with no key** | https://www.flickr.com/services/api/ |
| Unsplash API | user photos, 50 req/h in demo mode, hotlinking **required**, download tracking | https://unsplash.com/documentation |
| Instagram Business Discovery | other **professional** accounts' recent media only; needs your own Professional account + Meta app + token | https://developers.facebook.com/docs/instagram-api/guides/business-discovery · https://www.getphyllo.com/post/instagram-api-guide |
| Round 9 reviews (`replica/round-9/reviews.csv`) | Cosmos, Glass, mymind, Are.na, VSCO quotes on discovery, credit, algorithms | see below |
| Glass profile RSS | `glass.photo/<user>/rss` returned 404 for the name tried. **Unverified**, treat Glass as link-out only | — |

## What neighbours' users say (verbatim, linked)

- Credit is loved: *"I also really love all imagery come with references and credits"*
  ([Cosmos](https://apps.apple.com/gb/app/id1577975475?see-all=reviews#review-13219193555)).
- Similar-by-image is the hook: *"the match-making it does when you select one photo it shows you
  everything visually similar. I want to browse the whole web like this!"*
  ([Cosmos](https://apps.apple.com/us/app/id1577975475?see-all=reviews#review-11128691040)).
- Feeds go stale or irrelevant: *"the same pool of images no matter how many times you refresh"*
  ([Cosmos](https://apps.apple.com/us/app/id1577975475?see-all=reviews#review-14165063170));
  *"Home feed doesn't recommend anything relevant"*
  ([Cosmos](https://apps.apple.com/us/app/id1577975475?see-all=reviews#review-13076392361));
  *"I'd really love if the feed was more personalized to the elements that I save"*
  ([Cosmos](https://apps.apple.com/us/app/id1577975475?see-all=reviews#review-13598732924)).
- AI images contaminate discovery: *"the Ai photos mean nothing to me … the creativity of artists
  no computer can recreate"*
  ([Cosmos](https://apps.apple.com/gb/app/id1577975475?see-all=reviews#review-13422080516));
  source links that *"trace back to some instagram account that makes ai generated images"*
  ([Cosmos](https://apps.apple.com/us/app/id1577975475?see-all=reviews#review-11575539356)).
- No algorithm, just who you follow: *"You see the photographers you follow and the 'hash tags'
  you search for. That's it."*
  ([Glass](https://apps.apple.com/us/app/id1528446339?see-all=reviews#review-11895834903));
  *"promoting metadata (I can see the lens, the camera, the f-stop…)"*
  ([Glass](https://apps.apple.com/us/app/id1528446339?see-all=reviews#review-13568784269)).
- Discovery on a follow-only app is hard: *"If good content is hiding somewhere - it is hard to find"*
  ([Glass](https://apps.apple.com/us/app/id1528446339?see-all=reviews#review-8044244988)).
- Onboarding friction: *"Email, password, full name, phone number, required algorithm setup. I just
  want to make some inspo boards…"*
  ([Cosmos](https://apps.apple.com/gb/app/id1577975475?see-all=reviews#review-13852462145)).
- iPad: Cosmos has no iPad app ([review](https://apps.apple.com/gb/app/id1577975475?see-all=reviews#review-12420953027)).
  Colour Archive is iPad-first.

**The gap nobody fills:** every neighbour finds similar *images*. None finds similar
*photographers*, and none compares on how a picture is **edited**. Colour Archive already
measures grade (Style Match), colour and content locally, so it can say *why* two photographers
are alike in darkroom terms.

## Neighbour screens and flows (functional summary)

| ID | screen (neighbour) | purpose | states worth copying |
| --- | --- | --- | --- |
| N01 | element detail → related grid (Cosmos, Savee) | similar images under the one you opened | loading shimmer, end of results |
| N02 | profile (Cosmos, Glass, Are.na) | one person's work and their collections | empty profile, private |
| N03 | following feed (Glass, Cosmos) | newest from people you follow | caught up (Glass has no infinite feed) |
| N04 | "people to follow" drop-down on detail (Savee) | follow from the work, not a directory | already followed |
| N05 | onboarding taste picker (Cosmos) | seeds the feed | the thing users hate. Avoid it |
| N06 | Are.na block → "in channels" | co-curation graph: who else collected this | — |

```
F01 (neighbour) Follow from a picture
    N01 detail -> tap author -> N02 profile -> Follow          3 taps
F02 (neighbour) See what's new
    open app -> N03 feed -> scroll forever                       0 taps, no end
F03 (neighbour) Find a similar creator
    N01 detail -> N04 suggestions -> N02 -> Follow              4 taps
```

Targets to beat in Colour Archive: favourite a photographer in **1 tap** from any reference;
"what's new" in **0 taps**, with an end; a similar photographer with a reason in words.

## Inferred data model for the new feature (proposal, not a neighbour's)

```
Photographer  id, name, favourite (bool), addedAt,
              links { flickrNsid?, blueskyDid?, arenaSlug?, unsplash?, instagram?, glass?, site?, rss? }
              (every id resolved through the platform's API, never guessed: the notable.ts rule)
              fingerprint { grade (looks.ts), palette, clip centroid, dino centroid, n }
              hidden (bool: "not for me"), lastSeenAt
Reference     + photographerId?, sourceUrl?, licence?
SeenItem      photographerId, platform, remoteId, thumbUrl, url, takenAt, state (new | pinned | passed)
Suggestion    photographerId (candidate), via (follows | contacts | co-channel | faves),
              nearest favourite, distance, reason text, state (open | favourited | passed | later)
```

Store it in `photographers.json` and `photographers.seen.json`, both **gitignored**, like
`photos.locations.json`. The repo is public, and a taste graph is personal.

## What can't be done (skip rows)

- **Instagram for personal accounts:** no API (Basic Display ended Dec 2024). Scraping breaks the
  terms. Only *professional* accounts, through Business Discovery and your own Meta app.
- **Glass, VSCO, Cosmos, Savee, Pinterest boards of other people:** no public read API for this.
  Link out only.
- **A global "similar photographers" index:** nobody offers one. Candidates must come from the
  social graph of your favourites, then be ranked locally.
- **Downloading other people's full-res photos in bulk:** don't. Show hotlinked thumbnails, and
  store only what you pin, for private study (the board is never published).

## Size

New: 3 surfaces (favourites shelf, photographer sheet, suggestions), 5 flows, 3 entities. Hard
parts: platform resolvers and their rate limits; fingerprinting remote photos cheaply (thumbnails
only, no RAW); an honest reason line. **Size: M** for the core (A1 to A5 in ideas.md), **M** again
for suggestions.
