/**
 * The small "i" buttons scattered through the panel, and the one popover they
 * all share.
 *
 * A popover per button, positioned relative to it, would be clipped the
 * moment its trigger sat inside `.panel-body` — that element scrolls its own
 * overflow, and everything past its edge is cut rather than shown. Fixed to
 * the viewport and repositioned on open, this one is never inside anything
 * that could clip it.
 */

import { $ } from './dom';

const MARGIN = 8;

export function createInfoTips(): void {
  const pop = $<HTMLElement>('infotip-pop');
  const text = $<HTMLElement>('infotip-pop-text');
  let openButton: HTMLButtonElement | null = null;

  function close(): void {
    if (!openButton) return;
    pop.classList.remove('is-open');
    openButton.setAttribute('aria-expanded', 'false');
    openButton = null;
  }

  function place(button: HTMLButtonElement): void {
    const trigger = button.getBoundingClientRect();
    // Safe to measure without showing it first — the popover is always in the
    // document now, just faded to nothing, so it has real dimensions here
    // rather than the point `display: none` would have collapsed it to.
    const { width, height } = pop.getBoundingClientRect();

    let left = trigger.left + trigger.width / 2 - width / 2;
    left = Math.min(Math.max(left, MARGIN), window.innerWidth - width - MARGIN);

    // Below the button by default, above it if that would run off the bottom
    // of the screen — most triggers sit in a panel anchored to the top, so the
    // common case is room below and the flip is for the rows near its foot.
    let top = trigger.bottom + MARGIN;
    if (top + height > window.innerHeight - MARGIN) top = trigger.top - height - MARGIN;
    top = Math.max(MARGIN, top);

    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  function open(button: HTMLButtonElement): void {
    text.textContent = button.dataset.tip ?? '';
    button.setAttribute('aria-expanded', 'true');
    openButton = button;
    place(button);
    pop.classList.add('is-open');
  }

  document.querySelectorAll<HTMLButtonElement>('.infotip').forEach((button) => {
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', (event) => {
      // Bubbling to the document-level listener below would immediately close
      // what this click just opened.
      event.stopPropagation();
      if (openButton === button) close();
      else open(button);
    });
  });

  // Anything else — the map, another control, the button that opened this one
  // toggling shut on its own — counts as "somewhere else" and closes it.
  document.addEventListener('click', () => close());
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') close();
    },
    true,
  );
  // A scroll or a resize invalidates the position this was placed at; closing
  // is simpler than re-tracking a button that may itself have moved off-screen.
  window.addEventListener('resize', () => close());
  $<HTMLElement>('panel-body').addEventListener('scroll', () => close());
}
