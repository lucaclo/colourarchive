// The large page title that folds into a compact bar as the page scrolls.
//
// `.page-head` is sticky with a negative `top`: it scrolls up by exactly the
// difference between its full height and the bar's, then holds, so the strip
// that stays is the bottom of the header, where the title's baseline and the
// page's actions sit. A scroll timeline shrinks the title into that strip and
// fades the glass in behind it (global.css › Page head). This only measures
// the travel, which depends on the title's wrapped height.
//
// Without scroll-driven animations (Firefox today) the header is left to
// scroll away as an ordinary block, since a frozen full-size title clipped
// at the top would be worse than none.

export function startPageHeads() {
  const heads = document.querySelectorAll<HTMLElement>('.page-head');
  if (!heads.length) return;
  if (!CSS.supports('animation-timeline: scroll()') || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    heads.forEach((h) => h.classList.add('ph-static'));
    return;
  }
  const measure = (h: HTMLElement) => {
    const bar = parseFloat(getComputedStyle(h).getPropertyValue('--ph-bar-px')) || 56;
    h.style.setProperty('--ph-travel', `${Math.max(0, h.offsetHeight - bar)}px`);
  };
  const ro = new ResizeObserver((es) => es.forEach((e) => measure(e.target as HTMLElement)));
  heads.forEach((h) => { measure(h); ro.observe(h); });
}
