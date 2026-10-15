import { LR_TABLE_FILES, parseTables, type LrTables } from './lr-model';

// The same measured tables as the server reads, fetched once per page.

let loaded: Promise<LrTables> | null = null;

export function lrTablesInBrowser(base = '/match-lr/'): Promise<LrTables> {
  loaded ??= Promise.all(
    LR_TABLE_FILES.map(async (f) => {
      const res = await fetch(base + f);
      if (!res.ok) throw new Error(`Couldn’t load ${f} (${res.status}).`);
      return res.arrayBuffer();
    }),
  )
    .then(([m, v, g]) => parseTables(m, v, g))
    .catch((err) => {
      loaded = null;
      throw err;
    });
  return loaded;
}
