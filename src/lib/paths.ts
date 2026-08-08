import path from 'node:path';

// Resolve everything from the project root. Dev, `astro build` (prerender),
// and the launched node server all run with cwd = project root (the launcher
// cd's into it), so cwd is the one anchor that also survives Vite's SSR bundle
// — unlike import.meta.url, which points into a temp dir during prerender and
// made the static export read an empty manifest.
export const ROOT = process.cwd();

export const PHOTOS_DIR = path.join(ROOT, 'photos');
export const IMG_DIR = path.join(ROOT, 'public', 'img');
export const MANIFEST_PATH = path.join(ROOT, 'src', 'data', 'manifest.json');
// Inspiration board — a separate collection of reference images.
export const INSPIRATION_DIR = path.join(ROOT, 'inspiration');
export const INSPIRATION_STORE = path.join(ROOT, 'src', 'data', 'inspiration.json');
export const INSPIRATION_MANIFEST = path.join(ROOT, 'src', 'data', 'inspiration.manifest.json');
export const OVERRIDES_PATH = path.join(ROOT, 'photos.overrides.json');
export const EXPORT_PATH = path.join(ROOT, 'sequence.json');

// Style Match.
//
// Preview assets are served through /api/match/asset rather than from public/.
// Two reasons, both learned the hard way: the dev server's static middleware
// does not reliably see files created after it started (the reference preview
// 404'd when requested 1ms after being written), and anything under public/ is
// copied into dist/client at build time — which would bake ephemeral session
// artefacts into the published archive.
export const MATCH_CACHE_DIR = path.join(ROOT, '.match-cache');
export const MATCH_KEPT_DIR = path.join(ROOT, 'src', 'data', 'match');

// Scout. Geocoding answers are cached to disk and never expire on their own:
// places do not move, Nominatim asks to be used sparingly, and a scouted area
// should keep working when the Wi-Fi does not.
export const SCOUT_CACHE_DIR = path.join(ROOT, '.scout-cache');
export const SCOUT_GEOCODE_DIR = path.join(SCOUT_CACHE_DIR, 'geocode');
// Forecasts, unlike places, go off. Cached only long enough to survive a session
// of scrubbing the slider back and forth — see WEATHER_TTL_MS.
export const SCOUT_WEATHER_DIR = path.join(SCOUT_CACHE_DIR, 'weather');
// The aerosol column, from a different host and on a slower clock than the
// weather — it is a smooth field that moves over half a day. See AIR_TTL_MS.
export const SCOUT_AIR_DIR = path.join(SCOUT_CACHE_DIR, 'air');

/** Web path (as served) for a derivative file. */
export const imgUrl = (name: string): string => `/img/${name}`;
