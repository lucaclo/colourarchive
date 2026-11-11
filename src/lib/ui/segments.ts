// The gliding thumb behind every segmented control.
//
// There are seven of them (archive medium, book view, upload order, zine
// pages and paper, the cards' units and paper, Inspiration's group-by,
// Scout's 2D/3D) and each marked its choice its own way: aria-pressed,
// aria-checked, an `.on` class, or a checked radio inside a label. The
// selected background used to snap from one segment to the next. Here one
// `.seg-thumb` per control slides to whichever child is chosen, on the same
// spring as the tab bar's pill, so a change of choice shows where it went.
//
// Mark a control with `data-seg`. Pages keep setting their own state exactly
// as before; this only watches it. `data-seg="line"` draws the thumb as an
// underline instead (tab strips, Scout's tiles), and for that a row of
// disclosure buttons counts too: the expanded one is the chosen one.

const CHOSEN = ':scope > :is([aria-pressed="true"], [aria-checked="true"], [aria-selected="true"], [aria-expanded="true"], .on, :has(> input:checked))';

function place(seg: HTMLElement, thumb: HTMLElement) {
  const on = seg.querySelector<HTMLElement>(CHOSEN);
  if (!on || on.offsetParent === null) {
    thumb.style.opacity = '0';
    return;
  }
  // offsetLeft/Top are relative to the control (it is the positioned
  // ancestor), and unaffected by the press `scale`, so a thumb placed
  // mid-press doesn't land shrunk.
  thumb.style.opacity = '1';
  thumb.style.width = `${on.offsetWidth}px`;
  thumb.style.height = `${on.offsetHeight}px`;
  thumb.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
}

function wire(seg: HTMLElement) {
  if (seg.dataset.segWired) return;
  seg.dataset.segWired = '1';
  const thumb = document.createElement('span');
  thumb.className = 'seg-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  // Out of the flow even if the stylesheet that says so is late or stale;
  // as a flex item it would be an empty segment of its own.
  thumb.style.position = 'absolute';
  seg.prepend(thumb);
  place(seg, thumb);
  // First placement without motion; after that, every change glides.
  requestAnimationFrame(() => requestAnimationFrame(() => seg.classList.add('seg-ready')));
  const update = () => place(seg, thumb);
  new MutationObserver(update).observe(seg, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-expanded', 'class', 'hidden'] });
  seg.addEventListener('change', update);
  new ResizeObserver(update).observe(seg);
}

export function startSegments() {
  const scan = (root: ParentNode) => root.querySelectorAll<HTMLElement>('[data-seg]').forEach(wire);
  scan(document);
  // Some controls are built after load (the zine's edit panel, Scout's
  // sheets); pick them up as they arrive.
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (!(n instanceof HTMLElement)) continue;
      if (n.matches('[data-seg]')) wire(n);
      scan(n);
    }
  }).observe(document.body, { childList: true, subtree: true });
  // Web fonts change segment widths once they land.
  document.fonts?.ready.then(() => document.querySelectorAll<HTMLElement>('[data-seg]').forEach((s) => {
    const t = s.querySelector<HTMLElement>(':scope > .seg-thumb');
    if (t) place(s, t);
  }));
}
