/**
 * The naked-eye sky: catalogue stars placed for a time and place, their
 * constellations, and the band of the galaxy itself.
 *
 * The sister of `galactic.ts`, and built on it directly — `equatorialToHorizontal`
 * is the same transform `corePosition` uses, so a star and the core it belongs
 * to (Sgr A* is itself just a point at galactic l≈0°, b≈0°) never disagree
 * about where the sky is. Pure functions of (catalogue, latitude, longitude,
 * instant); no map, no network, no clock of its own — the fetch that gets the
 * catalogue here lives in `view/stars-loader.ts`, same split as everything
 * else in this project that touches a bundled asset.
 *
 * **Constellation lines are computed, not vendored.** Every freely available
 * stick-figure dataset found while building this carried a licence conflict —
 * a permissive one claimed in prose, a GPL header on the actual file — so
 * `constellationLines` below draws its own: a minimum spanning tree over each
 * constellation's stars by angular separation. It will not match any
 * particular planetarium's artistic choices, and says so rather than
 * pretending to be the IAU's own figures.
 */

import { equatorialToHorizontal, precess } from './galactic';
import { refraction } from './sun';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const norm360 = (d: number) => ((d % 360) + 360) % 360;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sin = (deg: number) => Math.sin(deg * RAD);

/** One catalogue entry — see `scripts/fetch-bright-stars.ts` for where it
 *  comes from and how it was filtered. */
export interface Star {
  id: number;
  name: string | null;
  bayer: string | null;
  flam: string | null;
  con: string | null;
  /** J2000, degrees. */
  raDeg: number;
  decDeg: number;
  /** Apparent magnitude — lower is brighter, and negative is a handful of
   *  the very brightest (Sirius is −1.44). */
  mag: number;
  /** B−V colour index, or null when the catalogue has none. */
  ci: number | null;
}

export interface StarPosition {
  star: Star;
  azimuth: number;
  /** Geometric. */
  altitude: number;
  /** Lifted by refraction — where the eye would actually find it, the same
   *  split `corePosition` reports for the same reason: shadow-style geometry
   *  wants the true position, a reader looking at the sky wants this one. */
  altitudeApparent: number;
  /**
   * Catalogue magnitude plus atmospheric extinction at this altitude — how
   * bright the star actually looks from here right now, not how bright it
   * is. A star at 5° up is measurably dimmer than the same star overhead,
   * which is why constellations near the horizon look sparser than the
   * catalogue alone would suggest.
   */
  apparentMag: number;
}

/**
 * Airmass: how much atmosphere a line of sight to this altitude passes
 * through, 1 at the zenith and rising toward the horizon.
 *
 * Kasten & Young 1989 — the standard approximation atmospheric-optics work
 * actually uses, valid all the way to the horizon, unlike the textbook
 * 1/sin(altitude) it replaces (which diverges to infinity there instead of
 * the true finite, if large, value).
 */
