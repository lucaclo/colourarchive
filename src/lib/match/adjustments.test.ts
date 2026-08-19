/**
 * Tests for the adjustment algebra.
 *
 * This file is arithmetic wearing a Lightroom costume, and the costume is the
 * point: every range in `clampAdjustments` exists because Lightroom's own .xmp
 * importer drops an out-of-range value silently rather than clamping it for
 * you, so a number that never gets pulled back into range does not fail loudly
 * later — it just quietly stops being a feature. The tests below therefore lean
 * on the range comments in adjustments.ts as ground truth, not on guesses about
 * what "reasonable" might mean.
 *
 * Two spots get more attention than a flat sweep of ranges would give them,
 * because both are places where the obvious implementation would be wrong:
 *
 *   - GradeWheel.hue is a colour-wheel angle, not a bounded slider, so it is
 *     wrapped modulo 360 rather than clamped — clamping would make every
 *     negative hue collapse to red (0) instead of continuing round to violet.
 *   - lerpAdjustments blends hue circularly (350 to 10 goes through 0, the
 *     20-degree way, not through 180) and fades absent masks in from neutral
 *     rather than snapping them into existence at the midpoint. Getting either
 *     of these wrong would not show up as a crash — it would show up as a
 *     preset that looks subtly deranged at 50% strength, which is a much
 *     worse bug to chase.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  atGroupStrength,
  atStrength,
  clamp,
  clampAdjustments,
  flatGroupStrength,
  identityAdjustments,
  lerpAdjustments,
  zeroHsl,
  type Adjustments,
  type MaskAdjustment,
} from './adjustments.ts';

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

/** A full, in-range Adjustments with every field distinguishable from its
 *  neighbour, so a mis-wired field in clamp/lerp shows up as a wrong number
 *  rather than an accidental pass. Shares curve x positions with `fixtureB`,
 *  as the solver guarantees two blendable solutions always do. */
function fixtureA(): Adjustments {
  return {
    exposure: 1,
    contrast: 10,
    highlights: -20,
    shadows: 15,
    whites: 5,
    blacks: -5,
    curve: [
      { x: 0, y: 0 },
      { x: 128, y: 140 },
      { x: 255, y: 255 },
    ],
    temp: 10,
    tint: -5,
    vibrance: 20,
    saturation: 10,
    hsl: {
      red: { hue: 5, sat: 10, lum: 0 },
      orange: { hue: -5, sat: 5, lum: 5 },
      yellow: { hue: 0, sat: 0, lum: 0 },
      green: { hue: 10, sat: -10, lum: -5 },
      aqua: { hue: 0, sat: 0, lum: 0 },
      blue: { hue: -10, sat: 20, lum: 0 },
      purple: { hue: 0, sat: 0, lum: 0 },
      magenta: { hue: 0, sat: 0, lum: 0 },
    },
    grading: {
      global: { hue: 200, sat: 20, lum: 0 },
      shadows: { hue: 210, sat: 10, lum: -5 },
      midtones: { hue: 0, sat: 0, lum: 0 },
      highlights: { hue: 40, sat: 15, lum: 5 },
      blending: 40,
      balance: 10,
    },
    texture: 10,
    clarity: 5,
    dehaze: -5,
    vignette: -10,
    grainAmount: 10,
    grainSize: 30,
    grainRoughness: 40,
    sharpenAmount: 20,
    sharpenRadius: 1.2,
    sharpenDetail: 30,
    noiseReduction: 10,
    colorNoiseReduction: 5,
    masks: [],
  };
}

