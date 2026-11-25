/**
 * Feedback from the app: a note and up to four pictures, sent from any page
 * (components/Feedback.astro) so the next session can work through them.
 *
 * Two ways in, one shape out:
 *   - a page the Mac serves (the app, the dev server, the iPad on the Wi-Fi)
 *     posts to /api/feedback, which keeps it on the Mac, in the archive's
 *     `.archive/feedback/<id>/` (note.md beside its pictures);
 *   - the published site, which has no server, files an issue in a private
 *     GitHub repo with the device's own token (lib/feedback-github.ts).
 *     `npm run feedback` pulls those into the same folders.
 *
 * Plain data in, plain data out: everything here runs in the page, on the
 * server and in the script alike.
 */

/** The private repo the published site files into (never the public code repo). */
export const FEEDBACK_REPO = 'lucaclo/colourarchive-feedback';
/** Where a device keeps its GitHub token. */
export const TOKEN_KEY = 'ca-feedback-token';
export const FEEDBACK_HASH = '#feedback';

export const MAX_IMAGES = 4;
export const MAX_NOTE = 4000;
/** Per picture, after the page has shrunk it. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
/** The long edge a picture is shrunk to before it's sent. */
export const MAX_EDGE = 2560;

export const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export type ImageType = keyof typeof IMAGE_TYPES;
export type ImageExt = (typeof IMAGE_TYPES)[ImageType];

/** What the page says about where it was sent from. */
export interface FeedbackContext {
  /** Path, query and hash on this site: `/scout?at=…`. */
  page: string;
  /** "iPhone", "Mac app", "Mac" (lib/updates.ts deviceName). */
  device: string;
  /** "393×852 @3x". */
  viewport: string;
  /** The build the page came from: "0.2.13 2026-11-25T08:40:00.000Z". */
  build: string;
}

