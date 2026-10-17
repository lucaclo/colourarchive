/**
 * The ⌘K palette's ranking: what to show for what's been typed.
 *
 * Kept to plain data in, plain data out, so the component only draws. The
 * reference is Immich 2.4's palette (jump to a page by name, plus a few
 * actions) and mymind's keyboard search; the archive adds its own nouns:
 * chapters, colours and Scout places.
 */

export type CommandGroup = 'This page' | 'Go to' | 'Chapters' | 'Places' | 'Search';

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  /** Where it goes. Page actions have none: they press `action` instead. */
  href?: string;
  /** For 'This page': the `data-cmdk-id` of the control it presses. */
  action?: string;
  /** Other words it answers to ("upload" for Add & remove). */
  keywords?: string[];
  /** A swatch to draw beside it, for chapters and colours. */
  swatch?: string;
}

/** 0 = no match. Higher is better. */
export function scoreCommand(command: Command, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const title = command.title.toLowerCase();
  const words = [title, ...(command.keywords ?? []).map((k) => k.toLowerCase())];
  let best = 0;
  for (const w of words) {
    if (w === q) best = Math.max(best, 100);
    else if (w.startsWith(q)) best = Math.max(best, 80 - Math.min(20, w.length - q.length));
    else if (w.split(/[\s&/-]+/).some((part) => part.startsWith(q))) best = Math.max(best, 60);
    else if (w.includes(q)) best = Math.max(best, 40);
    // Loose letters-in-order only once there are enough of them to mean
    // something; at two letters nearly everything matches.
    else if (q.length >= 3 && isSubsequence(q, w)) best = Math.max(best, 20);
  }
  return best;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

const GROUP_ORDER: CommandGroup[] = ['This page', 'Go to', 'Chapters', 'Places', 'Search'];

/**
 * The commands that match, best first, at most `limit`. An empty query lists
 * the pages and the first few places, in their own order, so the palette
 * opens on somewhere to go rather than a blank list.
 */
export function rankCommands(commands: Command[], query: string, limit = 9): Command[] {
  const q = query.trim();
  if (!q) {
    // What you can do here comes first (Immich's context actions), then
    // where you can go.
    const here = commands.filter((c) => c.group === 'This page').slice(0, 5);
    const pages = commands.filter((c) => c.group === 'Go to');
    const places = commands.filter((c) => c.group === 'Places').slice(0, 3);
    return [...here, ...pages, ...places].slice(0, Math.max(limit, here.length + pages.length));
  }
  return commands
    .map((c, i) => ({ c, i, s: scoreCommand(c, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || GROUP_ORDER.indexOf(a.c.group) - GROUP_ORDER.indexOf(b.c.group) || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c)
    .reduce<Command[][]>((groups, c) => {
      // One heading per group: groups keep the order of their best match.
      const g = groups.find((list) => list[0].group === c.group);
      if (g) g.push(c);
      else groups.push([c]);
      return groups;
    }, [])
    .flat();
}

/** `#3f6f8f`, `3f6f8f` or `#36f` as a six-digit hex, or null. */
/**
 * The page's own actions, from the controls it marks with `data-cmdk`
 * ("Print", "Spreads") and optional `data-cmdk-keywords`. Only controls
 * that can be pressed right now: hidden, disabled or already-current ones
 * (a pressed toggle, the selected tab) are left out.
 */
export interface PageControl {
  id: string;
  title: string;
  keywords?: string;
  visible: boolean;
  disabled: boolean;
  current: boolean;
}

export function pageCommands(controls: readonly PageControl[]): Command[] {
  const seen = new Set<string>();
  const out: Command[] = [];
  for (const c of controls) {
    const title = c.title.trim();
    if (!title || !c.visible || c.disabled || c.current || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push({
      id: `here:${c.id}`,
      title,
      group: 'This page',
      action: c.id,
      keywords: c.keywords?.split(',').map((k) => k.trim()).filter(Boolean),
    });
  }
  return out;
}

export function parseHex(query: string): string | null {
  const m = query.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

/**
 * The rows that depend on what was typed and can't be listed ahead: a hex
 * code becomes a colour search, and any text can be searched for in the
 * archive by description, where the archive has that search.
 */
export function queryCommands(query: string, opts: { textSearch?: boolean } = {}): Command[] {
  const q = query.trim();
  if (!q) return [];
  const out: Command[] = [];
  const hex = parseHex(q);
  if (hex) {
    out.push({ id: `colour:${hex}`, title: `Photos in ${hex}`, group: 'Search', href: `/?colour=${hex.slice(1)}`, swatch: hex });
    return out;
  }
  // The static publish has no description search to hand the words to.
  if (q.length >= 2 && opts.textSearch !== false) {
    out.push({ id: `search:${q}`, title: `Search the archive for “${q}”`, group: 'Search', href: `/?q=${encodeURIComponent(q)}` });
  }
  return out;
}
