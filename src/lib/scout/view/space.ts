/**
 * The space round the globe: a galaxy painted behind the map.
 *
 * MapLibre leaves its canvas transparent outside the globe, so whatever sits
 * behind #map shows there and nowhere else. Zoomed in, the map (or its sky,
 * once pitched) covers it all and this is never seen.
 *
 * Painted, not photographed: one seeded pass, so the sky is the same on every
 * visit and on every device. Kept spare, the way the night sky actually looks
 * away from a long exposure: near-black, a faint neutral Milky Way with a
 * barely warm core and soft dust lanes, and fine stars, mostly faint and
 * white, that thicken slightly towards the band.
 * Decorative only; Milky Way mode's real sky is the catalogue one in stars.ts
 * and galactic.ts.
 */

/** mulberry32: small, fast, and the same numbers everywhere for one seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A roughly normal number, by summing uniforms. */
const gauss = (rnd: () => number) => (rnd() + rnd() + rnd() + rnd() - 2) / 2;

export interface Star { x: number; y: number; r: number; a: number; tint: string }

/** The band runs corner to corner, lower left to upper right. */
function band(w: number, h: number) {
  const angle = Math.atan2(-h * 0.62, w);
  return { cx: w * 0.5, cy: h * 0.52, dx: Math.cos(angle), dy: Math.sin(angle), len: Math.hypot(w, h), width: Math.min(w, h) * 0.2 };
}

/** Distance of a point from the band's centre line, in band widths. */
export function bandDistance(x: number, y: number, w: number, h: number): number {
  const b = band(w, h);
  return Math.abs((x - b.cx) * -b.dy + (y - b.cy) * b.dx) / b.width;
}

/**
 * The stars for a w×h sky. Two populations: a scatter over the whole sky,
 * and a crowd along the band, so the Milky Way reads as stars, not haze.
 */
export function starsFor(w: number, h: number, seed = 7): Star[] {
  const rnd = seeded(seed);
  const b = band(w, h);
  const area = w * h;
  const out: Star[] = [];
  // Real stars are white to the eye; only a few lean blue or warm.
  const tints = ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#e8eeff', '#fff4e6'];
  const add = (x: number, y: number) => {
    // Most stars are faint; a very few are bright. A steep power law, as in
    // the real sky.
    const m = rnd() ** 7;
    out.push({ x, y, r: 0.3 + m * 1.35, a: 0.18 + m * 0.8, tint: tints[Math.floor(rnd() * tints.length)] });
  };
  for (let i = 0, n = Math.round(area / 1100); i < n; i++) add(rnd() * w, rnd() * h);
  for (let i = 0, n = Math.round(area / 1600); i < n; i++) {
    const t = (rnd() - 0.5) * b.len;
    const o = gauss(rnd) * b.width * 0.9;
    add(b.cx + b.dx * t - b.dy * o, b.cy + b.dy * t + b.dx * o);
  }
  return out;
}

/**
 * Everything soft: deep space, nebulae, the band and its dust. Hundreds of
 * faint gradients stacked at full resolution band into visible lines, so
 * this is painted small and stretched and blurred by CSS (see mountSpace),
 * which also costs a fraction as much.
 */
