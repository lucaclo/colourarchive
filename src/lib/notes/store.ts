/**
 * Notes in words, kept on this Mac (NOTES_WORDS_PATH): every note a model wrote,
 * by its cache key, so the same frame and intent never cost a second request,
 * and the Useful / Not useful mark given to each, which is how the trial is
 * judged. `latest` is the note last written or shown for each photo.
 *
 * Saved the way the zine is (zine-store.ts): one write at a time, to a temp
 * file renamed over the old one. A missing file is an empty store; a file that
 * no longer parses fails the read rather than being saved over.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { NOTES_WORDS_PATH } from '../paths';
import type { Dropped, WordsNote } from './words';

export type Mark = 'useful' | 'not-useful' | null;

export interface StoredNote {
  key: string;
  id: string;
  intent: string;
  model: string;
  /** ISO time it was written. */
  at: string;
  note: WordsNote;
  dropped: Dropped[];
  mark: Mark;
}

export interface NotesWordsFile {
  version: 1;
  notes: Record<string, StoredNote>;
  latest: Record<string, string>;
}

export const isMark = (v: unknown): v is Mark => v === 'useful' || v === 'not-useful' || v === null;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export async function readNotesWords(file = NOTES_WORDS_PATH): Promise<NotesWordsFile> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, notes: {}, latest: {} };
    throw err;
  }
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) throw new Error(`${path.basename(file)} isn’t an object`);
  return {
    version: 1,
    notes: isRecord(raw.notes) ? (raw.notes as Record<string, StoredNote>) : {},
    latest: isRecord(raw.latest) ? (raw.latest as Record<string, string>) : {},
  };
}

export async function latestNote(id: string, file = NOTES_WORDS_PATH): Promise<StoredNote | null> {
  const s = await readNotesWords(file);
  const key = Object.hasOwn(s.latest, id) ? s.latest[id] : undefined;
  return key && Object.hasOwn(s.notes, key) ? s.notes[key] : null;
}

export async function getNote(key: string, file = NOTES_WORDS_PATH): Promise<StoredNote | null> {
  const s = await readNotesWords(file);
  return Object.hasOwn(s.notes, key) ? s.notes[key] : null;
}

let writeChain: Promise<unknown> = Promise.resolve();

/** Read, change and write the file, one change at a time. `change` returns false to write nothing. */
function update(file: string, change: (s: NotesWordsFile) => boolean): Promise<boolean> {
  const step = async () => {
    const s = await readNotesWords(file);
    if (!change(s)) return false;
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(s, null, 2)}\n`);
    await fs.rename(tmp, file);
    return true;
  };
  const run = writeChain.then(step, step);
  writeChain = run.catch(() => {});
  return run;
}

/** Keeps a note (replacing one with the same key) and makes it its photo's latest. */
export async function putNote(note: StoredNote, file = NOTES_WORDS_PATH): Promise<void> {
  await update(file, (s) => {
    s.notes[note.key] = note;
    s.latest[note.id] = note.key;
    return true;
  });
}

/** Makes a kept note its photo's latest again, as when a cached note is shown. False when it isn't kept. */
export function setLatest(id: string, key: string, file = NOTES_WORDS_PATH): Promise<boolean> {
  let found = false;
  return update(file, (s) => {
    found = Object.hasOwn(s.notes, key);
    if (!found || s.latest[id] === key) return false;
    s.latest[id] = key;
    return true;
  }).then(() => found);
}

/** Marks a kept note for this photo. False when there's no such note for it. */
export function setMark(id: string, key: string, mark: Mark, file = NOTES_WORDS_PATH): Promise<boolean> {
  let found = false;
  return update(file, (s) => {
    const note = Object.hasOwn(s.notes, key) ? s.notes[key] : undefined;
    // Its own photo's note, or (the same frame filed twice) the one this photo shows.
    found = !!note && (note.id === id || s.latest[id] === key);
    if (!found || note!.mark === mark) return false;
    note!.mark = mark;
    return true;
  }).then(() => found);
}