/** Same shape as `fixtureA`, different numbers throughout, still in range. */
function fixtureB(): Adjustments {
  return {
    exposure: -1,
    contrast: -30,
    highlights: 40,
    shadows: -25,
    whites: -15,
    blacks: 25,
    curve: [
      { x: 0, y: 10 },
      { x: 128, y: 100 },
      { x: 255, y: 245 },
    ],
    temp: -30,
    tint: 15,
    vibrance: -10,
    saturation: -20,
    hsl: {
      red: { hue: -15, sat: 30, lum: 10 },
      orange: { hue: 15, sat: -5, lum: -5 },
      yellow: { hue: 0, sat: 0, lum: 0 },
      green: { hue: -10, sat: 10, lum: 5 },
      aqua: { hue: 0, sat: 0, lum: 0 },
      blue: { hue: 10, sat: -20, lum: 0 },
      purple: { hue: 0, sat: 0, lum: 0 },
      magenta: { hue: 0, sat: 0, lum: 0 },
    },
    grading: {
      global: { hue: 40, sat: 40, lum: 10 },
      shadows: { hue: 230, sat: 30, lum: 5 },
      midtones: { hue: 0, sat: 0, lum: 0 },
      highlights: { hue: 60, sat: 5, lum: -5 },
      blending: 60,
      balance: -10,
    },
    texture: -10,
    clarity: -5,
    dehaze: 15,
    vignette: 10,
    grainAmount: 30,
    grainSize: 10,
    grainRoughness: 20,
    sharpenAmount: 60,
    sharpenRadius: 0.8,
    sharpenDetail: 50,
    noiseReduction: 30,
    colorNoiseReduction: 15,
    masks: [],
  };
}

const mask = (overrides: Partial<MaskAdjustment> = {}): MaskAdjustment => ({
  region: 'people.skin',
  kind: 'subject',
  label: 'Skin',
  exposure: 0,
  temp: 0,
  tint: 0,
  saturation: 0,
  contrast: 0,
  rationale: 'test fixture',
  ...overrides,
});

/* ── zeroHsl ───────────────────────────────────────────────────────────────── */

describe('zeroHsl', () => {
  it('gives all eight Lightroom bands, each at neutral', () => {
    const z = zeroHsl();
    const keys = Object.keys(z).sort();
    assert.deepEqual(keys, [
      'aqua', 'blue', 'green', 'magenta', 'orange', 'purple', 'red', 'yellow',
    ]);
    for (const key of keys as (keyof typeof z)[]) {
      assert.deepEqual(z[key], { hue: 0, sat: 0, lum: 0 });
    }
  });
});

/* ── identityAdjustments ───────────────────────────────────────────────────── */

describe('identityAdjustments', () => {
  it('leaves the tone and colour controls at their neutral value', () => {
    const id = identityAdjustments();
    assert.equal(id.exposure, 0);
    assert.equal(id.contrast, 0);
    assert.equal(id.highlights, 0);
    assert.equal(id.shadows, 0);
    assert.equal(id.whites, 0);
    assert.equal(id.blacks, 0);
    assert.equal(id.temp, 0);
    assert.equal(id.tint, 0);
    assert.equal(id.vibrance, 0);
    assert.equal(id.saturation, 0);
    assert.deepEqual(id.hsl, zeroHsl());
    assert.equal(id.texture, 0);
    assert.equal(id.clarity, 0);
    assert.equal(id.dehaze, 0);
    assert.equal(id.vignette, 0);
    assert.equal(id.noiseReduction, 0);
    assert.equal(id.colorNoiseReduction, 0);
    assert.deepEqual(id.masks, []);
  });

  it('zeroes every grading wheel but leaves blending at its own default of 50', () => {
    // Blending at 0 would mean "no blend at all" in Lightroom's own control,
    // which is not the same thing as "no colour grading applied" — 50 is the
    // slider's neutral rest position, not its off switch.
    const id = identityAdjustments();
    assert.deepEqual(id.grading.global, { hue: 0, sat: 0, lum: 0 });
    assert.deepEqual(id.grading.shadows, { hue: 0, sat: 0, lum: 0 });
    assert.deepEqual(id.grading.midtones, { hue: 0, sat: 0, lum: 0 });
    assert.deepEqual(id.grading.highlights, { hue: 0, sat: 0, lum: 0 });
    assert.equal(id.grading.blending, 50);
    assert.equal(id.grading.balance, 0);
  });

  it('gives grain and sharpening their own non-zero rest positions', () => {
    // These four fields are not "no effect at zero" sliders — Lightroom's own
    // panel defaults land here, so this is what an untouched photo reads as.
    const id = identityAdjustments();
    assert.equal(id.grainAmount, 0);
    assert.equal(id.grainSize, 25);
    assert.equal(id.grainRoughness, 50);
    assert.equal(id.sharpenAmount, 0);
    assert.equal(id.sharpenRadius, 1);
    assert.equal(id.sharpenDetail, 25);
  });

  it('produces a straight-line curve — every point maps to itself', () => {
    const id = identityAdjustments();
    assert.ok(id.curve.length > 0);
    for (const p of id.curve) assert.equal(p.y, p.x);
  });

  it('defaults the curve to the standard two-point line, 0 and 255', () => {
    assert.deepEqual(identityAdjustments().curve, [
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ]);
  });

  it('places the curve at exactly the x positions it is given', () => {
    const xs = [0, 32, 96, 160, 224, 255];
    const id = identityAdjustments(xs);
    assert.deepEqual(id.curve.map((p) => p.x), xs);
    for (const p of id.curve) assert.equal(p.y, p.x);
  });
});

