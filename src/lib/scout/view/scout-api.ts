/**
 * The two calls that still need a server, and what to say when there isn't one.
 *
 * Everything else on this page reaches its source directly; Nominatim sends no
 * CORS header, so place search and the pin's name go through `/api/scout/…`,
 * answered by the Mac in development and by a Netlify function in the
 * published build.
 *
 * When neither is there — a Netlify **Drop** deploy carries no functions at
 * all, which is the documented way this archive gets published — that path
 * returns the host's 404 *page*. Calling `.json()` on HTML throws
 * "Unexpected token '<'", and that string was landing in the results list as
 * though it were a search result. Detect it here and say the true thing
 * instead: search is unavailable, the map still is.
 *
 * **What it says next has to be something you can do.** The first version sent
 * you to drag the pin, and the pin does not exist until a spot has been chosen —
 * so on a phone, where there is no keyboard route in either, the advice closed
 * the last door. Tapping the map now places the first spot, and this names that.
 */

/**
 * A geocoder result, as `/api/scout/geocode` and `/api/scout/reverse` return it.
 *
 * `bounds` is Nominatim's own, and is what a whole-city result is framed by —
 * a point at the centre of Tokyo says nothing about how far Tokyo reaches.
 */
export interface Place {
  name: string;
  detail: string;
  lat: number;
  lon: number;
  kind: string;
  timeZone: string;
  bounds?: [number, number, number, number];
}

export class NoSearchServer extends Error {
  constructor() {
    super('Place search needs the server. Zoom in and tap the map to choose a spot instead.');
    // Set explicitly: extending a built-in loses the constructor's name under
    // the ES5 downlevel some toolchains still emit, and this name is how the
    // failure is recognised in a log.
    this.name = 'NoSearchServer';
  }
}

/**
 * Fetch JSON from one of Scout's own endpoints, or say there is no endpoint.
 *
 * The content type is the test rather than the status, because the failure this
 * exists for answers **200** — a static host serving its 404 page is, as far as
 * HTTP is concerned, a successful request for a document.
 */
export async function getScoutJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!(response.headers.get('content-type') || '').includes('json')) throw new NoSearchServer();
  return response.json();
}
