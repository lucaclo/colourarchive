import { assertPublicHttpUrl } from '../inspiration';

/**
 * Where a photographer's public work can be read from — without an API key.
 *
 * Flickr's API is paid, Instagram's is closed to personal accounts, so this
 * leans on what the open web already publishes for anyone:
 *
 * - **Bluesky** — the AppView's public XRPC host answers profile, feed and
 *   follows reads with no login (`public.api.bsky.app`).
 * - **Mastodon** — the REST API's account lookup, statuses and following are
 *   public on Mastodon itself. Pixelfed keeps them behind a login, but
 *   publishes an Atom feed, which the generic path picks up.
 * - **Are.na** — channel contents and a user's contents are public reads
 *   (v2 for channels and search, v3 for a user's contents).
 * - **Flickr** — every profile page advertises its public photostream feed
 *   (`photos_public.gne?id=<nsid>`), the one Flickr feed that needs no key.
 *   Reading the NSID out of that `<link rel="alternate">` is RSS
 *   autodiscovery, not scraping, and means the id is the one Flickr gave,
 *   never a guess (the `notable.ts` provenance rule).
 * - **Anything with a feed** — personal sites, Tumblr, WordPress, Squarespace
 *   blogs, Substack, Pixelfed: RSS/Atom autodiscovery, then the images in
 *   each entry.
 * - **A portfolio page with no feed** — the large images on that one page.
 * - **Instagram** — nothing can be read; the link is kept to open it, and the
 *   share sheet stays the way in.
 *
 * Everything that parses is pure and exported for the tests; the network
 * calls are thin wrappers around it.
 */

export { KIND_LABEL, canFetch } from './kinds';
export type { LinkKind, ProfileLink, WorkItem, Resolved } from './kinds';
import type { ProfileLink, WorkItem, Resolved } from './kinds';

const BSKY = 'https://public.api.bsky.app/xrpc';
const ARENA2 = 'https://api.are.na/v2';
const ARENA3 = 'https://api.are.na/v3';
// Honest about what's asking. Are.na's API turns away a browser's user agent
// that doesn't behave like a browser, so this doesn't pretend to be one.
const UA = 'ColourArchive/1.0 (personal reference board)';
const MAX_TEXT = 3_000_000;

/* ── Identifying a link (pure) ─────────────────────────────────────────── */

export type Identified =
  | { kind: 'bluesky'; actor: string; post?: string }
  | { kind: 'mastodon'; host: string; acct: string; post?: string }
  | { kind: 'arena-channel'; slug: string }
  | { kind: 'arena-user'; slug: string }
  | { kind: 'arena-block'; id: string }
  | { kind: 'flickr'; user: string; photo?: string }
  | { kind: 'instagram'; user?: string }
  | { kind: 'web'; url: string };

const NOT_FEDI = /(^|\.)(youtube\.com|tiktok\.com|medium\.com|threads\.net|threads\.com|vimeo\.com|substack\.com)$/;

/** What a pasted link points at, from its shape alone. */
export function identify(raw: string): Identified | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));

  if (host === 'bsky.app' && parts[0] === 'profile' && parts[1]) {
    return { kind: 'bluesky', actor: parts[1], post: parts[2] === 'post' ? parts[3] : undefined };
  }
  if (host === 'are.na') {
    if (parts[0] === 'block' && parts[1]) return { kind: 'arena-block', id: parts[1] };
    if (parts.length >= 2 && parts[1] !== 'channels' && parts[1] !== 'index') return { kind: 'arena-channel', slug: parts[1] };
    if (parts[0]) return { kind: 'arena-user', slug: parts[0] };
    return null;
  }
  if (host === 'flickr.com' && (parts[0] === 'photos' || parts[0] === 'people') && parts[1] && parts[1] !== 'tags') {
    return { kind: 'flickr', user: parts[1], photo: parts[0] === 'photos' && /^\d+$/.test(parts[2] ?? '') ? parts[2] : undefined };
  }
  if (/(^|\.)pinterest\.[a-z.]+$/.test(host) && parts[0] && !['pin', 'search', 'ideas', 'today'].includes(parts[0])) {
    // Every Pinterest profile and board publishes RSS; the pages themselves are script.
    const feed = parts[1] ? `https://www.pinterest.com/${parts[0]}/${parts[1]}.rss` : `https://www.pinterest.com/${parts[0]}/feed.rss`;
    return { kind: 'web', url: feed };
  }
  if (host === 'instagram.com') {
    const reserved = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts']);
    return { kind: 'instagram', user: parts[0] && !reserved.has(parts[0]) ? parts[0] : undefined };
  }
  // Mastodon's profile shape, on any instance: /@name or /@name/123. Big
  // sites that borrowed the shape aren't the fediverse.
  if (NOT_FEDI.test(host)) return { kind: 'web', url: u.href };
  if (parts[0]?.startsWith('@') && parts[0].length > 1 && !parts[0].slice(1).includes('@')) {
    return { kind: 'mastodon', host, acct: parts[0].slice(1), post: /^\d+$/.test(parts[1] ?? '') ? parts[1] : undefined };
  }
  return { kind: 'web', url: u.href };
}

