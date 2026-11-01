/**
 * The colour clock (issue #145): the archive as a frame on a stand that
 * follows the light outside. Pure: which light it is, and which photographs
 * belong to it.
 *
 * - Night (sun below −12°): the darkest frames in the archive.
 * - Blue hour (−12° to −4°): Blue, then Teal.
 * - Golden hour (−4° to 6°): the oranges and yellows.
 * - Daytime under a flat overcast sky: Ash.
 * - Daytime otherwise: Green, and the bright frames of Ash.
 *
 * Without a location there is no sun to ask, so the clock's own hour stands
 * in, roughly; see `phaseFromClock`.
 */

export type LightPhase = 'night' | 'blue' | 'golden' | 'overcast' | 'day';

export const PHASE_WORD: Record<LightPhase, string> = {
  night: 'Night',
  blue: 'Blue hour',
  golden: 'Golden hour',
  overcast: 'Overcast',
  day: 'Daylight',
};

export function lightPhase(sunAltitude: number, flatOvercast = false): LightPhase {
  if (sunAltitude < -12) return 'night';
  if (sunAltitude < -4) return 'blue';
  if (sunAltitude < 6) return 'golden';
  return flatOvercast ? 'overcast' : 'day';
}

/** The rough stand-in when the device won't say where it is. */
export function phaseFromClock(hour: number): LightPhase {
  if (hour < 5 || hour >= 22) return 'night';
  if (hour < 6 || hour >= 20) return 'blue';
  if (hour < 8 || hour >= 18) return 'golden';
  return 'day';
}

export interface ClockFrame {
  id: string;
  /** The chapter's key, e.g. "yellow-deep". */
  key: string;
  L: number;
}

const base = (key: string) => key.split('-')[0];

/** The photographs for this light, never empty while the archive isn't. */
export function poolFor(phase: LightPhase, frames: readonly ClockFrame[]): ClockFrame[] {
  const of = (...keys: string[]) => frames.filter((f) => keys.includes(base(f.key)));
  let pool: ClockFrame[] = [];
  switch (phase) {
    case 'night': {
      const dark = [...frames].sort((a, b) => a.L - b.L);
      pool = dark.slice(0, Math.max(4, Math.ceil(frames.length * 0.2)));
      break;
    }
    case 'blue':
      pool = of('blue');
      if (pool.length < 3) pool = [...pool, ...of('teal')];
      break;
    case 'golden':
      pool = of('orange', 'yellow');
      break;
    case 'overcast':
      pool = of('achromatic');
      break;
    case 'day':
      pool = [...of('green'), ...of('achromatic').filter((f) => f.L >= 0.65)];
      break;
  }
  return pool.length ? pool : [...frames];
}

/** The next photo: random within the pool, never the one on screen. */
export function nextFrame(pool: readonly ClockFrame[], currentId: string | null, random = Math.random): ClockFrame | null {
  const choices = pool.length > 1 ? pool.filter((f) => f.id !== currentId) : pool;
  return choices.length ? choices[Math.floor(random() * choices.length)] : null;
}

/** OKLab lightness of an sRGB hex colour. */
export function hexLightness(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/** How light a photo looks overall: its palette's lightness, weighted by each
 *  colour's share ("#aabbcc:0.4,…", as the archive's frames carry it).
 *  The dominant colour alone can be a deep sky over a bright frame. */
export function paletteLightness(swatches: string, fallback: number): number {
  let sum = 0, weight = 0;
  for (const part of swatches.split(',')) {
    const [hex, share] = part.split(':');
    const w = Number(share);
    if (!/^#?[0-9a-f]{6}$/i.test(hex ?? '') || !(w > 0)) continue;
    sum += hexLightness(hex) * w;
    weight += w;
  }
  return weight ? sum / weight : fallback;
}
