// The shapes the board's own script shares with the server: no Node imports
// here, so the browser bundle can use the labels without pulling in fetch
// and DNS code (sources.ts).

export type LinkKind =
  | 'bluesky' | 'mastodon' | 'arena-channel' | 'arena-user' | 'flickr' | 'feed' | 'page' | 'instagram';

export interface ProfileLink {
  kind: LinkKind;
  /** The page a person would open. */
  url: string;
  /** The platform's own id: a DID, a Mastodon account id, an Are.na slug, a Flickr NSID. */
  id?: string;
  /** Mastodon's instance, for API calls. */
  host?: string;
  /** For `feed`: the RSS/Atom address found on the page. */
  feed?: string;
}

export interface WorkItem {
  /** Stable across fetches: the post/block/entry plus the image's index in it. */
  key: string;
  thumb: string;
  full: string;
  /** Where it was posted, for the credit line. */
  url: string;
  title?: string;
  at?: string;
  w?: number;
  h?: number;
}

export interface Resolved { name: string; link: ProfileLink; }

export const KIND_LABEL: Record<LinkKind, string> = {
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  'arena-channel': 'Are.na',
  'arena-user': 'Are.na',
  flickr: 'Flickr',
  feed: 'Feed',
  page: 'Site',
  instagram: 'Instagram',
};

/** Whether new work can be fetched from this kind of link at all. */
export const canFetch = (kind: LinkKind): boolean => kind !== 'instagram';


/** Platforms that arrive as a plain feed or page, named by where they live. */
const HOST_LABEL: [RegExp, string][] = [
  [/(^|\.)glass\.photo$/, 'Glass'],
  [/(^|\.)pinterest\./, 'Pinterest'],
  [/(^|\.)tumblr\.com$/, 'Tumblr'],
  [/pixelfed/, 'Pixelfed'],
  [/(^|\.)substack\.com$/, 'Substack'],
  [/(^|\.)vero\.co$/, 'Vero'],
];

/** What a link is called on screen: the platform, or "Site" for someone's own. */
export function linkLabel(link: ProfileLink): string {
  if (link.kind !== 'feed' && link.kind !== 'page') return KIND_LABEL[link.kind];
  let host = '';
  try { host = new URL(link.feed ?? link.url).hostname; } catch { /* unnamed */ }
  return HOST_LABEL.find(([re]) => re.test(host))?.[1] ?? 'Site';
}

/**
 * A credit as it should be printed. A photographer known only by a handle —
 * `cineplex.jpg` on Instagram — read as a file name under a picture ("More by
 * cineplex.jpg"); with its @ it reads as a person. Names with a space, or
 * capitals, are names, and are left alone.
 */
export function creditLabel(name: string): string {
  const n = name.trim();
  if (n.startsWith('@') || !/^[a-z0-9._]{2,30}$/.test(n) || !/[._\d]/.test(n)) return n;
  return `@${n}`;
}
