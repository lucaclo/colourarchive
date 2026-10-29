/**
 * Web push from this Mac (issue #142): a notification on the iPad's or
 * iPhone's home-screen app when a kept spot's sunset or sunrise reads lit.
 *
 * No third-party service: the VAPID keys are made here on first use and kept
 * with the archive's other private files, and the messages go straight to the
 * push service the device's browser named (Apple's, for an iPad). The device
 * sends its kept spots with its subscription, since they live in its own
 * storage, and again whenever they change.
 *
 * The loop (every ten minutes, while the archive is served) asks
 * push-plan.ts whether anything is due, reads that evening's horizon the
 * same way Scout's calendar does, and sends only on lit — at most one a day
 * per spot per device.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import webpush from 'web-push';
import { PUSH_PATH } from './paths';
import { fetchHorizonPair } from './scout/weather-client';
import { horizonReading, horizonSampleDistanceM, hourAt } from './scout/weather';
import { skyDays } from './scout/sky-week';
import { isoDateIn } from './scout/daylight';
import { pushMessage, pushPlans, type PushPlan, type PushSpot } from './scout/push-plan';

export interface PushSubscriptionJSON { endpoint: string; keys: { p256dh: string; auth: string } }
interface Device { subscription: PushSubscriptionJSON; spots: PushSpot[]; addedAt: string }
interface Store {
  vapid?: { publicKey: string; privateKey: string };
  devices: Device[];
  /** `${endpoint}|${spot key}` → the local date it was last told. */
  sent: Record<string, string>;
}

async function read(): Promise<Store> {
  try {
    const raw = JSON.parse(await fs.readFile(PUSH_PATH, 'utf8')) as Partial<Store>;
    return { vapid: raw.vapid, devices: raw.devices ?? [], sent: raw.sent ?? {} };
  } catch {
    return { devices: [], sent: {} };
  }
}

