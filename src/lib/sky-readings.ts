import fs from 'node:fs/promises';
import path from 'node:path';
import { SKY_READINGS_PATH } from './paths';
import { spotKey } from './scout/push-plan';
import type { StoredReading } from './scout/sky-check';

// Every sky reading Scout gave for a kept spot (issue #143), so it can be
// checked against the photos later. By spot, then by "date event". A reading
// is kept only if given before the sunrise or sunset it is about, and a later
// one replaces an earlier: the forecast nearest the evening is the one that
// counts. Private like the rest of the places files.
type Store = Record<string, Record<string, StoredReading>>;

async function read(): Promise<Store> {
  try { return JSON.parse(await fs.readFile(SKY_READINGS_PATH, 'utf8')) as Store; } catch { return {}; }
}

let chain: Promise<unknown> = Promise.resolve();

export function recordReadings(at: { lat: number; lon: number }, readings: StoredReading[], now = Date.now()): Promise<number> {
  const run = chain.then(async () => {
    const valid = readings.filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.iso) && (r.event === 'sunrise' || r.event === 'sunset')
      && ['lit', 'bare', 'blocked'].includes(r.verdict) && Number.isFinite(r.when) && r.when > now);
    if (!valid.length) return 0;
    const store = await read();
    const key = spotKey(at.lat, at.lon);
    const spot = (store[key] ??= {});
    for (const r of valid) spot[`${r.iso} ${r.event}`] = { iso: r.iso, event: r.event, when: r.when, verdict: r.verdict, note: String(r.note ?? '').slice(0, 400) };
    await fs.mkdir(path.dirname(SKY_READINGS_PATH), { recursive: true });
    const tmp = `${SKY_READINGS_PATH}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store, null, 2));
    await fs.rename(tmp, SKY_READINGS_PATH);
    return valid.length;
  });
  chain = run.catch(() => {});
  return run;
}

/** The readings for the spot at `at`, past ones only (the rest can't be checked yet). */
export async function readingsAt(at: { lat: number; lon: number }, now = Date.now()): Promise<StoredReading[]> {
  const spot = (await read())[spotKey(at.lat, at.lon)] ?? {};
  return Object.values(spot).filter((r) => r.when <= now);
}
