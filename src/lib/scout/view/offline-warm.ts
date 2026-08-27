/**
 * "Save this area for offline" — SCOUT-HANDOFF Part 8, issue #84.
 *
 * Scout's whole point is planning a shoot *before* standing at the spot with
 * a flaky signal, but until now the service worker only cached map/DEM tiles
 * opportunistically as you happened to pan across them — the sun/moon layer
 * is pure maths and always worked offline, but the landform shadow overlay
 * (`terrain-shadows.ts`) needs elevation tiles it may never have fetched for
 * a spot chosen at home and re-opened in the field.
 *
 * No new caching mechanism: `sw.js`'s `WARM` message already caches whatever
 * URL list it's handed (Layout.astro's own automatic per-page warm is the
 * existing caller). This only builds that list — the same `tilesFor` walk
 * and the same DEM host `terrain-shadows.ts` already fetches from, at the
 * same `MAX_TILES` ceiling that already protects it from an oversized
 * request — and hands it to the SW under its own tag, so its progress
 * doesn't get folded into the archive's own per-page-load pill (see the
 * `tag` check in Layout.astro's own message listener).
 *
 * DEM only for v1, not the basemap style itself: `tilesFor` walks a raster
 * z/x/y grid, and Scout's light/dark basemaps are vector styles MapLibre
 * resolves internally — there's no URL template here to enumerate tiles
 * from without reaching into MapLibre's own internals. Satellite (a raster
 * XYZ source) could be added the same way `tilesFor` handles DEM, as a
 * follow-up.
 */
import { tilesFor, fitsZoom, type Bounds } from '../terrain';
import { boundingBox, type LatLon } from '../geo';
import { $, on } from './dom';
import { terrariumTileUrl } from './terrarium-tile';

/** Same ceiling `terrain-shadows.ts` already enforces against the same host —
 *  see that file's own comment for why a request past this size is refused
 *  outright rather than throttled. */
const MAX_TILES = 64;

/** Distinguishes this run's WARM_PROGRESS/WARM_DONE from anyone else's. */
const TAG = 'scout-area';

export interface OfflineWarmPorts {
  centre(): LatLon | null;
  radiusKm(): number;
}

export function createOfflineWarm(ports: OfflineWarmPorts): void {
  const button = $<HTMLButtonElement>('save-offline');
  const note = (text: string) => {
    $('save-offline-note').textContent = text;
  };

  if (!('serviceWorker' in navigator)) {
    // Nothing this button could ever do on a browser with no service worker
    // to hand the list to.
    button.hidden = true;
    return;
  }

  let running = false;

  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = (e.data || {}) as {
      type?: string;
      tag?: string;
      done?: number;
      total?: number;
      have?: number;
      full?: boolean;
    };
    if (d.tag !== TAG) return;
    if (d.type === 'WARM_PROGRESS') note(`Saving… ${d.done} / ${d.total}`);
    if (d.type === 'WARM_DONE') {
      running = false;
      button.disabled = false;
      note(
        d.full
          ? `No room left · ${d.have} of ${d.total} tiles saved`
          : `Saved ${d.total} elevation tiles for offline`,
      );
    }
  });

  on('save-offline', 'click', () => {
    if (running) return;
    const centre = ports.centre();
    if (!centre) {
      note('Choose a place first.');
      return;
    }
    const sw = navigator.serviceWorker.controller;
    if (!sw) {
      note('Still starting up — try again in a moment.');
      return;
    }

    const [west, south, east, north] = boundingBox(centre, ports.radiusKm() * 1000);
    const bounds: Bounds = { west, south, east, north };
    // A one-off, user-requested fetch can afford more detail than the
    // shadow overlay's own every-slider-move budget of 16 (see
    // `terrain-shadows.ts`) — this asks for the finest zoom that still
    // fits inside the same 64-tile ceiling that protects it.
    const choice = fitsZoom(bounds, MAX_TILES);
    if (!choice.fits && choice.tiles > MAX_TILES) {
      note('That radius is too wide to save in one go — try a smaller one.');
      return;
    }
    const urls = tilesFor(bounds, choice.zoom).map(terrariumTileUrl);

    running = true;
    button.disabled = true;
    note(`Saving… 0 / ${urls.length}`);
    sw.postMessage({ type: 'WARM', urls, tag: TAG });
  });
}
