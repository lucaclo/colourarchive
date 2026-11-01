/**
 * Sequence on the floor (issue #147): finding work prints in a photograph.
 *
 * The prints are white paper with a photograph and a code on each, laid on
 * a floor or table that is darker than paper. So: mark the paper-white
 * pixels (Otsu's threshold on lightness, and nearly grey), group them into
 * connected pieces, and fit each piece the smallest rotated rectangle that
 * holds it — that's one print, at whatever angle it was dropped. A print's
 * own photograph can be dark, which leaves its paper as a ring; the ring's
 * outline is still the print's.
 *
 * Pure, on raw pixels. read.ts does the decoding, matching and ordering.
 * Limits, said plainly: prints that touch merge into one piece, glare that
 * turns the floor white joins prints to it, and steep perspective is only
 * partly undone (each print is straightened, not unwarped).
 */

export interface Raster { data: Uint8Array; width: number; height: number; channels: number }

export interface PrintRect {
  cx: number;
  cy: number;
  /** Along the rectangle's own axes, w ≥ h not assumed. */
  w: number;
  h: number;
  /** Radians, the rectangle's rotation from upright, within ±45°. */
  angle: number;
}

const lum = (r: Raster, i: number) => {
  const o = i * r.channels;
  return 0.2126 * r.data[o] + 0.7152 * r.data[o + 1] + 0.0722 * r.data[o + 2];
};

/** Otsu's threshold over a 256-bin histogram. */
export function otsu(hist: number[]): number {
  const total = hist.reduce((a, b) => a + b, 0);
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, at = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; at = t; }
  }
  return at;
}

/** 1 where the pixel looks like white paper. */
export function paperMask(r: Raster): Uint8Array {
  const n = r.width * r.height;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) hist[Math.round(lum(r, i))]++;
  const t = Math.max(otsu(hist), 140);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * r.channels;
    const spread = Math.max(r.data[o], r.data[o + 1], r.data[o + 2]) - Math.min(r.data[o], r.data[o + 1], r.data[o + 2]);
    if (lum(r, i) > t && spread < 48) mask[i] = 1;
  }
  return mask;
}

/** Shrink the mask by `radius` pixels (a square window, done as two passes),
 *  which parts prints that only just touch. */
export function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let all = 1;
        for (let d = -radius; d <= radius && all; d++) {
          const xx = horizontal ? x + d : x, yy = horizontal ? y : y + d;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height || !src[yy * width + xx]) all = 0;
        }
        out[y * width + x] = all;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

/** Connected pieces (4-neighbour), each as its pixel coordinates. */
export function components(mask: Uint8Array, width: number, height: number, minPixels: number): [number, number][][] {
  const seen = new Uint8Array(mask.length);
  const out: [number, number][][] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const pts: [number, number][] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width, y = (i - x) / width;
      pts.push([x, y]);
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < width - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && mask[i - width] && !seen[i - width]) { seen[i - width] = 1; stack.push(i - width); }
      if (y < height - 1 && mask[i + width] && !seen[i + width]) { seen[i + width] = 1; stack.push(i + width); }
    }
    if (pts.length >= minPixels) out.push(pts);
  }
  return out;
}

/** Andrew's monotone chain. */
export function convexHull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const pt of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop(); lower.push(pt); }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) { const pt = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop(); upper.push(pt); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The smallest rectangle at any angle (half-degree steps) around the points. */
export function minAreaRect(points: [number, number][]): PrintRect {
  const hull = convexHull(points);
  let best: PrintRect & { area: number } = { cx: 0, cy: 0, w: 0, h: 0, angle: 0, area: Infinity };
  for (let deg = -45; deg < 45; deg += 0.5) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, y] of hull) {
      const u = x * c + y * s, v = -x * s + y * c;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) {
      const u = (minU + maxU) / 2, v = (minV + maxV) / 2;
      best = { cx: u * c - v * s, cy: u * s + v * c, w: maxU - minU + 1, h: maxV - minV + 1, angle: a, area };
    }
  }
  const { area: _area, ...rect } = best;
  return rect;
}

