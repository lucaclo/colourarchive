/**
 * The server's side of the Updates panel (/api/updates): the Mac app's
 * updater as desktop/server.mjs relays it, what the published site says about
 * itself, and who may ask for what.
 */
import { parseStamp, SITE_URL, STAMP_FILE, type PublishStamp } from './publish';

/** The updater's status, as desktop/updater.cjs keeps it. */
export interface AppStatus {
  state: 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error' | 'cannot-install' | 'source';
  current: string;
  latest: string | null;
  error: string | null;
  installedIn: string | null;
  updatedAt: string | null;
  pending: boolean;
}

export type AppAction = 'check' | 'install' | 'reveal';

/**
 * Set on globalThis by desktop/server.mjs, in this same process, and kept up
 * to date by main.cjs (like ./busy.ts's counter). Absent outside the Mac app.
 */
interface MacAppBridge {
  status: AppStatus | null;
  act(action: AppAction, page: string | null, loopback: boolean): void;
}
const KEY = Symbol.for('colour-archive.app');

export function macApp(): MacAppBridge | null {
  const bridge = (globalThis as Record<symbol, unknown>)[KEY] as MacAppBridge | undefined;
  return bridge && typeof bridge.act === 'function' ? bridge : null;
}

/** The updater's status in the panel's shape, or null outside the Mac app. */
export function appStatus(): AppStatus | null {
  const s = macApp()?.status;
  if (!s || typeof s !== 'object') return null;
  return {
    state: s.state,
    current: s.current,
    latest: s.latest ?? null,
    error: s.error ?? null,
    installedIn: s.installedIn ?? null,
    updatedAt: s.updatedAt ?? null,
    pending: Boolean(s.pending),
  };
}

const hasControl = (s: string): boolean => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** A POST to /api/updates: what to do, and the page to come back to. */
export function parseAsk(value: unknown): { do: AppAction; page: string | null } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.do !== 'check' && v.do !== 'install' && v.do !== 'reveal') return null;
  // A path on this site, nothing else; no control characters (it ends up in update.log).
  const page = typeof v.page === 'string' && v.page.startsWith('/') && v.page.length <= 512 && !hasControl(v.page)
    ? v.page
    : null;
  return { do: v.do, page };
}

/**
 * Asked from this Mac itself: the app's window or a browser on it. The remote
 * gate also listens on 127.0.0.1 but names the phone in X-Forwarded-For (which
 * Astro's clientAddress then reports), so any request carrying that header,
 * forged or not, is from elsewhere.
 */
export function isLoopback(clientAddress: string | null | undefined, headers: Headers): boolean {
  if (headers.has('x-forwarded-for')) return false;
  return clientAddress === '127.0.0.1' || clientAddress === '::1' || clientAddress === '::ffff:127.0.0.1';
}

// --- The published site ------------------------------------------------------

export const PUBLISHED_TIMEOUT_MS = 3000;
export const PUBLISHED_TTL_MS = 10 * 60_000;
export const PUBLISHED_FAIL_TTL_MS = 60_000;

type Fetch = (url: string, init: { signal: AbortSignal; cache: RequestCache }) => Promise<Response>;

let cached: { at: number; ttl: number; stamp: Promise<PublishStamp | null> } | null = null;

/**
 * The published site's `/publish.json`, or null when it can't be read. Asked
 * at most every 10 minutes, or every minute while it fails.
 */
export function publishedStamp({ now = Date.now(), fetcher = fetch as Fetch } = {}): Promise<PublishStamp | null> {
  if (cached && now - cached.at < cached.ttl) return cached.stamp;
  const entry = {
    at: now,
    ttl: PUBLISHED_TTL_MS,
    stamp: fetcher(`${SITE_URL}/${STAMP_FILE}`, { signal: AbortSignal.timeout(PUBLISHED_TIMEOUT_MS), cache: 'no-store' })
      .then(async (res) => (res.ok ? parseStamp(await res.json()) : null))
      .catch(() => null),
  };
  entry.stamp.then((stamp) => {
    if (!stamp) entry.ttl = PUBLISHED_FAIL_TTL_MS;
  });
  cached = entry;
  return entry.stamp;
}

/** For tests: forget the published stamp. */
export function forgetPublished(): void {
  cached = null;
}
