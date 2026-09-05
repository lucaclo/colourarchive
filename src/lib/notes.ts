/**
 * Per-photo notes — the archive's own notebook.
 *
 * A one-line-or-so record of why a photo matters, kept by id so it survives
 * a chapter move, a rename override, even a re-ingest under the same
 * content hash — everything else here is measured or auto-generated, and
 * this is the one place that is neither. Same "the machine can't see this,
 * so someone has to write it down" idea as Scout's own per-spot notebook.
 *
 * Deliberately its own file rather than folded into `Overrides` or the book
 * curation: a note never changes what a photo *is* or where it sits, so it
 * has no business living next to the data that does.
 */
import fs from 'node:fs/promises';
import { NOTES_PATH } from './paths';

export type Notes = Record<string, string>;

async function readJson(): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(NOTES_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/** Validated rather than trusted — user-editable JSON on disk, same posture
 *  book.ts and spots.ts already take with theirs. An empty or whitespace-only
 *  value is dropped rather than stored, so "wrote a note then deleted it"
 *  and "never wrote one" look identical on disk. */
function readNotesValue(value: unknown): Notes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const notes: Notes = {};
  for (const [id, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text === 'string' && text.trim()) notes[id] = text;
  }
  return notes;
}

export async function readNotes(): Promise<Notes> {
  return readNotesValue(await readJson());
}

async function write(notes: Notes): Promise<void> {
  const tmp = `${NOTES_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(notes, null, 2));
  await fs.rename(tmp, NOTES_PATH);
}

// Same read-modify-write hazard book.ts's own curation save carries — two
// saves in close succession must not let the second clobber the first.
let writeChain: Promise<unknown> = Promise.resolve();
function serialized(fn: () => Promise<void>): Promise<void> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

/** Set, or (with an empty/whitespace string) clear, one photo's note. */
export function setNote(id: string, text: string): Promise<void> {
  return serialized(async () => {
    const notes = await readNotes();
    const trimmed = text.trim();
    if (trimmed) notes[id] = trimmed;
    else delete notes[id];
    await write(notes);
  });
}
