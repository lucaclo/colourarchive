# Round 12: every feature on the phone, accessibly

Asked 2026-11-11: "ensure that all features available on the computer are available on mobile, and are properly integrated for accessible use."

## Why the phone was missing features

The public site (colourarchive.netlify.app) is a static copy, with only Archive and Scout. Inspiration, Match, Book, Magazine and Add/remove run on the Mac's server: 54 modules that read and write its disk, plus local models. The user chose **Mac as engine**. The Mac keeps the only copy and does the work, and the phone reaches it from anywhere.

## From anywhere

- `desktop/remote-gate.mjs` sits in front of the whole server, `/img` and originals included. It has:
  - One password, stored as a scrypt hash in `~/Library/Application Support/Colour Archive/remote.json`.
  - HttpOnly, Secure, SameSite=Lax session cookies. Only token hashes are stored.
  - Same-origin writes only.
  - A lockout after 5 wrong tries per address in 15 minutes, and after 30 globally.
  - An ungated `/__ping`, with CORS for the public site only.
  - Tests in `desktop/remote-gate.test.mjs`, run by `npm test`.
- Astro only trusts listed hosts, so after its own check the gate hands the archive a local Host and Origin (`forward`). Without that, every upload through the tunnel got a 403.
- Mac app menu: **Let My Phone In From Anywhere**, **Phone Address…**, **Change Phone Password…**, **Sign Out All Phones**. It uses the person's own Tailscale install: `tailscale funnel --bg 43480` to a localhost-only listener.
- Dev server: `npm run remote`, the same gate as a proxy to https://localhost:4321. `REMOTE_NO_FUNNEL=1` runs it without the Funnel, for local tries.
- Public site: with `remote-host` written by either of the above, the static build links Inspiration, Book and Add to the Mac. A ping marks them dimmed when the Mac is away, and a tap then shows "Can't reach your Mac right now".

## Accessibility at phone size

`npm run a11y` runs axe for WCAG 2.2 A/AA plus best-practice over every page and the main overlays, on an emulated iPhone 13. It blocks every non-GET request, so it is safe against the real archive.

First run → fixed:
- Cover colour strip: chapter targets 17–23px wide. Now a 24px floor.
- Chapter scrubber: segments 3px wide on a phone, with overlapping hit areas. Now 24px, with no sideways overlap.
- Book view: "Chapter V" on olive came out at 4.34:1. It now uses `readableInk`, and a faint backing where even the better ink is under 4.5:1 (`inkContrast`).
- Scout cards sheet and Inspiration's "More like this" list: scrollable regions you couldn't reach by keyboard. Now focusable and named.
- Archive cover: content outside any landmark. Now a named region.

Final run: 0 findings at any level, across all 16 pages and states.

Manual checks axe can't make:
- **Dragging (2.5.7).** The Magazine's spread order was drag-only, and HTML drag doesn't work on iPhone. It now has Earlier/Later buttons in the spread panel. Book order was drag or arrow keys; now you can tap the handle to pick a photo up, then tap the photo it should go beside. Inspiration's before/after divider already moves to a single tap.
- **Overlays.** Inspiration's picture view, Match and More like this weren't dialogs to VoiceOver, and focus stayed on the board behind them. They're now `role=dialog` + `aria-modal` + `data-modal`. `src/lib/ui/modal.ts` moves focus in, traps Tab, and returns focus on close; it works by attribute because the opener is an inline script. Checked: focus lands on Close, Tab can't leave, and Escape returns focus to the picture.
- **Layout.** No page scrolls sideways at 390px. On Add & remove, the count slid under "Add photos" on a phone; the button now says "Add" there, and VoiceOver still hears "Add photos".

## Left for the device

Emulation can't prove the Funnel, the cookie on iOS, or safe areas. The person has to install Tailscale and switch the menu item on before any of the from-anywhere part exists.
