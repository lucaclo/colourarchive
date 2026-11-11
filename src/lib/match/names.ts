/**
 * A photo's name as a person would say it, from the file name the workbench
 * was handed. Archive and board files carry a content hash
 * (`DSC06160.b4490759aa4afe19.jpg`) and derivatives a width
 * (`008f7d3eff93aa1f-1280.avif`); neither is something anyone recognises, so
 * both come off, and a name that is nothing but a hash comes back empty for
 * the caller to replace with "Your photo" or "Reference".
 */
export function photoName(file: string): string {
  let s = file.trim().replace(/^.*[\\/]/, '');
  s = s.replace(/\.(jpe?g|png|webp|avif|heic|heif|tiff?|gif|dng|arw|cr[23]|nef|raf|orf|rw2|pef|srw|3fr|iiq)$/i, '');
  s = s.replace(/-(320|480|640|960|1024|1280|1600|2000|2048|2560)$/, '');
  s = s.replace(/[.\-_][0-9a-f]{8,}$/i, '');
  if (/^[0-9a-f]{12,}$/i.test(s)) return '';
  // Names a machine gave it, which nobody would say aloud either: a saved
  // Instagram image (`734846020_18006134951936155_…_n`) or an app's
  // `temp_image_<UUID>`.
  if (/^temp[_-]?image[_-]?[0-9a-f-]{20,}$/i.test(s)) return '';
  if ((s.match(/\d/g)?.length ?? 0) >= 12 && !/[a-z]{3,}/i.test(s)) return '';
  return unslug(s);
}

/**
 * A web slug back into words: `approaching-shadow-hong-kong-by-fan-ho` was
 * printed as it came, as the title of a match. Only names that are plainly a
 * slug — three or more words of letters joined by hyphens or underscores —
 * so `pantheon-2`, `trip-2024` and camera names are left exactly as they are.
 * A trailing "by Somebody" is the credit, and a credit is a name.
 */
function unslug(s: string): string {
  const words = s.split(/[-_]+/).filter(Boolean);
  if (words.length < 3 || !words.every((w) => /^[a-z]+$/i.test(w))) return s;
  const by = words.lastIndexOf('by');
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const title = (by > 0 ? words.slice(0, by) : words).join(' ');
  const sentence = cap(title);
  return by > 0 && by < words.length - 1 ? `${sentence} by ${words.slice(by + 1).map(cap).join(' ')}` : sentence;
}

/** "DSC01234 in the look of DSC06160", falling back to plain words. */
export function matchTitle(mine: string, references: string[]): string {
  const me = photoName(mine) || 'Your photo';
  const named = references.map(photoName).filter(Boolean);
  const ref =
    references.length > 1 ? `${references.length} references` : named[0] ? named[0] : 'the reference';
  return `${me} in the look of ${ref}`;
}
