import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NoSearchServer, getScoutJson } from './scout-api.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer every request with one body and one content type. */
function serve(body: string, contentType: string | null, status = 200) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return new Response(body, {
      status,
      headers: contentType ? { 'content-type': contentType } : {},
    });
  }) as typeof fetch;
  return asked;
}

describe('reading one of Scout’s own endpoints', () => {
  it('parses a JSON answer', async () => {
    const asked = serve('{"ok":true,"places":[]}', 'application/json');
    assert.deepEqual(await getScoutJson('/api/scout/geocode?q=leith'), { ok: true, places: [] });
    assert.deepEqual(asked, ['/api/scout/geocode?q=leith']);
  });

  it('accepts the charset suffix a real server sends', async () => {
    serve('{"ok":true}', 'application/json; charset=utf-8');
    assert.deepEqual(await getScoutJson('/api/scout/reverse'), { ok: true });
  });

  it('says there is no server when a static host answers with its 404 page', async () => {
    // The point of the whole module: this arrives as a **200**, because as far
    // as HTTP is concerned the host successfully served a document.
    serve('<!doctype html><title>Page not found</title>', 'text/html; charset=utf-8', 200);
    await assert.rejects(() => getScoutJson('/api/scout/geocode?q=leith'), NoSearchServer);
  });

  it('says the same thing when the response carries no content type at all', async () => {
    serve('nothing useful', null);
    await assert.rejects(() => getScoutJson('/api/scout/geocode?q=leith'), NoSearchServer);
  });

  it('tells the reader what to do instead', async () => {
    serve('<html>', 'text/html');
    await assert.rejects(
      () => getScoutJson('/api/scout/geocode?q=leith'),
      (error: Error) => {
        // This string is shown in the results list, so it has to name the way
        // out — the map works without search, and dragging the pin is it.
        assert.match(error.message, /drag the pin/i);
        return true;
      },
    );
  });

  it('lets a genuine network failure through as itself', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    // Offline is not the same as unserved, and must not be reported as though
    // the deploy were missing its functions.
    await assert.rejects(() => getScoutJson('/api/scout/geocode?q=leith'), TypeError);
  });
});