/** Every print in the photograph. */
export function findPrints(r: Raster): PrintRect[] {
  const minPixels = Math.round(r.width * r.height * 0.002);
  // About a thousandth of the picture's long side: enough to part two cards
  // laid edge to edge, and grown back onto each rectangle afterwards.
  const radius = Math.max(1, Math.round(Math.max(r.width, r.height) / 700));
  const rects = components(erode(paperMask(r), r.width, r.height, radius), r.width, r.height, minPixels)
    .map(minAreaRect)
    .map((q) => ({ ...q, w: q.w + 2 * radius, h: q.h + 2 * radius }));
  if (!rects.length) return [];
  // Prints are all one size; a stray reflection or a skirting board isn't.
  const areas = rects.map((q) => q.w * q.h).sort((a, b) => a - b);
  const typical = areas[Math.floor(areas.length * 0.6)];
  return rects.filter((q) => {
    const ratio = Math.max(q.w, q.h) / Math.min(q.w, q.h);
    const area = q.w * q.h;
    return ratio < 2.5 && area > typical * 0.35 && area < typical * 2.2;
  });
}

/** Bilinear sample of one rectangle, straightened, `inset` trimmed per side
 *  (fractions of width and height), `top`/`bottom` the band to keep. */
export function sampleRect(r: Raster, q: PrintRect, outW: number, opts: { top?: number; bottom?: number; inset?: number } = {}): Raster {
  const inset = opts.inset ?? 0.04, top = opts.top ?? 0, bottom = opts.bottom ?? 1;
  const u0 = -q.w / 2 + q.w * inset, u1 = q.w / 2 - q.w * inset;
  const v0 = -q.h / 2 + q.h * (top + inset), v1 = -q.h / 2 + q.h * (bottom - inset);
  const outH = Math.max(1, Math.round(outW * (v1 - v0) / (u1 - u0)));
  const out = new Uint8Array(outW * outH * 3);
  const c = Math.cos(q.angle), s = Math.sin(q.angle);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const u = u0 + ((x + 0.5) / outW) * (u1 - u0), v = v0 + ((y + 0.5) / outH) * (v1 - v0);
      const sx = q.cx + u * c - v * s, sy = q.cy + u * s + v * c;
      const x0 = Math.max(0, Math.min(r.width - 2, Math.floor(sx))), y0 = Math.max(0, Math.min(r.height - 2, Math.floor(sy)));
      const fx = Math.min(1, Math.max(0, sx - x0)), fy = Math.min(1, Math.max(0, sy - y0));
      for (let ch = 0; ch < 3; ch++) {
        const at = (xx: number, yy: number) => r.data[(yy * r.width + xx) * r.channels + ch];
        const val = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
        out[(y * outW + x) * 3 + ch] = val;
      }
    }
  }
  return { data: out, width: outW, height: outH, channels: 3 };
}

/**
 * The order a person reads the floor in: rows from the top, each left to
 * right. A print joins a row while its centre is within half a print's
 * height of the row's. Two prints nearly touching in a row are flagged as a
 * pair, which a book could print as one spread.
 */
export function readingOrder(rects: readonly PrintRect[]): { index: number; row: number; pairedWithNext: boolean }[] {
  if (!rects.length) return [];
  const hs = rects.map((q) => Math.min(q.w, q.h)).sort((a, b) => a - b);
  const ws = rects.map((q) => Math.max(q.w, q.h)).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)], medW = ws[Math.floor(ws.length / 2)];
  const byY = rects.map((q, index) => ({ q, index })).sort((a, b) => a.q.cy - b.q.cy);
  const rows: (typeof byY)[] = [];
  for (const item of byY) {
    const row = rows.at(-1);
    const mean = row ? row.reduce((s, x) => s + x.q.cy, 0) / row.length : 0;
    if (row && Math.abs(item.q.cy - mean) < medH * 0.5) row.push(item);
    else rows.push([item]);
  }
  const out: { index: number; row: number; pairedWithNext: boolean }[] = [];
  rows.forEach((row, r) => {
    row.sort((a, b) => a.q.cx - b.q.cx);
    row.forEach((item, k) => {
      const next = row[k + 1];
      const gap = next ? next.q.cx - item.q.cx - (item.q.w + next.q.w) / 2 : Infinity;
      out.push({ index: item.index, row: r, pairedWithNext: gap < medW * 0.08 });
    });
  });
  return out;
}

/**
 * The book's order with a new order read from the floor: the positions the
 * read photos already hold are filled with them in the floor's order, and
 * everything else stays where it is.
 */
export function applyOrder(current: readonly string[], proposed: readonly string[]): string[] {
  const read = new Set(proposed.filter((id) => current.includes(id)));
  const queue = proposed.filter((id) => read.has(id));
  return current.map((id) => (read.has(id) ? queue.shift()! : id));
}
