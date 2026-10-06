/**
 * Draws the zine onto a canvas: one page, one spread, or the whole printed
 * sheet. Thumbnails, the editing stage, the preview and the 300 DPI export
 * all use this code, so what you see is what prints.
 *
 * Sizes are in units of one-hundredth of a page's width, so a page reads the
 * same at 120px on screen as at 870px in print.
 */
import { panelRect, isFlipped, SPREADS, COVER_PANEL, BACK_PANEL, type Spread } from './imposition';
import { fontOf, inkOf, toneOf, type ZineDoc, type PageDoc, type CoverDoc, type MergeDoc, type PhotoRef, type TextStyle, type FrameStyle, type Tone } from './doc';

type Ctx = CanvasRenderingContext2D;

export interface RenderOpts {
  /** A loaded image for this photo, or null while it is still loading. */
  image: (ref: PhotoRef) => CanvasImageSource | null;
  /** Editor hints (empty-page prompts, a ghost title). Never printed. */
  hints: boolean;
}

const PAPER_TONE = toneOf('white').hex;
const NIGHT = '#151413';
const HINT = 'rgba(40, 36, 30, 0.38)';

// ── Geometry ────────────────────────────────────────────────────────────────

/** How a photo covers a box, and how far it can pan in each direction. */
export function coverGeometry(imgW: number, imgH: number, boxW: number, boxH: number) {
  const scale = Math.max(boxW / imgW, boxH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { w, h, overflowX: w - boxW, overflowY: h - boxH };
}

/** The paper border on each side, in px, for a page `u` units to the hundredth. */
export function frameInsets(f: FrameStyle, u: number) {
  const b = { none: 0, thin: 3.5, m: 8, wide: 14 }[f.border] * u;
  if (!b) return { t: 0, r: 0, b: 0, l: 0 };
  if (f.frame === 'polaroid') return { t: b, r: b, b: b * 2.8, l: b };
  if (f.frame === 'letterbox') return { t: b * 1.6, r: 0, b: b * 1.6, l: 0 };
  if (f.frame === 'pillar') return { t: 0, r: b * 1.4, b: 0, l: b * 1.4 };
  return { t: b, r: b, b, l: b };
}

/** Where the photo goes once the border is taken off. */
export function photoBox(f: FrameStyle, x: number, y: number, w: number, h: number, u: number) {
  const i = frameInsets(f, u);
  return { x: x + i.l, y: y + i.t, w: Math.max(1, w - i.l - i.r), h: Math.max(1, h - i.t - i.b) };
}

/** A thin line round the photo, in whatever reads against the paper. */
function keyline(ctx: Ctx, f: FrameStyle, x: number, y: number, w: number, h: number, u: number) {
  if (f.rule !== 'line') return;
  ctx.save();
  ctx.strokeStyle = toneOf(f.tone).dark ? 'rgba(255,255,255,0.75)' : 'rgba(20,19,18,0.85)';
  ctx.lineWidth = Math.max(1, u * 0.3);
  const o = ctx.lineWidth * 1.5;
  ctx.strokeRect(x - o, y - o, w + o * 2, h + o * 2);
  ctx.restore();
}

function drawCover(ctx: Ctx, img: CanvasImageSource, ref: PhotoRef, x: number, y: number, w: number, h: number) {
  const g = coverGeometry(ref.w, ref.h, w, h);
  const dx = x - g.overflowX / 2 - (ref.panX * g.overflowX) / 2;
  const dy = y - g.overflowY / 2 - (ref.panY * g.overflowY) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, dx, dy, g.w, g.h);
  ctx.restore();
}

/** Contain a photo in a box; returns where it landed, for the keyline. */
function containRect(ref: PhotoRef, x: number, y: number, w: number, h: number) {
  const scale = Math.min(w / ref.w, h / ref.h);
  const dw = ref.w * scale;
  const dh = ref.h * scale;
  return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
}

// ── Text ───────────────────────────────────────────────────────────────────

function font(doc: ZineDoc, px: number, weight?: number) {
  const f = fontOf(doc.font);
  return `${f.style} ${weight ?? f.weight} ${px}px ${f.family}`;
}

function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxW) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

interface Line { text: string; font: string; px: number; gapAfter: number; track?: number }

