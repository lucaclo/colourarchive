/**
 * The Gemini key for notes in words, read at the moment it's needed.
 *
 * In the Mac app the key lives in the Keychain (desktop/notes-key.cjs) and
 * main.cjs hands it to the server process by message, which keeps it in a
 * global slot; it is never in any process's environment. In `npm run dev` it
 * comes from the repo's .env, read once. A GEMINI_API_KEY already in the
 * environment (a hand-run server) is used as is.
 *
 * Only ever from process.env at run time. Astro inlines a private variable read
 * through import.meta.env.<NAME> into the build, and it does the same for every
 * .env name this file mentions if the file holds the env object on its own, so
 * the DEV check below is the only import.meta read here and must stay a member
 * access.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { ROOT } from '../paths';

let dotEnv: string | null = null;

function isDev(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false; // plain Node (tests, scripts): no Vite, no env object
  }
}

/** Only this one line of .env, never the rest of it into process.env. */
function fromDotEnv(): string {
  if (dotEnv === null) {
    try {
      dotEnv = parseEnv(fs.readFileSync(path.join(ROOT, '.env'), 'utf8')).GEMINI_API_KEY ?? '';
    } catch {
      dotEnv = '';
    }
  }
  return dotEnv;
}

/** Where desktop/server.mjs keeps the key it's sent. Not process.env, which
 *  every child process (sips, dcraw_emu) would inherit. */
const SLOT = Symbol.for('colour-archive.notes-key');

export function notesKey(): string {
  const held = (globalThis as Record<symbol, unknown>)[SLOT];
  if (typeof held === 'string' && held) return held;
  const set = process.env.GEMINI_API_KEY ?? '';
  if (set || !isDev()) return set;
  return fromDotEnv();
}

/** Flash: the free tier gives Pro no quota. */
export function notesModel(): string {
  return process.env.NOTES_MODEL || 'gemini-3.5-flash';
}