/* ── clamp ─────────────────────────────────────────────────────────────────── */

describe('clamp', () => {
  it('passes through a value already inside the range', () => {
    assert.equal(clamp(5, 0, 10), 5);
  });

  it('pulls a value back to the nearer bound', () => {
    assert.equal(clamp(-5, 0, 10), 0);
    assert.equal(clamp(15, 0, 10), 10);
  });

  it('treats the bounds themselves as in range', () => {
    assert.equal(clamp(0, 0, 10), 0);
    assert.equal(clamp(10, 0, 10), 10);
  });

  it('sends non-finite input to zero, not to either bound', () => {
    // This is the deliberate, non-obvious branch: a NaN or an infinity is not
    // "too high" or "too low" on the number line, so pinning it to `hi` or
    // `lo` would assert a direction the input never claimed. Zero is the one
    // answer that asserts nothing.
    assert.equal(clamp(NaN, -5, 5), 0);
    assert.equal(clamp(Infinity, -5, 5), 0);
    assert.equal(clamp(-Infinity, -5, 5), 0);
    // Holds even when zero itself sits outside the given range.
    assert.equal(clamp(NaN, 10, 20), 0);
    assert.equal(clamp(Infinity, 10, 20), 0);
  });
});

/* ── clampAdjustments ──────────────────────────────────────────────────────── */

describe('clampAdjustments', () => {
  it('leaves an already in-range set of adjustments untouched', () => {
    const a = fixtureA();
    assert.deepEqual(clampAdjustments(a), a);
  });

  it('pulls Light fields back into -5..5 / -100..100', () => {
    const a = identityAdjustments();
    a.exposure = 10; // range is -5..5
    assert.equal(clampAdjustments(a).exposure, 5);
  });

  it('pulls Colour fields back into -100..100', () => {
    const a = identityAdjustments();
    a.temp = -500;
    assert.equal(clampAdjustments(a).temp, -100);
  });

  it('pulls HSL mixer fields back into -100..100', () => {
    const a = identityAdjustments();
    a.hsl.red.hue = 500;
    assert.equal(clampAdjustments(a).hsl.red.hue, 100);
  });

  it('pulls a grading wheel saturation/luminance back into range', () => {
    const a = identityAdjustments();
    a.grading.global.sat = 500; // range is 0..100
    a.grading.global.lum = -500; // range is -100..100
    const c = clampAdjustments(a);
    assert.equal(c.grading.global.sat, 100);
    assert.equal(c.grading.global.lum, -100);
  });

  it('pulls grading blending and balance back into their own ranges', () => {
    const a = identityAdjustments();
    a.grading.blending = 500; // range is 0..100
    a.grading.balance = -500; // range is -100..100
    const c = clampAdjustments(a);
    assert.equal(c.grading.blending, 100);
    assert.equal(c.grading.balance, -100);
  });

  it('wraps a grading wheel hue modulo 360 instead of clamping it', () => {
    // Hue is a position on a colour wheel, not a bounded quantity: -10 degrees
    // is the same colour as 350, and collapsing it to 0 (red) would be wrong.
    const a = identityAdjustments();
    a.grading.global.hue = -10;
    assert.equal(clampAdjustments(a).grading.global.hue, 350);
  });

  it('wraps a grading wheel hue past a full turn the same way', () => {
    const a = identityAdjustments();
    a.grading.shadows.hue = 370;
    assert.equal(clampAdjustments(a).grading.shadows.hue, 10);
    a.grading.shadows.hue = 720 + 45;
    assert.equal(clampAdjustments(a).grading.shadows.hue, 45);
  });

  it('pulls Effects fields back into range', () => {
    const a = identityAdjustments();
    a.texture = 500; // range is -100..100
    a.vignette = -500;
    const c = clampAdjustments(a);
    assert.equal(c.texture, 100);
    assert.equal(c.vignette, -100);
  });

  it('pulls Detail fields back into their own ranges', () => {
    const a = identityAdjustments();
    a.sharpenAmount = 1000; // range is 0..150
    a.sharpenRadius = 10; // range is 0.5..3
    const c = clampAdjustments(a);
    assert.equal(c.sharpenAmount, 150);
    assert.equal(c.sharpenRadius, 3);
  });

  it('pulls a mask field back into its own range', () => {
    const a = identityAdjustments();
    a.masks = [mask({ exposure: 10, temp: 500 })]; // exposure range is -4..4
    const c = clampAdjustments(a);
    assert.equal(c.masks[0].exposure, 4);
    assert.equal(c.masks[0].temp, 100);
  });

  it('rounds curve points to integers and clamps them to 0..255', () => {
    const a = identityAdjustments();
    a.curve = [
      { x: 300, y: -10.4 },
      { x: 127.6, y: 127.4 },
      { x: -20, y: 260 },
    ];
    const c = clampAdjustments(a);
    assert.deepEqual(c.curve, [
      { x: 255, y: 0 },
      { x: 128, y: 127 },
      { x: 0, y: 255 },
    ]);
  });
});

