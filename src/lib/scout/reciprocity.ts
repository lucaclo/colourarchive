/**
 * Film in long exposures (issue #155).
 *
 * Film loses sensitivity when the light is dim and the shutter long: the same
 * total exposure spread over minutes makes a thinner negative than it does in
 * a fraction of a second (low-intensity reciprocity failure). So past a
 * second or so a film needs more time than the meter, and the ND arithmetic in
 * `exposure.ts`, say. Digital sensors don't fail this way.
 *
 * Every figure here is copied from the maker's own published sheet, named on
 * each stock, and nothing is fitted or guessed:
 *
 *   - **Ilford / Harman**: "Film Reciprocity Failure Compensation" (Dec 2023):
 *     corrected time = metered time ^ P, a factor per film, none needed at a
 *     second or less.
 *   - **Kodak Tri-X 400**: F-4017 table, 1 s → 2 s, 10 s → 50 s,
 *     100 s → 1200 s; between those the sheet's own graph, which is a smooth
 *     curve through them, read here as straight lines on log-log axes.
 *   - **Kodak Portra 400**: E-4050 says no correction from 1/10,000 s to 1 s
 *     and, past that, to make tests. So past a second this refuses to give a
 *     number rather than borrowing someone else's.
 *   - **Fujifilm Velvia 50**: data sheet: none to 1 s, then +1/3 stop at 4 s,
 *     +1/2 at 8 s, +2/3 at 16 s, +1 at 32 s, with magenta filters, and 64 s or
 *     more not recommended. Fuji gives these as a wider aperture; given as time
 *     instead, the longer exposure fails a little more again, which is said.
 *
 * Past the end of a maker's table the curve is carried on at its last slope
 * and the answer says it is extrapolated.
 */

export type ReciprocityRule =
  /** Tc = Tm^p for Tm over `fromS`. */
  | { kind: 'power'; p: number; fromS: number }
  /** Metered → corrected seconds, as printed. Below the first point, no change. */
  | { kind: 'times'; points: [meteredS: number, correctedS: number][]; noneBelowS: number }
  /** Stops to add at each metered time, as printed; past `notRecommendedFromS` refused. */
  | { kind: 'stops'; points: [meteredS: number, stops: number][]; filters: [meteredS: number, filter: string][]; notRecommendedFromS: number }
  /** The maker publishes nothing past `uptoS` and says to test. */
  | { kind: 'untested'; uptoS: number };

export interface FilmStock {
  id: string;
  name: string;
  source: string;
  rule: ReciprocityRule;
}

const ILFORD_SOURCE = 'Ilford, Film Reciprocity Failure Compensation (Dec 2023)';
const ilford = (id: string, name: string, p: number): FilmStock => ({
  id,
  name,
  source: ILFORD_SOURCE,
  rule: { kind: 'power', p, fromS: 1 },
});

export const FILM_STOCKS: readonly FilmStock[] = [
  {
    id: 'portra400',
    name: 'Kodak Portra 400',
    source: 'Kodak, Portra 400 technical data E-4050',
    rule: { kind: 'untested', uptoS: 1 },
  },
  {
    id: 'trix400',
    name: 'Kodak Tri-X 400',
    source: 'Kodak, Tri-X 320 and 400 technical data F-4017',
    rule: { kind: 'times', points: [[1, 2], [10, 50], [100, 1200]], noneBelowS: 0.1 },
  },
  ilford('hp5', 'Ilford HP5 Plus', 1.31),
  ilford('fp4', 'Ilford FP4 Plus', 1.26),
  ilford('panf', 'Ilford Pan F Plus', 1.33),
  ilford('delta100', 'Ilford Delta 100', 1.26),
  ilford('delta400', 'Ilford Delta 400', 1.41),
  ilford('delta3200', 'Ilford Delta 3200', 1.33),
  ilford('xp2', 'Ilford XP2 Super', 1.31),
  ilford('sfx', 'Ilford SFX 200', 1.43),
  ilford('ortho', 'Ilford Ortho Plus', 1.25),
  ilford('k100', 'Kentmere Pan 100', 1.26),
  ilford('k400', 'Kentmere Pan 400', 1.3),
  {
    id: 'velvia50',
    name: 'Fujifilm Velvia 50',
    source: 'Fujifilm, Velvia 50 data sheet',
    rule: {
      kind: 'stops',
      points: [[1, 0], [4, 1 / 3], [8, 1 / 2], [16, 2 / 3], [32, 1]],
      filters: [[4, '5M'], [8, '7.5M'], [16, '10M'], [32, '12.5M']],
      notRecommendedFromS: 64,
    },
  },
];

