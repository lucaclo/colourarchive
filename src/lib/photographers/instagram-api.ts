import fs from 'node:fs/promises';
import path from 'node:path';
import { INSTAGRAM_PATH } from '../paths';
import type { WorkItem } from './kinds';

/**
 * Instagram, the only way Instagram allows: the Graph API's Business
 * Discovery, through your own professional account.
 *
 * It reads the public posts of other *professional* accounts (Business or
 * Creator; most working photographers are one). Personal accounts can't be
 * read by anyone, and nothing here tries. You connect once with a Meta app of
 * your own in development mode — no app review, since the only account using
 * it is yours — and the token is renewed before its 60 days run out.
 *
 * Nothing leaves the Mac except the requests to graph.facebook.com; the token
 * and app secret live in a gitignored file.
 */

const GRAPH = 'https://graph.facebook.com/v23.0';
const RENEW_WITHIN = 10 * 24 * 3_600_000;

export interface InstagramConfig {
  appId: string;
  appSecret: string;
  token: string;
  /** ms since epoch; long-lived user tokens last about 60 days. */
  expiresAt: number;
  igUserId: string;
  username: string;
}

let memory: InstagramConfig | null | undefined;

export async function readInstagram(): Promise<InstagramConfig | null> {
  if (memory !== undefined) return memory;
  try { memory = JSON.parse(await fs.readFile(INSTAGRAM_PATH, 'utf8')) as InstagramConfig; } catch { memory = null; }
  return memory;
}
async function write(c: InstagramConfig | null): Promise<void> {
  memory = c;
  if (!c) { await fs.rm(INSTAGRAM_PATH, { force: true }); return; }
  await fs.mkdir(path.dirname(INSTAGRAM_PATH), { recursive: true });
  await fs.writeFile(INSTAGRAM_PATH, JSON.stringify(c, null, 2), { mode: 0o600 });
}

export const instagramConnected = async (): Promise<boolean> => Boolean(await readInstagram());

interface GraphError { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } }

async function graph<T>(pathAndQuery: string): Promise<T> {
  let res: Response;
  try { res = await fetch(`${GRAPH}${pathAndQuery}`, { signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error('Could not reach Instagram.'); }
  const body = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok || body.error) throw new GraphFailure(body.error?.error_user_msg || body.error?.message || `Instagram answered ${res.status}.`, body.error?.code, body.error?.error_subcode);
  return body;
}

export class GraphFailure extends Error {
  constructor(message: string, readonly code?: number, readonly subcode?: number) { super(message); }
}

async function longLived(appId: string, appSecret: string, token: string): Promise<{ token: string; expiresAt: number }> {
  const q = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: token });
  const r = await graph<{ access_token: string; expires_in?: number }>(`/oauth/access_token?${q}`);
  return { token: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 60 * 24 * 3600) * 1000 };
}

/**
 * Connect with an app id, its secret and a token from the Graph API
 * Explorer: swap the token for a long-lived one, then find the Instagram
 * professional account on your Pages.
 */
export async function connectInstagram(appId: string, appSecret: string, token: string): Promise<InstagramConfig> {
  const long = await longLived(appId.trim(), appSecret.trim(), token.trim());
  const pages = await graph<{ data: { name: string; instagram_business_account?: { id: string; username?: string } }[] }>(
    `/me/accounts?fields=name,instagram_business_account{id,username}&access_token=${encodeURIComponent(long.token)}`,
  );
  const ig = pages.data.find((p) => p.instagram_business_account)?.instagram_business_account;
  if (!ig) throw new Error('No Instagram professional account is linked to your Facebook Pages. Link it in Instagram, Edit profile, Page.');
  const config: InstagramConfig = { appId: appId.trim(), appSecret: appSecret.trim(), token: long.token, expiresAt: long.expiresAt, igUserId: ig.id, username: ig.username ?? '' };
  await write(config);
  return config;
}

export const disconnectInstagram = (): Promise<void> => write(null);

/** The token, renewed when it's within ten days of running out. */
async function freshConfig(): Promise<InstagramConfig> {
  const c = await readInstagram();
  if (!c) throw new Error('Instagram is not connected.');
  if (c.expiresAt - Date.now() < RENEW_WITHIN) {
    if (c.expiresAt < Date.now()) throw new Error('The Instagram connection ran out. Connect again.');
    const next = await longLived(c.appId, c.appSecret, c.token);
    await write({ ...c, ...next });
    return { ...c, ...next };
  }
  return c;
}

interface IgMedia {
  id: string; caption?: string; media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'; media_url?: string;
  permalink?: string; timestamp?: string; children?: { data: { id: string; media_type: string; media_url?: string }[] };
}

/** Business Discovery's answer as work items: photographs only, every image of a carousel. */
export function instagramWork(media: IgMedia[]): WorkItem[] {
  const items: WorkItem[] = [];
  for (const m of media) {
    const images = m.media_type === 'CAROUSEL_ALBUM'
      ? (m.children?.data ?? []).filter((c) => c.media_type === 'IMAGE' && c.media_url).map((c) => c.media_url!)
      : m.media_type === 'IMAGE' && m.media_url ? [m.media_url] : [];
    images.forEach((src, i) => items.push({
      key: `ig:${m.id}#${i}`, thumb: src, full: src, url: m.permalink ?? '',
      title: m.caption?.slice(0, 140) || undefined, at: m.timestamp,
    }));
  }
  return items;
}

/** A professional account's recent posts. */
export async function instagramDiscover(username: string): Promise<{ name?: string; items: WorkItem[] }> {
  const c = await freshConfig();
  const u = username.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(u)) throw new Error('That is not an Instagram username.');
  const fields = `business_discovery.username(${u}){username,name,media.limit(40){id,caption,media_type,media_url,permalink,timestamp,children{id,media_type,media_url}}}`;
  try {
    const r = await graph<{ business_discovery: { name?: string; media?: { data: IgMedia[] } } }>(
      `/${c.igUserId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(c.token)}`,
    );
    return { name: r.business_discovery.name, items: instagramWork(r.business_discovery.media?.data ?? []) };
  } catch (err) {
    // Business Discovery answers a personal or missing account with code 110.
    if (err instanceof GraphFailure && (err.code === 110 || /cannot be found|invalid user/i.test(err.message))) {
      throw new Error(`@${u} is a personal account, or not there. Instagram only shares professional accounts' posts.`, { cause: err });
    }
    throw err;
  }
}
