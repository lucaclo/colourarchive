/**
 * How the map looks, and how the sun lights it.
 *
 * Two jobs, both pure so they can be reasoned about without a GPU.
 *
 * The first is legibility. OpenFreeMap's `dark` style paints its roads at
 * RGB 18–24 on a 12,12,12 background — a contrast ratio of about 1.1:1, which
 * on a laptop in daylight is indistinguishable from a blank rectangle. That is
 * not a broken map, but it looks exactly like one. `contrastOverrides` lifts the
 * handful of layers that carry the shape of a place until it reads.
 *
 * The second is light. Everything below takes the sun's altitude and azimuth and
 * returns colours: what the sky does, how warm the light is, how strong it is,
 * and which way it comes from. That is the difference between a map with a time
 * slider and a map that shows you the evening.
 */

/** Sampling points for the light, low sun to high. */
interface Stop {
  altitude: number;
  colour: [number, number, number];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const hex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((v) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0')).join('')}`;

/** The same idea for a single number rather than a colour. */
interface NumberStop {
  altitude: number;
  value: number;
}

function rampNumber(stops: NumberStop[], altitude: number): number {
  if (altitude <= stops[0].altitude) return stops[0].value;
  const last = stops[stops.length - 1];
  if (altitude >= last.altitude) return last.value;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (altitude <= b.altitude) {
      const t = (altitude - a.altitude) / (b.altitude - a.altitude);
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value;
}

/** Interpolate a ramp of altitude stops. */
function ramp(stops: Stop[], altitude: number): [number, number, number] {
  if (altitude <= stops[0].altitude) return stops[0].colour;
  const last = stops[stops.length - 1];
  if (altitude >= last.altitude) return last.colour;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (altitude <= b.altitude) {
      const t = (altitude - a.altitude) / (b.altitude - a.altitude);
      return mix(a.colour, b.colour, t);
    }
  }
  return last.colour;
}

/* ── The light itself ──────────────────────────────────────────────────────── */

/**
 * Colour of direct sunlight at a given altitude.
 *
 * Deep amber at the horizon climbing to a near-neutral white overhead — the
 * same progression as the colour temperature of daylight, which runs from
 * roughly 2000K at sunrise to 5500K at noon. Below the horizon it goes blue,
 * because what is left is skylight, not sunlight.
 */
const LIGHT_RAMP: Stop[] = [
  { altitude: -18, colour: [18, 22, 40] },
  { altitude: -6, colour: [40, 58, 105] },
  { altitude: -4, colour: [92, 106, 158] },
  { altitude: 0, colour: [214, 122, 62] },
  { altitude: 6, colour: [240, 176, 104] },
  { altitude: 20, colour: [252, 226, 186] },
  { altitude: 60, colour: [255, 248, 236] },
];

export const sunlightColour = (altitude: number): string => hex(ramp(LIGHT_RAMP, altitude));

/**
 * How strong the direct light is, 0–1.
 *
 * Zero below the horizon — not a small number, zero. There is no direct sun to
 * light anything with, and a building lit from a direction the sun is not in is
 * the sort of confident lie this whole project is built to avoid.
 */
export function sunlightIntensity(altitude: number): number {
  if (altitude <= 0) return 0;
  // Rises quickly out of the horizon murk, then flattens.
  return clamp01(Math.sin((Math.min(altitude, 60) / 60) * (Math.PI / 2)) * 0.62 + 0.06);
}

/** Ambient fill — what lights the shadowed side. Never fully black. */
const AMBIENT_RAMP: Stop[] = [
  { altitude: -18, colour: [10, 11, 16] },
  { altitude: -6, colour: [22, 28, 48] },
  { altitude: 0, colour: [46, 54, 76] },
  { altitude: 15, colour: [78, 88, 104] },
  { altitude: 60, colour: [104, 112, 124] },
];

export const ambientColour = (altitude: number): string => hex(ramp(AMBIENT_RAMP, altitude));

/** The sky behind it all. */
const SKY_RAMP: Stop[] = [
  { altitude: -18, colour: [6, 7, 11] },
  { altitude: -12, colour: [10, 14, 28] },
  { altitude: -6, colour: [24, 36, 70] },
  { altitude: -2, colour: [66, 74, 116] },
  { altitude: 2, colour: [150, 108, 88] },
  { altitude: 10, colour: [96, 118, 150] },
  { altitude: 40, colour: [70, 100, 140] },
];

export const skyColour = (altitude: number): string => hex(ramp(SKY_RAMP, altitude));

/** Ground shadow colour. Cooler and deeper as the light goes. */
const SHADOW_RAMP: Stop[] = [
  { altitude: 0, colour: [14, 18, 32] },
  { altitude: 10, colour: [20, 26, 44] },
  { altitude: 45, colour: [28, 34, 52] },
];

export const shadowColour = (altitude: number): string => hex(ramp(SHADOW_RAMP, altitude));

/**
 * How dark a cast shadow should read, 0–1.
 *
 * Not a constant, because the difference between lit and shaded ground is not a
 * constant. At 2° the sunlight has crossed something like thirty atmospheres:
 * what is left of the direct beam is weak, and most of what lights the street is
 * skylight, which falls inside the shadow as readily as outside it. Painting a
 * dawn shadow as hard as a noon one asserts a contrast that is not there — and
 * at dawn there are far more shadows, overlapping, so the overstatement compounds
 * until the map is a dark smear.
 */
export function shadowOpacity(altitude: number): number {
  if (!(altitude > 0)) return 0;
  return 0.24 + 0.22 * clamp01(altitude / 18);
}

/* ── The whole scene, graded ───────────────────────────────────────────────── */

/**
 * The colour the entire scene is bathed in, and how strongly.
 *
 * The basemap underneath is a fixed set of colours — a city at midnight and the
 * same city at noon come off the tile server identical. That is the right call
 * for a tile server and the wrong one for a map whose entire subject is the
 * light. This is the wash that puts the time of day back: violet before dawn,
 * amber through the golden hour, all but gone at midday when the light is
 * neutral and there is nothing to say.
 *
 * It is a presentational cast over the ground, not a claim about any particular
 * place — everything that *is* a claim (shadows, hillshade direction, the sun's
 * own position) is drawn on top of it and computed, not tinted.
 */
const WASH_RAMP: Stop[] = [
  { altitude: -18, colour: [4, 8, 22] },
  { altitude: -8, colour: [10, 18, 44] },
  { altitude: -4, colour: [26, 32, 68] },
  { altitude: -1, colour: [86, 62, 92] },
  { altitude: 1, colour: [214, 118, 54] },
  { altitude: 4, colour: [232, 152, 70] },
  { altitude: 10, colour: [244, 200, 132] },
  { altitude: 25, colour: [252, 236, 206] },
  { altitude: 55, colour: [255, 250, 240] },
];

const WASH_OPACITY: NumberStop[] = [
  { altitude: -18, value: 0.5 },
  { altitude: -8, value: 0.46 },
  { altitude: -4, value: 0.38 },
  { altitude: -1, value: 0.3 },
  { altitude: 1, value: 0.26 },
  { altitude: 4, value: 0.22 },
  { altitude: 10, value: 0.14 },
  { altitude: 25, value: 0.07 },
  { altitude: 55, value: 0.03 },
];

export interface Wash {
  colour: string;
  opacity: number;
}

export const daylightWash = (altitude: number): Wash => ({
  colour: hex(ramp(WASH_RAMP, altitude)),
  opacity: rampNumber(WASH_OPACITY, altitude),
});

/* ── Buildings ─────────────────────────────────────────────────────────────── */

export type BasemapTheme = 'light' | 'dark';

/**
 * MapLibre lights an extrusion by *multiplying* the face colour by the light
 * colour. That makes a literal sunlight colour unusable: feed it the deep blue
 * of astronomical twilight and every building goes black, feed it the amber of
 * sunrise and every building loses two thirds of its brightness at exactly the
 * hour a scout is looking at.
 *
 * So the light carries hue and the building carries value. This normalises the
 * sun's colour to full brightness — same cast, no dimming — and pulls it part of
 * the way to white, because the faces turned away from the sun are lit by the
 * sky rather than by the sun and should not take the full amber.
 */
export function extrusionLightColour(altitude: number): string {
  const raw = ramp(LIGHT_RAMP, altitude);
  const peak = Math.max(...raw, 1);
  const normalised = raw.map((c) => (c * 255) / peak) as [number, number, number];
  return hex(mix(normalised, [255, 255, 255], 0.4));
}

/**
 * How directional the light is, for MapLibre's `light.intensity`.
 *
 * Deliberately *not* `sunlightIntensity`, which is how much energy is in the
 * beam. This is a different quantity and it runs the other way: a low sun rakes
 * across a facade and the difference between the face pointing at it and the
 * face beside it is at its greatest, while at noon the sun is overhead, every
 * wall is lit at a similar grazing angle, and the modelling flattens out. Using
 * beam strength here made dawn — the one hour this tab exists for — the flattest
 * light of the day.
 */
export function directionalIntensity(altitude: number): number {
  // Below the horizon there is no direction to light from, so the shading goes
  // flat rather than inventing a side for the light to come from.
  if (altitude <= 0) return 0.08;
  return 0.42 + 0.36 * clamp01(1 - altitude / 25);
}

/** A height in metres and the colour a building of that height should be. */
export interface BuildingStop {
  height: number;
  colour: string;
}

/** Where the ramp is sampled. Log-ish, so low-rise gets most of the range. */
const BUILDING_HEIGHTS = [0, 8, 18, 40, 90, 200];

/**
 * The two ends of each theme's building ramp, at night and at midday.
 *
 * `low` is a two-storey shop, `tall` is a tower. They differ because they are
 * genuinely differently lit: a low roof sits at the bottom of a street canyon
 * with a slot of sky above it, while the top of a tower sees the whole
 * hemisphere and, at dawn and dusk, sees the sun a good while before the street
 * does. A city drawn in one flat grey throws that away, and a skyline is most of
 * what you are reading a 3D map for.
 */
const BUILDING_ENDS: Record<
  BasemapTheme,
  { night: [string, string]; day: [string, string] }
> = {
  dark: { night: ['#14161c', '#2b313c'], day: ['#2e323a', '#626b79'] },
  light: { night: ['#2c3140', '#545d73'], day: ['#bfb8ac', '#f4efe6'] },
};

const rgb = (value: string): [number, number, number] => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

/**
 * How far through the day it is, 0–1, across civil twilight.
 *
 * Civil twilight rather than the horizon because that is when the change is
 * actually visible on the ground: -6° is when you can no longer read outside,
 * +6° is when the light has stopped being golden.
 */
const daylight = (altitude: number) => clamp01((altitude + 6) / 12);

/**
 * The building colour ramp for a given sun and basemap, ready to be fed to a
 * `fill-extrusion-color` interpolation on `render_height`.
 */
export function buildingColours(altitude: number, theme: BasemapTheme): BuildingStop[] {
  const ends = BUILDING_ENDS[theme];
  const t = daylight(altitude);
  const low = mix(rgb(ends.night[0]), rgb(ends.day[0]), t);
  const tall = mix(rgb(ends.night[1]), rgb(ends.day[1]), t);
  const span = Math.log10(1 + 200 / 8);
  return BUILDING_HEIGHTS.map((height) => ({
    height,
    colour: hex(mix(low, tall, clamp01(Math.log10(1 + height / 8) / span))),
  }));
}

/**
 * MapLibre's `setLight` position, as [radial, azimuthal, polar].
 *
 * With `anchor: 'map'` the azimuthal angle is measured clockwise from north —
 * the same convention the sun engine already uses — and the polar angle is
 * measured down from straight overhead, so it is 90 minus the altitude.
 */
export function lightPosition(azimuth: number, altitude: number): [number, number, number] {
  return [1.4, ((azimuth % 360) + 360) % 360, Math.max(0, Math.min(180, 90 - altitude))];
}

/* ── Basemap legibility ────────────────────────────────────────────────────── */

export interface PaintOverride {
  layerId: string;
  property: string;
  value: string | number;
}

interface MinimalLayer {
  id: string;
  type: string;
  'source-layer'?: string;
}

/**
 * Lift the stock dark style until a person can actually read it.
 *
 * Driven off each layer's *source-layer* rather than its id, because ids are a
 * styling choice that can change under us while the OpenMapTiles schema is a
 * contract. Anything unrecognised is left exactly as it was.
 */
export function contrastOverrides(layers: MinimalLayer[]): PaintOverride[] {
  const out: PaintOverride[] = [];
  const push = (layerId: string, property: string, value: string | number) =>
    out.push({ layerId, property, value });

  for (const layer of layers) {
    const source = layer['source-layer'];
    if (layer.type === 'background') {
      push(layer.id, 'background-color', '#101014');
      continue;
    }
    if (source === 'water' && layer.type === 'fill') {
      push(layer.id, 'fill-color', '#16233a');
      continue;
    }
    if (source === 'waterway' && layer.type === 'line') {
      push(layer.id, 'line-color', '#1b2c47');
      continue;
    }
    if (source === 'transportation' && layer.type === 'line') {
      // The single most important change: roads are the shape of a city.
      // Majors clear 3:1 against the background — WCAG's floor for a graphical
      // object — so the street grid survives a bright room and a laptop screen.
      const major = /motorway|trunk|primary/i.test(layer.id);
      push(layer.id, 'line-color', major ? '#666b75' : '#454a53');
      continue;
    }
    if (source === 'building' && layer.type === 'fill') {
      push(layer.id, 'fill-color', '#24262c');
      push(layer.id, 'fill-outline-color', '#2f3238');
      continue;
    }
    if (source === 'landcover' || source === 'landuse') {
      if (layer.type === 'fill') push(layer.id, 'fill-color', '#171a1c');
      continue;
    }
    if (layer.type === 'symbol') {
      push(layer.id, 'text-color', '#a9adb4');
      push(layer.id, 'text-halo-color', '#0b0c0f');
      continue;
    }
    if (source === 'boundary' && layer.type === 'line') {
      push(layer.id, 'line-color', '#3a3f48');
    }
  }
  return out;
}

/**
 * Contrast ratio between two hex colours, by WCAG's relative luminance.
 * Used in the tests to assert the overrides actually achieve something rather
 * than merely being different numbers.
 */
export function contrastRatio(a: string, b: string): number {
  const luminance = (colour: string) => {
    const value = colour.replace('#', '');
    const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
    const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
