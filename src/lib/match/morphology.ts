// Greyscale morphology. Pure — no sharp, no models — so both the server and
// the browser can shrink a mask the same way.

/**
 * Sliding-window minimum along one axis, O(n) via a monotonic deque.
 * Greyscale erosion with a square structuring element is separable, so running
 * this over rows then columns erodes without an O(r²) inner loop.
 */
function minFilter1D(
  src: Uint8Array,
  dst: Uint8Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
): void {
  const n = horizontal ? width : height;
  const outer = horizontal ? height : width;
  const idx = horizontal
    ? (o: number, i: number) => o * width + i
    : (o: number, i: number) => i * width + o;

  const deque = new Int32Array(n);

  for (let o = 0; o < outer; o++) {
    let head = 0;
    let tail = 0; // holds indices with strictly increasing values

    // Prime with the first `radius` entries so the window is correct at i = 0.
    for (let i = 0; i < Math.min(radius, n); i++) {
      const v = src[idx(o, i)];
      while (tail > head && src[idx(o, deque[tail - 1])] >= v) tail--;
      deque[tail++] = i;
    }

    for (let i = 0; i < n; i++) {
      const add = i + radius;
      if (add < n) {
        const v = src[idx(o, add)];
        while (tail > head && src[idx(o, deque[tail - 1])] >= v) tail--;
        deque[tail++] = add;
      }
      const drop = i - radius - 1;
      if (drop >= 0 && deque[head] <= drop) head++;
      dst[idx(o, i)] = src[idx(o, deque[head])];
    }
  }
}

/** Shrink a mask inward by `radius` pixels. Soft (anti-aliased) masks erode
 *  correctly too, since greyscale erosion is just a local minimum. */
export function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius < 1) return mask;
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  minFilter1D(mask, tmp, width, height, radius, true);
  minFilter1D(tmp, out, width, height, radius, false);
  return out;
}
