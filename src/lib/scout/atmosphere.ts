/**
 * The air between the sun and the subject.
 *
 * Scout computes where the sun is to a fraction of a degree, and until now said
 * nothing at all about what its light is *like*. But a photographer choosing
 * between a tropical coast and a Cairngorm ridge is not choosing between two
 * solar altitudes; they are choosing between two atmospheres. The light on the
 * ridge is hard, blue and contrasty. The light on the coast is soft, white and
 * flat. Same sun, same geometry, completely different photograph.
 *
 * Three terms account for essentially all of it, and all three are computable:
 *
 * **Air mass** — how much atmosphere the beam crossed. This is where *latitude*
 * enters, and it enters nowhere else: the tropics reach air mass 1 at noon,
 * while Edinburgh's midwinter sun tops out around 9.5° and never gets below
 * about 5.8. Everything weak and warm about a low sun follows from this one
 * number.
 *
 * **Pressure** — how much atmosphere there was to begin with. This is the
 * mountain. At 3,000 m there is 30% less of it, so the beam is stronger, the
 * sky is darker, and the shadows are deeper because less light is being
 * scattered down into them.
 *
 * **Aerosol** — what the air is carrying. This is the coast, and it is the
 * subtle one. What matters is less the *amount* of haze than its particle size,
 * captured by the Ångström exponent α. Continental dust is small (α≈1.3) and
 * scatters blue preferentially, giving a saturated sky and clean light. Sea
 * salt is large (α≈0.1–0.5) and scatters almost neutrally, so maritime haze
 * *whitens* rather than reddens, lifts the shadows and flattens the contrast.
 * That single exponent is most of the difference this file exists to model.
 *
 * Everything here is pure: no map, no network, no DOM. What it cannot know —
 * the actual turbidity over your head — is passed in, so that a measured value
 * and an assumed one can be told apart by the caller and labelled honestly.
 */

import { CIE_1931, CIE_STEP_NM, OZONE_CHAPPUIS, cieWavelength } from './cie';

/* ── Geometry of the path ──────────────────────────────────────────────────── */

/**
 * Relative air mass — Kasten & Young (1989).
 *
 * 1.0 with the sun overhead, about 5.6 at 10°, and about 38 at the horizon.
 * The empirical tail is what makes it usable near the horizon, where a plain
 * 1/sin(h) diverges to nonsense.
 */