/* ── lerpAdjustments ───────────────────────────────────────────────────────── */

describe('lerpAdjustments', () => {
  it('at t=0 gives back the first argument, unchanged', () => {
    // Fixtures are already in range, so clampAdjustments (piped in at the end
    // of lerpAdjustments) is a no-op here — this checks the lerp itself, not
    // clamping riding along with it.
    const a = fixtureA();
    assert.deepEqual(lerpAdjustments(a, fixtureB(), 0), a);
  });

  it('at t=1 gives back the second argument, unchanged', () => {
    const b = fixtureB();
    assert.deepEqual(lerpAdjustments(fixtureA(), b, 1), b);
  });

  it('at t=0.5 is the arithmetic mean, field by field', () => {
    const a = fixtureA();
    const b = fixtureB();
    const mid = lerpAdjustments(a, b, 0.5);
    const mean = (x: number, y: number) => (x + y) / 2;
    assert.equal(mid.exposure, mean(a.exposure, b.exposure));
    assert.equal(mid.temp, mean(a.temp, b.temp));
    assert.equal(mid.vibrance, mean(a.vibrance, b.vibrance));
    assert.equal(mid.texture, mean(a.texture, b.texture));
    assert.equal(mid.sharpenAmount, mean(a.sharpenAmount, b.sharpenAmount));
    assert.equal(mid.noiseReduction, mean(a.noiseReduction, b.noiseReduction));
    assert.equal(mid.grading.blending, mean(a.grading.blending, b.grading.blending));
    assert.equal(mid.hsl.red.hue, mean(a.hsl.red.hue, b.hsl.red.hue));
    assert.equal(mid.hsl.blue.sat, mean(a.hsl.blue.sat, b.hsl.blue.sat));
    // Non-circular wheel fields (sat/lum) are plain means too.
    assert.ok(Math.abs(mid.grading.global.sat - mean(a.grading.global.sat, b.grading.global.sat)) < 1e-9);
  });

  it('takes the short way round a grading wheel hue, not the arithmetic mean', () => {
    // 350 to 10 is 20 degrees apart through zero. The naive mean, 180, would
    // be the far side of the wheel — the whole reason lerpHue exists.
    const a = fixtureA();
    const b = fixtureB();
    a.grading.global.hue = 350;
    b.grading.global.hue = 10;
    const mid = lerpAdjustments(a, b, 0.5);
    assert.equal(mid.grading.global.hue, 0);
  });

  it('adopts the other side\'s hue outright when one side has no saturation', () => {
    // A wheel with sat ~0 has no meaningful hue to blend from/to, so the
    // interpolated hue should just be the other side's, at any t — not some
    // blend toward an arbitrary angle.
    const a = fixtureA();
    const b = fixtureB();
    a.grading.global = { hue: 123, sat: 0, lum: 0 };
    b.grading.global = { hue: 77, sat: 80, lum: 0 };
    assert.equal(lerpAdjustments(a, b, 0.5).grading.global.hue, 77);
    assert.equal(lerpAdjustments(a, b, 0.1).grading.global.hue, 77);
    assert.equal(lerpAdjustments(a, b, 0.9).grading.global.hue, 77);
  });

  it('fades a mask present only in `a` toward neutral as t runs to 1', () => {
    const a = fixtureA();
    a.masks = [mask({ exposure: 2, temp: 40, tint: -20, saturation: 30, contrast: 10 })];
    const b = fixtureB();
    b.masks = [];

    const start = lerpAdjustments(a, b, 0);
    assert.equal(start.masks.length, 1);
    assert.equal(start.masks[0].exposure, 2);
    assert.equal(start.masks[0].temp, 40);
    assert.equal(start.masks[0].tint, -20);
    assert.equal(start.masks[0].saturation, 30);
    assert.equal(start.masks[0].contrast, 10);

    const end = lerpAdjustments(a, b, 1);
    assert.equal(end.masks.length, 1);
    assert.equal(end.masks[0].exposure, 0);
    assert.equal(end.masks[0].temp, 0);
    assert.equal(end.masks[0].tint, 0);
    assert.equal(end.masks[0].saturation, 0);
    assert.equal(end.masks[0].contrast, 0);
    // Identity, label and rationale ride along even once the mask has faded.
    assert.equal(end.masks[0].region, 'people.skin');
    assert.equal(end.masks[0].label, 'Skin');
  });

  it('fades a mask present only in `b` in from neutral as t runs from 0', () => {
    const a = fixtureA();
    a.masks = [];
    const b = fixtureB();
    b.masks = [mask({ exposure: -1, temp: 25, tint: 10, saturation: -15, contrast: 20 })];

    const start = lerpAdjustments(a, b, 0);
    assert.equal(start.masks.length, 1);
    assert.equal(start.masks[0].exposure, 0);
    assert.equal(start.masks[0].temp, 0);
    assert.equal(start.masks[0].tint, 0);
    assert.equal(start.masks[0].saturation, 0);
    assert.equal(start.masks[0].contrast, 0);

    const end = lerpAdjustments(a, b, 1);
    assert.equal(end.masks[0].exposure, -1);
    assert.equal(end.masks[0].temp, 25);
    assert.equal(end.masks[0].tint, 10);
    assert.equal(end.masks[0].saturation, -15);
    assert.equal(end.masks[0].contrast, 20);
  });
});