export function airmass(apparentAltitudeDeg: number): number {
  if (apparentAltitudeDeg <= -1) return Infinity;
  const h = Math.max(0, apparentAltitudeDeg);
  return 1 / (sin(h) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

/**
 * Magnitudes per airmass lost to the atmosphere — a clear, dark-site value.
 * Not measured for any particular night: a hazy sky or a coastal one can run
 * noticeably higher, and this project has no source for tonight's actual
 * number the way it does for cloud. Stated as a convention, the same way
 * `EXTINCTION_COEFFICIENT`'s neighbours in this file are.
 */
export const EXTINCTION_COEFFICIENT = 0.2;

/** How many magnitudes dimmer a star looks at this altitude than it would
 *  directly overhead. Zero at the zenith, a couple of magnitudes by 5°. */
export function extinctionMag(apparentAltitudeDeg: number): number {
  const x = airmass(apparentAltitudeDeg);
  return Number.isFinite(x) ? EXTINCTION_COEFFICIENT * (x - 1) : Infinity;
}

/**
 * Every catalogue star currently above `minAltitude`, precessed to the
 * instant and placed in the sky, apparent altitude and apparent magnitude
 * both included.
 *
 * `minAltitude` defaults a little below the true horizon (not 0) so a star
 * about to rise is not dropped and picked back up a minute later — the same
 * reasoning `MOONRISE_ALTITUDE` and the horizon dip already use elsewhere in
 * this project. It compares against *apparent* altitude, refraction and all,
 * for the same reason the horizon dip does: what a person outside would
 * actually see clearing the horizon, not the geometric moment.
 */
export function starPositions(
  stars: readonly Star[],
  latitude: number,
  longitude: number,
  date: Date,
  minAltitude = -1,
): StarPosition[] {
  const out: StarPosition[] = [];
  for (const star of stars) {
    const { rightAscension, declination } = precess(star.raDeg, star.decDeg, date);
    const { azimuth, altitude } = equatorialToHorizontal(
      rightAscension,
      declination,
      latitude,
      longitude,
      date,
    );
    const altitudeApparent = altitude + refraction(altitude);
    if (altitudeApparent >= minAltitude) {
      out.push({
        star,
        azimuth,
        altitude,
        altitudeApparent,
        apparentMag: star.mag + extinctionMag(altitudeApparent),
      });
    }
  }
  return out;
}

/**
 * How dark the sky has to be before anything shows at all, 0..1.
 *
 * Not a hard cut: the sky brightens continuously through twilight. 0 at
 * civil twilight and brighter (nothing shows), 1 at astronomical twilight
 * and darker (as dark as it gets) — the same two thresholds `coreNight`
 * already draws its own darkness window from, so a reader who has learned
 * what those words mean there does not have to learn a second pair here.
 * `limitingMagnitude` is what turns this into "which stars", star by star;
 * this alone is what the galactic plane's own brightness fades with, since
 * a diffuse band has no single magnitude to fade past.
 */
export function starVisibility(sunAltitude: number, civil = -6, astronomical = -18): number {
  if (sunAltitude >= civil) return 0;
  if (sunAltitude <= astronomical) return 1;
  return (civil - sunAltitude) / (civil - astronomical);
}

/** A bright, high moon washes out faint stars before it washes out Sirius —
 *  the same reason a full moon "loses" a meteor shower and a crescent barely
 *  touches it. Zero when the moon is down; scales with both how much of it
 *  is lit and how high it has climbed, since a full moon on the horizon
 *  glows red and dim while a quarter moon overhead is still a real light
 *  source. `MAX_MOON_PENALTY` is a stated convention, not a measurement — the
 *  same honest limit as `EXTINCTION_COEFFICIENT` — chosen so a full moon
 *  near the zenith knocks the naked-eye limit down by roughly the four
 *  magnitudes commonly reported for that case, not a photometric model of
 *  tonight's actual sky glow. */
const MAX_MOON_PENALTY = 4;
export function moonlightPenalty(moonAltitude: number, illuminatedFraction: number): number {
  if (moonAltitude <= 0) return 0;
  const climbed = clamp(moonAltitude / 45, 0, 1);
  return MAX_MOON_PENALTY * clamp(illuminatedFraction, 0, 1) * climbed;
}

/**
 * The faintest catalogue magnitude worth drawing right now — twilight and
 * moonlight both push it brighter (numerically lower); a moonless
 * astronomically dark sky pushes it all the way to `catalogLimit`, the
 * catalogue's own cutoff (see `scripts/fetch-bright-stars.ts`), since there
 * is nothing fainter to ask for anyway.
 *
 * -2 is where the ramp starts at civil twilight: bright enough that only a
 * handful of the catalogue's brightest entries (Sirius, Canopus, Vega) are
 * anywhere near it, which is what the sky actually looks like at dusk before
 * anything else has come out.
 */
export function limitingMagnitude(
  sunAltitude: number,
  moonAltitude: number,
  moonIlluminatedFraction: number,
  catalogLimit = 4.0,
): number {
  const dark = starVisibility(sunAltitude);
  const base = -2 + (catalogLimit + 2) * dark;
  return Math.min(catalogLimit, base - moonlightPenalty(moonAltitude, moonIlluminatedFraction));
}

/**
 * How solid a star draws against the current limiting magnitude, 0..1.
 *
 * Fully drawn at and brighter than `limit` — that is what "the limiting
 * magnitude is X" means, stars to X are visible — then a smooth fade to
 * nothing over the next `fadeRange` magnitudes past it, rather than a snap.
 * That is how a star actually behaves as the sky brightens past it: it does
 * not vanish, it *fades*.
 */
export function starAlpha(apparentMag: number, limit: number, fadeRange = 1.0): number {
  return clamp(1 - (apparentMag - limit) / fadeRange, 0, 1);
}

/** Angular separation between two catalogue points, degrees — the great-circle
 *  distance on the sky, which is what "nearest star" has to mean here rather
 *  than a difference in RA/Dec that means something different at every declination. */
export function angularSeparation(raA: number, decA: number, raB: number, decB: number): number {
  const cosD =
    Math.sin(decA * RAD) * Math.sin(decB * RAD) +
    Math.cos(decA * RAD) * Math.cos(decB * RAD) * Math.cos((raA - raB) * RAD);
  return Math.acos(Math.min(1, Math.max(-1, cosD))) * DEG;
}

export interface ConstellationEdge {
  con: string;
  a: Star;
  b: Star;
}

/**
 * A stick figure per constellation: the minimum spanning tree over its
 * stars, joined by angular separation.
 *
 * An MST rather than nearest-neighbour-per-star because nearest-neighbour
 * can and does fragment a constellation into disconnected pairs — two stars
 * each other's closest neighbour, with no edge to the rest of the shape at
 * all. An MST is the smallest set of edges that leaves every star in a
 * constellation reachable from every other, which is the least a "figure"
 * can mean and still be one connected shape.
 */
export function constellationLines(stars: readonly Star[]): ConstellationEdge[] {
  const groups = new Map<string, Star[]>();
  for (const star of stars) {
    if (!star.con) continue;
    const group = groups.get(star.con);
    if (group) group.push(star);
    else groups.set(star.con, [star]);
  }

  const edges: ConstellationEdge[] = [];
  for (const [con, group] of groups) {
    if (group.length < 2) continue;
    // Prim's algorithm. `group` is at most a few dozen stars, so the O(n²)
    // form is simpler than a heap and costs nothing measurable here.
    const inTree = new Set<number>([0]);
    while (inTree.size < group.length) {
      let best: { from: number; to: number; d: number } | null = null;
      for (const from of inTree) {
        for (let to = 0; to < group.length; to++) {
          if (inTree.has(to)) continue;
          const d = angularSeparation(
            group[from].raDeg,
            group[from].decDeg,
            group[to].raDeg,
            group[to].decDeg,
          );
          if (!best || d < best.d) best = { from, to, d };
        }
      }
      if (!best) break;
      inTree.add(best.to);
      edges.push({ con, a: group[best.from], b: group[best.to] });
    }
  }
  return edges;
}

/**
 * The galactic plane's north pole and the galactic longitude of the north
 * celestial pole, J2000 — the IAU 1958 System II definition, the standard
 * every galactic-coordinate conversion is built from. Sagittarius A* sits at
 * galactic (l, b) ≈ (0°, 0°) by construction, which is what
 * `galactic-plane.test.ts` checks this transform against: if it did not
 * reproduce `CORE_J2000` at l=0, b=0, it would be wrong.
 */
const NGP_RA = 192.85948;
const NGP_DEC = 27.12825;
const NCP_GALACTIC_LON = 122.93192;

/** A point on the galactic plane (or at some latitude off it) → J2000
 *  equatorial coordinates. */
export function galacticToEquatorial(
  longitude: number,
  latitude: number,
): { rightAscension: number; declination: number } {
  const b = latitude * RAD;
  const decNgp = NGP_DEC * RAD;
  const dLon = (NCP_GALACTIC_LON - longitude) * RAD;

  const sinDec = Math.sin(decNgp) * Math.sin(b) + Math.cos(decNgp) * Math.cos(b) * Math.cos(dLon);
  const declination = Math.asin(Math.min(1, Math.max(-1, sinDec))) * DEG;

  const y = Math.cos(b) * Math.sin(dLon);
  const x = Math.cos(decNgp) * Math.sin(b) - Math.sin(decNgp) * Math.cos(b) * Math.cos(dLon);
  const rightAscension = norm360(NGP_RA + Math.atan2(y, x) * DEG);

  return { rightAscension, declination };
}

/**
 * The Milky Way's own band, sampled along a line of constant galactic
 * latitude and placed in the sky for an instant — what the arc for the core
 * alone cannot show, which is the *shape* of the galaxy overhead rather than
 * one bright region within it.
 *
 * `galacticLatitude` defaults to the centreline (0°) but is a parameter
 * rather than a hard-coded 0 so a caller can draw the band with real width —
 * a few parallel passes either side of the plane, the way the band actually
 * looks, rather than the single thread-thin great circle the centreline
 * alone would be.
 */
export function galacticPlane(
  latitude: number,
  longitude: number,
  date: Date,
  stepDeg = 3,
  galacticLatitude = 0,
): Array<{ azimuth: number; altitude: number }> {
  const out: Array<{ azimuth: number; altitude: number }> = [];
  for (let l = 0; l <= 360; l += stepDeg) {
    const { rightAscension, declination } = galacticToEquatorial(l, galacticLatitude);
    const precessed = precess(rightAscension, declination, date);
    out.push(
      equatorialToHorizontal(precessed.rightAscension, precessed.declination, latitude, longitude, date),
    );
  }
  return out;
}

/**
 * The 88 IAU constellation abbreviations, spelled out — official
 * designations, not a creative work, so unlike the stick figures above there
 * is no dataset to be careful about here: this is the same list any
 * planetarium programme's own lookup table is. Keyed exactly as the
 * catalogue's own `con` field spells them.
 */
export const CONSTELLATION_NAME: Readonly<Record<string, string>> = {
  And: 'Andromeda', Ant: 'Antlia', Aps: 'Apus', Aqr: 'Aquarius', Aql: 'Aquila',
  Ara: 'Ara', Ari: 'Aries', Aur: 'Auriga', Boo: 'Boötes', Cae: 'Caelum',
  Cam: 'Camelopardalis', Cnc: 'Cancer', CVn: 'Canes Venatici', CMa: 'Canis Major',
  CMi: 'Canis Minor', Cap: 'Capricornus', Car: 'Carina', Cas: 'Cassiopeia',
  Cen: 'Centaurus', Cep: 'Cepheus', Cet: 'Cetus', Cha: 'Chamaeleon',
  Cir: 'Circinus', Col: 'Columba', Com: 'Coma Berenices', CrA: 'Corona Australis',
  CrB: 'Corona Borealis', Crv: 'Corvus', Crt: 'Crater', Cru: 'Crux', Cyg: 'Cygnus',
  Del: 'Delphinus', Dor: 'Dorado', Dra: 'Draco', Equ: 'Equuleus', Eri: 'Eridanus',
  For: 'Fornax', Gem: 'Gemini', Gru: 'Grus', Her: 'Hercules', Hor: 'Horologium',
  Hya: 'Hydra', Hyi: 'Hydrus', Ind: 'Indus', Lac: 'Lacerta', Leo: 'Leo',
  LMi: 'Leo Minor', Lep: 'Lepus', Lib: 'Libra', Lup: 'Lupus', Lyn: 'Lynx',
  Lyr: 'Lyra', Men: 'Mensa', Mic: 'Microscopium', Mon: 'Monoceros', Mus: 'Musca',
  Nor: 'Norma', Oct: 'Octans', Oph: 'Ophiuchus', Ori: 'Orion', Pav: 'Pavo',
  Peg: 'Pegasus', Per: 'Perseus', Phe: 'Phoenix', Pic: 'Pictor', Psc: 'Pisces',
  PsA: 'Piscis Austrinus', Pup: 'Puppis', Pyx: 'Pyxis', Ret: 'Reticulum',
  Sge: 'Sagitta', Sgr: 'Sagittarius', Sco: 'Scorpius', Scl: 'Sculptor',
  Sct: 'Scutum', Ser: 'Serpens', Sex: 'Sextans', Tau: 'Taurus', Tel: 'Telescopium',
  Tri: 'Triangulum', TrA: 'Triangulum Australe', Tuc: 'Tucana', UMa: 'Ursa Major',
  UMi: 'Ursa Minor', Vel: 'Vela', Vir: 'Virgo', Vol: 'Volans', Vul: 'Vulpecula',
};

/**
 * The constellations currently worth naming, ranked by how solidly their
 * stars are drawn — the same `alpha` the dome itself fades stars by, so a
 * constellation half-below-the-horizon or washed out by a bright moon does
 * not get named just as confidently as one standing clear overhead.
 *
 * `limit` caps how many names come back, because "everything above the
 * horizon" is not an answer to "what am I looking at" — it is a list. Six is
 * enough to name a target and its immediate neighbours without turning into
 * an almanac entry.
 */
export function prominentConstellations(
  stars: ReadonlyArray<{ star: Star; alpha: number }>,
  limit = 6,
): string[] {
  const best = new Map<string, number>();
  for (const s of stars) {
    if (!s.star.con) continue;
    const current = best.get(s.star.con) ?? 0;
    if (s.alpha > current) best.set(s.star.con, s.alpha);
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([con]) => CONSTELLATION_NAME[con] ?? con);
}

/**
 * How bright the Milky Way's own band looks at a given galactic longitude,
 * 0..1 — brightest looking back toward the galactic centre (l=0°, straight
 * through the star clouds of Sagittarius), dimmest toward the anticentre
 * (l=180°, looking out through the thin edge of the disc away from the
 * core). A smooth cosine rather than a measured surface-brightness profile:
 * this project has no source for the latter and does not pretend to one, the
 * same honest limit as `EXTINCTION_COEFFICIENT` and `MAX_MOON_PENALTY`
 * above — but the shape (brighter toward the core, never quite invisible on
 * the far side) is the real one, and is what makes the band worth drawing
 * with any variation at all.
 */
export function galacticBandBrightness(longitude: number): number {
  const FLOOR = 0.35;
  return FLOOR + (1 - FLOOR) * (1 + Math.cos(norm360(longitude) * RAD)) / 2;
}

/**
 * A star's colour, roughly, from its B−V index — Mitchell Charity's
 * black-body-fit table (www.vendian.org/mncharity/dir3/blackbody), reduced
 * to the handful of anchor points that separate a hot blue-white star from a
 * cool orange one, which is all a point a few pixels wide can show anyway.
 * Null (no colour index in the catalogue) reads as neutral white.
 */
export function starColour(ci: number | null): [number, number, number] {
  if (ci === null) return [1, 1, 1];
  const stops: Array<[number, [number, number, number]]> = [
    [-0.4, [0.61, 0.7, 1]],
    [0.0, [0.79, 0.85, 1]],
    [0.3, [1, 0.96, 0.92]],
    [0.6, [1, 0.89, 0.7]],
    [1.0, [1, 0.78, 0.52]],
    [1.6, [1, 0.62, 0.4]],
  ];
  if (ci <= stops[0][0]) return stops[0][1];
  if (ci >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (ci >= t0 && ci <= t1) {
      const t = (ci - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return [1, 1, 1];
}
