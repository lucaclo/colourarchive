/**
 * Tests for the Lightroom preset writer.
 *
 * A .xmp preset ASSERTS every field it contains — there is no way to write
 * "no opinion" other than omitting the attribute entirely. That single fact
 * drives almost every property worth checking here: which fields the module
 * always writes (the authoritative tone move), which it writes only when
 * non-zero (so Lightroom's own non-zero defaults are not silently stripped),
 * and which it must NEVER write regardless of input (the descriptive-only
 * Basic tone fields, which would double-apply a move the curve already
 * carries). Getting any of these backwards produces a preset that looks fine
 * in a diff but behaves wrongly — or fails to import — inside Lightroom,
 * which is exactly the kind of bug a snapshot test would not catch and a
 * property test will.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { toXmp, buildPresetFiles, type PresetOptions } from './xmp.ts';
import { identityAdjustments, type Adjustments, type MaskAdjustment } from './adjustments.ts';
import { HSL_BANDS } from './types.ts';

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

/** Start from the no-op Adjustments and override just the fields a test cares
 *  about, per the task brief — hand-writing the full ~30-field object every
 *  time would bury each test's actual point in boilerplate. */
function adj(overrides: Partial<Adjustments> = {}): Adjustments {
  return { ...identityAdjustments(), ...overrides };
}

function mask(overrides: Partial<MaskAdjustment> = {}): MaskAdjustment {
  return {
    region: 'subject',
    kind: 'subject',
    label: 'Subject',
    exposure: 0,
    temp: 0,
    tint: 0,
    saturation: 0,
    contrast: 0,
    rationale: 'test fixture',
    ...overrides,
  };
}

const NAME_ONLY: PresetOptions = { name: 'Test Preset' };

/* ── Always-written vs. gated fields ──────────────────────────────────────── */

describe('toXmp — the always-written tone move', () => {
  it('writes Exposure2012 even at 0, since it is the authoritative move', () => {
    const xml = toXmp(identityAdjustments(), NAME_ONLY);
    assert.match(xml, /crs:Exposure2012="\+0\.00"/);
  });
});

