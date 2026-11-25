/**
 * The phones, iPads and browsers that opened pages from this Mac, and which
 * build each last had, for the Updates panel's "Phones and iPads".
 *
 * Each page served by the Mac says once per load what it is (POST
 * /api/devices): a random id it keeps in its own storage, a kind of device,
 * whether it runs as a home-screen app, and the build it was served. That and
 * when it said so is all that is kept: never the user agent, never an address.
 * At most 12, and any not seen for 90 days are dropped. The Mac app's own
 * window isn't a device here.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEVICES_PATH } from './paths';

export const DEVICE_NAMES = ['iPhone', 'iPad', 'Mac', 'Android', 'Windows', 'Linux', 'Browser'] as const;
export type DeviceName = (typeof DEVICE_NAMES)[number];

/** What a page says about itself. */
export interface DeviceReport {
  id: string;
  name: DeviceName;
  standalone: boolean;
  builtAt: string;
}

export interface Device extends DeviceReport {
  seenAt: string;
}

export const MAX_DEVICES = 12;
export const KEEP_MS = 90 * 86_400_000;

const ID = /^[A-Za-z0-9-]{8,64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** A page's report, or null when any field isn't what one sends. */
export function parseReport(value: unknown): DeviceReport | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !ID.test(v.id)) return null;
  if (typeof v.name !== 'string' || !(DEVICE_NAMES as readonly string[]).includes(v.name)) return null;
  if (typeof v.standalone !== 'boolean') return null;
  if (typeof v.builtAt !== 'string' || !ISO.test(v.builtAt) || !Number.isFinite(Date.parse(v.builtAt))) return null;
  return { id: v.id, name: v.name as DeviceName, standalone: v.standalone, builtAt: v.builtAt };
}

/** The Mac app's own window (desktop/main.cjs adds this to its user agent). */
export const isMacApp = (userAgent: string | null | undefined): boolean => (userAgent ?? '').includes('ColourArchiveMac/');

/** Newest first, none older than 90 days, at most 12. */
export function tidyDevices(list: Device[], now: Date): Device[] {
  const since = now.getTime() - KEEP_MS;
  return list
    .filter((d) => Date.parse(d.seenAt) >= since)
    .sort((a, b) => Date.parse(b.seenAt) - Date.parse(a.seenAt))
    .slice(0, MAX_DEVICES);
}

/** `list` with `report` seen at `now`: the same device updated in place, or added. */
export function recordDevice(list: Device[], report: DeviceReport, now: Date): Device[] {
  const seen: Device = { id: report.id, name: report.name, standalone: report.standalone, builtAt: report.builtAt, seenAt: now.toISOString() };
  const i = list.findIndex((d) => d.id === report.id);
  const next = i === -1 ? [...list, seen] : list.map((d, j) => (j === i ? seen : d));
  return tidyDevices(next, now);
}

const isDevice = (d: unknown): d is Device =>
  parseReport(d) !== null && typeof (d as Device).seenAt === 'string' && Number.isFinite(Date.parse((d as Device).seenAt));

export async function readDevices(file = DEVICES_PATH): Promise<Device[]> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(raw) ? raw.filter(isDevice).map(({ id, name, standalone, builtAt, seenAt }) => ({ id, name, standalone, builtAt, seenAt })) : [];
  } catch {
    return [];
  }
}

let chain: Promise<unknown> = Promise.resolve();

/** Keep `report`, seen now. Serialised, written atomically. */
export function rememberDevice(report: DeviceReport, now = new Date(), file = DEVICES_PATH): Promise<void> {
  const run = chain.then(async () => {
    const next = recordDevice(await readDevices(file), report, now);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
    await fs.rename(tmp, file);
  });
  chain = run.catch(() => {});
  return run;
}