/* ── Reading HTML and feeds (pure) ─────────────────────────────────────── */

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** An attribute's value from one tag's source, entity-decoded. */
export function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const v = m ? (m[1] ?? m[2] ?? m[3]) : undefined;
  return v == null ? undefined : decodeEntities(v);
}

/** `<meta property|name="…" content="…">`, first match. */
export function metaContent(html: string, ...names: string[]): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
    if (names.includes(key)) {
      const c = attr(tag, 'content')?.trim();
      if (c) return c;
    }
  }
  return undefined;
}

/** The RSS/Atom feed a page advertises, absolute. */
export function discoverFeed(html: string, base: string): { href: string; title?: string } | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    const type = (attr(tag, 'type') ?? '').toLowerCase();
    const href = attr(tag, 'href');
    if (!href || !rel.split(/\s+/).includes('alternate')) continue;
    if (!/(rss|atom)\+xml|application\/feed\+json/.test(type)) continue;
    try { return { href: new URL(href, base).href, title: attr(tag, 'title') }; } catch { /* next */ }
  }
  return null;
}

/** Flickr's Atom link title is "Flickr: NAME’s Photostream Atom feed". */
export function flickrNameFromFeedTitle(title: string | undefined): string | undefined {
  const m = title?.match(/^Flickr:\s*(.+?)[’']s Photostream/i);
  return m?.[1]?.trim() || undefined;
}

/** The NSID inside a `photos_public.gne?id=…` feed address. */
export function flickrNsidFromFeed(href: string): string | undefined {
  try {
    const id = new URL(href).searchParams.get('id');
    return id && /^\d+@N\d+$/.test(id) ? id : undefined;
  } catch { return undefined; }
}

/** A person's name as a page states it, best evidence first. */
export function pageName(html: string): string | undefined {
  const named = metaContent(html, 'author', 'article:author', 'og:site_name', 'twitter:creator', 'application-name');
  if (named && !/^https?:/i.test(named)) return named.replace(/^@/, '');
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  return title ? decodeEntities(title).split(/\s[|–—-]\s/)[0].trim() || undefined : undefined;
}

/**
 * Who made the picture a page is about — only from fields that name a
 * person, never the site's own name. Used to credit a shared link; a site
 * like Pinterest or Cosmos names itself, which is not a credit.
 */
export function pageAuthor(html: string): string | undefined {
  const v = metaContent(html, 'author', 'article:author', 'twitter:creator', 'dc.creator', 'parsely-author');
  if (!v || /^https?:/i.test(v)) return undefined;
  return v.replace(/^@/, '').trim() || undefined;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif)(\?|#|$)/i;
const NOT_A_PHOTO = /(logo|icon|avatar|sprite|favicon|badge|emoji|spinner|placeholder|blank|pixel)/i;

/** Every image in an HTML fragment, largest srcset candidate preferred. */
export function imagesInHtml(html: string, base: string): string[] {
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw || raw.startsWith('data:')) return;
    try {
      const abs = new URL(raw.trim(), base).href;
      if (!out.includes(abs)) out.push(abs);
    } catch { /* skip */ }
  };
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const srcset = attr(tag, 'srcset') ?? attr(tag, 'data-srcset');
    if (srcset) {
      const best = srcset.split(',')
        .map((c) => c.trim().split(/\s+/))
        .map(([u, d]) => ({ u, n: parseFloat(d ?? '1') || 1 }))
        .sort((a, b) => b.n - a.n)[0];
      if (best?.u) { push(best.u); continue; }
    }
    // Squarespace keeps the real address in data-src / data-image.
    push(attr(tag, 'data-src') ?? attr(tag, 'data-image') ?? attr(tag, 'src'));
  }
  return out;
}

/** One RSS `<item>` or Atom `<entry>` turned into its images. */
function entryImages(entry: string, base: string): string[] {
  const out: string[] = [];
  const add = (u: string | undefined) => { if (u) { try { const a = new URL(u, base).href; if (!out.includes(a)) out.push(a); } catch { /* skip */ } } };
  for (const tag of entry.match(/<media:content\b[^>]*>/gi) ?? []) {
    const medium = attr(tag, 'medium'), type = attr(tag, 'type') ?? '';
    if (medium === 'image' || type.startsWith('image/') || IMAGE_EXT.test(attr(tag, 'url') ?? '')) add(attr(tag, 'url'));
  }
  for (const tag of entry.match(/<enclosure\b[^>]*>/gi) ?? []) {
    if ((attr(tag, 'type') ?? '').startsWith('image/')) add(attr(tag, 'url'));
  }
  for (const tag of entry.match(/<link\b[^>]*>/gi) ?? []) {
    if (attr(tag, 'rel') === 'enclosure' && (attr(tag, 'type') ?? '').startsWith('image/')) add(attr(tag, 'href'));
  }
  // The body, escaped (RSS description) or in CDATA (content:encoded).
  const bodies = entry.match(/<(description|content:encoded|content|summary)\b[^>]*>([\s\S]*?)<\/\1>/gi) ?? [];
  for (const b of bodies) {
    let inner = b.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, '');
    inner = inner.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
    if (!/<img/i.test(inner)) inner = decodeEntities(inner);
    for (const u of imagesInHtml(inner, base)) add(u);
  }
  if (!out.length) {
    for (const tag of entry.match(/<media:thumbnail\b[^>]*>/gi) ?? []) add(attr(tag, 'url'));
  }
  return out.filter((u) => !NOT_A_PHOTO.test(u));
}