/* ── atStrength ────────────────────────────────────────────────────────────── */

describe('atStrength', () => {
  const restrained = fixtureA();
  const faithful = fixtureB();

  it('at t=0 is no change at all', () => {
    // Not quite a byte-identical identityAdjustments(), and that is itself
    // evidence the wheel special-case is wired in correctly: identity's
    // grading wheels are all `sat: 0`, so lerpWheel's "adopt the other side's
    // hue outright when a side has no saturation" rule fires and reports
    // `restrained`'s hue immediately rather than 0 — but only ever alongside
    // `sat: 0`, which is what makes that hue invisible. So the true claim at
    // t=0 is "every field reads as no change", checked field by field, with
    // grading-wheel hue asserted separately as "present but neutralised by
    // zero saturation" rather than "equal to identity's arbitrary 0".
    const at0 = atStrength(restrained, faithful, 0);
    const identity = identityAdjustments(restrained.curve.map((p) => p.x));
    const { grading: at0Grading, ...at0Rest } = at0;
    const { grading: identityGrading, ...identityRest } = identity;
    assert.deepEqual(at0Rest, identityRest);
    for (const wheel of ['global', 'shadows', 'midtones', 'highlights'] as const) {
      assert.equal(at0Grading[wheel].sat, identityGrading[wheel].sat, `${wheel}.sat`);
      assert.equal(at0Grading[wheel].lum, identityGrading[wheel].lum, `${wheel}.lum`);
    }
    assert.equal(at0Grading.blending, identityGrading.blending);
    assert.equal(at0Grading.balance, identityGrading.balance);
  });

  it('at t=0.5 is the restrained solution', () => {
    assert.deepEqual(atStrength(restrained, faithful, 0.5), clampAdjustments(restrained));
  });

  it('at t=1 is the faithful solution', () => {
    assert.deepEqual(atStrength(restrained, faithful, 1), clampAdjustments(faithful));
  });

  it('is continuous across the 0.5 seam rather than jumping', () => {
    // The slider is deliberately piecewise (identity→restrained, then
    // restrained→faithful), which is exactly the kind of construction that
    // can hide an off-by-one seam. Values just either side of the midpoint
    // should sit close to each other and close to `restrained`, not show a
    // discontinuity.
    const before = atStrength(restrained, faithful, 0.4999);
    const at = atStrength(restrained, faithful, 0.5);
    const after = atStrength(restrained, faithful, 0.5001);
    assert.ok(Math.abs(before.exposure - at.exposure) < 0.05, `${before.exposure} vs ${at.exposure}`);
    assert.ok(Math.abs(after.exposure - at.exposure) < 0.05, `${after.exposure} vs ${at.exposure}`);
    assert.ok(Math.abs(before.temp - at.temp) < 0.05, `${before.temp} vs ${at.temp}`);
    assert.ok(Math.abs(after.temp - at.temp) < 0.05, `${after.temp} vs ${at.temp}`);
    assert.ok(Math.abs(before.grading.global.sat - at.grading.global.sat) < 0.05);
    assert.ok(Math.abs(after.grading.global.sat - at.grading.global.sat) < 0.05);
  });

  it('clamps t below 0 to the same result as t=0', () => {
    assert.deepEqual(atStrength(restrained, faithful, -1), atStrength(restrained, faithful, 0));
  });

  it('clamps t above 1 to the same result as t=1', () => {
    assert.deepEqual(atStrength(restrained, faithful, 2), atStrength(restrained, faithful, 1));
  });
});