function setTrack(ctx: Ctx, px: number) {
  if ('letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** Where the text is going: over a photo, or on paper of a given colour. */
type Ground = { photo: true } | { photo: false; tone: Tone };

/** White on white paper or black on black can't be read; flip those. */
function inkHex(style: TextStyle, ground: Ground) {
  const ink = inkOf(style.ink);
  if (!ground.photo) {
    const dark = toneOf(ground.tone).dark;
    if (style.ink === 'white' && !dark) return inkOf('black').hex;
    if (style.ink === 'black' && dark) return inkOf('white').hex;
  }
  return ink.hex;
}

/**
 * Lay a block of lines into a box by the style's alignment, and draw it.
 * `band` is the horizontal extent a full-width band behind the text runs to.
 */
function drawBlock(ctx: Ctx, lines: Line[], style: TextStyle, x: number, y: number, w: number, h: number, ground: Ground, band = { x, w }) {
  if (!lines.length) return;
  const total = lines.reduce((s, l) => s + l.px * 1.12 + l.gapAfter, 0) - (lines.at(-1)?.gapAfter ?? 0);
  let cy = style.valign === 'top' ? y : style.valign === 'bottom' ? y + h - total : y + (h - total) / 2;
  const ax = style.align === 'left' ? x : style.align === 'right' ? x + w : x + w / 2;
  const fill = inkHex(style, ground);
  const light = fill === inkOf('white').hex || (fill === inkOf(style.ink).hex && inkOf(style.ink).light);
  ctx.save();
  ctx.textAlign = style.align === 'center' ? 'center' : style.align;
  ctx.textBaseline = 'top';

  if (style.plate !== 'none') {
    // A plate in the opposite of the ink, so the text reads on any photo.
    const pad = lines[0].px * 0.55;
    let left = band.x;
    let width = band.w;
    if (style.plate === 'box') {
      const widest = Math.max(...lines.map((l) => { ctx.font = l.font; setTrack(ctx, l.track ?? 0); return ctx.measureText(l.text).width; }));
      setTrack(ctx, 0);
      left = (style.align === 'left' ? ax : style.align === 'right' ? ax - widest : ax - widest / 2) - pad;
      width = widest + pad * 2;
    }
    ctx.fillStyle = light ? 'rgba(20,19,18,0.82)' : 'rgba(251,250,246,0.9)';
    ctx.fillRect(left, cy - pad * 0.8, width, total + pad * 1.6);
  } else if (ground.photo && light) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = lines[0].px * 0.35;
  }
  ctx.fillStyle = fill;
  for (const l of lines) {
    ctx.font = l.font;
    setTrack(ctx, l.track ?? 0);
    ctx.fillText(l.text, ax, cy);
    setTrack(ctx, 0);
    cy += l.px * 1.12 + l.gapAfter;
  }
  ctx.restore();
}

const CAPTION_PX = { xs: 2.6, s: 3.3, m: 4.3, l: 5.6, xl: 7.4 } as const;
const TITLE_CAP = { xs: 8, s: 11, m: 15, l: 20, xl: 26 } as const;

function captionLines(ctx: Ctx, doc: ZineDoc, text: string, style: TextStyle, u: number, maxW: number): Line[] {
  const px = CAPTION_PX[style.size] * u;
  const id = fontOf(doc.font).id;
  const f = font(doc, px, id.startsWith('serif') ? 500 : id === 'sans-light' ? 300 : 400);
  const upper = style.case === 'upper';
  const track = upper ? px * 0.08 : 0;
  ctx.font = f;
  setTrack(ctx, track);
  const rows = wrap(ctx, upper ? text.trim().toUpperCase() : text.trim(), maxW);
  setTrack(ctx, 0);
  return rows.map((t) => ({ text: t, font: f, px, gapAfter: px * 0.15, track }));
}

// ── Pages ──────────────────────────────────────────────────────────────────

function emptyHint(ctx: Ctx, x: number, y: number, w: number, h: number, u: number, label: string) {
  ctx.save();
  ctx.strokeStyle = HINT;
  ctx.setLineDash([u * 1.4, u * 1.2]);
  ctx.lineWidth = Math.max(1, u * 0.25);
  const m = u * 7;
  ctx.strokeRect(x + m, y + m, w - m * 2, h - m * 2);
  ctx.fillStyle = HINT;
  ctx.font = `italic 500 ${u * 5}px Fraunces, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.restore();
}

/**
 * An inside page: a photo inside its paper border, fitted or filling, and a
 * caption. A fitted photo's caption gets its own band above or below the
 * picture, the way a print is captioned on the mount, unless it's set to sit
 * in the middle; a filling photo's caption sits on the picture.
 */
function drawInner(ctx: Ctx, doc: ZineDoc, page: PageDoc, x: number, y: number, w: number, h: number, o: RenderOpts) {
  const u = w / 100;
  ctx.fillStyle = toneOf(page.tone).hex;
  ctx.fillRect(x, y, w, h);
  const img = page.photo && o.image(page.photo);
  const ins = frameInsets(page, u);
  const box = photoBox(page, x, y, w, h, u);
  const paper: Ground = { photo: false, tone: page.tone };

  if (page.photo && page.fit === 'fill') {
    if (img) drawCover(ctx, img, page.photo, box.x, box.y, box.w, box.h);
    keyline(ctx, page, box.x, box.y, box.w, box.h, u);
    const m = u * 8;
    const caption = page.caption.trim() ? captionLines(ctx, doc, page.caption, page, u, box.w - m * 2) : [];
    drawBlock(ctx, caption, page, box.x + m, box.y + m, box.w - m * 2, box.h - m * 2, { photo: true }, { x: box.x, w: box.w });
    return;
  }

  // Text never comes closer to the paper's edge than this, border or not.
  const safe = u * 6;
  const tx = x + Math.max(ins.l, safe);
  const tw = w - Math.max(ins.l, safe) - Math.max(ins.r, safe);
  const caption = page.caption.trim() ? captionLines(ctx, doc, page.caption, page, u, tw) : [];
  const capH = caption.reduce((s, l) => s + l.px * 1.12 + l.gapAfter, 0);
  const banded = caption.length > 0 && page.valign !== 'middle';
  const edge = page.valign === 'top' ? ins.t : ins.b;
  const band = banded ? capH + u * 4 + Math.max(0, safe - edge) : 0;
  const area = { ...box, y: box.y + (page.valign === 'top' ? band : 0), h: Math.max(1, box.h - band) };

  if (page.photo) {
    const r = containRect(page.photo, area.x, area.y, area.w, area.h);
    if (img) ctx.drawImage(img, r.x, r.y, r.w, r.h);
    keyline(ctx, page, r.x, r.y, r.w, r.h, u);
  } else if (o.hints) {
    emptyHint(ctx, x, y, w, h, u, 'Drop a photo');
  }
  if (caption.length) {
    const ty = y + Math.max(ins.t, safe);
    const th = h - Math.max(ins.t, safe) - Math.max(ins.b, safe);
    const over = Boolean(page.photo) && !banded;
    drawBlock(ctx, caption, page, tx, ty, tw, th, over ? { photo: true } : paper, { x, w });
  }
}

/** The cover or back cover: a full-bleed photo, a wash, and the masthead. */
function drawCoverPage(ctx: Ctx, doc: ZineDoc, page: PageDoc, text: CoverDoc, front: boolean, x: number, y: number, w: number, h: number, o: RenderOpts) {
  const u = w / 100;
  const img = page.photo && o.image(page.photo);
  const light = inkOf(text.ink).light;
  const framed = page.border !== 'none';
  // With no border and no photo, a light title gets a dark page to sit on.
  ctx.fillStyle = !framed && !page.photo && light ? NIGHT : toneOf(page.tone).hex;
  ctx.fillRect(x, y, w, h);
  const box = photoBox(page, x, y, w, h, u);
  if (page.photo && img) {
    // The photo is printed as it is: the title's colour never tints it.
    drawCover(ctx, img, page.photo, box.x, box.y, box.w, box.h);
  }
  if (page.photo) keyline(ctx, page, box.x, box.y, box.w, box.h, u);
  const f = fontOf(doc.font);
  const ghost = front && o.hints && !text.title.trim();
  const title = (ghost ? 'Name your zine' : text.title).trim();
  const m = u * 9;
  const maxW = w - m * 2;
  const lines: Line[] = [];
  if (title) {
    const shown = f.upper || text.case === 'upper' ? title.toUpperCase() : title;
    let px = TITLE_CAP[text.size] * u;
    let rows: string[] = [];
    // Shrink until it fits in four lines with no word wider than the column.
    for (; px > 4 * u; px *= 0.94) {
      ctx.font = font(doc, px);
      rows = wrap(ctx, shown, maxW);
      if (rows.length <= 4 && rows.every((r) => ctx.measureText(r).width <= maxW)) break;
    }
    const tf = font(doc, px);
    rows.forEach((t, i) => lines.push({ text: t, font: tf, px, gapAfter: i === rows.length - 1 ? px * 0.35 : -px * 0.08 }));
  }
  const small = (s: string, scale: number) => {
    if (!s.trim()) return;
    const px = Math.max(3 * u, (TITLE_CAP[text.size] * u) * scale);
    const sf = `normal 500 ${px}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.font = sf;
    for (const t of wrap(ctx, s.trim().toUpperCase(), maxW)) lines.push({ text: t, font: sf, px, gapAfter: px * 0.4, track: px * 0.12 });
  };
  small(text.subtitle, 0.3);
  small(text.author, 0.26);
  if (!lines.length) return;
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.55;
  drawBlock(ctx, lines, text, x + m, y + m, maxW, h - m * 2, page.photo ? { photo: true } : { photo: false, tone: !framed && light ? 'black' : page.tone }, { x, w });
  ctx.restore();
}