function tagText(entry: string, name: string): string | undefined {
  const m = entry.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return undefined;
  return decodeEntities(m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '')).trim() || undefined;
}

/** Parse an RSS 2.0 or Atom document into work items. */
export function parseFeed(xml: string, base: string, perEntry = 4): { title?: string; items: WorkItem[] } {
  const channelTitle = tagText(xml.split(/<(item|entry)\b/i)[0] ?? '', 'title');
  const entries = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const items: WorkItem[] = [];
  for (const entry of entries) {
    const link = (() => {
      const atom = (entry.match(/<link\b[^>]*>/gi) ?? []).find((t) => !attr(t, 'rel') || attr(t, 'rel') === 'alternate');
      return (atom && attr(atom, 'href')) || tagText(entry, 'link') || tagText(entry, 'guid') || base;
    })();
    const at = tagText(entry, 'pubDate') ?? tagText(entry, 'published') ?? tagText(entry, 'updated') ?? tagText(entry, 'dc:date');
    const title = tagText(entry, 'title');
    const imgs = entryImages(entry, base).slice(0, perEntry);
    imgs.forEach((src, i) => {
      items.push({
        key: `${link}#${i}`, ...sized(src), url: link,
        title: title?.replace(/<[^>]+>/g, '').slice(0, 140),
        at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : undefined,
      });
    });
  }
  return { title: channelTitle, items };
}

/**
 * A grid-sized and a full-sized address for one picture, where the host
 * serves sizes: a portfolio page's own <img> is often the multi-megabyte
 * original, far too heavy for a grid of forty.
 */
export function sized(src: string): { thumb: string; full: string } {
  try {
    const u = new URL(src);
    if (/(^|\.)squarespace-cdn\.com$/.test(u.hostname)) {
      const at = (w: string) => { const v = new URL(u.href); v.searchParams.set('format', w); return v.href; };
      return { thumb: at('500w'), full: at('2500w') };
    }
    // Pinterest's feed hands out 236px; the same path serves 736px.
    if (/(^|\.)pinimg\.com$/.test(u.hostname) && /\/236x\//.test(u.pathname)) {
      return { thumb: src.replace('/236x/', '/474x/'), full: src.replace('/236x/', '/736x/') };
    }
    // Signed addresses that only come full size: the Mac makes the grid copy.
    if (HEAVY_HOSTS.test(u.hostname)) return { thumb: `/api/photographers/thumb?u=${encodeURIComponent(src)}`, full: src };
  } catch { /* as it is */ }
  return { thumb: src, full: src };
}

const HEAVY_HOSTS = /(^|\.)cdn\.glass\.photo$/;

/** The photographs on one portfolio page, when it has no feed. */
export function pageWork(html: string, pageUrl: string, limit = 40): WorkItem[] {
  const og = metaContent(html, 'og:image', 'og:image:secure_url');
  const all = [...(og ? [new URL(og, pageUrl).href] : []), ...imagesInHtml(html, pageUrl)];
  const seen = new Set<string>();
  const out: WorkItem[] = [];
  for (const src of all) {
    if (NOT_A_PHOTO.test(src) || /\.svg(\?|$)/i.test(src)) continue;
    // Same picture at another size (Squarespace ?format=, WordPress -300x200).
    const norm = src.replace(/\?.*$/, '').replace(/-\d+x\d+(\.\w+)$/, '$1');
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({ key: norm, ...sized(src), url: pageUrl });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * A person's name as a profile decorates it, undecorated:
 * "Donna F. Photographer 🇨🇦" → "Donna F.", "Evelyn | Wildlife Photographer"
 * → "Evelyn", "Photographer: Daido Moriyama" → "Daido Moriyama". A studio
 * name ("Fit Light Photography") is a name and stays.
 */
export function tidyName(raw: string): string {
  let s = raw.replace(/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D}/gu, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(photographer|photography|photos?|pictures|work)\s*(by|of)?\s*[:\-–—]?\s+/i, '');
  const parts = s.split(/\s+[|•·—–]\s+|\s+-\s+/);
  if (parts.length > 1 && parts.slice(1).some((p) => /photo|film|camera|visual|artist|portfolio/i.test(p))) s = parts[0];
  s = s.replace(/[\s,]+(photographer|fotografo|fotógrafa|fotograf)\s*$/i, '').trim();
  return s || raw.trim();
}

/** Whether a title reads like somebody's name rather than a mood or a topic. */
export function looksLikeName(s: string): boolean {
  return /^[\p{Lu}][\p{L}'’.-]*(\s+(?:(?:van|von|de|da|di|del|der|den|du|dos|le|la|y)\s+)*[\p{Lu}][\p{L}'’.-]*){1,3}$/u.test(s.trim());
}

