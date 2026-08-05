/**
 * What survives a reload, and what it is allowed to come back as.
 *
 * The page writes its whole view into `sessionStorage` on every change and
 * reads it back on the next visit. That is only safe as long as something
 * checks what comes out: storage is the one input to this page that was written
 * by an *older build of itself*, so every field in it is a claim made by code
 * that no longer exists.
 *
 * Two fields are normalised here rather than trusted, because both drive a
 * `setStyle` and a stored value that is not one of the known ones would put the
 * map into a state with no way back. Everything else is passed through and
 * merged over a default by the caller, which is why the shapes are `Partial` —
 * a session written before a field existed simply does not have it.
 */

import type { LatLon } from '../geo';
import type {
  Basemap,
  Lens,
  PlaceLabel,
  Shown,
  SightTarget,
  Slab,
  ViewMode,
} from './state';

/**
 * Versioned. A session saved before a field the UI depends on existed would
 * restore into a half-state — the reason this exists at all was a save with no
 * timezone quietly printing Tokyo's sunset on a London clock.
 */
export const STORE_KEY = 'scout-view.v4';

/**
 * The kept spots, which are deliberately not in the same box.
 *
 * `localStorage`, where the rest of the view state is in `sessionStorage` —
 * surviving the tab is the entire point of keeping a spot.
 */
export const SPOTS_KEY = 'scout-spots.v1';

/** The view as it is written out. Everything here is known to be present. */
export interface SessionState {
  centre: LatLon;
  label: PlaceLabel;
  radiusKm: number;
  timeZone: string;
  view: ViewMode;
  basemap: Basemap;
  shown: Shown;
  slab: Slab;
  lens: Lens;
  target: SightTarget;
  isoDate: string;
}

/** The view as it comes back: two fields settled, the rest still to be merged. */
export interface SavedView {
  centre?: LatLon;
  label?: PlaceLabel;
  radiusKm?: number;
  timeZone?: string;
  view: ViewMode;
  basemap: Basemap;
  shown?: Partial<Shown>;
  slab?: Partial<Slab>;
  lens?: Partial<Lens>;
  target?: Partial<SightTarget>;
  isoDate?: string;
}

/**
 * Parse a stored session, settling the two fields that must not be surprises.
 *
 * **Throws** on unreadable JSON, and that is deliberate. The caller abandons the
 * whole restore when this throws, rather than half-applying a session it could
 * not read — a page holding somebody's toggles but not their coordinate is a
 * worse answer than a page that opens fresh.
 */
export function readSession(raw: string | null): SavedView {
  const saved = JSON.parse(raw || 'null') as Partial<SavedView> | null;
  return {
    ...saved,
    // Anything that is not 3D is flat. A stored '3d' is the only value that
    // turns terrain on, so an unrecognised one costs the pitch and nothing else.
    view: saved?.view === '3d' ? '3d' : '2d',
    // Light is the fallback because it is the style the map is constructed with:
    // restoring to it is the one basemap that needs no `setStyle` at all.
    basemap: saved?.basemap === 'dark' || saved?.basemap === 'satellite' ? saved.basemap : 'light',
  };
}

/** The view as the string that goes into storage. */
export function writeSession(state: SessionState): string {
  const { centre, label, radiusKm, timeZone, view, basemap, shown, slab, lens, target, isoDate } =
    state;
  return JSON.stringify({
    centre,
    label,
    radiusKm,
    timeZone,
    view,
    basemap,
    shown,
    slab,
    lens,
    target,
    isoDate,
  });
}
