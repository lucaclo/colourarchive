# Design Brief: Visual Refresh (Whisper, extended)

## Problem

The archive is functionally rich and already carries real craft — a
scroll-driven ambient colour wash, hand-tuned masonry, a considered
typographic pairing, film grain, a lightbox with pinch-zoom. But it reads as
plain. The restraint that makes it feel considered is the same restraint
that makes it feel quiet: the chrome (topbar, buttons, focus states, panel
borders) stays almost entirely achromatic even though the app's entire
premise is colour; the cover page under-sells what's inside; and hierarchy
is binary — one display face, one label face, nothing in between.

## Solution

Refine within the existing "Whisper" system rather than replace it. Wire up
the colour plumbing that already exists but is inert (`--accent` is a token
hardcoded to `--fg`; the scroll tracker already computes a wash colour per
frame and only ever applies it to `body` background) so the archive's own
hue data reaches the chrome. Give the cover a real hero moment. Spend a
motion budget on one earned flourish — the chapter transition — instead of
scattering small ones. Then propagate the same refined tokens to
Inspiration, Scout, and Upload so all four pages read as one system.

## Experience Principles

1. **Colour is structural, not decorative** — the chrome inherits the
   archive's own OKLCH hue data (already computed, already flowing through
   the DOM as `data-wash`) instead of staying grey-on-grey. Nothing new is
   invented; what's dormant gets wired up.
2. **One earned flourish over many small ones** — motion budget goes to the
   chapter transition and the cover entrance, not spread thin across every
   hover state. A flourish that happens once per chapter reads as intent; the
   same flourish on every button reads as noise.
3. **The photograph remains the only subject** — richness comes from what
   type, colour, and motion can do with the chrome. No imagery behind the
   cover text, no second photo treatment competing with the archive itself.
   This constraint already exists in the codebase (`global.css` header:
   "The photograph is the only event") and this refresh does not break it.

## Aesthetic Direction

- **Philosophy**: Refined editorial/archival minimalism — Whisper, evolved,
  not replaced. Warm near-black ground, Fraunces italic display, JetBrains
  Mono labels, hairline chrome. The change is in how much presence those
  same materials are allowed to have, not what they are.
- **Tone**: Warm, quiet-confident, considered. Not loud, not playful, not
  "energetic" — an exhibition catalogue, not a product launch.
- **Reference points**: None supplied by the designer. Working from the
  existing Whisper system's own internal logic (the six-preset history in
  `global.css`'s header comment) plus the OKLCH colour data the pipeline
  already produces.
- **Anti-references**: Generic dark-mode SaaS chrome; the "AI gradient"
  aesthetic; industrial/brutalist treatments; typographic maximalism (a
  third typeface, All-Caps-Everywhere); anything that competes with a
  photograph for attention.

## Existing Patterns

- **Typography**: Fraunces (italic, opsz-variable) for display — cover `h1`
  and chapter titles only; JetBrains Mono for every label, count, and piece
  of chrome. `font-variant-numeric: tabular-nums` throughout. This refresh
  keeps both faces; it does not add a third.
- **Colors**: `--bg #100f0e` / `--fg #ece9e3` / `--muted #83807a` /
  `--border #201f1d`, all warm-toned. Per-chapter OKLCH hues exist
  (`ch.oklch`) and already drive the chapter-gap background and the
  spectrum scrubber; `--accent` exists as a token but is hardcoded to `--fg`,
  i.e. never actually accents anything.
- **Spacing/motion**: `--edge` (page inset), `--gap` (chapter breath),
  `--ease`/`--ease-io` cubic-beziers, `--fade` (620ms photo entrance). These
  are the vocabulary to extend, not replace.