export interface FeedbackEntry extends FeedbackContext {
  id: string;
  note: string;
  /** ISO time it was sent. */
  created: string;
  /** File names in its folder, in order: "1.jpg". */
  images: string[];
  source: 'mac' | 'github';
  /** GitHub issue number and address, for ones filed from the published site. */
  issue?: number;
  url?: string;
  /** ISO time it was marked done. */
  done?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-11-25-1432-a1b2`: when (local time) plus four hex characters, so ids sort by time. */
export function newFeedbackId(date: Date, rand: Uint8Array): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}`;
  const tail = [...rand.slice(0, 2)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${day}-${time}-${tail.padEnd(4, '0')}`;
}

/** A folder name this code made: a new id, or `gh-<issue>` for a pulled issue. */
export const validFeedbackId = (id: unknown): id is string =>
  typeof id === 'string' && (/^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}$/.test(id) || /^gh-\d{1,7}$/.test(id));

/** Control characters out (newlines and tabs kept only where asked), trimmed, capped. */
function clean(value: unknown, max: number, multiline = false): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const c = ch.codePointAt(0) ?? 0;
    if (multiline && (ch === '\n' || ch === '\t')) out += ch;
    else if (c < 32 || c === 127) out += multiline ? '' : ' ';
    else out += ch;
  }
  out = out.replace(/\r/g, '').trim();
  return [...out].slice(0, max).join('');
}

export const cleanNote = (value: unknown): string => clean(value, MAX_NOTE, true);

/** The page's description of itself, made safe to keep: single lines, short, the page a path on this site. */
export function cleanContext(fields: Record<string, unknown>): FeedbackContext {
  const page = clean(fields.page, 600);
  return {
    page: page.startsWith('/') ? page : '/',
    device: clean(fields.device, 40) || 'Unknown',
    viewport: clean(fields.viewport, 40),
    build: clean(fields.build, 80),
  };
}

/** The file type a picture's first bytes say it is, whatever its name claims. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

const PAGES: [RegExp, string][] = [
  [/^\/book\/zine/, 'Magazine'],
  [/^\/book\/view/, 'Shared book'],
  [/^\/book/, 'Book'],
  [/^\/inspiration/, 'Inspiration'],
  [/^\/scout/, 'Scout'],
  [/^\/upload/, 'Add & remove'],
  [/^\/get/, 'Get the app'],
  [/^\/(?:[?#]|$)/, 'Archive'],
];

/** The section a page belongs to, by name ("Scout"), or its path when it's none of them. */
export function pageLabel(page: string): string {
  for (const [re, name] of PAGES) if (re.test(page)) return name;
  return page.split(/[?#]/)[0] || '/';
}

/** An issue title: the note's first line, cut at 72 characters; or "Feedback from Scout". */
export function issueTitle(note: string, page: string): string {
  const first = note.split('\n').map((l) => l.trim()).find(Boolean);
  if (!first) return `Feedback from ${pageLabel(page)}`;
  const chars = [...first.replace(/\s+/g, ' ')];
  return chars.length > 72 ? `${chars.slice(0, 71).join('').trimEnd()}…` : chars.join('');
}

const META = 'colour-archive-feedback';
const NOTE_END = '<!-- /note -->';

/** A cell for a Markdown table: no pipes or line breaks to break it. */
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' ';

/**
 * The issue's body: the note, the pictures, a small table of where it came
 * from, and the same facts as JSON in a comment for `npm run feedback`.
 */
export function issueBody(
  entry: Pick<FeedbackEntry, 'id' | 'note' | 'created'> & FeedbackContext,
  imageUrls: string[],
): string {
  const meta = {
    id: entry.id,
    created: entry.created,
    page: entry.page,
    device: entry.device,
    viewport: entry.viewport,
    build: entry.build,
  };
  // `>` escaped, so nothing in a value can close the comment early.
  const json = JSON.stringify(meta).replace(/>/g, '\\u003e').replace(/</g, '\\u003c');
  const parts = [entry.note || '', NOTE_END];
  imageUrls.forEach((u, i) => parts.push(`![Picture ${i + 1}](${u})`));
  parts.push(
    [
      '| Page | Device | Window | Build |',
      '| --- | --- | --- | --- |',
      `| ${cell(entry.page)} | ${cell(entry.device)} | ${cell(entry.viewport)} | ${cell(entry.build)} |`,
    ].join('\n'),
  );
  parts.push(`<!-- ${META} ${json} -->`);
  return parts.join('\n\n');
}

/** Picture files named in an issue body (`shots/<name>`), in order, once each. */
export function issueImages(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/\/shots\/([A-Za-z0-9._-]+\.(?:jpg|png|webp))/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** An issue body back to its note and facts. Anything missing (an issue typed on GitHub) is left empty. */
export function parseIssueBody(body: string): { note: string; context: FeedbackContext; id: string | null; created: string | null } {
  const text = body.replace(/\r\n/g, '\n');
  const m = text.match(new RegExp(`<!-- ${META} (\\{.*?\\}) -->`));
  let meta: Record<string, unknown> = {};
  if (m) {
    try {
      meta = JSON.parse(m[1]);
    } catch {
      meta = {};
    }
  }
  const end = text.indexOf(NOTE_END);
  const note = end >= 0 ? text.slice(0, end) : m ? text.slice(0, m.index) : text;
  return {
    note: cleanNote(note),
    context: cleanContext(meta),
    id: typeof meta.id === 'string' ? meta.id : null,
    created: typeof meta.created === 'string' ? meta.created : null,
  };
}

// --- note.md -------------------------------------------------------------------

const FRONT_KEYS = ['id', 'created', 'source', 'page', 'device', 'viewport', 'build', 'images', 'issue', 'url', 'done'] as const;

/** A kept item as Markdown: one-line facts in front matter, then the note as written. */
export function noteMarkdown(entry: FeedbackEntry): string {
  const front: Record<string, string | undefined> = {
    id: entry.id,
    created: entry.created,
    source: entry.source,
    page: entry.page,
    device: entry.device,
    viewport: entry.viewport,
    build: entry.build,
    images: entry.images.join(', '),
    issue: entry.issue !== undefined ? String(entry.issue) : undefined,
    url: entry.url,
    done: entry.done,
  };
  const lines = FRONT_KEYS.filter((k) => front[k]).map((k) => `${k}: ${clean(front[k], 600)}`);
  return `---\n${lines.join('\n')}\n---\n\n${entry.note}\n`;
}

/** note.md back to an entry, or null when it isn't one. */
export function parseNoteMarkdown(text: string): FeedbackEntry | null {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const f: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) f[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!validFeedbackId(f.id)) return null;
  const issue = f.issue ? Number(f.issue) : undefined;
  return {
    id: f.id,
    note: m[2].trim(),
    created: f.created ?? '',
    source: f.source === 'github' ? 'github' : 'mac',
    page: f.page ?? '/',
    device: f.device ?? '',
    viewport: f.viewport ?? '',
    build: f.build ?? '',
    images: (f.images ?? '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(s)),
    ...(Number.isInteger(issue) ? { issue } : {}),
    ...(f.url ? { url: f.url } : {}),
    ...(f.done ? { done: f.done } : {}),
  };
}

// --- In the page -----------------------------------------------------------------

/** "393×852 @3x". */
export const viewportLabel = (w: number, h: number, dpr: number): string =>
  `${Math.round(w)}×${Math.round(h)} @${Math.round(dpr * 10) / 10}x`;

/** The size to draw a picture at so its long edge is at most `max`. */
export function fitWithin(w: number, h: number, max = MAX_EDGE): { w: number; h: number; scaled: boolean } {
  const long = Math.max(w, h);
  if (long <= max) return { w, h, scaled: false };
  const k = max / long;
  return { w: Math.round(w * k), h: Math.round(h * k), scaled: true };
}

/** GitHub's token page, filled in: the name, what it's for, never expiring, issues and contents. */
export function newTokenUrl(repo = FEEDBACK_REPO): string {
  const [owner, name] = repo.split('/');
  const q = new URLSearchParams({
    name: 'Colour Archive feedback',
    description: `Lets the app file feedback in ${name}. Give it only that repository.`,
    target_name: owner,
    expires_in: 'none',
    contents: 'write',
    issues: 'write',
  });
  return `https://github.com/settings/personal-access-tokens/new?${q}`;
}