/* ── atGroupStrength ───────────────────────────────────────────────────────── */

describe('atGroupStrength', () => {
  const restrained = fixtureA();
  const faithful = fixtureB();

  it('with all three groups equal, matches the single flat atStrength exactly', () => {
    for (const t of [0, 0.3, 0.5, 0.7, 1]) {
      assert.deepEqual(
        atGroupStrength(restrained, faithful, flatGroupStrength(t)),
        atStrength(restrained, faithful, t),
        `mismatch at t=${t}`,
      );
    }
  });

  it('lets one panel sit at full strength while another holds back — the case the flat slider cannot express', () => {
    // Light at 1 (faithful), Colour at 0.5 (restrained), Effects at 0 (identity).
    const result = atGroupStrength(restrained, faithful, { light: 1, colour: 0.5, effects: 0 });
    const identity = identityAdjustments(restrained.curve.map((p) => p.x));

    // Light fields track the faithful solution.
    assert.equal(result.exposure, clampAdjustments(faithful).exposure);
    assert.equal(result.contrast, clampAdjustments(faithful).contrast);
    assert.deepEqual(result.curve, clampAdjustments(faithful).curve);

    // Colour fields track the restrained solution.
    assert.equal(result.temp, clampAdjustments(restrained).temp);
    assert.equal(result.saturation, clampAdjustments(restrained).saturation);
    assert.deepEqual(result.hsl, clampAdjustments(restrained).hsl);

    // Effects fields track identity (no change).
    assert.equal(result.texture, identity.texture);
    assert.equal(result.grainAmount, identity.grainAmount);
    assert.equal(result.sharpenAmount, identity.sharpenAmount);
  });

  it('splits a single mask across panels: exposure/contrast follow Light, temp/tint/saturation follow Colour', () => {
    const withMasks = (base: Adjustments): Adjustments => ({
      ...base,
      masks: [mask({ exposure: 0.8, contrast: 20, temp: 40, tint: -10, saturation: 30 })],
    });
    const r = withMasks(restrained);
    const f = withMasks(faithful);

    const result = atGroupStrength(r, f, { light: 1, colour: 0, effects: 0 });
    const lightOnly = atStrength(r, f, 1).masks[0];
    const colourOff = atStrength(r, f, 0).masks[0];

    assert.equal(result.masks.length, 1);
    assert.equal(result.masks[0].exposure, lightOnly.exposure);
    assert.equal(result.masks[0].contrast, lightOnly.contrast);
    assert.equal(result.masks[0].temp, colourOff.temp);
    assert.equal(result.masks[0].tint, colourOff.tint);
    assert.equal(result.masks[0].saturation, colourOff.saturation);
  });

  it('clamps each panel independently, same as atStrength', () => {
    const result = atGroupStrength(restrained, faithful, { light: -5, colour: 2, effects: 0.5 });
    assert.deepEqual(
      { exposure: result.exposure, curve: result.curve },
      { exposure: atStrength(restrained, faithful, 0).exposure, curve: atStrength(restrained, faithful, 0).curve },
    );
    assert.equal(result.temp, atStrength(restrained, faithful, 1).temp);
  });
});