describe('toXmp — fields gated on non-zero, omitted at their neutral value', () => {
  const GATED: [keyof Adjustments, string][] = [
    ['texture', 'Texture'],
    ['clarity', 'Clarity2012'],
    ['dehaze', 'Dehaze'],
    ['vibrance', 'Vibrance'],
    ['saturation', 'Saturation'],
  ];

  for (const [field, attr] of GATED) {
    it(`omits ${attr} when ${String(field)} is 0`, () => {
      const xml = toXmp(identityAdjustments(), NAME_ONLY);
      assert.doesNotMatch(xml, new RegExp(`crs:${attr}=`));
    });

    it(`writes ${attr} when ${String(field)} is non-zero`, () => {
      const xml = toXmp(adj({ [field]: 42 } as Partial<Adjustments>), NAME_ONLY);
      assert.match(xml, new RegExp(`crs:${attr}="\\+42"`));
    });
  }

  it('omits the grain block when grainAmount is 0, even with non-default size/roughness', () => {
    const xml = toXmp(adj({ grainAmount: 0, grainSize: 80, grainRoughness: 10 }), NAME_ONLY);
    assert.doesNotMatch(xml, /crs:GrainAmount=/);
    assert.doesNotMatch(xml, /crs:GrainSize=/);
    assert.doesNotMatch(xml, /crs:GrainFrequency=/);
  });

  it('writes the full grain block once amount is non-zero', () => {
    const xml = toXmp(adj({ grainAmount: 30, grainSize: 80, grainRoughness: 10 }), NAME_ONLY);
    assert.match(xml, /crs:GrainAmount="30"/);
    assert.match(xml, /crs:GrainSize="80"/);
    assert.match(xml, /crs:GrainFrequency="10"/);
  });

  it('omits the vignette block when vignette is 0', () => {
    const xml = toXmp(identityAdjustments(), NAME_ONLY);
    assert.doesNotMatch(xml, /crs:PostCropVignetteAmount=/);
  });

  it('writes the vignette block when vignette is non-zero', () => {
    const xml = toXmp(adj({ vignette: -25 }), NAME_ONLY);
    assert.match(xml, /crs:PostCropVignetteAmount="-25"/);
    assert.match(xml, /crs:PostCropVignetteStyle="1"/);
  });

  it('omits sharpening fields when sharpenAmount is 0, regardless of radius/detail', () => {
    const xml = toXmp(adj({ sharpenAmount: 0, sharpenRadius: 2.4, sharpenDetail: 90 }), NAME_ONLY);
    assert.doesNotMatch(xml, /crs:Sharpness=/);
    assert.doesNotMatch(xml, /crs:SharpenRadius=/);
    assert.doesNotMatch(xml, /crs:SharpenDetail=/);
  });

  it('writes sharpening fields once sharpenAmount is non-zero', () => {
    const xml = toXmp(adj({ sharpenAmount: 60, sharpenRadius: 1.5, sharpenDetail: 30 }), NAME_ONLY);
    assert.match(xml, /crs:Sharpness="60"/);
    assert.match(xml, /crs:SharpenRadius="1\.5"/);
    assert.match(xml, /crs:SharpenDetail="30"/);
  });

  it('omits noise reduction fields at 0, writes them once positive', () => {
    const off = toXmp(identityAdjustments(), NAME_ONLY);
    assert.doesNotMatch(off, /crs:LuminanceSmoothing=/);
    assert.doesNotMatch(off, /crs:ColorNoiseReduction=/);

    const on = toXmp(adj({ noiseReduction: 15, colorNoiseReduction: 20 }), NAME_ONLY);
    assert.match(on, /crs:LuminanceSmoothing="15"/);
    assert.match(on, /crs:ColorNoiseReduction="20"/);
  });

  it('omits HSL and Colour Grading blocks entirely at identity', () => {
    const xml = toXmp(identityAdjustments(), NAME_ONLY);
    assert.doesNotMatch(xml, /crs:HueAdjustmentRed=/);
    assert.doesNotMatch(xml, /crs:SplitToningShadowHue=/);
    assert.doesNotMatch(xml, /crs:ColorGradeGlobalSat=/);
  });

  it('writes the full HSL set once any single band is touched', () => {
    const withHsl = adj({
      hsl: {
        ...identityAdjustments().hsl,
        red: { hue: 10, sat: 0, lum: 0 },
      },
    });
    const xml = toXmp(withHsl, NAME_ONLY);
    // The whole panel is written, keeping it internally consistent, even
    // though only one band was actually touched.
    for (const band of HSL_BANDS) {
      const n = { red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', aqua: 'Aqua', blue: 'Blue', purple: 'Purple', magenta: 'Magenta' }[band.key];
      assert.match(xml, new RegExp(`crs:HueAdjustment${n}=`));
      assert.match(xml, new RegExp(`crs:SaturationAdjustment${n}=`));
      assert.match(xml, new RegExp(`crs:LuminanceAdjustment${n}=`));
    }
  });

  it('writes the full Colour Grading set once any wheel has saturation', () => {
    const withGrading = adj({
      grading: {
        ...identityAdjustments().grading,
        shadows: { hue: 220, sat: 10, lum: 0 },
      },
    });
    const xml = toXmp(withGrading, NAME_ONLY);
    assert.match(xml, /crs:SplitToningShadowHue=/);
    assert.match(xml, /crs:SplitToningShadowSaturation="10"/);
    assert.match(xml, /crs:ColorGradeGlobalHue=/);
    assert.match(xml, /crs:ColorGradeBlending=/);
  });
});

/* ── The single most important property: descriptive Basic fields never appear ── */

describe('toXmp — never emits the descriptive-only Basic tone fields', () => {
  it('omits Contrast2012, Highlights2012, Shadows2012, Whites2012 and Blacks2012 even when set', () => {
    const loud = adj({
      contrast: 80,
      highlights: -70,
      shadows: 65,
      whites: 90,
      blacks: -85,
    });
    const xml = toXmp(loud, NAME_ONLY);

    // These are display-only descriptions of the tone curve. The authoritative
    // move is Exposure2012 + the curve alone; writing these alongside it would
    // apply the same tonal move twice.
    for (const attr of ['Contrast2012', 'Highlights2012', 'Shadows2012', 'Whites2012', 'Blacks2012']) {
      assert.doesNotMatch(xml, new RegExp(`crs:${attr}=`), `${attr} leaked into the output`);
    }
  });
});

/* ── Tone curve identity ──────────────────────────────────────────────────── */

describe('toXmp — ToneCurveName2012', () => {
  it('is omitted when the curve is the identity line', () => {
    const xml = toXmp(identityAdjustments(), NAME_ONLY);
    assert.doesNotMatch(xml, /crs:ToneCurveName2012=/);
    assert.doesNotMatch(xml, /ToneCurvePV2012/);
  });

  it('is written as "Custom" once the curve departs from identity', () => {
    const curved = adj({
      curve: [
        { x: 0, y: 0 },
        { x: 128, y: 150 },
        { x: 255, y: 255 },
      ],
    });
    const xml = toXmp(curved, NAME_ONLY);
    assert.match(xml, /crs:ToneCurveName2012="Custom"/);
    assert.match(xml, /ToneCurvePV2012/);
    assert.match(xml, /<rdf:li>128, 150<\/rdf:li>/);
  });

  it('tolerates a curve within 1 unit of identity as still identity', () => {
    // The code's own tolerance: abs(p.x - p.y) <= 1.
    const almostIdentity = adj({
      curve: [
        { x: 0, y: 1 },
        { x: 255, y: 254 },
      ],
    });
    const xml = toXmp(almostIdentity, NAME_ONLY);
    assert.doesNotMatch(xml, /crs:ToneCurveName2012=/);
  });
});

/* ── XML escaping ─────────────────────────────────────────────────────────── */

describe('toXmp — XML escaping of name and group', () => {
  it('escapes &, <, >, and " in the preset name and group', () => {
    const dangerous: PresetOptions = {
      name: `Fog & <Mist> "Cove"`,
      group: `A & B`,
    };
    const xml = toXmp(identityAdjustments(), dangerous);

    // The raw, unescaped special characters must not appear where the name and
    // group were interpolated: attribute values and rdf:li text content.
    assert.doesNotMatch(xml, /x-default">Fog & <Mist>/);
    assert.match(xml, /Fog &amp; &lt;Mist&gt; &quot;Cove&quot;/);
    assert.match(xml, /<rdf:li xml:lang="x-default">A &amp; B<\/rdf:li>/);
  });

  it('lower-cases the escaped name for SortName without reintroducing raw characters', () => {
    const xml = toXmp(identityAdjustments(), { name: `A & B` });
    assert.match(xml, /<crs:SortName>[\s\S]*?a &amp; b<\/rdf:li>/);
  });
});

/* ── Deterministic UUID ───────────────────────────────────────────────────── */

describe('toXmp — deterministic UUID from seed', () => {
  const uuidOf = (xml: string): string => {
    const m = xml.match(/crs:UUID="([0-9A-F]+)"/);
    assert.ok(m, 'no crs:UUID attribute found');
    return m![1];
  };

  it('produces byte-identical UUIDs across two calls with the same seed', () => {
    const opts: PresetOptions = { name: 'Same Name', seed: 'match-42' };
    const uuidA = uuidOf(toXmp(identityAdjustments(), opts));
    const uuidB = uuidOf(toXmp(identityAdjustments(), { ...opts }));
    assert.equal(uuidA, uuidB);
  });

  it('falls back to the name as the seed when no seed is given', () => {
    const uuidA = uuidOf(toXmp(identityAdjustments(), { name: 'Falls Back' }));
    const uuidB = uuidOf(toXmp(identityAdjustments(), { name: 'Falls Back' }));
    assert.equal(uuidA, uuidB);
  });

  it('produces a different UUID for a different seed', () => {
    const uuidA = uuidOf(toXmp(identityAdjustments(), { name: 'X', seed: 'seed-one' }));
    const uuidB = uuidOf(toXmp(identityAdjustments(), { name: 'X', seed: 'seed-two' }));
    assert.notEqual(uuidA, uuidB);
  });

  it('produces a different UUID for a different name when no seed is given', () => {
    const uuidA = uuidOf(toXmp(identityAdjustments(), { name: 'Preset One' }));
    const uuidB = uuidOf(toXmp(identityAdjustments(), { name: 'Preset Two' }));
    assert.notEqual(uuidA, uuidB);
  });

  it('a seed overrides the name for UUID purposes even if the name differs', () => {
    const uuidA = uuidOf(toXmp(identityAdjustments(), { name: 'Preset One', seed: 'shared' }));
    const uuidB = uuidOf(toXmp(identityAdjustments(), { name: 'Preset Two', seed: 'shared' }));
    assert.equal(uuidA, uuidB);
  });
});

/* ── Masks ─────────────────────────────────────────────────────────────────── */

describe('toXmp — includeMasks', () => {
  it('includes a MaskGroupBasedCorrections block for a regenerable mask kind, by default', () => {
    const withMask = adj({ masks: [mask({ kind: 'subject', label: 'Subject' })] });
    const xml = toXmp(withMask, NAME_ONLY);
    assert.match(xml, /<crs:MaskGroupBasedCorrections>/);
    assert.match(xml, /crs:MaskSubType="1"/); // subject
    assert.match(xml, /crs:CorrectionName="Subject"/);
  });

  it('includes sky (2) and background (0) mask kinds', () => {
    const xml = toXmp(
      adj({
        masks: [
          mask({ kind: 'sky', label: 'Sky', region: 'scene.sky' }),
          mask({ kind: 'background', label: 'Background', region: 'background' }),
        ],
      }),
      NAME_ONLY,
    );
    assert.match(xml, /crs:MaskSubType="2"/);
    assert.match(xml, /crs:MaskSubType="0"/);
  });

  it('excludes a manual-kind mask from the block, even when present', () => {
    const xml = toXmp(adj({ masks: [mask({ kind: 'manual', label: 'Hand Drawn' })] }), NAME_ONLY);
    assert.doesNotMatch(xml, /<crs:MaskGroupBasedCorrections>/);
    assert.doesNotMatch(xml, /crs:CorrectionName="Hand Drawn"/);
  });

  it('includes only the regenerable masks when manual and subject masks are both present', () => {
    const xml = toXmp(
      adj({
        masks: [
          mask({ kind: 'manual', label: 'Hand Drawn' }),
          mask({ kind: 'subject', label: 'Subject' }),
        ],
      }),
      NAME_ONLY,
    );
    assert.match(xml, /crs:CorrectionName="Subject"/);
    assert.doesNotMatch(xml, /crs:CorrectionName="Hand Drawn"/);
  });

  it('omits the mask block entirely when includeMasks is false, even with masks present', () => {
    const xml = toXmp(adj({ masks: [mask({ kind: 'subject' })] }), {
      ...NAME_ONLY,
      includeMasks: false,
    });
    assert.doesNotMatch(xml, /<crs:MaskGroupBasedCorrections>/);
    assert.doesNotMatch(xml, /crs:CorrectionName=/);
  });

  it('omits the mask block when there are no masks at all', () => {
    const xml = toXmp(identityAdjustments(), NAME_ONLY);
    assert.doesNotMatch(xml, /<crs:MaskGroupBasedCorrections>/);
  });
});

/* ── buildPresetFiles ─────────────────────────────────────────────────────── */

describe('buildPresetFiles', () => {
  it('returns a single safe-named file with no masks present', () => {
    const files = buildPresetFiles(identityAdjustments(), NAME_ONLY);
    assert.equal(files.length, 1);
    assert.equal(files[0].filename, 'Test-Preset.xmp');
    assert.doesNotMatch(files[0].contents, /<crs:MaskGroupBasedCorrections>/);
  });

  it('returns two files when a regenerable mask is present: full, then -safe', () => {
    const withMask = adj({ masks: [mask({ kind: 'subject', label: 'Subject' })] });
    const files = buildPresetFiles(withMask, NAME_ONLY);
    assert.equal(files.length, 2);

    assert.equal(files[0].filename, 'Test-Preset.xmp');
    assert.match(files[0].contents, /<crs:MaskGroupBasedCorrections>/);

    assert.equal(files[1].filename, 'Test-Preset-safe.xmp');
    assert.doesNotMatch(files[1].contents, /<crs:MaskGroupBasedCorrections>/);
  });

  it('returns a single file, with no -safe suffix, when the only mask is manual', () => {
    const onlyManual = adj({ masks: [mask({ kind: 'manual', label: 'Hand Drawn' })] });
    const files = buildPresetFiles(onlyManual, NAME_ONLY);
    assert.equal(files.length, 1);
    assert.equal(files[0].filename, 'Test-Preset.xmp');
  });

  it('sanitises the preset name into a filesystem-safe filename', () => {
    const files = buildPresetFiles(identityAdjustments(), { name: `Fog & <Mist> "Cove"!!` });
    assert.equal(files.length, 1);
    assert.equal(files[0].filename, 'Fog-Mist-Cove.xmp');
  });

  it('every returned file still upholds the never-emit-descriptive-Basic-fields invariant', () => {
    const loud = adj({
      contrast: 80,
      highlights: -70,
      shadows: 65,
      whites: 90,
      blacks: -85,
      masks: [mask({ kind: 'subject' })],
    });
    const files = buildPresetFiles(loud, NAME_ONLY);
    assert.ok(files.length > 0);
    for (const file of files) {
      for (const attr of ['Contrast2012', 'Highlights2012', 'Shadows2012', 'Whites2012', 'Blacks2012']) {
        assert.doesNotMatch(
          file.contents,
          new RegExp(`crs:${attr}=`),
          `${attr} leaked into ${file.filename}`,
        );
      }
    }
  });

  it('each file carries a non-empty description', () => {
    const files = buildPresetFiles(identityAdjustments(), NAME_ONLY);
    for (const file of files) {
      assert.ok(file.description.length > 0);
    }
  });
});