- **Components already in place**: `.topbar` (auto-hides on scroll),
  `.view-toggle`, `.genre-drop`, `.cover` + `.cover-spectrum`,
  `.chapter-gap` + `.chapter-title`, `.spectrum` (side scrubber),
  `.lightbox`, `.insights` overlay, `.offline-pill` (archive page);
  `.mx-panel` / `.insp-*` (Inspiration's board + Style Match workbench);
  `.panel` / `.card` / `.chip` / `.sheet` (Scout); `.drop` / `.ingest` /
  `.manage` (Upload, and `.drop` is shared with Inspiration).

## Component Inventory

| Component                         | Status | Notes |
| ---------------------------------- | ------ | ----- |
| `--accent` token + wiring          | Modify | Currently inert; drive it from the same per-frame `data-wash` value already computed for `body` background. |
| `.topbar` (links, focus, hover)    | Modify | Underline/focus/hover states pick up `--accent` instead of pure `--fg`. |
| `.cover` / `.cover-spectrum`       | Modify | More presence — thicker spectrum, choreography pushed further. No new imagery. |
| `.chapter-gap` transition          | Modify | Replace the plain 900ms background-color tween with a real wipe/reveal tied to the incoming chapter's hue. |
| `.spectrum` (side scrubber)        | Modify | Same accent treatment, slightly more presence at rest. |
| `.lightbox`, `.insights` chrome    | Modify | Borders/icons pick up `--accent` at low opacity instead of `--hair`/`--fg` only. |
| `.mx-panel`, `.insp-*` (Inspiration) | Modify | Inherit the same accent + chrome tokens once Phase 1 (archive page) is validated. |
| `.panel`, `.card`, `.chip`, `.sheet` (Scout) | Modify | Same. |
| `.drop`, `.ingest`, `.manage` (Upload) | Modify | Same. |
| New components                     | None   | This is a refinement pass — no new component types planned. |

## Key Interactions

- **Ambient accent tracking**: already exists as `setAmbient()` in
  `index.astro`'s inline script, currently writing only
  `body.style.backgroundColor`. Extend it to also set a CSS custom property
  (`--accent`) that chrome elements reference, so scrolling through a
  chapter re-tints the topbar/focus rings/hairlines along with the
  background, at a much lower amplitude than the background wash itself.
- **Chapter transition wipe**: entering a `.chapter-gap` currently crossfades
  `body`'s background-color over 900ms. Add a directional reveal (colour
  sweeping in, or the title mask-revealing) so the handoff between chapters
  is visible as an event, not just a colour drift.
- **Cover entrance**: extend the existing `riseIn`/`drawIn` stagger
  (`.cover-kicker` → `h1` → `.cover-sub` → `.cover-spectrum` →
  `.scroll-hint`) rather than replacing it — more visual weight, same
  choreography shape.

## Responsive Behavior

No new breakpoint behavior. All existing mobile-specific rules stay as-is:
44px touch targets (`@media (pointer: coarse)`), the spectrum bar collapsing
to a footer strip under 640px, the topbar's `flex-wrap` fallback. Accent and
typography changes apply within those existing rules, not alongside new ones.

## Accessibility Requirements

- Any new `--accent`-based text/border must hold existing contrast ratios
  against `--bg` — accent effects are opacity-mixed with `--fg`/`--muted`,
  not swapped in as saturated raw hue, specifically to protect this.
- `:focus-visible` outline behavior is preserved untouched.
- All new motion respects `@media (prefers-reduced-motion: reduce)`, matching
  every existing animated element in `global.css`.

## Out of Scope

- No structural/navigation changes (Information Architecture phase was
  explicitly skipped — this is a visual/interaction refresh only).
- No new typefaces or a third typographic voice.
- No imagery behind the cover text or anywhere the photograph isn't the
  subject.
- No industrial/brutalist or maximalist direction (see anti-references).
- Scout's map/MapLibre styling, Inspiration's Style Match measurement UI
  internals, and Upload's ingest pipeline UI are only touched for chrome
  tokens (colour/type/motion) — their layout and interaction logic is
  unchanged.
