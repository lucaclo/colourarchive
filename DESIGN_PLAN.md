# Design plan: one darkroom, one material

Follows `DESIGN_AUDIT.md`. The numbers in brackets refer to audit findings.

## Visual direction

**"Prints on the light table."** The archive is a darkroom. Every surface is the warm selenium ground (#100f0e), photographs are the only colour, and the current chapter's hue tints the chrome. The direction keeps what is already locked:

- the Whisper palette;
- Fraunces italic for titles;
- the system face for controls;
- mono for data only;
- the notebook vocabulary;
- minimal text;
- the 36px phone floor.

It raises three things:

1. **One material for every control.** There are four kinds of control, and each looks the same on every page:
   - **Capsule (glass):** floating chrome over photos and maps, such as the tab bar, toolbars and the lightbox tools.
   - **Fill pill:** in-page buttons. Primary is paper on ink; secondary is a quiet fill.
   - **Segmented control:** with a thumb that glides.
   - **Text field:** a filled, rounded well.

   No square boxes, no bare text links acting as buttons, and no white rectangles.
2. **Motion with physics.** Every tappable thing:
   - squishes on press, using the independent `scale` property so it never fights a layout transform;
   - springs back with a small overshoot on release;
   - lifts slightly on hover with a pointer.

   Selections glide instead of snapping. Grids develop into view as they scroll in, the same "print developing" idea the archive already uses. Large page titles collapse into a compact glass bar as you scroll, so the page's actions stay in reach.
3. **Hierarchy through the chapter.** The chapter opener becomes the app's signature typographic moment:
   - an editorial split layout;
   - a large title;
   - the palette as a struck band;
   - a scroll-linked drift as it leaves.

   Every page header follows one pattern, so the app reads as one book.

**Signature element:** the colour itself. The chapter hue sits in the tab pill, the segmented thumbs, the focus ring and the scroll rail. Nothing else is decorative.

**Self-critique.** Is this a default? A cream-and-serif template would add a terracotta accent and hairline broadsheet rules. This plan adds neither. Its one accent is borrowed from the user's own photographs at runtime, which only this product can do. Its motion vocabulary comes from the existing photo flight and develop effects. Kept.

## Shared design system (built first)

| Token or primitive | Spec |
| --- | --- |
| `--spring-press` | Damped spring with ζ≈0.55 sampled into `linear()`, about 4% overshoot on release. Falls back to `--spring`. |
| `--dur-press` | 90ms down, 360ms release. |
| `--press` | 0.96. Small controls get 0.92 via `--press-sm`, rows 0.985 via `--press-row`. |
| Glass tiers | `--glass-bg` rises from 58% to 82% of `--bg`, so the tab bar label is ≥5:1 over a white map [1]. `--glass-bg-strong` goes to 90%. |
| Type | `--t-title-1` clamp(2.4rem, 6vw, 4.5rem) for page titles, `--t-title-2` 1.5rem for sections and the compact bar. The tab label floor is 11px [2]. |
| `.btn` | Pill, `min-height: var(--hit)`, 0 1.1rem, footnote/500. Variants: `.btn-primary` (paper on ink), `.btn-quiet` (fill), `.btn-ghost` (text-only with a hover fill), `.btn-icon` (round). One hover: fill brightens and the button lifts 1px. One press: scale. |
| `.seg` and `[data-seg]` | Capsule track `--fill`, with buttons inside. A `.seg-thumb` element positioned by `src/lib/ui/segments.ts` glides to whichever child is `[aria-pressed=true]`, `[aria-checked=true]`, `.on` or `:has(input:checked)`. It uses `--spring-move`, so all seven segmented controls slide [4]. |
| `.field` | Filled rounded well, `--fill` with a hairline edge, and the focus ring takes the accent. |
| Universal press | `button, a.btn, .tab, [role=button]` etc. get `scale` on `:active`, with a spring on release. The 50+ ad hoc `transform: scale()` rules are deleted [11]. This also fixes `.lb-nav:active`, which dropped its `translateY(-50%)` and jumped. |
| `[data-reveal]` | Children develop in as they enter the viewport: opacity, an 8px rise and blur 4px→0 on `animation-timeline: view()`. CSS only, zero JS. It degrades to static where unsupported or under reduced motion [10]. |
| `.page-head` | Large Fraunces title, a data-face count beside it, and an action cluster on the right. It sticks, and as the page scrolls a scroll-timeline shrinks the title to `--t-title-2` and fades in a glass backdrop. Pure CSS [6]. |
| Tab bar | Stronger glass, an 11px phone label, the icon nudges up 1px on hover, the press springs, and the pill tints toward the chapter accent. |

## Per screen

| Screen | Before | After |
| --- | --- | --- |
| **Archive toolbar** | Overview, Get the app and Insights are three loose capsules. On the phone, three stranded circles sit on row 2 [8]. | One capsule with hairline separators, the same `.tb-group` as the filters. On the phone it becomes one compact capsule on row 2, beside search. |
| **Chapter opener** | Centred small title, tracked mono "CHAPTER I" and "7 PHOTOGRAPHS", tiny squares [5]. | Editorial split, left-aligned on ≥820px: "Chapter i" in sentence-case italic above a title at about 1.6× the old size. The count goes in the data face without tracking. The palette becomes a continuous struck band that draws across. Scroll-linked: the title drifts up and fades as the opener leaves (view timeline). Phone stays centred and gets the same type changes. |
| **Overview strips** | Uppercase tracked counts. | Data-face counts, consistent with the opener. |
| **Lightbox** | Seven separate circles and pills, a mono caption, and a phone row that scrolls off-screen [7]. | One glass capsule holds the tools, with separators between the media, related and output groups. The caption uses the UI face for words and mono only for data. On the phone the capsule fades its edges to show it scrolls. |
| **Insights** | Boxed SaaS cards, a far-away close [13]. | Notebook: hairline-separated sections, no boxes. A sticky header row holds the title and close together. Two columns on ≥1100px. Rows keep their stagger. |
| **Inspiration** | Titled "Reference". The empty shelf takes the fold. The group-by uses slashes. Square buttons in the forms [3][6][9]. | `.page-head` titled "Inspiration" with a count and the Add primary. The empty shelf becomes a single inline row ("Photographers" and an add pill). Group-by becomes a `.seg` with a glider. Forms use `.field` and `.btn`. The board develops in on scroll. |
| **Book** | Text-link actions beside a pill, no sticky header [3][6]. | `.page-head` with a compact sticky bar. Share and Magazine become `.btn-quiet` with icons, Print becomes `.btn-primary`, and List/Spreads gets the glider. Thumbnails get a 4px radius, lift on hover and develop on scroll. |
| **Magazine (zine)** | Square boxed toolbar, an underlined-link footer, a phone rail under the tab bar [3][15]. | The toolbar uses `.seg` for pages and paper size with gliders, and `.btn` for Colours, Preview and Download PDF (primary). The footer becomes quiet pills. Bottom padding respects `--tabbar-space`. |
| **Add & remove** | A second Fraunces title, stacked controls [18]. | `.page-head` with a compact bar. "In the archive" becomes a section label. Order, search and the edge chip go on one row on wide screens. The grid develops in. |
| **Scout** | Mixed white and black map controls, a foreign ⓘ, a pale tab bar [1][17]. | The tab bar's glass is fixed globally. The 2D/3D segment gets the dark glass track and glider. The attribution button goes into a glass circle. |
| **Book share view** | Tracked mono caps. | Sentence-case italic eyebrow and data-face counts. |
| **⌘K, colour filter, Get, Cards, Photographer sheet** | No or inconsistent press. Square buttons in the Photographers forms. | Universal press, `.btn`/`.field`, and the `.seg` glider on Cards. |

## Order

1. Tokens, universal press, `.btn`, `.seg` with the glider script, `.field`, `[data-reveal]`, `.page-head`, and the tab bar fixes.
2. Archive: toolbar, chapter opener, lightbox, Insights.
3. Inspiration and Photographers.
4. Book, Zine and Book view.
5. Upload, Scout controls, Cards, Get and ⌘K.
6. Re-shoot all three sizes, compare, and fix again.

## Constraints

- Keep all IDs, `data-*` hooks and ARIA.
- No behaviour changes.
- Respect reduced motion and reduced transparency for every new animation.
- Book's size select writes `book.json`, so don't touch it in tests.
