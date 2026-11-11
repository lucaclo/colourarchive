# Design plan: Scout and Match

Follows `DESIGN_AUDIT_SCOUT_MATCH.md`; numbers in brackets refer to its findings. It extends the app-wide direction in `DESIGN_PLAN.md` ("Prints on the light table") and doesn't replace it.

## Visual direction

**"The darkroom notebook, wired."** Scout and Match are the app's two instruments, one for light outdoors and one for light in the edit. They keep everything already locked:

- always-dark glass chrome on Scout;
- italic Fraunces for group titles and the verdict;
- the UI face for every control;
- mono only for figures;
- hairlines, not boxes;
- minimal text;
- the 36px phone floor.

The change is in how the controls feel in the hand. Every control becomes one of the app's four materials, and every state change moves the way a physical instrument would:

- **A switch** is a switch. The thumb slides on the press spring and the track fills from the left.
- **A fold** opens by growing, so the sheet makes room instead of jumping. Its plus turns into a minus by rotating its upright stroke away.
- **A selection moves.** Scout's tile underline, Match's tab underline and the strength slider's thumb all travel to where you pointed.
- **The Match result develops** out of blur, the way the archive's photographs do. The stage comes first, then the slider, then the numbers. It's the moment the feature has been working toward for up to a minute.

**Signature:** still the colour. The chapter accent tints the switch's on state, the tab underline and the focus ring. Nothing new is decorative.

**Self-critique.** Do the iOS-style switches make Scout look like a settings screen? They're used only where the HIG says a switch belongs: map layers that turn on and off. Everything that acts stays a pill, and everything that chooses stays a segmented control. The notebook typography carries the identity, so the controls can be plainly familiar. Kept.

## Shared system additions (global.css › Design system)

| Primitive | Spec |
| --- | --- |
| `input.switch` | 34×20 track, `var(--fill-active)`. The thumb is a 16px paper disc with a soft shadow. When on, the track fills with `color-mix(accent-mix 70%, fg)` and the thumb travels 14px on `--spring-move`. Press widens the thumb to 20px, as iOS does, then springs back. It keeps the native checkbox, so focus, form state and VoiceOver work unchanged. Increased contrast adds an outline. |
| `[data-seg="line"]` | Same glider script, drawn as a 2px underline. `segments.ts` also watches `aria-expanded`, so expanding tiles can drive it. Used for Scout's tiles and Match's tabs. |
| `details[data-disclose]` | Content grows from 0 to auto on `::details-content` with `interpolate-size: allow-keywords` over 380ms on `--spring-move`. Children fade up 4px. Where unsupported it opens instantly, as now. Under reduced motion it opens instantly. |
| `input.range` | 4px rounded track that fills to the value (via `--fill-to`). The thumb is a 20px paper disc that grows to 24px on the spring while held. Used for Match's strength sliders. |
| `select.field` | `.field` with a drawn chevron. |

## Per screen

| Screen | Before | After |
| --- | --- | --- |
| **Scout map** | A black bar at the bottom [1]. | While the globe fills the view, the haze behind the map takes the basemap's land colour, so a gap MapLibre leaves reads as ground. At night it stays navy. **Done.** |
| **Plan, Yours, Night sky folds** | 10 browser-default grey squares [2]. | `.btn .btn-sm` quiet pills. Disabled is 45% opacity. |
| **Sheet actions** (`.wide`) | Hairline 8px boxes. | Full-width quiet pills with the same fill and hover as `.btn`. |
| **Layers and night panels** | 15px square boxes [6]. | `.switch` on the right, label on the left, iOS list style. |
| **Groups and folds** | Snap open, with a text glyph swap [7]. | `data-disclose` grow; the plus is drawn from two strokes and the upright one rotates flat. |
| **Sun, Sky, At the pin tiles** | The underline blinks [8]. | `[data-seg="line"]` glides between tiles and fades out when all are closed. |
| **Search** | Outlined box [9]. | Filled `.field` well with the accent focus ring. |
| **Camera and tool selects** | Bare native selects [10]. | `select.field`. |
| **All times, All 8, Glossary, lens links** | Underlined grey text [11]. | Small ghost pills. "All times" fills while pressed. |
| **Moon line** | Mono words [14]. | UI face. |
| **Phone peek** | Half-cut jump labels [16]. | The labels fade out at peek and fade in as the sheet rises. |
| **Month grid** | − / + month steppers [17]. | ‹ › like the date picker. |
| **Glossary (phone)** | Runs under the tab bar [20]. | Bottom margin clears the bar. |
| **Match footer** | 2px rectangles [4]. | Download is `.btn-primary`, Keep is a quiet pill, More is a round icon button. The menu pops in from its corner with rounded rows. |
| **Match tabs** | No visible selection, and no `aria-selected` [5]. | Gliding accent underline, `aria-selected` kept in sync, and the active tab at full weight. |
| **Match scores** | Repeated over every tab, burying phone panels [3]. | Shown with the Light tab only (the answer first). Every other tab opens straight onto its own content. |
| **Match stage** | Captions adrift from the pictures [12]. | Each figure shrinks to its image, so the caption chips and hold hint sit on the photo's own corner. The column hairline stays. |
| **Strength sliders** | System range [13]. | `input.range` on the main slider, the three group sliders and the batch slider. |
| **Before / after** | Native checkbox. | `.switch`. |
| **Separate sliders** | The › never turns. | The chevron is its own span and turns a quarter on open. |
| **Result arrival** | One frame [15]. | Develop-in: the stage at 0ms, the bar at 90ms, the tabs at 150ms, the content at 210ms. |
| **Tone curve** | Flat 4% grey square [18]. | A darker inset well with an 8px corner. |
| **Start and Check selects** | Underline field and white select. | `select.field`. |

## Order

1. Primitives in global.css, plus the `segments.ts` change.
2. Scout markup: `.ghost` → `.btn`, toggles → `.switch`, `data-disclose`, tiles `data-seg="line"`, selects, month steppers.
3. Scout CSS: wide, events-all, search, folds glyph, moon, peek, glossary.
4. Match markup and CSS: footer, tabs, scores, stage captions, ranges, switch, chevron, develop, curve, selects.
5. Re-shoot all three sizes, compare with `sm-before`, and fix again.
6. `npm run check`, `npm test`, eslint on `src/lib/ui`.

## Constraints

- Keep every ID, `data-*` hook, ARIA attribute and `⌘K` entry.
- No behaviour changes, except the tab `aria-selected` fix and Match scores showing on the Light tab only.
- Never reintroduce light chrome on Scout, and add no explanatory text.
- Reduced motion, reduced transparency and increased contrast all keep working.
