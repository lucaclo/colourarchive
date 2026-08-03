/* Colour Archive — offline service worker.
 *
 * Lets the iPad keep a full, browsable snapshot of the archive on-device.
 * Visit once while on the same Wi-Fi (laptop app running); everything the page
 * references is cached. After that the Home Screen app opens and scrolls fully
 * offline — laptop off, Wi-Fi gone — showing the last snapshot it saw.
 *
 * Strategy:
 *   • HTML pages   → network-first (fresh when online, cached copy when not)
 *   • own assets/images/fonts → cache-first (instant, and the basis of offline)
 *   • third-party assets → network-first with a short fuse, then the cached copy
 *   • /api/*       → never cached (uploads, removals, full-res originals)
 */
const VERSION = 'v1';
const CACHE = `colour-archive-${VERSION}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();

    // Nothing is evicted here. An earlier version of this fix cleared out the
    // third-party entries on the reasoning that they were stale — and took the
    // offline copy of every map sprite and DEM tile with them, so the first
    // network hiccup after it landed left the basemap with nothing to fall back
    // on and the map failed to draw. The staleness is already handled below by
    // going to the network first; a stale entry that is only ever read when
    // there is no network is not a bug, it is the entire point of having one.
  })());
});

function isCacheableAsset(url) {
  if (url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/img/')) return true;
  // Fonts are served from this origin now (public/fonts) — the woff2 rule below
  // covers them, so there is no third-party font host left to special-case.
  if (/\.(css|js|avif|webp|png|svg|ico|woff2?|json)$/.test(url.pathname)) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Dynamic, machine-side endpoints — leave them to the network.
  if (url.pathname.startsWith('/api/')) return;

  const isNavigation =
    req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
        if (url.origin === self.location.origin) cache.put('/', res.clone()); // start_url for offline launch
        return res;
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match(req)) || (await cache.match('/')) || Response.error();
      }
    })());
    return;
  }

  if (isCacheableAsset(url)) {
    // Our own assets are either content-hashed or ours to change, so a cache hit
    // is always the right answer and answering from disk is the whole point.
    //
    // Third-party ones are neither. Scout pulls a map style, its sprite sheet
    // (a .json and a .png) and terrarium DEM tiles (.png) from hosts that update
    // on their own schedule — served cache-first they are pinned to whatever was
    // seen on the first visit, and a sprite that no longer matches the style it
    // was cut for draws the wrong icons with no error anywhere. Go to the network
    // for those and keep the cached copy for when there isn't one.
    event.respondWith(
      url.origin === self.location.origin ? cacheFirst(req) : networkFirst(req),
    );
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    // The `.catch` matters and its absence was a real defect. `cache.put` is not
    // awaited — deliberately, so a slow write cannot delay the response — which
    // means a rejection here has nobody to receive it and becomes an unhandled
    // rejection inside the worker. It rejects for an ordinary reason, too: iOS
    // gives a site a far smaller Cache Storage quota than a desktop does, and
    // this archive warms tens of megabytes of photographs into it, so a full
    // quota is the expected end state on a phone rather than an exotic one.
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    return Response.error();
  }
}

/**
 * Fresh if the network is prompt, the stored copy otherwise.
 *
 * Plain network-first was not enough. A map needs hundreds of these — sprites,
 * DEM tiles, a style — and on a slow connection making every one of them wait
 * for the network is how a map that used to appear instantly starts crawling;
 * on no connection at all, a bare `fetch` rejection means the basemap simply
 * fails. So the request races a short timer: whoever answers first wins, the
 * network keeps filling the cache either way, and a copy we already hold is
 * always better than an error.
 */
const NETWORK_PATIENCE_MS = 2500;

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  // Never rejects, so a slow request that loses the race cannot go unhandled.
  const network = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);

  const hit = await cache.match(req);
  if (!hit) return (await network) || Response.error();

  const patience = new Promise((resolve) => setTimeout(resolve, NETWORK_PATIENCE_MS, null));
  return (await Promise.race([network, patience])) || hit;
}

// The page hands us the full list of image URLs so the WHOLE archive caches on
// a single visit, without having to scroll every photo into view first.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'WARM' || !Array.isArray(data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const queue = data.urls.slice();
    const total = queue.length;
    let added = 0, done = 0, lastPost = 0;
    const say = async (type, extra) => {
      const clients = await self.clients.matchAll();
      clients.forEach((c) => c.postMessage(Object.assign({ type, total, done, added }, extra)));
    };
    const tick = () => {
      done++;
      // Report at most every 4 files: enough for a count that visibly moves,
      // few enough that postMessage isn't competing with the downloads.
      if (done - lastPost >= 4 || done === total) { lastPost = done; say('WARM_PROGRESS'); }
    };
    // Bounded concurrency. Firing every derivative at once (hundreds of AVIFs,
    // several MB each) saturates the LAN, and iOS starts failing requests under
    // that load — the snapshot came out with holes in it. Six at a time keeps
    // the page responsive while it fills and every fetch actually lands.
    const worker = async () => {
      for (let u = queue.shift(); u !== undefined; u = queue.shift()) {
        try {
          if (!(await cache.match(u))) {
            // No `cache: 'no-store'`. Every derivative is named by the hash of
            // its own bytes, so a given URL can never point at different pixels
            // — there is nothing to go stale, and bypassing the HTTP cache only
            // meant re-downloading over the network what the browser already had
            // on disk. On a phone filling a snapshot that is tens of megabytes
            // of someone's data allowance spent to arrive at the same bytes.
            const res = await fetch(u);
            if (res && (res.ok || res.type === 'opaque')) { await cache.put(u, res.clone()); added++; }
          }
        } catch { /* offline or missing — skip */ }
        tick();   // counts attempted, not succeeded: the bar must always finish
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, total) }, worker));
    await say('WARM_DONE');
  })());
});
