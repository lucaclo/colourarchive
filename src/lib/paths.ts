import path from 'node:path';

// Resolve everything from the project root. Dev, `astro build` (prerender),
// and the launched node server all run with cwd = project root (the launcher
// cd's into it), so cwd is the one anchor that also survives Vite's SSR bundle
// — unlike import.meta.url, which points into a temp dir during prerender and
// made the static export read an empty manifest.
export const ROOT = process.cwd();

// Where the archive's own data lives — the photographs and everything the app
// writes about them. In development that is this repository, as it always was.
// The Mac app (desktop/main.cjs) sets COLOUR_ARCHIVE_DATA to the folder the
// person chose on first launch, so their photographs live outside the app and
// survive reinstalling or updating it. The originals and reference images sit
// at the top of that folder where Finder shows them; everything derived from
// them goes in a hidden `.archive` beside them, laid out as it is here.
export const DATA_ROOT = process.env.COLOUR_ARCHIVE_DATA || null;
/** True inside the Mac app, which keeps its data outside the code. */
export const IS_DESKTOP = DATA_ROOT !== null;
const kept = (...rel: string[]): string =>
  DATA_ROOT ? path.join(DATA_ROOT, '.archive', ...rel) : path.join(ROOT, ...rel);

// Where the Match and search models are cached once downloaded. Left to the
// library's default (inside node_modules) in development; the Mac app points it
// at its Application Support folder, since the app's own files are read-only.
export const MODELS_DIR = process.env.COLOUR_ARCHIVE_MODELS || null;

export const PHOTOS_DIR = DATA_ROOT ? path.join(DATA_ROOT, 'Photos') : path.join(ROOT, 'photos');
export const IMG_DIR = kept('public', 'img');
// The flat, append-only list of every photograph — the source of truth.
// manifest.json is derived from it (ordered, grouped, overrides applied).
export const STORE_PATH = kept('src', 'data', 'photos.json');
export const MANIFEST_PATH = kept('src', 'data', 'manifest.json');
// Inspiration board — a separate collection of reference images.
export const INSPIRATION_DIR = DATA_ROOT ? path.join(DATA_ROOT, 'Inspiration') : path.join(ROOT, 'inspiration');
export const INSPIRATION_STORE = kept('src', 'data', 'inspiration.json');
export const INSPIRATION_MANIFEST = kept('src', 'data', 'inspiration.manifest.json');
export const OVERRIDES_PATH = kept('photos.overrides.json');
// Where each photograph was taken, placed by hand in Scout. Deliberately NOT
// in OVERRIDES_PATH and git-ignored: the repository is public, and a push
// must never publish where someone shoots. See `scout/mine.ts`.
export const LOCATIONS_PATH = kept('photos.locations.json');
export const EXPORT_PATH = kept('sequence.json');
// The book's own curation — issue #82. Deliberately separate from
// OVERRIDES_PATH: an override changes what a photo *is* (its chapter,
// medium, genre) for the whole archive, while this changes only whether and
// where a photo sits in one particular curated object, the printed book.
export const BOOK_PATH = kept('src', 'data', 'book.json');
// The archive's own notebook — why a photo matters, kept by id. Deliberately
// its own file, not folded into overrides or the book curation: this is
// never derived and never affects rendering, chapter, or export — the only
// thing that ever reads it is a human.
// Print PDFs built from the book (api/book/pdf). Regenerated on demand,
// large, and full of originals, so git-ignored.
export const BOOK_PRINT_DIR = kept('.book-print');
export const NOTES_PATH = kept('src', 'data', 'notes.json');
// Scout's curated list of named photographers to look for near a spot — see
// `scout/sources/notable.ts`'s header. Hand-edited, like NOTES_PATH, so it is
// read fresh rather than cached at module load.
export const NOTABLE_PHOTOGRAPHERS_PATH = path.join(ROOT, 'src', 'data', 'notable-photographers.json');

// Style Match.
//
// Preview assets are served through /api/match/asset rather than from public/.
// Two reasons, both learned the hard way: the dev server's static middleware
// does not reliably see files created after it started (the reference preview
// 404'd when requested 1ms after being written), and anything under public/ is
// copied into dist/client at build time — which would bake ephemeral session
// artefacts into the published archive.
export const MATCH_CACHE_DIR = kept('.match-cache');
export const MATCH_KEPT_DIR = kept('src', 'data', 'match');
// A separate top-level directory, not a subfolder of MATCH_CACHE_DIR: the
// startup sweep in session.ts deletes anything under MATCH_CACHE_DIR that
// isn't a kept match's id, and a subfolder here would look exactly like one
// of those to it.
export const MATCH_ANALYSIS_CACHE_DIR = kept('.match-analysis-cache');
// Round trips (an applied preset's export, measured back) and the calibration
// fitted from them. Git-ignored like the rest: it describes one person's
// Lightroom, and the snapshots inside hold full measurements of their photos.
export const MATCH_CALIBRATION_DIR = kept('.match-calibration');

// Scout. Geocoding answers are cached to disk and never expire on their own:
// places do not move, Nominatim asks to be used sparingly, and a scouted area
// should keep working when the Wi-Fi does not.
export const SCOUT_CACHE_DIR = kept('.scout-cache');
export const SCOUT_GEOCODE_DIR = path.join(SCOUT_CACHE_DIR, 'geocode');
// Forecasts, unlike places, go off. Cached only long enough to survive a session
// of scrubbing the slider back and forth — see WEATHER_TTL_MS.
export const SCOUT_WEATHER_DIR = path.join(SCOUT_CACHE_DIR, 'weather');
// The aerosol column, from a different host and on a slower clock than the
// weather — it is a smooth field that moves over half a day. See AIR_TTL_MS.
export const SCOUT_AIR_DIR = path.join(SCOUT_CACHE_DIR, 'air');
// Seeing and transparency, from a third host on 7Timer's own four-times-a-day
// clock. See SEEING_TTL_MS.
export const SCOUT_SEEING_DIR = path.join(SCOUT_CACHE_DIR, 'seeing');
// Tide predictions (issue #71) — split into two caches with two different
// lifetimes, since they answer two different-shaped questions. See
// tide-client.ts's header for why.
export const SCOUT_TIDE_STATION_DIR = path.join(SCOUT_CACHE_DIR, 'tide-station');
export const SCOUT_TIDE_DAY_DIR = path.join(SCOUT_CACHE_DIR, 'tide-day');
// Real-time space weather (Kp, Bz, solar wind speed) from NOAA SWPC. One
// file, not one per coordinate: unlike weather, this reading does not vary
// with where the pin is — see aurora-client.ts's own note. See AURORA_TTL_MS.
export const SCOUT_AURORA_DIR = path.join(SCOUT_CACHE_DIR, 'aurora');

/** Web path (as served) for a derivative file. */
export const imgUrl = (name: string): string => `/img/${name}`;