/** One page, by sheet panel, drawn upright into the given box. */
export function drawPage(ctx: Ctx, doc: ZineDoc, panel: number, x: number, y: number, w: number, h: number, o: RenderOpts) {
  const page = doc.pages[panel];
  if (panel === COVER_PANEL) drawCoverPage(ctx, doc, page, doc.cover, true, x, y, w, h, o);
  else if (panel === BACK_PANEL) drawCoverPage(ctx, doc, page, doc.back, false, x, y, w, h, o);
  else drawInner(ctx, doc, page, x, y, w, h, o);
}

/** A spread as the reader sees it: left page, right page, side by side. */
export function drawSpread(ctx: Ctx, doc: ZineDoc, spread: Spread, x: number, y: number, pageW: number, h: number, o: RenderOpts) {
  const merged: MergeDoc = doc.merged[spread.id];
  if (!merged.on) {
    drawPage(ctx, doc, spread.left, x, y, pageW, h, o);
    drawPage(ctx, doc, spread.right, x + pageW, y, pageW, h, o);
    return;
  }
  const w = pageW * 2;
  const u = pageW / 100;
  ctx.fillStyle = toneOf(merged.tone).hex;
  ctx.fillRect(x, y, w, h);
  const img = merged.photo && o.image(merged.photo);
  const box = photoBox(merged, x, y, w, h, u);
  if (merged.photo) {
    if (img) drawCover(ctx, img, merged.photo, box.x, box.y, box.w, box.h);
    keyline(ctx, merged, box.x, box.y, box.w, box.h, u);
  } else if (o.hints) emptyHint(ctx, x, y, w, h, u, 'Drop one photo for both pages');
  if (merged.caption.trim()) {
    const m = u * 8;
    const lines = captionLines(ctx, doc, merged.caption, merged, u, box.w - m * 2);
    const ground: Ground = merged.photo ? { photo: true } : { photo: false, tone: merged.tone };
    drawBlock(ctx, lines, merged, box.x + m, box.y + m, box.w - m * 2, box.h - m * 2, ground, { x: box.x, w: box.w });
  }
}

