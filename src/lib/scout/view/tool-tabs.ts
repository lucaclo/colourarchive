/**
 * The Camera group's five tools behind one fold, one shown at a time.
 *
 * Each tool is still its own `<details>` (its summary hidden by CSS), so the
 * page's code that opens a fold, checks `.open` or listens for `toggle` keeps
 * working. This only keeps exactly one of them open, mirrors that in the tab
 * row, and opens the Tools fold whenever one of its tools is opened from
 * elsewhere (⌘K, a link across from Layers).
 */

import { $ } from './dom';

const KEY = 'scout.tool';

export interface ToolTabsPorts {
  /** Bring the Camera group into view: open it and the sheet, then scroll to `el`. */
  reveal(el: HTMLElement): void;
}

export function initToolTabs(ports: ToolTabsPorts): void {
  const wrapper = $<HTMLDetailsElement>('fold-tools');
  const tabs = [...$('tool-tabs').querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const paneOf = (tab: HTMLButtonElement) => $<HTMLDetailsElement>(tab.dataset.fold!);
  const panes = tabs.map(paneOf);

  let current = readSaved() ?? panes[0].id;
  if (!panes.some((p) => p.id === current)) current = panes[0].id;

  function sync() {
    for (const tab of tabs) {
      const on = tab.dataset.fold === current;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
  }

  function select(id: string) {
    current = id;
    for (const pane of panes) {
      const want = pane.id === id && wrapper.open;
      if (pane.open !== want) pane.open = want;
    }
    sync();
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* a private window: the choice lasts this visit */
    }
  }

  // The panes open only with the fold, so a closed Tools fold costs the page
  // nothing: the stack and the core nights work only while theirs is open.
  wrapper.addEventListener('toggle', () => select(current));

  for (const pane of panes) {
    pane.addEventListener('toggle', () => {
      if (!pane.open) return;
      // Opened from elsewhere: it becomes the tool, and the fold opens round it.
      if (!wrapper.open) wrapper.open = true;
      if (current !== pane.id) select(pane.id);
      else for (const other of panes) if (other !== pane && other.open) other.open = false;
    });
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      // From ⌘K the fold may be shut and out of sight; open it and go there.
      const fromOutside = !wrapper.open || tab.checkVisibility?.() === false;
      wrapper.open = true;
      select(tab.dataset.fold!);
      if (fromOutside) ports.reveal(wrapper);
    });
    // Arrow keys move along the row, as a tab list does.
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      const jump = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (!step && jump < 0) return;
      event.preventDefault();
      const next = tabs[jump >= 0 ? jump : (i + step + tabs.length) % tabs.length];
      next.focus();
      select(next.dataset.fold!);
    });
  });

  select(current);
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