function paintHaze(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const rnd = seeded(11);
  const b = band(w, h);

  // Deep space: near-black, flat, with the faintest lift towards the middle.
  const bg = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.7);
  bg.addColorStop(0, '#07080b');
  bg.addColorStop(1, '#020203');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // The band: soft neutral clouds along the line, barely warmer at the core.
  ctx.globalCompositeOperation = 'lighter';
  const blob = (x: number, y: number, r: number, col: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (let i = 0; i < 420; i++) {
    const t = (rnd() - 0.5) * b.len;
    const core = Math.exp(-((t / (b.len * 0.2)) ** 2));
    const o = gauss(rnd) * b.width * (0.5 + core * 0.25);
    const x = b.cx + b.dx * t - b.dy * o;
    const y = b.cy + b.dy * t + b.dx * o;
    const r = b.width * (0.25 + rnd() * 0.4);
    blob(x, y, r, core > 0.5 && rnd() < core ? `rgba(235,222,205,${0.016 + core * 0.012})` : 'rgba(205,210,220,0.014)');
  }

  // Dust lanes: dark, broken threads along the middle of the band.
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 260; i++) {
    const t = (rnd() - 0.5) * b.len * 0.9;
    const o = (Math.sin(t / (b.width * 1.7)) * 0.18 + gauss(rnd) * 0.12) * b.width;
    const x = b.cx + b.dx * t - b.dy * o;
    const y = b.cy + b.dy * t + b.dx * o;
    blob(x, y, b.width * (0.08 + rnd() * 0.16), 'rgba(2,2,4,0.12)');
  }

  ctx.globalCompositeOperation = 'source-over';
}

/** Stars, sharp and at full resolution, over a transparent canvas. */
function paintStars(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  for (const s of starsFor(w, h)) {
    if (s.r > 1.4) {
      // The brightest few get a soft glow that fades out, not a disc.
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 3.2);
      g.addColorStop(0, s.tint);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = s.a * 0.3;
      ctx.fillStyle = g;
      ctx.fillRect(s.x - s.r * 3.2, s.y - s.r * 3.2, s.r * 6.4, s.r * 6.4);
    }
    ctx.globalAlpha = s.a;
    ctx.fillStyle = s.tint;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Whether the globe covers the whole view, so none of the space round it can
 * be seen. MapLibre's globe is a sphere whose circumference is the world's
 * width at this zoom (512 × 2^zoom px), so its diameter is that over π; it
 * covers a centred view once that reaches the view's diagonal.
 */
export function globeFillsView(zoom: number, width: number, height: number): boolean {
  return (512 * 2 ** zoom) / Math.PI >= Math.hypot(width, height) * 1.05;
}

export interface SpaceView {
  /** Paint when it can be seen; let go of the canvases' memory when it can't. */
  setVisible(visible: boolean): void;
}

/** How much smaller the haze is painted than it shows. */
const HAZE_SCALE = 6;

/**
 * Paint the galaxy into two canvases that fill the same box: the haze, small
 * and stretched by CSS (where a blur smooths the faint gradients' banding,
 * in every browser), and the stars, sharp, on top. Again on resize.
 *
 * A full-screen star canvas at a big iPad's pixel density holds over 20 MB,
 * all of it hidden once a place fills the screen, so while it can't be seen
 * both canvases are shrunk to nothing (which frees them) and are repainted,
 * in a few milliseconds, when the globe comes back into view.
 */
export function mountSpace(haze: HTMLCanvasElement, stars: HTMLCanvasElement): SpaceView {
  let visible = true;
  const draw = () => {
    if (!visible) return;
    const w = stars.clientWidth;
    const h = stars.clientHeight;
    if (!w || !h) return;
    haze.width = Math.max(1, Math.ceil(w / HAZE_SCALE));
    haze.height = Math.max(1, Math.ceil(h / HAZE_SCALE));
    const hctx = haze.getContext('2d');
    if (hctx) {
      hctx.setTransform(1 / HAZE_SCALE, 0, 0, 1 / HAZE_SCALE, 0, 0);
      paintHaze(hctx, w, h);
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    stars.width = Math.round(w * dpr);
    stars.height = Math.round(h * dpr);
    const sctx = stars.getContext('2d');
    if (sctx) {
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintStars(sctx, w, h);
    }
  };
  let timer = 0;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(draw, 120);
  }).observe(stars);
  draw();
  return {
    setVisible(next) {
      if (next === visible) return;
      visible = next;
      if (next) draw();
      else for (const c of [haze, stars]) c.width = c.height = 0;
    },
  };
}
