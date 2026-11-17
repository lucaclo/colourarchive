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

/** A camera's own frame number (DSC06549, IMG_2863, DSCF0012-2): a name, but not a title. */
const CAMERA_NAME = /^(?:_?DSC[FN]?|_MG|IMG|PXL|GOPR|DJI|P|R|L)[_-]?\d{3,}(?:[_-]\d+)*$/i;

/** What a person would call the picture, or '' when it has no such name. */
function titleOf(file: string): string {
  const name = photoName(file);
  return name && !CAMERA_NAME.test(name) ? name : '';
}

/**
 * The match's heading. Frame numbers on both sides read as a filing note
 * ("DSC06549 in the look of DSC00424-2", R13-28), so only real titles are
 * used, and with none it's "Your photo in this look".
 */
export function matchTitle(mine: string, references: string[]): string {
  const me = titleOf(mine) || 'Your photo';
  if (references.length > 1) return `${me} in the look of ${references.length} references`;
  const ref = titleOf(references[0] ?? '');
  return ref ? `${me} in the look of ${ref}` : `${me} in this look`;
}
