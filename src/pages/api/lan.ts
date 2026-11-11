import type { APIRoute } from 'astro';

export const prerender = false;

// Where an iPad reaches this archive (issue #138). Set by the Mac app when
// "Let My iPad In" is on; empty from the dev server, which says its own
// address in the terminal. Also answers "is the Mac there at all", for the
// home-screen app's offline note (Layout.astro).
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      ok: true,
      archive: process.env.COLOUR_ARCHIVE_LAN_URL ?? null,
      setup: process.env.COLOUR_ARCHIVE_LAN_SETUP ?? null,
      // From anywhere, behind the phone password: "Let My Phone In From Anywhere".
      remote: process.env.COLOUR_ARCHIVE_REMOTE_URL || null,
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
