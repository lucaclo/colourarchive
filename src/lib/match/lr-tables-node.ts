import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../paths';
import { LR_TABLE_FILES, parseTables, type LrTables } from './lr-model';

// The measured Lightroom tables, read once on the server. They live under
// public/ so the browser preview fetches the same bytes (see lr-tables-browser).

let loaded: Promise<LrTables> | null = null;

export const LR_TABLE_DIR = path.join(ROOT, 'public', 'match-lr');

export function lrTables(dir = LR_TABLE_DIR): Promise<LrTables> {
  if (dir !== LR_TABLE_DIR) return read(dir);
  loaded ??= read(dir).catch((err) => {
    loaded = null;
    throw err;
  });
  return loaded;
}

async function read(dir: string): Promise<LrTables> {
  const bufs = await Promise.all(LR_TABLE_FILES.map((f) => fs.readFile(path.join(dir, f))));
  const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  return parseTables(ab(bufs[0]), ab(bufs[1]), ab(bufs[2]));
}
