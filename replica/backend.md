# Backend

Colour Archive stays single-user and local-first, by the user's decision on
2026-10-09: no accounts, no payments, no email. The Mac is the server; the
iPad is the client on the same network. So the auth, database, Stripe and
email sections of the replica-backend checklist don't apply. What follows is
the security checklist, applied to the routes added in this pass.

## New routes

| route | writes | input checks |
| --- | --- | --- |
| POST `/api/book/pdf?trim&bleed` | `.book-print/*.pdf` (git-ignored) | trim checked against the TRIMS table; bleed is `1` or not; unique temp file per build |
| GET `/api/book/pdf?file=` | — | name must match `colour-archive-[a-z0-9-]+.pdf`; `../photos.json` returns 404 (tested) |
| GET `/api/match/presets.zip?ids=` | a download record per id (as the single preset route does) | at most 200 ids; unknown ids skipped and named in `X-Missing` |
| GET `/inspiration/add?url=` | the inspiration board | only `Sec-Fetch-Site: none` / `same-origin` (a Shortcut's Open URLs, or this site); another site embedding the URL is refused (tested) |
| POST `/api/inspiration/add` (JSON url) | the inspiration board | now through `fetchImageFromUrl` |

`fetchImageFromUrl` (src/lib/inspiration.ts) is the one place the Mac fetches
a link someone shared. It refuses anything that is not http(s), any host
that resolves to a loopback, private, link-local or CGNAT address, `localhost`
and `.local` names, and follows at most one redirect, checking it the same
way. Files over 80 MB are refused. Tested against 127.0.0.1, 192.168.1.1,
localhost, mac.local, file:// and [::1]; a public Wikimedia link still works.

## Checklist

- [x] secrets only in env vars, `.env*` in `.gitignore` — the `.env` rule was missing; added (no .env existed)
- [x] input validated on the server on every new route (table above)
- [n/a] authorisation per user — single user by design
- [n/a] rate limits on auth / email / SMS — none exist
- [n/a] webhooks — none
- [x] uploads: the link fetch is size-capped and type-checked; file uploads unchanged
- [x] no user data in URLs or logs — the share page's URL carries only the shared link
- [ ] **dependencies audited: `npm audit` reports critical/high advisories in `astro`, `@astrojs/node`, `@fastify/busboy` and `devalue`.** Pre-existing; fixing means major upgrades of Astro and its Node adapter, so it is left as a separate, deliberate change.
- [n/a] privacy policy — nothing is published that collects data

## Still open, not from this pass

- The existing multipart branch of `/api/inspiration/add` and the other POST
  routes accept cross-site form posts (no CSRF check). Anyone on the same
  network can reach the Mac server. Worth an origin check across all write
  routes in one go.
