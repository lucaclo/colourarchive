/**
 * The glossary sheet (issue #159): a native `<dialog>`, so Escape, focus
 * trapping and the backdrop come from the browser rather than from here.
 * Opened from the About fold, from ⌘K, and from any infotip whose word has
 * an entry, in which case it lands on that entry.
 */

import { $ } from './dom';

export function createGlossary(): { open: (termId?: string) => void } {
  const dialog = $<HTMLDialogElement>('glossary');
  const body = $<HTMLElement>('glossary-body');

  function open(termId?: string): void {
    if (!dialog.open) dialog.showModal();
    body.querySelector('.glossary-entry.is-target')?.classList.remove('is-target');
    const entry = termId ? document.getElementById(`term-${termId}`) : null;
    if (entry) {
      entry.classList.add('is-target');
      entry.scrollIntoView({ block: 'center' });
    } else {
      body.scrollTop = 0;
    }
  }

  $('glossary-close').addEventListener('click', () => dialog.close());
  // A click on the backdrop lands on the dialog element itself, outside its box.
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) dialog.close();
  });
  $('glossary-open').addEventListener('click', () => open());
  return { open };
}
