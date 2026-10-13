/**
 * Your photos on the map — and the fold that places them.
 *
 * Owns the `#fold-mine` block, a clustered GeoJSON source, and the HTML
 * markers drawn from it: each located archive photo is a thumbnail pin, and
 * photos close together at the current zoom stack into one pin with a count.
 * The clustering is MapLibre's own (`cluster: true`), so the stacks re-form on
 * every zoom for free; the markers are HTML because a photograph cannot be a
 * circle layer. The source's single layer is invisible and exists only so the
 * source loads — the markers are read off it with `querySourceFeatures`.
 *
 * Placing is two taps: a photo in the fold's grid, then the map. The page's
 * click handler asks `consumeClick` first, so while a photo is waiting the tap
 * places it rather than moving the scouting pin.
 *
 * Mac-only. The list comes from `/api/scout/mine`, which the static publish
 * does not have, and the locations are private besides (see `scout/mine.ts`),
 * so on the published site the fold stays hidden and nothing is fetched.
 */

import type { GeoJSONSource, Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';
import type { LatLon } from '../geo';
import { mineFeatures, minePinSize, type MinePhoto } from '../mine';
import { $, on } from './dom';

type MapLibreModule = typeof import('maplibre-gl');

export const MINE_SOURCE = 'scout-mine';
const MINE_LAYER = 'scout-mine-anchor';
const SHOWN_KEY = 'scout.mine.shown';

export interface MinePorts {
  lib: MapLibreModule;
  map(): MapLibreMap | null;
  /** Make this the place being scouted. */
  scoutAt(at: LatLon): void;
  notify(text: string): void;
}

export interface MineLayer {
  /** Add the source and its anchor layer. Call on every `style.load` —
   *  `setStyle` drops them. */
  attach(): void;
  /** True if the tap was a placement and must go no further. */
  consumeClick(at: LatLon): boolean;
}

export function createMineLayer(ports: MinePorts): MineLayer {
  let photos: MinePhoto[] = [];
  let shown = readShown();
  let placingId: string | null = null;
  const markers = new Map<string, Marker>();
  let popup: Popup | null = null;

  const byId = (id: string) => photos.find((p) => p.id === id);
  const located = () => photos.filter((p) => p.lat !== undefined);

  /* ── The list ──────────────────────────────────────────────────────── */

  void (async () => {
    try {
      const response = await fetch('/api/scout/mine');
      const data = await response.json();
      if (!data.ok) throw new Error(data.error);
      photos = data.photos as MinePhoto[];
    } catch (err) {
      // No server, or it failed: the fold stays hidden rather than showing
      // an archive with nothing in it.
      console.warn('[scout] your photos unavailable', err);
      return;
    }
    $<HTMLElement>('fold-mine').hidden = false;
    renderFold();
    refreshSource();
  })();

  /* ── The fold ──────────────────────────────────────────────────────── */

  function renderFold() {
    const placed = located().length;
    $('mine-count').textContent = photos.length
      ? `${placed} of ${photos.length} on the map`
      : 'The archive is empty.';
    const showButton = $<HTMLButtonElement>('mine-show');
    showButton.setAttribute('aria-pressed', String(shown));
    showButton.textContent = shown ? 'Shown on map' : 'Hidden';
    $<HTMLButtonElement>('mine-fit').disabled = placed === 0;

    const unplaced = photos.filter((p) => p.lat === undefined);
    $('mine-hint').textContent = unplaced.length
      ? 'Tap a photo below, then tap the map where you took it.'
      : 'Every photo has a place. Tap a pin to move one.';
    const grid = $('mine-grid');
    grid.replaceChildren(
      ...unplaced.map((photo) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.id = photo.id;
        button.setAttribute('aria-pressed', String(photo.id === placingId));
        button.setAttribute('aria-label', `Place this ${photo.chapter.toLowerCase()} photo`);
        button.style.backgroundImage = `url("${photo.placeholder}")`;
        button.append(thumb(photo, true));
        item.append(button);
        return item;
      }),
    );
  }

  on('mine-grid', 'click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
    if (!button) return;
    const id = button.dataset.id!;
    startPlacing(placingId === id ? null : id);
  });

  on('mine-show', 'click', () => {
    shown = !shown;
    try {
      localStorage.setItem(SHOWN_KEY, shown ? '1' : '0');
    } catch {
      // A private window: the choice lasts this visit only.
    }
    renderFold();
    if (shown) markDirty();
    else refreshMarkers();
  });

  on('mine-fit', 'click', () => {
    const map = ports.map();
    const points = located();
    if (!map || !points.length) return;
    if (!shown) {
      shown = true;
      renderFold();
    }
    if (points.length === 1) {
      map.flyTo({ center: [points[0].lon!, points[0].lat!], zoom: 14 });
      return;
    }
    const bounds = new ports.lib.LngLatBounds();
    for (const p of points) bounds.extend([p.lon!, p.lat!]);
    map.fitBounds(bounds, { padding: 80, maxZoom: 15 });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && placingId) startPlacing(null);
  });

  /* ── Placing ───────────────────────────────────────────────────────── */

  function startPlacing(id: string | null) {
    placingId = id;
    popup?.remove();
    renderFold();
    if (id) ports.notify('Now tap the map where you took it. Esc to cancel.');
  }

  function consumeClick(at: LatLon): boolean {
    if (!placingId) return false;
    const id = placingId;
    placingId = null;
    void save(id, at);
    return true;
  }

  async function save(id: string, at: LatLon | null) {
    const photo = byId(id);
    if (!photo) return;
    const before = { lat: photo.lat, lon: photo.lon, source: photo.source };
    // Optimistic: the pin lands on the tap, and is taken back if the write
    // fails, so a slow disk never makes the map feel like it ignored you.
    if (at) Object.assign(photo, { lat: at.lat, lon: at.lon, source: 'placed' });
    else Object.assign(photo, { lat: undefined, lon: undefined, source: undefined });
    if (at && !shown) shown = true;
    renderFold();
    refreshSource();
    try {
      const response = await fetch('/api/scout/mine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, location: at }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error);
      // Clearing a placement falls back to GPS if the file has one — only the
      // server knows that, so ask it rather than guess.
      if (!at) await reload();
      ports.notify(at ? 'Photo placed' : 'Location removed');
    } catch (err) {
      Object.assign(photo, before);
      renderFold();
      refreshSource();
      ports.notify(`Could not save that: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function reload() {
    const data = await fetch('/api/scout/mine').then((r) => r.json());
    if (data.ok) photos = data.photos;
    renderFold();
    refreshSource();
  }

  /* ── The map ───────────────────────────────────────────────────────── */

  function attach() {
    const map = ports.map();
    if (!map || map.getSource(MINE_SOURCE)) return;
    map.addSource(MINE_SOURCE, {
      type: 'geojson',
      data: mineFeatures(photos),
      cluster: true,
      clusterRadius: 48,
      // Past street level, two photos a few metres apart are two spots.
      clusterMaxZoom: 16,
      // The lowest index in a stack is its cover photo — numbers aggregate,
      // strings do not, hence `order` rather than the id.
      clusterProperties: { cover: ['min', ['get', 'order']] },
    });
    map.addLayer({
      id: MINE_LAYER,
      type: 'circle',
      source: MINE_SOURCE,
      paint: { 'circle-radius': 1, 'circle-opacity': 0 },
    });
    // Markers are DOM and survive a style swap, but the stacks they show
    // belong to the new source; rebuild them once it has loaded.
    for (const marker of markers.values()) marker.remove();
    markers.clear();
  }

  function refreshSource() {
    const source = ports.map()?.getSource(MINE_SOURCE) as GeoJSONSource | undefined;
    source?.setData(mineFeatures(photos));
    // `setData` re-clusters in a worker; the render hook below redraws when
    // done. Hiding is immediate, though, and does not need to wait for it.
    if (!shown) refreshMarkers();
    else markDirty();
  }

  function refreshMarkers() {
    const map = ports.map();
    if (!map) return;
    if (!shown || !map.getSource(MINE_SOURCE) || !map.isSourceLoaded(MINE_SOURCE)) {
      if (!shown) {
        for (const marker of markers.values()) marker.remove();
        markers.clear();
      }
      return;
    }
    const wanted = new Map<string, GeoJSON.Feature>();
    for (const feature of map.querySourceFeatures(MINE_SOURCE)) {
      const props = feature.properties ?? {};
      // A feature spanning a tile boundary is returned once per tile.
      const key = props.cluster ? `c${props.cluster_id}` : `p${props.id}`;
      if (!wanted.has(key)) wanted.set(key, feature);
    }
    for (const [key, marker] of markers) {
      if (!wanted.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    }
    for (const [key, feature] of wanted) {
      if (markers.has(key)) continue;
      const [lon, lat] = (feature.geometry as GeoJSON.Point).coordinates;
      const element = pinElement(feature.properties ?? {});
      if (!element) continue;
      markers.set(key, new ports.lib.Marker({ element }).setLngLat([lon, lat]).addTo(map));
    }
  }

  function pinElement(props: Record<string, unknown>): HTMLElement | null {
    const cover = photos[Number(props.cluster ? props.cover : props.order)];
    if (!cover) return null;
    const element = document.createElement('button');
    element.type = 'button';
    element.className = props.cluster ? 'mine-pin mine-cluster' : 'mine-pin';
    element.style.setProperty('--ring', cover.colour);
    element.style.backgroundImage = `url("${cover.placeholder}")`;
    element.append(thumb(cover));
    if (props.cluster) {
      const count = Number(props.point_count);
      const badge = document.createElement('b');
      badge.textContent = String(count);
      element.append(badge);
      element.setAttribute('aria-label', `${count} of your photos here — zoom in`);
    } else {
      element.setAttribute('aria-label', `Your ${cover.chapter.toLowerCase()} photo`);
    }
    element.addEventListener('click', (event) => {
      // The map's own click would otherwise move the scouting pin too.
      event.stopPropagation();
      if (props.cluster) void openCluster(Number(props.cluster_id), element);
      else openCard(cover);
    });
    return element;
  }

  async function openCluster(clusterId: number, element: HTMLElement) {
    const map = ports.map();
    const source = map?.getSource(MINE_SOURCE) as GeoJSONSource | undefined;
    if (!map || !source) return;
    const zoom = await source.getClusterExpansionZoom(clusterId);
    const marker = [...markers.values()].find((m) => m.getElement() === element);
    map.easeTo({ center: marker?.getLngLat() ?? map.getCenter(), zoom: Math.max(zoom, map.getZoom() + 1) });
  }

  function openCard(photo: MinePhoto) {
    const map = ports.map();
    if (!map || photo.lat === undefined || photo.lon === undefined) return;
    popup?.remove();
    const card = document.createElement('div');
    card.className = 'mine-card';
    card.append(thumb(photo));
    const caption = document.createElement('p');
    const when = photo.capturedAt
      ? new Date(photo.capturedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : null;
    caption.textContent = [photo.chapter, when, photo.source === 'gps' ? 'from GPS' : 'placed by hand']
      .filter(Boolean)
      .join(' · ');
    const actions = document.createElement('div');
    actions.className = 'mine-card-actions';
    const at = { lat: photo.lat, lon: photo.lon };
    actions.append(
      action('Scout here', () => {
        popup?.remove();
        ports.scoutAt(at);
      }),
      action('Move', () => startPlacing(photo.id)),
    );
    // A GPS position is the file's, not a choice made here, so there is no
    // placement to take back.
    if (photo.source === 'placed') actions.append(action('Remove', () => (popup?.remove(), void save(photo.id, null))));
    card.append(caption, actions);
    popup = new ports.lib.Popup({ offset: 28, maxWidth: '260px', closeButton: true, className: 'mine-popup' })
      .setLngLat([photo.lon, photo.lat])
      .setDOMContent(card)
      .addTo(map);
  }

  // Marked dirty by anything that can change the stacks, and rebuilt on the
  // next frame the source is loaded for. Waiting on `sourcedata` alone missed
  // a zoom back to tiles already cached — no load, so no event, and the pins
  // stayed gone until the next pan.
  let dirty = true;
  const map = ports.map();
  const markDirty = () => {
    dirty = true;
    map?.triggerRepaint();
  };
  map?.on('sourcedata', (event) => {
    if (event.sourceId === MINE_SOURCE) markDirty();
  });
  map?.on('moveend', markDirty);
  // The pins shrink as you zoom out (see minePinSize). A variable on the
  // container rather than a transform: MapLibre owns each marker's transform.
  const sizePins = () => map?.getContainer().style.setProperty('--mine-size', `${minePinSize(map.getZoom())}px`);
  map?.on('zoom', sizePins);
  sizePins();
  map?.on('render', () => {
    if (!dirty || !map.getSource(MINE_SOURCE) || !map.isSourceLoaded(MINE_SOURCE)) return;
    dirty = false;
    refreshMarkers();
  });

  return { attach, consumeClick };
}

/** Lazy only in the fold's grid. Inside a MapLibre marker or popup the
 *  browser's visibility check does not reliably fire, and the pin stays on
 *  its blurred placeholder — and a marker only exists while it is in view
 *  anyway. */
function thumb(photo: MinePhoto, lazy = false): HTMLImageElement {
  const img = document.createElement('img');
  img.src = photo.thumb;
  img.alt = '';
  img.loading = lazy ? 'lazy' : 'eager';
  img.decoding = 'async';
  return img;
}

function action(label: string, run: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', run);
  return button;
}

function readShown(): boolean {
  try {
    return localStorage.getItem(SHOWN_KEY) !== '0';
  } catch {
    return true;
  }
}
