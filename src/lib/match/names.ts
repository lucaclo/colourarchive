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
  return s;
}

/** "DSC01234 in the look of DSC06160", falling back to plain words. */
export function matchTitle(mine: string, references: string[]): string {
  const me = photoName(mine) || 'Your photo';
  const named = references.map(photoName).filter(Boolean);
  const ref =
    references.length > 1 ? `${references.length} references` : named[0] ? named[0] : 'the reference';
  return `${me} in the look of ${ref}`;
}
