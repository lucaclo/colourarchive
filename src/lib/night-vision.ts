/**
 * Night vision (issue #157): the screen in dim amber-red on black, so a
 * glance at it doesn't undo twenty minutes of dark adaptation. Used by Scout
 * and by the colour clock (#145), remembered on the device.
 *
 * The page can't turn the screen down, so the palette carries it. Rather than
 * recolour every element (the map draws in WebGL, and a dozen inks are
 * hard-coded because they mean something), one full-screen layer with a
 * backdrop filter maps whatever is under it to a single warm hue at low
 * brightness: see `html[data-night-vision]` in global.css. Holding a finger
 * on a photo lifts it while held, which is the only way to see colour.
 */

const KEY = 'night-vision';

export function nightVisionSaved(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const nightVisionOn = (): boolean => document.documentElement.hasAttribute('data-night-vision');

/** Switch it, and remember the choice unless told not to. */
export function setNightVision(on: boolean, remember = true): void {
  document.documentElement.toggleAttribute('data-night-vision', on);
  if (remember) {
    try {
      if (on) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      /* for this visit */
    }
  }
  document.dispatchEvent(new CustomEvent('night-vision', { detail: on }));
}

let peekBound = false;

/** Press and hold an image to see it in colour, once, for the whole document. */
export function bindNightVisionPeek(): void {
  if (peekBound) return;
  peekBound = true;
  const end = () => document.documentElement.removeAttribute('data-nv-peek');
  document.addEventListener('pointerdown', (event) => {
    if (!nightVisionOn()) return;
    if ((event.target as Element | null)?.closest?.('img, .cclock')) document.documentElement.setAttribute('data-nv-peek', '');
  });
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}
