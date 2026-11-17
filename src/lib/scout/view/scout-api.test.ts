import { afterEach, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { answerInBrowser, getScoutJson, NoSearchServer } from './scout-api';

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
        // This string is shown in the results list, so it has to name a way out
        // that exists. It used to say "drag the pin", and there is no pin until
        // a spot has been chosen — which on a phone, with search unavailable,
        // left no way in at all. Tapping the map is the one that works from a
        // standing start.
        assert.match(error.message, /tap the map/i);
        assert.doesNotMatch(
          error.message,
          /drag the pin/i,
          'the pin does not exist before a spot is chosen',
        );
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

/* ── The published build, answered in the page through /nominatim/* ──────── */

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const utc = () => 'Europe/London';

const PIER_WAY = { lat: '50.8193', lon: '-0.1366', name: 'Brighton Palace Pier', display_name: 'Brighton Palace Pier, Madeira Drive, Brighton', category: 'man_made', type: 'pier', boundingbox: ['50.815', '50.821', '-0.138', '-0.135'] };
const PIER_NODE = { ...PIER_WAY, lat: '50.81935', lon: '-0.13662' };

test('the published build searches through the site’s proxy and reads the answer like the Mac', async () => {
  const asked: string[] = [];
  const answer = (await answerInBrowser('/api/scout/geocode?q=Brighton%20pier', async (url) => {
    asked.push(url);
    return json([PIER_WAY, PIER_NODE]);
  }, utc)) as { ok: boolean; places: { name: string; kind: string; timeZone: string; bounds?: number[] }[] };
  assert.equal(asked.length, 1);
  assert.match(asked[0], /^\/nominatim\/search\?q=Brighton\+pier&format=jsonv2&limit=6&addressdetails=0$/);
  assert.equal(answer.ok, true);
  assert.equal(answer.places.length, 1, 'the way and the node are one pier');
  assert.equal(answer.places[0].kind, 'Pier');
  assert.equal(answer.places[0].timeZone, 'Europe/London');
  assert.deepEqual(answer.places[0].bounds, [-0.138, 50.815, -0.135, 50.821]);
});

test('a host page instead of JSON says search is unavailable, not a parser error', async () => {
  await assert.rejects(
    answerInBrowser('/api/scout/geocode?q=Brighton', async () => new Response('<html>Not found</html>', { headers: { 'content-type': 'text/html' } }), utc),
    NoSearchServer,
  );
  await assert.rejects(answerInBrowser('/api/scout/geocode?q=Brighton', async () => { throw new TypeError('offline'); }, utc), NoSearchServer);
});

test('a name borrows Nominatim’s and keeps the point asked about; no name falls back to the coordinate', async () => {
  const named = (await answerInBrowser('/api/scout/reverse?lat=50.82&lon=-0.137', async (url) => {
    assert.match(url, /^\/nominatim\/reverse\?lat=50\.82&lon=-0\.137&format=jsonv2&zoom=16$/);
    return json({ ...PIER_WAY, lat: '50.8193', lon: '-0.1366' });
  }, utc)) as { place: { name: string; lat: number; lon: number } };
  assert.equal(named.place.name, 'Brighton Palace Pier');
  assert.deepEqual([named.place.lat, named.place.lon], [50.82, -0.137]);

  const bare = (await answerInBrowser('/api/scout/reverse?lat=50.82&lon=-0.137', async () => new Response('', { status: 502 }), utc)) as { place: { name: string; kind: string } };
  assert.equal(bare.place.kind, 'point');
  assert.equal(bare.place.name, '50.8200°N 0.1370°W');
});

test('short queries ask nothing; other URLs are left to the network', async () => {
  let calls = 0;
  const count = async () => { calls++; return json([]); };
  assert.deepEqual(await answerInBrowser('/api/scout/geocode?q=a', count, utc), { ok: true, places: [] });
  assert.equal(await answerInBrowser('/api/scout/weather?lat=1&lon=2', count, utc), null);
  assert.equal(calls, 0);
});
