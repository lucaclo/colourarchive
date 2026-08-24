/**
 * First-visit orientation for the panel's 13 folds.
 *
 * `infotip.ts` already solves "what does this number mean" once you're
 * looking at a panel — this solves the different problem of not knowing a
 * panel exists at all. The only orientation before a place is picked used to
 * be one line saying to type a place; nothing said what Scout could answer
 * once one was.
 *
 * Given the project's preference for precision over hand-holding, not a
 * tour: a single dismissible line, reusing the infotip popover's own visual
 * language, shown once — ever, via `localStorage` — before a place is
 * picked, and gone the moment one is. Session-scoped (`sessionStorage`, so a
 * closed tab starts fresh) alongside it: an "unread" dot on any of the 13
 * folds this session hasn't opened yet.
 */

import { $ } from './dom';

const SEEN_KEY = 'scout-orientation-seen';
const OPENED_KEY = 'scout-opened-folds';

export interface FirstVisitOrientation {
  /** Dismiss the orientation line — called once a place is picked, from
   *  whichever of the two paths that happens through. A no-op once it is
   *  already dismissed. */
  dismiss(): void;
}

export function createFirstVisitOrientation(): FirstVisitOrientation {
  const el = $<HTMLElement>('first-visit');
  const closeBtn = $<HTMLButtonElement>('first-visit-close');

  let seen = false;
  try {
    seen = localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // Private browsing or storage disabled — treat every visit as first
    // rather than throwing on what is meant to be a quiet courtesy line.
  }
  if (!seen) el.hidden = false;

  function dismiss(): void {
    if (el.hidden) return;
    el.hidden = true;
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Nothing to persist to — it will simply show again next visit.
    }
  }
  closeBtn.addEventListener('click', dismiss);

  let opened = new Set<string>();
  try {
    const raw = sessionStorage.getItem(OPENED_KEY);
    if (raw) opened = new Set(JSON.parse(raw) as string[]);
  } catch {
    // Start with nothing marked read rather than fail the whole page over it.
  }
  document.querySelectorAll<HTMLDetailsElement>('.fold').forEach((fold) => {
    if (!opened.has(fold.id)) fold.classList.add('unread');
    fold.addEventListener('toggle', () => {
      if (!fold.open || opened.has(fold.id)) return;
      opened.add(fold.id);
      fold.classList.remove('unread');
      try {
        sessionStorage.setItem(OPENED_KEY, JSON.stringify([...opened]));
      } catch {
        // Session-only convenience — dropping the write just means the dot
        // reappears next reload, not a broken feature.
      }
    });
  });

  return { dismiss };
}
