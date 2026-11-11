/**
 * Who you already follow photographers through: your own Instagram data.
 *
 * Instagram's API can't read other people's work for a personal account, but
 * "Download your information" hands you your own: who you follow, whose
 * posts you saved, whose you liked. Saving a post is the strongest signal
 * of taste there is, so the people you save most come first — a favourites
 * list with nothing typed.
 *
 * Read from the JSON export (the HTML one is for reading, not parsing). The
 * file names and shapes have moved between export versions, so files are
 * recognised by what's in them rather than where they sit.
 */

export interface InstagramPerson {
  username: string;
  saved: number;
  liked: number;
  following: boolean;
  /** Most recent save or like, ISO. */
  last?: string;
  score: number;
}

/** A username out of an Instagram profile or post address. */
export function usernameFromHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const parts = new URL(href).pathname.split('/').filter(Boolean);
    // https://www.instagram.com/_u/name, /name, /name/p/…
    const name = parts[0] === '_u' ? parts[1] : parts[0];
    if (!name || ['p', 'reel', 'reels', 'stories', 'tv', 'explore'].includes(name)) return undefined;
    return name.toLowerCase();
  } catch { return undefined; }
}

const validName = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9._]{1,30}$/i.test(s);

interface Entry { title?: string; string_list_data?: { href?: string; value?: string; timestamp?: number }[]; string_map_data?: Record<string, { href?: string; value?: string; timestamp?: number }> }

/** Every list of entries in a file, whatever the top-level key is called. */
function entriesOf(json: unknown): { key: string; entries: Entry[] }[] {
  if (Array.isArray(json)) return [{ key: '', entries: json as Entry[] }];
  if (!json || typeof json !== 'object') return [];
  return Object.entries(json as Record<string, unknown>)
    .filter(([, v]) => Array.isArray(v))
    .map(([key, v]) => ({ key, entries: v as Entry[] }));
}

/**
 * Rank the people in an export. Each file is classified by its own
 * top-level key ("relationships_following", "saved_saved_media",
 * "likes_media_likes"), so a renamed file still reads.
 */
export function rankInstagram(files: { name: string; text: string }[]): InstagramPerson[] {
  const people = new Map<string, InstagramPerson>();
  const get = (u: string) => {
    let p = people.get(u);
    if (!p) { p = { username: u, saved: 0, liked: 0, following: false, score: 0 }; people.set(u, p); }
    return p;
  };
  const touch = (p: InstagramPerson, ts?: number) => {
    if (!ts) return;
    const iso = new Date(ts * 1000).toISOString();
    if (!p.last || iso > p.last) p.last = iso;
  };

  for (const f of files) {
    let json: unknown;
    try { json = JSON.parse(f.text); } catch { continue; }
    for (const { key, entries } of entriesOf(json)) {
      const k = `${key} ${f.name}`.toLowerCase();
      const kind = /following/.test(k) && !/hashtag/.test(k) ? 'following'
        : /saved/.test(k) ? 'saved'
        : /like/.test(k) && !/comment/.test(k) ? 'liked'
        : null;
      if (!kind) continue;
      for (const e of entries) {
        const item = e.string_list_data?.[0] ?? Object.values(e.string_map_data ?? {})[0];
        // Following: the name is the value (older) or the title (newer).
        // Saved and liked: the title is the post's owner.
        const name = kind === 'following'
          ? [item?.value, e.title, usernameFromHref(item?.href)].find(validName)
          : [e.title].find(validName);
        if (!name) continue;
        const p = get(name.toLowerCase());
        if (kind === 'following') p.following = true;
        else if (kind === 'saved') { p.saved++; touch(p, item?.timestamp); }
        else { p.liked++; touch(p, item?.timestamp); }
      }
    }
  }

  for (const p of people.values()) p.score = p.saved * 3 + Math.min(p.liked, 30) + (p.following ? 2 : 0);
  return [...people.values()]
    // Following alone, with nothing saved or liked, says little about taste.
    .filter((p) => p.saved > 0 || p.liked > 1)
    .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
}

/** Whether a file inside the export is one worth reading. */
export const wantedInExport = (name: string): boolean =>
  /\.json$/i.test(name) && /(following|saved_posts|saved_collections|liked_posts|likes)/i.test(name.split('/').pop() ?? '');
