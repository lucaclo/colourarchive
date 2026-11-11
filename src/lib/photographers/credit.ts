import sharp from 'sharp';
import exifReader from 'exif-reader';
import { identify, pageAuthor, profileUrlOf, resolveProfile, type ProfileLink } from './sources';
import { findOrCreate, updatePhotographers } from './store';

/**
 * Who took a reference, worked out rather than typed: "Whose is it?" was
 * never filled in once, on any of the board's references.
 *
 * Best evidence first:
 * 1. the shared link names its account (a Bluesky post, a Mastodon status, a
 *    Flickr photo, an Instagram link with the username in it), resolved
 *    through the platform so the credit carries a link that can be followed;
 * 2. the page says who wrote it (`author`, `article:author`, `twitter:creator`);
 * 3. the file says who made it (EXIF Artist, else the name in Copyright);
 * 4. what was typed in "Whose is it?", if anything.
 */

export interface Credit { name: string; link?: ProfileLink }

/** "© 2024 Jane Doe. All rights reserved." → "Jane Doe" */
export function nameFromCopyright(s: string): string | undefined {
  const cleaned = s
    .replace(/©|\(c\)|copyright/gi, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/all rights reserved\.?/gi, ' ')
    .replace(/[.,;]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned && cleaned.length <= 60 ? cleaned : undefined;
}

export async function creditFromFile(buf: Buffer): Promise<Credit | null> {
  try {
    const { exif } = await sharp(buf).metadata();
    if (!exif) return null;
    const img = exifReader(exif).Image ?? {};
    const artist = typeof img.Artist === 'string' ? img.Artist.trim() : '';
    if (artist) return { name: artist };
    const copy = typeof img.Copyright === 'string' ? nameFromCopyright(img.Copyright) : undefined;
    return copy ? { name: copy } : null;
  } catch {
    return null;
  }
}

export async function creditFromLink(url: string, html?: string): Promise<Credit | null> {
  const profile = profileUrlOf(url);
  if (profile) {
    try { return await resolveProfile(profile); } catch {
      const id = identify(profile);
      if (id?.kind === 'instagram' && id.user) return { name: id.user };
    }
  }
  const author = html ? pageAuthor(html) : undefined;
  return author ? { name: author } : null;
}

/** What was typed: a link is followed like a shared one, words are a name. */
export async function creditFromTyped(source: string): Promise<Credit | null> {
  const s = source.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    try { return await resolveProfile(s); } catch { return creditFromLink(s); }
  }
  return { name: s.slice(0, 80) };
}

/** Record the credit, making the photographer if they're new. */
export async function creditReference(refId: string, credit: Credit): Promise<{ id: string; name: string }> {
  return updatePhotographers((file) => {
    const p = findOrCreate(file, credit.name, credit.link);
    file.credits[refId] = p.id;
    return { id: p.id, name: p.name };
  });
}

/**
 * Every source of a credit, best first, for one newly added reference, and
 * who it went to (so the page can offer more of their work). Never throws:
 * an uncredited reference is the normal case, not an error.
 */
export async function autoCredit(refId: string, opts: { url?: string; html?: string; buf?: Buffer; typed?: string }): Promise<{ id: string; name: string } | null> {
  try {
    // A credit the link proves beats one typed: the field often still holds
    // the last batch's credit.
    const fromLink = opts.url ? await creditFromLink(opts.url, opts.html) : null;
    const typed = opts.typed && opts.typed !== opts.url ? await creditFromTyped(opts.typed) : null;
    const fromFile = !fromLink && !typed && opts.buf ? await creditFromFile(opts.buf) : null;
    const credit = fromLink ?? typed ?? fromFile;
    return credit ? await creditReference(refId, credit) : null;
  } catch (err) {
    console.warn('[photographers] could not credit', refId, err);
    return null;
  }
}
