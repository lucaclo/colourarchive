import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Where the real archive lives on this Mac.
 *
 * Since D1 (2026-11-18) there is one archive: the folder the Mac app was
 * pointed at on first launch (`Photos/`, `Inspiration/` and a hidden
 * `.archive`), which is the same kind of folder anyone who installs the app
 * has. This repository's own `photos/`, `public/img` and `src/data` are a
 * development copy.
 *
 * Whatever acts on the real archive from here — a public build, publishing,
 * the drift and photo checks — finds it the same way: `COLOUR_ARCHIVE_DATA`
 * when it is set (a throwaway copy for a test), otherwise the folder in the
 * app's own settings. `paths.ts` reads `COLOUR_ARCHIVE_DATA` once, when it
 * loads, so callers set it before anything imports that.
 */

/** The app's settings folder; `COLOUR_ARCHIVE_PROFILE` moves it, as in desktop/main.cjs. */
export function appProfileDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return env.COLOUR_ARCHIVE_PROFILE || path.join(home, 'Library', 'Application Support', 'Colour Archive');
}

/** The folder the Mac app opens, or null if it was never set up or has gone. */
export function appArchiveFolder(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string | null {
  try {
    const { dataDir } = JSON.parse(fs.readFileSync(path.join(appProfileDir(env, home), 'settings.json'), 'utf8')) as { dataDir?: unknown };
    return typeof dataDir === 'string' && fs.existsSync(path.join(dataDir, '.archive')) ? dataDir : null;
  } catch {
    return null;
  }
}

/** The real archive: an explicit `COLOUR_ARCHIVE_DATA`, else the app's folder. */
export function realArchiveFolder(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string | null {
  return env.COLOUR_ARCHIVE_DATA || appArchiveFolder(env, home);
}
