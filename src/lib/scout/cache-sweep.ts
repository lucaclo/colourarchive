import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Delete cache files whose `fetchedAt` is older than `maxAgeMs`, once per
 * process. The geocode/weather/air/seeing caches each check their own TTL on
 * read but never delete what falls outside it, so a spot never revisited
 * leaves its file behind forever — this is what reclaims that disk space.
 *
 * Best-effort throughout: a sweep that fails to run, or fails on one file,
 * just leaves that file for next time — the same outcome as not sweeping at
 * all, never a new failure mode.
 */
export async function sweepStaleCache(
  dir: string,
  maxAgeMs: number,
  eligible: (name: string) => boolean = () => true,
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  await Promise.all(
    entries
      .filter((name) => name.endsWith('.json') && eligible(name))
      .map(async (name) => {
        const file = path.join(dir, name);
        try {
          const raw = await fs.readFile(file, 'utf8');
          const parsed = JSON.parse(raw) as { fetchedAt?: unknown };
          const fetchedAtMs =
            typeof parsed.fetchedAt === 'number'
              ? parsed.fetchedAt
              : typeof parsed.fetchedAt === 'string'
                ? Date.parse(parsed.fetchedAt)
                : NaN;
          if (Number.isFinite(fetchedAtMs) && fetchedAtMs < cutoff) {
            await fs.unlink(file).catch(() => {});
          }
        } catch {
          // Corrupt or unreadable entry — not this sweep's job to fix.
        }
      }),
  );
}