/* ── A photographer's own site (pure) ──────────────────────────────── */

const fold = (s: string): string =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Whether `text` names this person: every part of the name appears, so
 * "Adrien Franque" is not "Adrien Sanguinetti". Spaces are ignored too, so a
 * handle like "adriensanguinetti" counts.
 */
export function namesMatch(text: string, name: string): boolean {
  const parts = fold(name).split(' ').filter((t) => t.length >= 2);
  if (!parts.length) return false;
  const hay = `${fold(text)} ${fold(text).replace(/ /g, '')}`;
  return parts.every((t) => hay.includes(t));
}

/**
 * Where a photographer's own site usually is: their name as a domain, with
 * the endings photographers pick. Only guesses — `findSite` keeps one only
 * when the page itself carries the name.
 */
export function siteGuesses(name: string): string[] {
  const parts = fold(name).split(' ').filter(Boolean);
  if (parts.length < 2) return [];
  const joined = parts.join(''), dashed = parts.join('-');
  const out: string[] = [];
  for (const base of [joined, dashed, `${joined}photography`, `${joined}photo`]) {
    for (const tld of ['com', 'photo', 'photography', 'net', 'co.uk', 'fr', 'de', 'it', 'jp', 'me']) {
      if (base !== joined && !['com', 'photo', 'photography'].includes(tld)) continue;
      out.push(`https://www.${base}.${tld}/`);
    }
  }
  return out;
}

const NOT_WORK = /blog|store|shop|cart|course|workshop|preset|newsletter|contact|about|login|account|privacy|terms/i;
const WORK = /portfolio|work|gallery|galleries|photograph|projects|series|images/i;

/** The site's domain is the name itself (adriensanguinetti.com, jo-smith.photo). */
export function domainIsName(url: string, name: string): boolean {
  try {
    const label = new URL(url).hostname.replace(/^www\./, '').split('.')[0].replace(/-/g, '');
    return label === fold(name).replace(/ /g, '') || label === `${fold(name).replace(/ /g, '')}photography`;
  } catch { return false; }
}

/** The page on a site that holds the photographs: "Portfolio", "Work"… */
export function workPageUrl(html: string, base: string): string | null {
  const origin = new URL(base).origin;
  for (const a of html.match(/<a\b[^>]*href=[^>]*>[\s\S]{0,200}?<\/a>/gi) ?? []) {
    const href = attr(a, 'href');
    if (!href) continue;
    let u: URL;
    try { u = new URL(href, base); } catch { continue; }
    if (u.origin !== origin || u.pathname === '/' || u.pathname === new URL(base).pathname) continue;
    const text = a.replace(/<[^>]+>/g, ' ');
    if (NOT_WORK.test(u.pathname)) continue;
    if (WORK.test(u.pathname) || WORK.test(text)) return u.origin + u.pathname;
  }
  return null;
}

/** The profiles a site links to that this app can read or open. */
export function profileLinksIn(html: string, base: string): string[] {
  const own = new URL(base).hostname.replace(/^www\./, '');
  const out: string[] = [];
  for (const a of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(a, 'href');
    if (!href || !/^https?:/i.test(href)) continue;
    const id = identify(href);
    if (!id || id.kind === 'web' || id.kind === 'arena-block') continue;
    if (id.kind === 'mastodon' && id.host.replace(/^www\./, '') === own) continue;
    if (id.kind === 'instagram' && !id.user) continue;
    if (id.kind === 'bluesky' && id.post) continue;
    const clean = href.split('#')[0];
    if (!out.includes(clean)) out.push(clean);
  }
  return out;
}

/* ── Platform responses (pure) ─────────────────────────────────────────── */

interface BskyImage { thumb: string; fullsize: string; alt?: string; aspectRatio?: { width: number; height: number } }
interface BskyFeedItem {
  post: {
    uri: string; indexedAt?: string;
    author: { did: string; handle: string };
    record?: { createdAt?: string; text?: string };
    embed?: { $type: string; images?: BskyImage[]; media?: { $type: string; images?: BskyImage[] } };
  };
  reason?: unknown;
}