export const filmStock = (id: string | undefined): FilmStock | undefined => FILM_STOCKS.find((s) => s.id === id);

export interface Corrected {
  /** The time to give, seconds. Equal to the metered time when nothing is needed. */
  seconds: number;
  /** How many stops that adds. */
  stops: number;
  /** Past the end of the maker's figures, carried on at their last slope. */
  extrapolated: boolean;
  /** A colour filter the maker asks for at this time (Velvia). */
  filter?: string;
  /** When the maker gives no number, or advises against it: why. */
  refusal?: string;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Piecewise straight on log-log axes through `points`, carried on past the last. */
function logLog(points: [number, number][], x: number): { y: number; extrapolated: boolean } {
  const lx = Math.log(x);
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1 || i === points.length - 1) {
      const t = (lx - Math.log(x0)) / (Math.log(x1) - Math.log(x0));
      return { y: Math.exp(lerp(Math.log(y0), Math.log(y1), t)), extrapolated: x > x1 };
    }
  }
  return { y: x, extrapolated: false };
}

export function correctExposure(stock: FilmStock, meteredS: number): Corrected {
  const none: Corrected = { seconds: meteredS, stops: 0, extrapolated: false };
  const rule = stock.rule;
  switch (rule.kind) {
    case 'power': {
      if (meteredS <= rule.fromS) return none;
      const seconds = meteredS ** rule.p;
      return { seconds, stops: Math.log2(seconds / meteredS), extrapolated: false };
    }
    case 'times': {
      if (meteredS <= rule.noneBelowS) return none;
      // Below the first printed point the sheet says "none" at its last listed
      // short time; join that to the first point.
      const pts: [number, number][] = [[rule.noneBelowS, rule.noneBelowS], ...rule.points];
      const { y, extrapolated } = logLog(pts, meteredS);
      return { seconds: y, stops: Math.log2(y / meteredS), extrapolated };
    }
    case 'stops': {
      if (meteredS >= rule.notRecommendedFromS) {
        return { ...none, refusal: `${stock.name}'s maker doesn't recommend exposures of ${rule.notRecommendedFromS} s or longer.` };
      }
      const first = rule.points[0][0];
      if (meteredS <= first) return none;
      let stops = rule.points[rule.points.length - 1][1];
      for (let i = 1; i < rule.points.length; i++) {
        const [t0, s0] = rule.points[i - 1];
        const [t1, s1] = rule.points[i];
        if (meteredS <= t1) {
          stops = lerp(s0, s1, (Math.log2(meteredS) - Math.log2(t0)) / (Math.log2(t1) - Math.log2(t0)));
          break;
        }
      }
      const filter = [...rule.filters].reverse().find(([t]) => meteredS >= t)?.[1];
      return { seconds: meteredS * 2 ** stops, stops, extrapolated: false, filter };
    }
    case 'untested':
      if (meteredS <= rule.uptoS) return none;
      return { ...none, refusal: `${stock.name}'s maker gives no correction past ${rule.uptoS} s and says to test. Bracket: one and two stops over.` };
  }
}

/** "+⅓", "+½", "+1⅔": stops as a photographer writes them, to the nearest third or half. */
export function formatStops(stops: number): string {
  const thirds = Math.round(stops * 3) / 3;
  const halves = Math.round(stops * 2) / 2;
  const v = Math.abs(halves - stops) < Math.abs(thirds - stops) ? halves : thirds;
  if (v <= 0) return '0';
  const whole = Math.floor(v + 1e-9);
  const rest = v - whole;
  const frac = rest < 0.01 ? '' : Math.abs(rest - 0.5) < 0.01 ? '½' : rest < 0.5 ? '⅓' : '⅔';
  return `+${whole || ''}${frac}`;
}
