/**
 * Kept-spot notifications, the page's half (issue #142). Turns them on from a
 * tap (iOS only asks for permission inside one), hands the Mac the device's
 * subscription with its kept spots, and keeps the Mac's copy of the spots in
 * step as they change. Per-spot mutes live here, beside the spots.
 *
 * Only offered where web push exists: a home-screen app on iPad and iPhone
 * (iPadOS 16.4+), or a desktop browser, served by the Mac — never the static
 * site, which has no server to send anything.
 */
import { spotKey, type PushSpot } from '../push-plan';

const MUTED_KEY = 'scout.push.muted';

export interface PushSpotInput { name: string; lat: number; lon: number; timeZone?: string }

export function pushSupported(isStatic: boolean): boolean {
  return !isStatic && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function readMuted(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(MUTED_KEY) || '[]')); } catch { return new Set(); }
}
function writeMuted(muted: Set<string>) {
  try { localStorage.setItem(MUTED_KEY, JSON.stringify([...muted])); } catch { /* private mode */ }
}

const toPushSpots = (spots: PushSpotInput[], muted: Set<string>): PushSpot[] =>
  spots.map((s) => {
    const key = spotKey(s.lat, s.lon);
    return { key, name: s.name, lat: s.lat, lon: s.lon, timeZone: s.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone, muted: muted.has(key) };
  });

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function subscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Whether this device is subscribed. A browser without a working push
 *  service can leave the question hanging, so after 3 s the answer is no. */
export async function pushOn(): Promise<boolean> {
  if (Notification.permission !== 'granted') return false;
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  return Boolean(await Promise.race([subscription().catch(() => null), late]));
}

async function post(body: object): Promise<{ ok: boolean; error?: string }> {
  return fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
}

/** Call from a tap. Resolves to a plain reason when it can't be turned on. */
export async function enablePush(spots: PushSpotInput[]): Promise<string | null> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'Notifications are turned off for this app in Settings.';
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await fetch('/api/push').then((r) => r.json());
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const res = await post({ action: 'subscribe', subscription: sub.toJSON(), spots: toPushSpots(spots, readMuted()) });
  return res.ok ? null : res.error ?? 'The Mac didn’t take it.';
}

export async function disablePush(): Promise<void> {
  const sub = await subscription();
  if (!sub) return;
  await post({ action: 'unsubscribe', endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

export async function testPush(): Promise<boolean> {
  const sub = await subscription();
  return sub ? (await post({ action: 'test', endpoint: sub.endpoint }).catch(() => ({ ok: false }))).ok : false;
}

let syncTimer = 0;
/** Tell the Mac the kept spots changed (debounced; quiet when push is off). */
export function syncPush(spots: PushSpotInput[]): void {
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(async () => {
    const sub = await subscription().catch(() => null);
    if (sub) await post({ action: 'subscribe', subscription: sub.toJSON(), spots: toPushSpots(spots, readMuted()) }).catch(() => {});
  }, 800);
}

export function toggleMuted(spot: PushSpotInput, spots: PushSpotInput[]): boolean {
  const muted = readMuted();
  const key = spotKey(spot.lat, spot.lon);
  const nowMuted = !muted.has(key);
  if (nowMuted) muted.add(key); else muted.delete(key);
  writeMuted(muted);
  syncPush(spots);
  return nowMuted;
}

export const isMuted = (spot: PushSpotInput): boolean => readMuted().has(spotKey(spot.lat, spot.lon));