/** A Bluesky author feed, own posts only (not reposts), one item per image. */
export function bskyWork(feed: BskyFeedItem[], did: string): WorkItem[] {
  const items: WorkItem[] = [];
  for (const { post, reason } of feed) {
    if (reason || post.author.did !== did) continue;
    const images = post.embed?.images ?? post.embed?.media?.images ?? [];
    const rkey = post.uri.split('/').pop();
    images.forEach((im, i) => {
      items.push({
        key: `${post.uri}#${i}`, thumb: im.thumb, full: im.fullsize,
        url: `https://bsky.app/profile/${post.author.handle}/post/${rkey}`,
        title: post.record?.text?.slice(0, 140) || im.alt || undefined,
        at: post.record?.createdAt ?? post.indexedAt,
        w: im.aspectRatio?.width, h: im.aspectRatio?.height,
      });
    });
  }
  return items;
}

interface MastoStatus {
  id: string; url?: string; uri?: string; created_at?: string; content?: string; reblog?: unknown;
  media_attachments?: { type: string; url: string; preview_url?: string; meta?: { original?: { width?: number; height?: number } } }[];
}
export function mastodonWork(statuses: MastoStatus[]): WorkItem[] {
  const items: WorkItem[] = [];
  for (const s of statuses) {
    if (s.reblog) continue;
    (s.media_attachments ?? []).filter((m) => m.type === 'image').forEach((m, i) => {
      items.push({
        key: `${s.uri ?? s.id}#${i}`, thumb: m.preview_url || m.url, full: m.url, url: s.url ?? s.uri ?? '',
        title: s.content ? decodeEntities(s.content.replace(/<[^>]+>/g, ' ')).trim().slice(0, 140) || undefined : undefined,
        at: s.created_at, w: m.meta?.original?.width, h: m.meta?.original?.height,
      });
    });
  }
  return items;
}

interface ArenaV2Block {
  id: number; class: string; title?: string; connected_at?: string; created_at?: string;
  image?: { thumb?: { url: string }; display?: { url: string }; large?: { url: string }; original?: { url: string; width?: number; height?: number } };
}
export function arenaChannelWork(contents: ArenaV2Block[]): WorkItem[] {
  return contents
    .filter((b) => b.class === 'Image' && b.image)
    .sort((a, b) => Date.parse(b.connected_at ?? b.created_at ?? '') - Date.parse(a.connected_at ?? a.created_at ?? ''))
    .map((b) => ({
      key: `arena:${b.id}`,
      thumb: b.image!.display?.url ?? b.image!.thumb?.url ?? b.image!.original!.url,
      full: b.image!.large?.url ?? b.image!.original?.url ?? b.image!.display!.url,
      url: `https://www.are.na/block/${b.id}`,
      title: b.title || undefined,
      at: b.connected_at ?? b.created_at,
      w: b.image!.original?.width, h: b.image!.original?.height,
    }));
}

interface ArenaV3Block {
  id: number; type: string; title?: string; created_at?: string;
  image?: { src: string; width?: number; height?: number; small?: { src: string }; medium?: { src: string }; large?: { src: string } };
}
export function arenaUserWork(data: ArenaV3Block[]): WorkItem[] {
  return data
    .filter((b) => b.type === 'Image' && b.image?.src)
    .map((b) => ({
      key: `arena:${b.id}`,
      thumb: b.image!.medium?.src ?? b.image!.small?.src ?? b.image!.src,
      full: b.image!.large?.src ?? b.image!.src,
      url: `https://www.are.na/block/${b.id}`,
      title: b.title || undefined, at: b.created_at, w: b.image!.width, h: b.image!.height,
    }));
}

interface FlickrFeed { title?: string; items: { title?: string; link: string; media: { m: string }; published?: string }[] }
/** Flickr's public feed hands out the 240px `_m` size; the same path serves
 *  `_z` (640) and `_b` (1024) for any public photo. */
export function flickrWork(feed: FlickrFeed): WorkItem[] {
  return feed.items.map((it) => ({
    key: it.link,
    thumb: it.media.m.replace(/_m\.(jpg|png)$/i, '_z.$1'),
    full: it.media.m.replace(/_m\.(jpg|png)$/i, '_b.$1'),
    url: it.link, title: it.title || undefined, at: it.published,
  }));
}

/* ── Network ───────────────────────────────────────────────────────────── */

/** Every hop is checked like the first, as `fetchImageFromUrl` does: a
 *  pasted link is fetched by the Mac and must not reach the Mac's network. */
