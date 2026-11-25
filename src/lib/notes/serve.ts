/**
 * One note in words for an archive photo, as the server writes it (#180).
 *
 * What leaves the Mac: the photo as a stripped ≤1568 px JPEG and the intent.
 * No findings and no references yet (#179 and #178 aren't built), and never
 * the file name, the id, EXIF or GPS. A note already kept for the same frame,
 * model and intent comes back without a request unless `fresh` is asked for.
 *
 * Raw service errors go to the server log with the key scrubbed out; what's
 * thrown carries only a reason, for the API to turn into its short copy.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { readStore } from '../manifest';
import { NOTES_WORDS_PATH, PHOTOS_DIR } from '../paths';
import { notesKey, notesModel } from './key';
import { getNote, putNote, setLatest, type StoredNote } from './store';
import { askGemini, cacheKey, redact, strippedJpeg, validate, WordsError, type AskInput, type AskResult } from './words';

export const MAX_INTENT = 300;

export type NotesReason = 'bad-input' | 'no-photo' | 'no-key';

/** The UI's words for each, as the API sends them. */
export const NOTES_COPY: Record<NotesReason, string> = {
  'bad-input': 'Intent needed',
  'no-photo': 'Photo not found',
  'no-key': 'No key',
};

export class NotesError extends Error {
  constructor(readonly reason: NotesReason) {
    super(NOTES_COPY[reason]);
    this.name = 'NotesError';
  }
}

export interface WriteInput {
  id: string;
  intent: string;
  fresh?: boolean;
}

export interface WriteDeps {
  ask?: (input: AskInput) => Promise<AskResult>;
  key?: () => string;
  model?: () => string;
  /** Where the notes are kept. */
  file?: string;
  /** The photo's original on disk, or null when the id isn't in the archive. */
  photoFile?: (id: string) => Promise<string | null>;
  now?: () => Date;
}

async function archivePhoto(id: string): Promise<string | null> {
  const photo = (await readStore()).find((p) => p.id === id);
  return photo ? path.join(PHOTOS_DIR, photo.filename) : null;
}

export async function writeNote(input: WriteInput, deps: WriteDeps = {}): Promise<StoredNote> {
  const { ask = askGemini, key: getKey = notesKey, model: getModel = notesModel, file = NOTES_WORDS_PATH } = deps;
  const { photoFile = archivePhoto, now = () => new Date() } = deps;

  const intent = typeof input.intent === 'string' ? input.intent.trim() : '';
  if (!intent || intent.length > MAX_INTENT) throw new NotesError('bad-input');
  const id = typeof input.id === 'string' ? input.id : '';
  const at = id ? await photoFile(id) : null;
  if (!at) throw new NotesError('no-photo');

  let original: Buffer;
  try {
    original = await fs.readFile(at);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotesError('no-photo');
    throw err;
  }
  const frame = await strippedJpeg(original);
  const model = getModel();
  const key = cacheKey({ model, frame, intent, findings: [], refs: [] });

  if (input.fresh !== true) {
    const kept = await getNote(key, file);
    if (kept) {
      await setLatest(id, key, file);
      return kept;
    }
  }

  const apiKey = getKey();
  if (!apiKey) throw new NotesError('no-key');

  let raw: unknown;
  try {
    ({ raw } = await ask({ key: apiKey, model, frame, intent }));
  } catch (err) {
    const reason = err instanceof WordsError ? err.reason : 'service';
    console.error(`[notes/words] ${reason}: ${redact(String((err as Error)?.message ?? err), apiKey)}`);
    throw new WordsError(reason, 'see the server log');
  }

  const { note, dropped } = validate(raw, []);
  const stored: StoredNote = { key, id, intent, model, at: now().toISOString(), note, dropped, mark: null };
  await putNote(stored, file);
  return stored;
}
