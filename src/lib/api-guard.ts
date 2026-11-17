/**
 * Who may write to the archive's API, and what a bad body gets back (R13-02,
 * R13-04). Used by src/middleware.ts for every POST/PUT/PATCH/DELETE under
 * /api. Pure, so it is tested without a server.
 *
 * The server listens on every interface so the phone on the Wi-Fi can reach
 * it, and Astro's own origin check is off in dev (and only covers form posts
 * in production). Without this, any web page open in a browser that trusts the
 * local certificate could post to /api/remove or /api/book.
 *
 * A browser always names where a cross-site write came from (Origin, or at
 * least Referer), so a write that names another origin is refused. A request
 * that names none didn't come from a web page: the iPad's share-sheet Shortcut
 * (README, "Saving from the share sheet") posts that way. Refusing it would
 * stop nothing, since a client outside a browser can claim any Origin it likes.
 *
 * The remote gate (desktop/remote-gate.mjs) checks the phone's real Origin and
 * then hands requests on as the server's own, so they pass here unchanged.
 */

export const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The origin a browser says the request came from, or null when it names none. */
export function claimedOrigin(headers: Headers): string | null {
  const origin = headers.get('origin');
  if (origin) return origin;
  const referer = headers.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return 'null';
  }
}

/**
 * Whether a write may go through. `own` is the origin this server answers as
 * (Astro's `context.url.origin`, which already trusts the Host header only for
 * the hosts Vite and astro.config allow).
 */
export function writeAllowed(headers: Headers, own: string): boolean {
  const from = claimedOrigin(headers);
  return from === null || from === own;
}

/** Bodies the API reads as JSON: application/json, and the text/plain a bare fetch sends. */
export function isJsonish(contentType: string | null): boolean {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return type === 'application/json' || type === 'text/plain' || type.endsWith('+json');
}

/**
 * True unless the body is a JSON object or array: every route that takes JSON
 * reads fields off it, so an empty body, `null` or a bare number reached the
 * route and came back as a 500 with the engine's own words.
 */
export function badJson(text: string): boolean {
  if (!text.trim()) return true;
  try {
    const value: unknown = JSON.parse(text);
    return value === null || typeof value !== 'object';
  } catch {
    return true;
  }
}
