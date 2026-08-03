/**
 * The service worker, run for real in a sandbox.
 *
 * `public/sw.js` is a plain script with no exports, so there is nothing to
 * import — but it is also the one file here that can take the whole app offline
 * by being subtly wrong, and it has done exactly that twice: once by pinning
 * third-party assets forever, and once by evicting them and leaving the basemap
 * with nothing to fall back on. Both were behaviours, not typos, and only a
 * test that actually runs the fetch handler would have caught either.
 *
 * So it is evaluated in a `vm` context with a stubbed cache, network and clock,
 * and driven the way a browser would drive it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../../public/sw.js', import.meta.url)),
  'utf8',
);

const ORIGIN = 'https://archive.local';

type Handlers = Record<string, (event: unknown) => void>;

/** A cache faithful enough for what the worker asks of it. */
class FakeCache {
  readonly store = new Map<string, Response>();
  async match(req: Request | string) {
    return this.store.get(typeof req === 'string' ? req : req.url);
  }
  async put(req: Request | string, res: Response) {
    this.store.set(typeof req === 'string' ? req : req.url, res);
  }
  async delete(req: Request | string) {
    return this.store.delete(typeof req === 'string' ? req : req.url);
  }
  async keys() {
    return [...this.store.keys()].map((url) => ({ url }));
  }
}

function boot(options: {
  /** What the network does for a given URL. */
  network?: (url: string) => Promise<Response>;
  /** Pre-existing cache contents, url → body. */
  cached?: Record<string, string>;
} = {}) {
  const caches = new Map<string, FakeCache>();
  const handlers: Handlers = {};
  const timers: Array<() => void> = [];
  let fetches = 0;

  const cache = new FakeCache();
  caches.set('colour-archive-v1', cache);
  for (const [url, body] of Object.entries(options.cached ?? {})) {
    cache.store.set(url, new Response(body, { status: 200 }));
  }

  const context: Record<string, unknown> = {
    URL,
    Response,
    Request,
    Promise,
    Array,
    Object,
    console,
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        handlers[type] = fn;
      },
      skipWaiting: () => {},
      clients: { claim: async () => {}, matchAll: async () => [] },
    },
    caches: {
      keys: async () => [...caches.keys()],
      open: async (name: string) => {
        if (!caches.has(name)) caches.set(name, new FakeCache());
        return caches.get(name)!;
      },
      delete: async (name: string) => caches.delete(name),
    },
    fetch: async (req: Request | string) => {
      fetches++;
      const url = typeof req === 'string' ? req : req.url;
      if (!options.network) return new Response('from network', { status: 200 });
      return options.network(url);
    },
    // A clock we hold: the worker's patience timer only fires when we say so.
    setTimeout: (fn: (v: unknown) => void, _ms: number, value: unknown) => {
      timers.push(() => fn(value));
      return timers.length;
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SOURCE, context);

  /** Drive one GET through the fetch handler and return what it answered. */
  const request = async (url: string, init: RequestInit = {}) => {
    let answer: Promise<Response> | Response | undefined;
    const req = new Request(url, { method: 'GET', ...init });
    handlers.fetch?.({
      request: req,
      respondWith: (r: Promise<Response> | Response) => {
        answer = r;
      },
    });
    return answer === undefined ? undefined : await answer;
  };

  const activate = async () => {
    let work: Promise<unknown> | undefined;
    handlers.activate?.({ waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  };

  return {
    request,
    activate,
    cache,
    /**
     * Run the patience timer out.
     *
     * It has to be waited for rather than simply fired: the worker looks in the
     * cache before it sets the timer, so at the moment a request is handed over
     * there is nothing to run yet.
     */
    runOutThePatience: async () => {
      for (let i = 0; i < 50 && !timers.length; i++) await new Promise(setImmediate);
      assert.ok(timers.length, 'the worker never set a patience timer');
      timers.splice(0).forEach((t) => t());
    },
    fetchCount: () => fetches,
  };
}

const SPRITE = 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm@2x.json';
const OWN_ASSET = `${ORIGIN}/_astro/index.abc123.js`;

describe('the service worker: our own assets', () => {
  it('answers from the cache without touching the network', async () => {
    const sw = boot({ cached: { [OWN_ASSET]: 'cached copy' } });
    const res = await sw.request(OWN_ASSET);
    assert.equal(await res!.text(), 'cached copy');
    assert.equal(sw.fetchCount(), 0, 'a cache hit must not go to the network');
  });

  it('fetches and stores one it has never seen', async () => {
    const sw = boot();
    const res = await sw.request(OWN_ASSET);
    assert.equal(await res!.text(), 'from network');
    assert.ok(await sw.cache.match(OWN_ASSET), 'it should have been kept');
  });
});

describe('the service worker: third-party assets', () => {
  it('prefers the network, so a sprite is never pinned to the first visit', async () => {
    const sw = boot({
      cached: { [SPRITE]: 'last month' },
      network: async () => new Response('today', { status: 200 }),
    });
    const res = await sw.request(SPRITE);
    assert.equal(await res!.text(), 'today');
    assert.equal(await (await sw.cache.match(SPRITE))!.text(), 'today', 'and refreshed');
  });

  it('falls back to the stored copy when the network fails', async () => {
    // The regression that broke the basemap: with nothing kept, this is an error.
    const sw = boot({
      cached: { [SPRITE]: 'last month' },
      network: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const res = await sw.request(SPRITE);
    assert.equal(res!.type !== 'error', true, 'must not answer with a network error');
    assert.equal(await res!.text(), 'last month');
  });

  it('does not wait on a slow network when it already has a copy', async () => {
    const sw = boot({
      cached: { [SPRITE]: 'last month' },
      network: () => new Promise(() => {}), // never settles
    });
    const pending = sw.request(SPRITE);
    await sw.runOutThePatience();
    const res = await pending;
    assert.equal(await res!.text(), 'last month');
  });

  it('reports the failure honestly when there is nothing to fall back on', async () => {
    const sw = boot({
      network: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const res = await sw.request(SPRITE);
    assert.equal(res!.type, 'error');
  });
});

describe('the service worker: activation', () => {
  it('keeps the third-party copies rather than evicting them', async () => {
    // Evicting these is what left the map with no sprite and no way to get one.
    const sw = boot({ cached: { [SPRITE]: 'the offline copy', [OWN_ASSET]: 'js' } });
    await sw.activate();
    assert.ok(await sw.cache.match(SPRITE), 'the offline copy must survive activation');
    assert.ok(await sw.cache.match(OWN_ASSET));
  });
});

describe('the service worker: what it stays out of', () => {
  it('never answers for /api/, which is uploads and originals', async () => {
    const sw = boot({ cached: { [`${ORIGIN}/api/similar`]: 'stale' } });
    assert.equal(await sw.request(`${ORIGIN}/api/similar?ref=1`), undefined);
  });

  it('never answers a POST', async () => {
    const sw = boot();
    assert.equal(await sw.request(OWN_ASSET, { method: 'POST' }), undefined);
  });
});
