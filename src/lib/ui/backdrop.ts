// A press on a modal sheet's backdrop closes it, for every
// `<dialog data-backdrop-close>` (Feedback, Updates, the Book's survey).
//
// Each sheet used to close on `click` with `e.target === dialog`. That also
// fired when a press began inside and ended outside, such as selecting the note's
// text and letting go past the edge: the click goes to the nearest common
// ancestor, which is the dialog, and the draft vanished. Now the press must
// start and end outside the sheet's box, and start after it opened. Works by
// attribute, like modal.ts, because the survey's script is inline.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Outside the sheet's box: on its backdrop. The edge counts as the sheet. */
export function outsideBox(x: number, y: number, box: Box): boolean {
  return x < box.left || x > box.right || y < box.top || y > box.bottom;
}

const onBackdrop = (e: MouseEvent, dlg: HTMLDialogElement) =>
  e.target === dlg && outsideBox(e.clientX, e.clientY, dlg.getBoundingClientRect());

export function startBackdrops() {
  let pressed: HTMLDialogElement | null = null;
  const sheet = (e: Event) => {
    const t = e.target;
    return t instanceof HTMLDialogElement && t.open && t.hasAttribute('data-backdrop-close') ? t : null;
  };
  document.addEventListener('pointerdown', (e) => {
    const dlg = sheet(e);
    pressed = dlg && onBackdrop(e, dlg) ? dlg : null;
  }, true);
  document.addEventListener('click', (e) => {
    const dlg = sheet(e);
    const was = pressed;
    pressed = null;
    if (dlg && was === dlg && onBackdrop(e, dlg)) dlg.close();
  }, true);
}
