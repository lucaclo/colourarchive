/**
 * A picture for the feedback sheet, ready to send: kept as it is when it's
 * already a JPEG, PNG or WebP of a sensible size (a screenshot stays sharp),
 * otherwise drawn again as a JPEG with its long edge at most MAX_EDGE (a
 * phone photo, a HEIC, a Retina window capture). In the page only.
 */
import { fitWithin, IMAGE_TYPES, MAX_EDGE, type ImageType } from './feedback';

/** Kept as sent below this, if the size and type are fine too. */
const KEEP_BYTES = 3 * 1024 * 1024;

/** A reason fit to show (lib/feedback.ts quiet errors); anything else the browser throws stays in the console. */
export class PictureError extends Error {}

export interface Picture {
  blob: Blob;
  type: ImageType;
  /** An object URL for the thumbnail; revoke it when the picture goes. */
  url: string;
}

export async function preparePicture(file: Blob): Promise<Picture> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PictureError('Not a picture this browser can open');
  }
  try {
    const fit = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
    if (!fit.scaled && file.size <= KEEP_BYTES && file.type in IMAGE_TYPES) {
      return { blob: file, type: file.type as ImageType, url: URL.createObjectURL(file) };
    }
    const canvas = document.createElement('canvas');
    canvas.width = fit.w;
    canvas.height = fit.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PictureError('Couldn’t draw the picture');
    ctx.drawImage(bitmap, 0, 0, fit.w, fit.h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new PictureError('Couldn’t draw the picture');
    return { blob, type: 'image/jpeg', url: URL.createObjectURL(blob) };
  } finally {
    bitmap.close();
  }
}
