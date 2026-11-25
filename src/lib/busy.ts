/**
 * Background work the Mac app must not swap itself in the middle of (#168):
 * the inbox scan, which runs on a timer with no request in flight. A counter
 * on globalThis, so desktop/server.mjs, in the same process, reads it without
 * importing the built site.
 */
const KEY = Symbol.for('colour-archive.busy');
type Busy = { n: number };
const state = (): Busy => ((globalThis as Record<symbol, unknown>)[KEY] ??= { n: 0 }) as Busy;

/** Run `job` counted as busy. */
export async function whileBusy<T>(job: () => Promise<T>): Promise<T> {
  const s = state();
  s.n++;
  try {
    return await job();
  } finally {
    s.n--;
  }
}

/** Jobs running now. */
export const busyCount = (): number => state().n;