/** The fold line down the middle of an open spread, for the editor only. */
export function drawGutter(ctx: Ctx, x: number, y: number, h: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, y);
  ctx.lineTo(Math.round(x) + 0.5, y + h);
  ctx.stroke();
  ctx.restore();
}

/**
 * The printed sheet. Each spread is drawn whole and then cut into its two
 * pages, so a merged photo runs across the fold correctly. The top row is
 * turned upside down.
 */
export function drawSheet(ctx: Ctx, doc: ZineDoc, W: number, H: number, o: RenderOpts, guides = false) {
  const pw = W / 4;
  const ph = H / 2;
  ctx.fillStyle = PAPER_TONE;
  ctx.fillRect(0, 0, W, H);

  const place = (panel: number, paint: (c: Ctx) => void) => {
    const r = panelRect(panel, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    if (isFlipped(panel)) {
      ctx.translate(r.x + r.w, r.y + r.h);
      ctx.rotate(Math.PI);
    } else {
      ctx.translate(r.x, r.y);
    }
    paint(ctx);
    ctx.restore();
  };

  place(COVER_PANEL, (c) => drawPage(c, doc, COVER_PANEL, 0, 0, pw, ph, o));
  place(BACK_PANEL, (c) => drawPage(c, doc, BACK_PANEL, 0, 0, pw, ph, o));
  for (const s of SPREADS) {
    place(s.left, (c) => drawSpread(c, doc, s, 0, 0, pw, ph, o));
    place(s.right, (c) => drawSpread(c, doc, s, -pw, 0, pw, ph, o));
  }

  if (guides) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(pw * i, 0); ctx.lineTo(pw * i, H); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, ph); ctx.lineTo(W, ph); ctx.stroke();
    // The one cut: the middle two panels along the long fold.
    ctx.setLineDash([]);
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pw, ph); ctx.lineTo(pw * 3, ph); ctx.stroke();
    ctx.restore();
  }
}