export function airMass(altitudeDeg: number): number {
  if (altitudeDeg <= -1) return Infinity;
  const h = Math.max(altitudeDeg, -0.9);
  return 1 / (Math.sin((h * Math.PI) / 180) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

/**
 * Station pressure as a fraction of sea level.
 *
 * The scale height Bird uses. Air mass is proportional to the mass of air
 * overhead, so this is the whole of the altitude effect: 3,000 m ⇒ 0.70.
 */
export function pressureRatio(elevationM: number): number {
  return Math.exp(-Math.max(0, elevationM) / 8434.5);
}

/* ── What the air is carrying ──────────────────────────────────────────────── */

export interface Aerosol {
  /** Ångström turbidity β — the *amount*, as optical depth at 1 µm. */
  beta: number;
  /** Ångström exponent α — the *particle size*, and the character of the light. */
  alpha: number;
}

/**
 * Typical air, by the kind of place.
 *
 * Ranges from the aerosol-climatology literature, rounded to the middle of
 * each. Defaults, never measurements — the caller must say which it used.
 */
export const AEROSOL: Record<'mountain' | 'continental' | 'maritime' | 'urban', Aerosol> = {
  mountain: { beta: 0.02, alpha: 1.3 },
  continental: { beta: 0.05, alpha: 1.3 },
  maritime: { beta: 0.12, alpha: 0.4 },
  urban: { beta: 0.2, alpha: 1.3 },
};

/**
 * Turbidity from a measured aerosol optical depth at 550 nm.
 *
 * CAMS publishes AOD at 550 nm; Ångström is anchored at 1 µm. `β = τ·λ^α` with
 * λ = 0.55 converts one to the other — given α, which still has to come from
 * somewhere, and usually from the kind of place rather than a measurement.
 */
export const betaFromAod550 = (aod550: number, alpha: number): number =>
  Math.max(0, aod550) * Math.pow(0.55, alpha);

/**
 * How maritime the air probably is, from how much sea is nearby.
 *
 * Not a measurement of the air — nothing here can measure the air — but a
 * measurement of the *terrain*, which is the honest half of the question. A pin
 * with open water across most of its surroundings is breathing sea air, and sea
 * air means large, neutral, wavelength-blind particles.
 *
 * `seaFraction` is the share of the loaded height field sitting at or below sea
 * level. Blended rather than switched, because a headland is not a mid-ocean
 * buoy and should not be modelled as one.
 */
export function coastalAerosol(seaFraction: number, inland: Aerosol = AEROSOL.continental): Aerosol {
  const t = Math.min(1, Math.max(0, seaFraction));
  return {
    beta: inland.beta + (AEROSOL.maritime.beta - inland.beta) * t,
    alpha: inland.alpha + (AEROSOL.maritime.alpha - inland.alpha) * t,
  };
}

/* ── Spectral transmittance ────────────────────────────────────────────────── */

/**
 * Rayleigh optical depth at sea level — Bodhaine et al. (1999), λ in µm.
 *
 * The λ⁻⁴ that makes the sky blue and the setting sun red.
 */
const rayleighDepth = (um: number) =>
  0.008569 * um ** -4 * (1 + 0.0113 * um ** -2 + 0.00013 * um ** -4);

export interface SpectralInput {
  altitudeDeg: number;
  elevationM: number;
  aerosol: Aerosol;
  /** Column ozone, atm-cm. 0.3 is the global mean. */
  ozoneCm?: number;
}

export interface Chromaticity {
  x: number;
  y: number;
  /** Correlated colour temperature, K. */
  cct: number;
}

/** CIE xy and CCT from a spectrum sampled on the CIE grid. */
function chromaticityOf(spectrum: number[]): Chromaticity {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let i = 0; i < CIE_1931.length; i++) {
    const power = spectrum[i];
    X += power * CIE_1931[i][0];
    Y += power * CIE_1931[i][1];
    Z += power * CIE_1931[i][2];
  }
  const sum = X + Y + Z;
  if (!(sum > 0)) return { x: 0.3333, y: 0.3333, cct: 0 };
  const x = X / sum;
  const y = Y / sum;
  // McCamy (1992). Good to a few kelvin over the daylight range, and its
  // epicentre is close enough to the Planckian locus for sunlight.
  const n = (x - 0.332) / (0.1858 - y);
  const cct = 437 * n ** 3 + 3601 * n ** 2 + 6861 * n + 5517;
  return { x, y, cct };
}

/**
 * The extraterrestrial spectrum, as a 5772 K Planck curve.
 *
 * An approximation, and worth naming as one: the real spectrum is riddled with
 * Fraunhofer absorption lines and departs from a blackbody in the blue. At the
 * 10 nm resolution used here none of that survives sampling anyway, and for
 * chromaticity — which is what this is for — the error is small next to the
 * turbidity we are guessing at.
 */
function planck5772(): number[] {
  const T = 5772;
  const h = 6.62607015e-34;
  const c = 2.99792458e8;
  const k = 1.380649e-23;
  return CIE_1931.map((_, i) => {
    const lambda = cieWavelength(i) * 1e-9;
    return (2 * h * c * c) / (lambda ** 5 * (Math.exp((h * c) / (lambda * k * T)) - 1));
  });
}

const E0 = planck5772();

/** Extraterrestrial illuminance normal to the beam, lux. The standard value. */
const EXTRATERRESTRIAL_LUX = 133_100;

export interface SpectralResult {
  airMass: number;
  pressureRatio: number;
  /** Colour of the direct beam. */
  sun: Chromaticity;
  /** Colour of the skylight — see `skySpectrum` for what this is and is not. */
  sky: Chromaticity;
  /** Illuminance of the beam on a surface square to it, lux. */
  directLux: number;
}

/**
 * Colour and strength of the direct beam, and the colour of the sky.
 *
 * Luminous rather than radiometric on purpose: the visible band is the only one
 * a photograph records, and computing lux from the same integral that produced
 * the chromaticity means the colour and the exposure can never disagree.
 */
export function spectralLight(input: SpectralInput): SpectralResult {
  const m = airMass(input.altitudeDeg);
  const p = pressureRatio(input.elevationM);
  const mp = m * p;
  const ozone = input.ozoneCm ?? 0.3;

  const beam: number[] = [];
  const sky: number[] = [];
  let luminousIn = 0;
  let luminousOut = 0;

  for (let i = 0; i < CIE_1931.length; i++) {
    const um = cieWavelength(i) / 1000;
    const tR = rayleighDepth(um) * p;
    const tA = input.aerosol.beta * um ** -input.aerosol.alpha;
    const tO = OZONE_CHAPPUIS[i] * ozone;

    const transmitted = Number.isFinite(mp) ? Math.exp(-(tR + tA + tO) * mp) : 0;
    beam[i] = E0[i] * transmitted;

    // Skylight, approximately: the part of the beam Rayleigh scattering removed,
    // then attenuated by everything else on its way down. Not a radiative
    // transfer solution — there is no multiple scattering here and no angular
    // dependence — but it carries the behaviour that matters, which is that
    // thin dry air scatters selectively and goes deep blue, while large
    // maritime particles scatter neutrally and go white.
    const scattered = 1 - Math.exp(-tR * mp);
    sky[i] = E0[i] * scattered * Math.exp(-(tA + tO) * mp);

    luminousIn += E0[i] * CIE_1931[i][1];
    luminousOut += beam[i] * CIE_1931[i][1];
  }

  return {
    airMass: m,
    pressureRatio: p,
    sun: chromaticityOf(beam),
    sky: chromaticityOf(sky),
    // The luminous transmittance of the path, against a known extraterrestrial
    // illuminance — so the absolute scale never depends on the Planck fit.
    directLux: EXTRATERRESTRIAL_LUX * (luminousIn > 0 ? luminousOut / luminousIn : 0),
  };
}

/* ── How much of it is a shadow, and how much is fill ──────────────────────── */

export interface BirdInput extends SpectralInput {
  /** Precipitable water, cm. 1.5 is a temperate default. */
  waterCm?: number;
  /** Ground reflectance, for the sky-ground multiple reflection term. */
  albedo?: number;
}

export interface BirdResult {
  /** Direct normal irradiance, W/m². */
  directNormal: number;
  /** Diffuse irradiance on a horizontal surface, W/m². */
  diffuseHorizontal: number;
  /** Global horizontal irradiance, W/m². */
  globalHorizontal: number;
  /** Share of the horizontal light arriving as skylight, 0–1. */
  diffuseFraction: number;
}

/**
 * Bird & Hulstrom's clear-sky model (1981).
 *
 * The compact, widely validated one. What it is wanted for here is not the
 * watts but the *ratio*: direct beam against skylight is exactly the key-to-fill
 * of the scene, and therefore how hard the light is and how deep the shadows
 * go. It is the number that separates a mountain ridge from a hazy coast even
 * when both have the sun at the same height.
 */
export function birdClearSky(input: BirdInput): BirdResult {
  const m = airMass(input.altitudeDeg);
  if (!Number.isFinite(m) || input.altitudeDeg <= 0) {
    return { directNormal: 0, diffuseHorizontal: 0, globalHorizontal: 0, diffuseFraction: 1 };
  }
  const p = pressureRatio(input.elevationM);
  const ma = m * p;
  const ozone = input.ozoneCm ?? 0.3;
  const water = input.waterCm ?? 1.5;
  const albedo = input.albedo ?? 0.2;
  const cosZ = Math.sin((input.altitudeDeg * Math.PI) / 180);

  const I0 = 1353; // Bird's solar constant

  const tRayleigh = Math.exp(-0.0903 * ma ** 0.84 * (1 + ma - ma ** 1.01));
  const xo = ozone * m;
  const tOzone =
    1 -
    0.1611 * xo * (1 + 139.48 * xo) ** -0.3034 -
    (0.002715 * xo) / (1 + 0.044 * xo + 0.0003 * xo ** 2);
  const tMixed = Math.exp(-0.0127 * ma ** 0.26);
  const xw = water * m;
  const tWater = 1 - (2.4959 * xw) / ((1 + 79.034 * xw) ** 0.6828 + 6.385 * xw);

  // Bird takes the aerosol as a broadband depth weighted across two anchors.
  const tau380 = input.aerosol.beta * 0.38 ** -input.aerosol.alpha;
  const tau500 = input.aerosol.beta * 0.5 ** -input.aerosol.alpha;
  const tau = 0.2758 * tau380 + 0.35 * tau500;
  const tAerosol = Math.exp(-(tau ** 0.873) * (1 + tau - tau ** 0.7088) * m ** 0.9108);

  const directNormal = 0.9662 * I0 * tRayleigh * tOzone * tMixed * tWater * tAerosol;
  const directHorizontal = directNormal * cosZ;

  // Aerosol absorption vs scattering: ω₀ = 0.9 is Bird's single-scattering
  // albedo, and 0.84 the forward-scatter fraction.
  const tAbsorb = 1 - (1 - 0.9) * (1 - ma + ma ** 1.06) * (1 - tAerosol);
  const tScatter = tAerosol / tAbsorb;
  const forward = 0.84;

  const scatteredDown =
    (I0 *
      cosZ *
      0.79 *
      tOzone *
      tMixed *
      tWater *
      tAbsorb *
      (0.5 * (1 - tRayleigh) + forward * (1 - tScatter))) /
    (1 - ma + ma ** 1.02);

  const skyAlbedo = 0.0685 + (1 - forward) * (1 - tScatter);
  const globalHorizontal = (directHorizontal + scatteredDown) / (1 - albedo * skyAlbedo);
  const diffuseHorizontal = Math.max(0, globalHorizontal - directHorizontal);

  return {
    directNormal: Math.max(0, directNormal),
    diffuseHorizontal,
    globalHorizontal: Math.max(0, globalHorizontal),
    diffuseFraction: globalHorizontal > 0 ? diffuseHorizontal / globalHorizontal : 1,
  };
}

/* ── What a photographer asked ─────────────────────────────────────────────── */

export interface LightReading extends SpectralResult, BirdResult {
  /** Illuminance from the sky on a horizontal surface, lux. */
  diffuseLux: number;
  /** Incident-light EV at ISO 100 for a subject facing the sun. */
  ev100: number;
  /** Key against fill, in stops. The number that means "hard" or "soft". */
  contrastStops: number;
}

/**
 * Everything above, as the three numbers worth printing.
 *
 * Colour temperature for white balance, contrast in stops for whether you need
 * fill, and EV for exposure. Nothing here reports optical depth, because nobody
 * has ever set a camera by it.
 */
export function readLight(input: BirdInput): LightReading {
  const spectral = spectralLight(input);
  const bird = birdClearSky(input);

  // The sky's illuminance rides across on the radiometric ratio rather than
  // being integrated separately. Both are horizontal, so the sin(h) cancels and
  // this is just `directLux · diffuse/direct`. Skylight is bluer and therefore
  // slightly more luminous per watt; that error is a few percent and well
  // inside the uncertainty of the turbidity that produced it.
  //
  // With no beam at all there is no ratio to ride on, so it falls back to a
  // nominal efficacy — overcast and twilight skylight sit near 110 lm/W.
  const diffuseLux =
    bird.directNormal > 1
      ? spectral.directLux * (bird.diffuseHorizontal / bird.directNormal)
      : bird.diffuseHorizontal * 110;

  // Key against fill, both measured on the *same* plane.
  //
  // Getting this wrong is easy and the result looks plausible: comparing the
  // beam normal to its own path against skylight on the horizontal says the
  // light gets *harder* towards sunset, because the beam-normal figure carries
  // no cosine while the sky's does. It is the wrong way round — a low sun is
  // soft precisely because so little of the beam lands on the ground and the
  // sky keeps filling.
  //
  // Horizontal for both, which is also the plane a ground shadow lives on: lit
  // ground gets beam plus sky, shadowed ground gets sky alone, and the ratio
  // between them is exactly this.
  const sinH = Math.max(0, Math.sin((input.altitudeDeg * Math.PI) / 180));
  const lit = spectral.directLux * sinH + diffuseLux;
  const shaded = Math.max(diffuseLux, 1e-6);
  const contrastStops = lit > shaded ? Math.log2(lit / shaded) : 0;

  // Incident-light metering, on a subject turned to face the sun: EV100 =
  // log2(E·S/C) with S=100 and C=250, which puts a bright sunlit scene at about
  // EV 15 — sunny sixteen, as it should.
  const incident = Math.max(spectral.directLux + diffuseLux, 1e-6);
  const ev100 = Math.log2(incident / 2.5);

  return { ...spectral, ...bird, diffuseLux, ev100, contrastStops };
}

/** "5 400 K · 4.6 stops · EV 15" territory, as words. */
export function describeLight(reading: LightReading): string {
  if (!(reading.directLux > 50)) return 'No direct sun — everything here is skylight.';
  const cct = Math.round(reading.sun.cct / 50) * 50;
  const hardness =
    reading.contrastStops >= 4.5
      ? 'hard'
      : reading.contrastStops >= 3
        ? 'firm'
        : reading.contrastStops >= 1.8
          ? 'soft'
          : 'flat';
  return `${cct} K · ${hardness}, ${reading.contrastStops.toFixed(1)} stops key to fill`;
}