async function get(url: string, accept: string): Promise<Response> {
  let at = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHttpUrl(at);
    const res = await fetch(at, {
      headers: { accept, 'user-agent': UA },
      signal: AbortSignal.timeout(15_000),
      redirect: 'manual',
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (next) { at = new URL(next, at).href; continue; }
    if (!res.ok) throw new Error(`${new URL(at).hostname} answered ${res.status}.`);
    // `res.url` is empty for a manual fetch; keep the address that answered.
    Object.defineProperty(res, 'url', { value: at });
    return res;
  }
  throw new Error('That link redirects too many times.');
}
export async function getJson<T>(url: string): Promise<T> {
  return (await get(url, 'application/json')).json() as Promise<T>;
}
export async function getText(url: string): Promise<{ text: string; url: string; type: string }> {
  const res = await get(url, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  const text = (await res.text()).slice(0, MAX_TEXT);
  return { text, url: res.url || url, type: res.headers.get('content-type') ?? '' };
}

/** An image's bytes, for measuring or pinning. */
export async function getImage(url: string, maxBytes = 40 * 1024 * 1024): Promise<Buffer> {
  const res = await get(url, 'image/avif,image/webp,image/jpeg,image/*;q=0.8');
  if (!(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('That link is not an image.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('That file is too big.');
  return buf;
}

interface BskyProfile { did: string; handle: string; displayName?: string; description?: string; avatar?: string }

async function bskyProfile(actor: string): Promise<BskyProfile> {
  return getJson<BskyProfile>(`${BSKY}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
}

/**
 * Turn a pasted profile link into a name and a link the app can read from.
 * Throws a sentence when it can't.
 */
export async function resolveProfile(raw: string): Promise<Resolved> {
  const id = identify(raw);
  if (!id) throw new Error('That is not a web link.');

  switch (id.kind) {
    case 'bluesky': {
      const p = await bskyProfile(id.actor);
      return { name: tidyName(p.displayName?.trim() || p.handle), link: { kind: 'bluesky', id: p.did, url: `https://bsky.app/profile/${p.handle}` } };
    }
    case 'mastodon': {
      try {
        const a = await getJson<{ id: string; display_name?: string; username: string; url: string }>(
          `https://${id.host}/api/v1/accounts/lookup?acct=${encodeURIComponent(id.acct)}`,
        );
        return { name: tidyName(a.display_name?.trim() || a.username), link: { kind: 'mastodon', id: a.id, host: id.host, url: a.url } };
      } catch {
        // Not Mastodon, or its API needs a login: try the page's feed.
        return resolveWeb(`https://${id.host}/@${id.acct}`);
      }
    }
    case 'arena-channel': {
      const c = await getJson<{ title: string; slug: string; user?: { slug: string } }>(`${ARENA2}/channels/${encodeURIComponent(id.slug)}`);
      return { name: tidyName(c.title), link: { kind: 'arena-channel', id: c.slug, url: `https://www.are.na/${c.user?.slug ?? 'channel'}/${c.slug}` } };
    }
    case 'arena-user': {
      const u = await getJson<{ name?: string; slug: string }>(`${ARENA3}/users/${encodeURIComponent(id.slug)}`);
      return { name: u.name || u.slug, link: { kind: 'arena-user', id: u.slug, url: `https://www.are.na/${u.slug}` } };
    }
    case 'arena-block':
      throw new Error('That is one block. Paste the channel or the person instead.');
    case 'flickr': {
      const page = await getText(`https://www.flickr.com/photos/${encodeURIComponent(id.user)}/`);
      const feed = discoverFeed(page.text, page.url);
      const nsid = feed && flickrNsidFromFeed(feed.href);
      if (!nsid) throw new Error('Flickr did not show that photostream.');
      return {
        name: flickrNameFromFeedTitle(feed!.title) ?? id.user,
        link: { kind: 'flickr', id: nsid, url: `https://www.flickr.com/photos/${id.user}/` },
      };
    }
    case 'instagram':
      if (!id.user) throw new Error('That is a post. Paste their profile instead.');
      return { name: id.user, link: { kind: 'instagram', id: id.user, url: `https://www.instagram.com/${id.user}/` } };
    case 'web':
      return resolveWeb(id.url);
  }
}

/** "dansup on pixelfed.social" → "dansup"; "Posts – Jo Smith" stays as is. */
export function feedName(title: string | undefined, host: string): string | undefined {
  const t = title
    ?.replace(new RegExp(`\\s+on\\s+(www\\.)?${host.replace(/^www\./, '').replace(/\./g, '\\.')}\\s*$`, 'i'), '')
    // "Photo feed of Tom Watson on Glass" → "Tom Watson"
    .replace(/^(photo feed of|photos (by|from)|posts (by|from)|uploads from)\s+/i, '')
    .replace(/\s+on\s+(glass|pixelfed|tumblr|flickr|mastodon|vero|substack|pinterest)\s*$/i, '')
    .trim();
  return t || undefined;
}

// Where sites usually keep a feed, for a page that won't be read directly
// (Tumblr answers its pages 403 but serves /rss to anyone).
const FEED_PATHS = ['/rss', '/feed', '/atom.xml', '/rss.xml', '/feed.xml', '/index.xml'];

async function feedAtCommonPaths(url: string): Promise<Resolved | null> {
  const origin = new URL(url).origin;
  for (const p of FEED_PATHS) {
    try {
      const r = await getText(origin + p);
      if (!/^\s*(<\?xml|<rss\b|<feed\b)/i.test(r.text.slice(0, 400))) continue;
      const parsed = parseFeed(r.text, r.url);
      return { name: feedName(parsed.title, new URL(url).hostname) ?? new URL(url).hostname, link: { kind: 'feed', url, feed: r.url } };
    } catch { /* next */ }
  }
  return null;
}

async function resolveWeb(url: string): Promise<Resolved> {
  let page: Awaited<ReturnType<typeof getText>>;
  try { page = await getText(url); } catch (err) {
    const viaFeed = await feedAtCommonPaths(url);
    if (viaFeed) return viaFeed;
    throw err;
  }
  const isFeed = /xml|rss|atom/.test(page.type) || /^\s*<\?xml|<rss\b|<feed\b/i.test(page.text.slice(0, 400));
  if (isFeed) {
    const parsed = parseFeed(page.text, page.url);
    return { name: feedName(parsed.title, new URL(page.url).hostname) ?? new URL(page.url).hostname, link: { kind: 'feed', url: page.url, feed: page.url } };
  }
  const name = pageName(page.text) ?? new URL(page.url).hostname.replace(/^www\./, '');
  const feed = discoverFeed(page.text, page.url);
  if (feed) {
    // A Flickr page reached by some other address still reads best as Flickr.
    const nsid = flickrNsidFromFeed(feed.href);
    if (nsid) return { name: flickrNameFromFeedTitle(feed.title) ?? name, link: { kind: 'flickr', id: nsid, url: page.url } };
    // The feed's own title often names the person better than the page does.
    let titled: string | undefined;
    try { titled = feedName(parseFeed((await getText(feed.href)).text, feed.href).title, new URL(page.url).hostname); } catch { /* the page's name, then */ }
    return { name: titled ?? name, link: { kind: 'feed', url: page.url, feed: feed.href } };
  }
  // No feed: the photographs are on a page. A site's front page is often a
  // shop or a hero; its "Portfolio" usually holds far more.
  let best = { url: page.url, n: pageWork(page.text, page.url).length };
  const work = workPageUrl(page.text, page.url);
  if (work) {
    try {
      const w = await getText(work);
      const n = pageWork(w.text, w.url).length;
      if (n > best.n) best = { url: w.url, n };
    } catch { /* the front page, then */ }
  }
  if (best.n >= 6) return { name, link: { kind: 'page', url: best.url } };
  return (await feedAtCommonPaths(page.url)) ?? { name, link: { kind: 'page', url: best.url } };
}

/**
 * A photographer's own site, from their name alone: the guesses in
 * `siteGuesses`, kept only when the page names them. Returns the page too,
 * so the profiles it links to can be read without fetching it again.
 */
export async function findSite(name: string): Promise<{ url: string; html: string } | null> {
  const guesses = siteGuesses(name);
  const found = await Promise.all(guesses.map(async (u) => {
    try {
      const page = await getText(u);
      const said = [pageName(page.text), metaContent(page.text, 'og:title', 'og:site_name', 'author'), page.text.match(/<title[^>]*>([^<]*)/i)?.[1]]
        .filter(Boolean).join(' ');
      return namesMatch(decodeEntities(said), name) ? { url: page.url, html: page.text } : null;
    } catch { return null; }
  }));
  return found.find((f): f is NonNullable<typeof f> => Boolean(f)) ?? null;
}

/** Recent public photographs from one link, newest first where dates exist. */
export async function fetchWork(link: ProfileLink, limit = 48): Promise<WorkItem[]> {
  let items: WorkItem[] = [];
  switch (link.kind) {
    case 'bluesky': {
      const r = await getJson<{ feed: BskyFeedItem[] }>(
        `${BSKY}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(link.id!)}&filter=posts_with_media&limit=60`,
      );
      items = bskyWork(r.feed, link.id!);
      break;
    }
    case 'mastodon': {
      const r = await getJson<MastoStatus[]>(
        `https://${link.host}/api/v1/accounts/${encodeURIComponent(link.id!)}/statuses?only_media=true&exclude_reblogs=true&exclude_replies=true&limit=40`,
      );
      items = mastodonWork(r);
      break;
    }
    case 'arena-channel': {
      const r = await getJson<{ contents: ArenaV2Block[] }>(`${ARENA2}/channels/${encodeURIComponent(link.id!)}/contents?per=100`);
      items = arenaChannelWork(r.contents ?? []);
      break;
    }
    case 'arena-user': {
      const r = await getJson<{ data: ArenaV3Block[] }>(`${ARENA3}/users/${encodeURIComponent(link.id!)}/contents?per=60`);
      items = arenaUserWork(r.data ?? []);
      break;
    }
    case 'flickr': {
      const r = await getJson<FlickrFeed>(
        `https://www.flickr.com/services/feeds/photos_public.gne?id=${encodeURIComponent(link.id!)}&format=json&nojsoncallback=1`,
      );
      items = flickrWork(r);
      break;
    }
    case 'feed': {
      const page = await getText(link.feed ?? link.url);
      items = parseFeed(page.text, page.url).items;
      break;
    }
    case 'page': {
      const page = await getText(link.url);
      items = pageWork(page.text, page.url);
      break;
    }
    case 'instagram': {
      // Only through your own connection, and only professional accounts.
      const { instagramConnected, instagramDiscover } = await import('./instagram-api');
      if (!link.id || !(await instagramConnected())) return [];
      items = (await instagramDiscover(link.id)).items;
      break;
    }
  }
  const dated = items.some((i) => i.at);
  if (dated) items.sort((a, b) => Date.parse(b.at ?? '0') - Date.parse(a.at ?? '0'));
  return items.slice(0, limit);
}

/* ── Credit from a shared link ─────────────────────────────────────────── */

/**
 * The profile behind a shared post, from the link's shape: a Bluesky post,
 * a Mastodon status, a Flickr photo page, an Instagram link that carries the
 * username. Null when the link names nobody.
 */
export function profileUrlOf(raw: string): string | null {
  const id = identify(raw);
  if (!id) return null;
  switch (id.kind) {
    case 'bluesky': return `https://bsky.app/profile/${id.actor}`;
    case 'mastodon': return `https://${id.host}/@${id.acct}`;
    case 'flickr': return `https://www.flickr.com/photos/${id.user}/`;
    case 'instagram': return id.user ? `https://www.instagram.com/${id.user}/` : null;
    case 'arena-channel': case 'arena-user': case 'arena-block': return null;
    case 'web': return null;
  }
}

/* ── Graph and search, for suggestions ─────────────────────────────────── */

export interface Candidate { name: string; link: ProfileLink; note?: string }

/** Who a Bluesky account follows (public). */
export async function bskyFollows(did: string, max = 200): Promise<(Candidate & { bio: string })[]> {
  const out: (Candidate & { bio: string })[] = [];
  let cursor: string | undefined;
  while (out.length < max) {
    const r = await getJson<{ follows: BskyProfile[]; cursor?: string }>(
      `${BSKY}/app.bsky.graph.getFollows?actor=${encodeURIComponent(did)}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    for (const f of r.follows) {
      out.push({ name: tidyName(f.displayName?.trim() || f.handle), bio: f.description ?? '', link: { kind: 'bluesky', id: f.did, url: `https://bsky.app/profile/${f.handle}` } });
    }
    if (!r.cursor || !r.follows.length) break;
    cursor = r.cursor;
  }
  return out;
}

/** Who a Mastodon account follows (public on Mastodon). */
export async function mastodonFollows(host: string, id: string): Promise<(Candidate & { bio: string })[]> {
  const r = await getJson<{ id: string; acct: string; display_name?: string; username: string; url: string; note?: string }[]>(
    `https://${host}/api/v1/accounts/${encodeURIComponent(id)}/following?limit=80`,
  );
  return r.map((a) => {
    // A remote account's id is this instance's id for it, so reads go through this host.
    return {
      name: tidyName(a.display_name?.trim() || a.username),
      bio: decodeEntities((a.note ?? '').replace(/<[^>]+>/g, ' ')),
      link: { kind: 'mastodon' as const, id: a.id, host, url: a.url },
    };
  });
}

/** The other public channels an Are.na block was connected to. */
export async function arenaBlockChannels(blockId: string): Promise<{ title: string; slug: string; user: string; length: number }[]> {
  const r = await getJson<{ channels: { title: string; slug: string; length: number; user?: { slug: string } }[] }>(
    `${ARENA2}/blocks/${encodeURIComponent(blockId)}/channels?per=30`,
  );
  return (r.channels ?? []).map((c) => ({ title: c.title, slug: c.slug, user: c.user?.slug ?? 'channel', length: c.length }));
}

/** Bluesky accounts whose name or handle matches. */
export async function bskySearch(q: string, limit = 4): Promise<Candidate[]> {
  const r = await getJson<{ actors: BskyProfile[] }>(`${BSKY}/app.bsky.actor.searchActors?q=${encodeURIComponent(q)}&limit=${limit * 3}`);
  // Bluesky's search matches any word; only accounts that carry the whole name count.
  return r.actors.filter((a) => namesMatch(`${a.displayName ?? ''} ${a.handle}`, q)).slice(0, limit).map((a) => ({
    name: tidyName(a.displayName?.trim() || a.handle), note: `@${a.handle}`,
    link: { kind: 'bluesky', id: a.did, url: `https://bsky.app/profile/${a.handle}` },
  }));
}

/** Are.na channels named after someone — where other people keep their work. */
export async function arenaSearch(q: string, limit = 4): Promise<Candidate[]> {
  const r = await getJson<{ channels: { title: string; slug: string; length: number; user?: { slug: string; full_name?: string } }[] }>(
    `${ARENA2}/search/channels?q=${encodeURIComponent(q)}&per=${limit * 2}`,
  );
  return (r.channels ?? [])
    .filter((c) => c.length >= 4 && namesMatch(c.title, q))
    .slice(0, limit)
    .map((c) => ({
      name: tidyName(c.title), note: `kept by ${c.user?.full_name ?? c.user?.slug ?? 'someone'} · ${c.length}`,
      link: { kind: 'arena-channel', id: c.slug, url: `https://www.are.na/${c.user?.slug ?? 'channel'}/${c.slug}` },
    }));
}
