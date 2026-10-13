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
 * picked, and gone the moment one is. (The "unread" dots it used to put on
 * every fold were retired in the round-3 declutter: thirteen orange dots read
 * as thirteen alerts.)
 */

import { $ } from './dom';

const SEEN_KEY = 'scout-orientation-seen';

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
  // The orientation card is retired: the page keeps text to the essentials,
  // and the search hint already says how to start. Kept as a no-op so the
  // callers that dismiss it need no change.
  void seen;

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

  return { dismiss };
}
