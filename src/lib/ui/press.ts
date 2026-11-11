// Press feedback for every tappable thing in the app, in one place.
//
// It used to be some sixty `:active { transform: scale(…) }` rules spread over
// sixteen files, each with its own depth (0.88 to 0.995) and timing, and a
// good many controls had none at all. They also fought: a rule like
// `.lb-nav:active { transform: scale(0.92) }` replaced the button's own
// `translateY(-50%)`, so the viewer's arrows jumped down on every press.
//
// This drives the independent `scale` property through the Web Animations
// API instead. `scale` composes with any `transform` already on the element,
// and an animation is untouched by whatever `transition` shorthand the
// element's own stylesheet declares, which would otherwise swallow a CSS
// transition on release. Down is quick and plain; the let-go plays
// --spring-press, a loose spring with a small overshoot, so a tap reads as
// something that gave and came back.

const PRESSABLE = [
  'button:not(:disabled)',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="radio"]',
  '[role="option"]',
  '[role="menuitem"]',
  'label:has(> input[type="checkbox"], > input[type="radio"])',
].join(',');

// Things that already answer a press in their own way, or that a finger
// drags rather than taps: photographs in the archive (they fly into the
// viewer), anything on the map canvas, sliders, and long text links in prose.
const EXEMPT = '[data-no-press], .frame, .maplibregl-map *, input[type="range"], .cs-seg, .spectrum-seg, p a, li > a:only-child:not([class])';

const reduce = matchMedia('(prefers-reduced-motion: reduce)');

function curve(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// How far it gives depends on how big it is: a 36px icon button can sink
// visibly, a full-width list row only a breath, or the whole row would
// appear to lurch.
function depth(el: Element): number {
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height);
  if (size < 64) return 0.9;
  if (size < 200) return 0.96;
  if (size < 420) return 0.98;
  return 0.992;
}

const held = new WeakMap<Element, Animation>();

function down(el: Element) {
  if (reduce.matches) return;
  const to = depth(el);
  held.get(el)?.cancel();
  const a = el.animate([{ scale: '1' }, { scale: String(to) }], { duration: 90, easing: 'cubic-bezier(0.2, 0, 0.4, 1)', fill: 'forwards' });
  held.set(el, a);
}

function up(el: Element) {
  const a = held.get(el);
  if (!a) return;
  held.delete(el);
  const from = getComputedStyle(el).scale;
  a.cancel();
  if (reduce.matches || from === 'none') return;
  el.animate([{ scale: from }, { scale: '1' }], { duration: 420, easing: curve('--spring-press', 'ease-out') });
}

function target(e: Event): Element | null {
  const t = e.target instanceof Element ? e.target.closest(PRESSABLE) : null;
  if (!t || t.closest(EXEMPT)) return null;
  return t;
}

export function startPress() {
  let current: Element | null = null;
  const release = () => {
    if (current) up(current);
    current = null;
  };
  addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const t = target(e);
    if (!t) return;
    current = t;
    down(t);
  }, { passive: true });
  addEventListener('pointerup', release, { passive: true });
  addEventListener('pointercancel', release, { passive: true });
  // A drag that leaves the control is not a tap any more.
  addEventListener('pointerout', (e) => {
    if (current && e.target === current && !current.contains(e.relatedTarget as Node | null)) release();
  }, { passive: true });
  // Keyboard presses get the same answer, so a Space on a focused button
  // looks like a tap.
  addEventListener('keydown', (e) => {
    if ((e.key !== ' ' && e.key !== 'Enter') || e.repeat) return;
    const t = target(e);
    if (!t || t.matches('input, textarea, select')) return;
    current = t;
    down(t);
  });
  addEventListener('keyup', release);
  addEventListener('blur', release);
}