let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: (s: Store) => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const s = await read();
    const out = await fn(s);
    await fs.mkdir(path.dirname(PUSH_PATH), { recursive: true });
    const tmp = `${PUSH_PATH}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    await fs.rename(tmp, PUSH_PATH);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

/** The public half of this Mac's VAPID key, made the first time it's asked for. */
export function publicKey(): Promise<string> {
  return locked(async (s) => {
    const vapid = (s.vapid ??= webpush.generateVAPIDKeys());
    return vapid.publicKey;
  });
}

const isSub = (v: unknown): v is PushSubscriptionJSON => {
  const s = v as PushSubscriptionJSON;
  return Boolean(s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string');
};
const cleanSpots = (spots: unknown): PushSpot[] =>
  (Array.isArray(spots) ? spots : [])
    .filter((x) => x && typeof x.key === 'string' && Number.isFinite(x.lat) && Number.isFinite(x.lon))
    .slice(0, 50)
    .map((x) => ({ key: x.key, name: String(x.name ?? 'Kept spot').slice(0, 80), lat: x.lat, lon: x.lon, timeZone: typeof x.timeZone === 'string' ? x.timeZone : 'UTC', muted: Boolean(x.muted) }));

/** Add or refresh a device and the spots it keeps. */
export function subscribe(subscription: unknown, spots: unknown): Promise<void> {
  if (!isSub(subscription)) return Promise.reject(new Error('Not a push subscription.'));
  return locked(async (s) => {
    const rest = s.devices.filter((d) => d.subscription.endpoint !== subscription.endpoint);
    s.devices = [...rest, { subscription: { endpoint: subscription.endpoint, keys: subscription.keys }, spots: cleanSpots(spots), addedAt: new Date().toISOString() }];
  });
}

export function unsubscribe(endpoint: string): Promise<void> {
  return locked(async (s) => {
    s.devices = s.devices.filter((d) => d.subscription.endpoint !== endpoint);
  });
}

/** The horizon reading for one plan, as the calendar would give it. */
async function readingFor(spot: PushSpot, plan: PushPlan) {
  const [day] = skyDays(spot.lat, spot.lon, plan.iso, spot.timeZone, plan.event, 1);
  if (!day) return null;
  const distanceM = horizonSampleDistanceM();
  const pair = await fetchHorizonPair(spot.lat, spot.lon, day.bearing, distanceM);
  if (!pair.gate) return null;
  return horizonReading(hourAt(pair.gate, day.when), hourAt(pair.pin, day.when), day.bearing, distanceM);
}

async function send(s: Store, device: Device, payload: object): Promise<'sent' | 'gone'> {
  try {
    await webpush.sendNotification(device.subscription, JSON.stringify(payload), {
      vapidDetails: { subject: process.env.SITE_URL ?? 'https://colourarchive.netlify.app', publicKey: s.vapid!.publicKey, privateKey: s.vapid!.privateKey },
      TTL: 3 * 3600,
      urgency: 'normal',
    });
    return 'sent';
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) return 'gone'; // the device unsubscribed or was reset
    throw err;
  }
}

/** One pass: what's due, read, and sent. Never throws. */
export async function checkPush(now = new Date()): Promise<number> {
  let count = 0;
  try {
    await locked(async (s) => {
      if (!s.vapid || s.devices.length === 0) return;
      const readings = new Map<string, Awaited<ReturnType<typeof readingFor>>>();
      const gone = new Set<string>();
      for (const device of s.devices) {
        for (const spot of device.spots) {
          const sentKey = `${device.subscription.endpoint}|${spot.key}`;
          if (s.sent[sentKey] === isoDateIn(now, spot.timeZone)) continue;
          for (const plan of pushPlans(spot, now)) {
            const rk = `${spot.key}|${plan.event}|${plan.iso}`;
            if (!readings.has(rk)) readings.set(rk, await readingFor(spot, plan).catch(() => null));
            const reading = readings.get(rk);
            if (reading?.verdict !== 'lit' || reading.canvasCover == null) continue;
            const { title, body } = pushMessage(spot, plan, { canvasCover: reading.canvasCover, bearing: reading.bearing }, now);
            const url = `/scout?${new URLSearchParams({ at: `${spot.lat.toFixed(5)},${spot.lon.toFixed(5)}`, tz: spot.timeZone, n: spot.name, d: plan.iso })}`;
            const result = await send(s, device, { title, body, url, tag: `kept-${spot.key}` }).catch((err) => { console.warn('[push] send failed', err?.message ?? err); return null; });
            if (result === 'gone') gone.add(device.subscription.endpoint);
            if (result === 'sent') { s.sent[sentKey] = isoDateIn(now, spot.timeZone); count++; }
            break; // one a day per spot
          }
        }
      }
      if (gone.size) s.devices = s.devices.filter((d) => !gone.has(d.subscription.endpoint));
    });
  } catch (err) {
    console.warn('[push] check failed', err);
  }
  if (count) console.log(`[push] sent ${count}`);
  return count;
}

/** A test message to every device, for the Scout button that checks it works. */
export function sendTest(endpoint: string): Promise<boolean> {
  return locked(async (s) => {
    const device = s.devices.find((d) => d.subscription.endpoint === endpoint);
    if (!device || !s.vapid) return false;
    return (await send(s, device, { title: 'Colour Archive', body: 'Notifications work. You’ll hear when a kept spot reads lit.', url: '/scout', tag: 'test' })) === 'sent';
  });
}

const CHECK_MS = 10 * 60_000;
const g = globalThis as unknown as { __colourPush?: ReturnType<typeof setInterval> };
export function startPush(): void {
  if (g.__colourPush || process.env.PUBLIC_STATIC === 'true') return;
  g.__colourPush = setInterval(() => void checkPush(), CHECK_MS);
  g.__colourPush.unref?.();
  void checkPush();
}
