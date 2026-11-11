// Full-screen overlays that open by un-hiding a div: move focus in, keep it
// there, and give it back on close.
//
// Inspiration's enlarge view, its split view and Match each cover the whole
// page, but focus stayed on the board behind them: VoiceOver kept reading
// pictures you could no longer see, Tab walked off into the hidden page, and
// closing dropped focus at the top of the document. Two of the three are
// opened from an inline script that can't import anything, so this works by
// attribute instead of by call: mark the element `data-modal` (with
// role="dialog", aria-modal and a label) and toggling its `hidden` does the
// rest.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const stack: { el: HTMLElement; back: Element | null }[] = [];

function focusables(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.checkVisibility?.() ?? n.offsetParent !== null);
}

function opened(el: HTMLElement) {
  if (stack.some((s) => s.el === el)) return;
  stack.push({ el, back: document.activeElement });
  // After the entrance has had a frame to lay out, so the first control is
  // focusable (and visible) when focus lands on it.
  requestAnimationFrame(() => {
    if (el.hidden || el.contains(document.activeElement)) return;
    const first = focusables(el)[0];
    if (first) first.focus({ preventScroll: true });
    else {
      el.tabIndex = -1;
      el.focus({ preventScroll: true });
    }
  });
}

function closed(el: HTMLElement) {
  const i = stack.findIndex((s) => s.el === el);
  if (i < 0) return;
  const [{ back }] = stack.splice(i, 1);
  // Back to whatever opened it, if that is still on the page and reachable.
  if (back instanceof HTMLElement && back.isConnected && !back.closest('[hidden]')) back.focus({ preventScroll: true });
}

export function startModals() {
  const sync = (el: HTMLElement) => (el.hidden ? closed(el) : opened(el));
  new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target as HTMLElement;
      if (el.matches('[data-modal]')) sync(el);
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  for (const el of document.querySelectorAll<HTMLElement>('[data-modal]:not([hidden])')) opened(el);

  // Tab and Shift-Tab wrap inside the topmost open overlay.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !stack.length) return;
    const { el } = stack[stack.length - 1];
    if (el.hidden) return;
    const items = focusables(el);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!el.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
