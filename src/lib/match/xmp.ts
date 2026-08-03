import { HSL_BANDS } from './types';
import type { Adjustments, MaskAdjustment } from './adjustments';

// Lightroom preset writer.
//
// The field vocabulary here was taken from real .xmp files written by the
// Lightroom install on this machine, not from guesswork. Several details are
// counter-intuitive enough that they would almost certainly have been wrong
// otherwise:
//
//   • Colour Grading SHADOWS and HIGHLIGHTS are written as `SplitToning*`
//     fields — a legacy of the panel's origins — while MIDTONES and GLOBAL use
//     `ColorGrade*`. The four wheels are not symmetrical in the file format.
//
//   • `VignetteAmount` is the LENS CORRECTION vignette. The Effects panel
//     control is `PostCropVignetteAmount`. Writing the former silently applies
//     a different correction than the one that was measured.
//
//   • Local (mask) slider values are normalised to -1..1, not -100..100 —
//     except LocalExposure2012, which is in stops like its global counterpart.
//
//   • `Temperature` is absolute Kelvin on a RAW file. A preset carrying it
//     would discard the photo's as-shot white balance, so the colour cast is
//     routed through Colour Grading instead. (`IncrementalTemperature` exists
//     and is relative, but its support in the cloud app is unverified.)

const CRS_NS = 'http://ns.adobe.com/camera-raw-settings/1.0/';

/** Matches the newest values present in this machine's Lightroom library. */
const PROCESS_VERSION = '15.4';
const CRS_VERSION = '18.2';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Lightroom writes signed integers with an explicit '+'. */
const int = (v: number): string => {
  const r = Math.round(v);
  return r > 0 ? `+${r}` : String(r);
};
/** Unsigned controls (Sharpness, Grain, …) carry no sign. */
const uint = (v: number): string => String(Math.max(0, Math.round(v)));
/** Exposure is written with two decimals and an explicit sign. */
const expo = (v: number): string => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
/** Local slider values are normalised to -1..1 in the file format. */
const local = (v: number): string => (v / 100).toFixed(6);
const localExpo = (v: number): string => v.toFixed(6);

/**
 * Deterministic UUID so re-exporting the same match twice yields the same
 * preset identity rather than a duplicate entry in Lightroom.
 *
 * Hand-rolled FNV-1a rather than node:crypto, because this module also runs in
 * the browser on the offline fallback path. It is an identity label, not a
 * security boundary — collision resistance beyond "different matches get
 * different ids" is not required.
 */
function uuidFrom(seed: string): string {
  let out = '';
  for (let salt = 0; salt < 4; salt++) {
    let h = 0x811c9dc5 ^ (salt * 0x9e3779b9);
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out.toUpperCase();
}

const HSL_XMP_NAME: Record<string, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  aqua: 'Aqua',
  blue: 'Blue',
  purple: 'Purple',
  magenta: 'Magenta',
};

/** MaskSubType values used by Lightroom's AI masks. These regenerate against
 *  whatever photo the preset is applied to, which is what makes a mask worth
 *  embedding at all. */
const MASK_SUBTYPE: Record<MaskAdjustment['kind'], number | null> = {
  background: 0,
  subject: 1,
  sky: 2,
  manual: null, // cannot be regenerated — excluded from the preset
};

export interface PresetOptions {
  /** Shown in Lightroom's preset list. */
  name: string;
  /** Preset group / folder name. */
  group?: string;
  /** Include AI mask corrections. */
  includeMasks?: boolean;
  /** Seed for the deterministic UUID — pass something stable per match. */
  seed?: string;
}

function maskBlock(masks: MaskAdjustment[]): string {
  const usable = masks.filter((m) => MASK_SUBTYPE[m.kind] !== null);
  if (usable.length === 0) return '';

  const entries = usable
    .map((m) => {
      const subType = MASK_SUBTYPE[m.kind]!;
      const name = esc(m.label);
      return `    <rdf:li>
     <rdf:Description
      crs:What="Correction"
      crs:CorrectionAmount="1.000000"
      crs:CorrectionActive="true"
      crs:CorrectionName="${name}"
      crs:LocalExposure2012="${localExpo(m.exposure)}"
      crs:LocalTemperature="${local(m.temp)}"
      crs:LocalTint="${local(m.tint)}"
      crs:LocalSaturation="${local(m.saturation)}"
      crs:LocalContrast2012="${local(m.contrast)}">
      <crs:CorrectionMasks>
       <rdf:Seq>
        <rdf:li>
         <rdf:Description
          crs:What="Mask/Image"
          crs:MaskActive="true"
          crs:MaskName="${name}"
          crs:MaskBlendMode="0"
          crs:MaskInverted="false"
          crs:MaskValue="1.000000"
          crs:MaskSubType="${subType}"/>
        </rdf:li>
       </rdf:Seq>
      </crs:CorrectionMasks>
     </rdf:Description>
    </rdf:li>`;
    })
    .join('\n');

  return `
   <crs:MaskGroupBasedCorrections>
    <rdf:Seq>
${entries}
    </rdf:Seq>
   </crs:MaskGroupBasedCorrections>`;
}

/**
 * Render an Adjustments as a Lightroom-importable .xmp preset.
 *
 * NOTE what is deliberately absent: Contrast2012, Highlights2012, Shadows2012,
 * Whites2012 and Blacks2012. Those values exist on the Adjustments object as
 * *descriptions* of the tone curve for display; writing them alongside the
 * curve would apply the same tonal move twice. The authoritative tone move is
 * Exposure2012 + ToneCurvePV2012, and only those are written.
 */
export function toXmp(adj: Adjustments, opts: PresetOptions): string {
  const name = esc(opts.name);
  const group = esc(opts.group ?? 'Colour Archive');
  const uuid = uuidFrom(opts.seed ?? opts.name);
  const includeMasks = opts.includeMasks ?? true;

  // A preset ASSERTS every field it contains. That makes writing a zero
  // actively harmful wherever Lightroom's own default is non-zero: a preset
  // carrying `Sharpness="0"` strips the default capture sharpening off a RAW,
  // and `ColorNoiseReduction="0"` disables colour noise reduction outright —
  // neither of which was ever measured or intended. Anything the solver has no
  // deliberate opinion about is therefore OMITTED, so it inherits whatever the
  // photo already has.
  const a: string[] = [];
  const put = (k: string, v: string) => a.push(`    crs:${k}="${v}"`);

  // Tone: always the authoritative move.
  put('Exposure2012', expo(adj.exposure));

  const curveIsIdentity = adj.curve.every((p) => Math.abs(p.x - p.y) <= 1);
  if (!curveIsIdentity) put('ToneCurveName2012', 'Custom');

  // Presence panel — Lightroom's defaults here are 0, so writing 0 is a no-op.
  if (adj.texture !== 0) put('Texture', int(adj.texture));
  if (adj.clarity !== 0) put('Clarity2012', int(adj.clarity));
  if (adj.dehaze !== 0) put('Dehaze', int(adj.dehaze));
  if (adj.vibrance !== 0) put('Vibrance', int(adj.vibrance));
  if (adj.saturation !== 0) put('Saturation', int(adj.saturation));

  // Colour Mixer — default 0, and writing the full set keeps the panel
  // internally consistent rather than half-specified.
  const hslActive = HSL_BANDS.some((b) => {
    const v = adj.hsl[b.key];
    return v.hue !== 0 || v.sat !== 0 || v.lum !== 0;
  });
  if (hslActive) {
    for (const b of HSL_BANDS) {
      const n = HSL_XMP_NAME[b.key];
      const v = adj.hsl[b.key];
      put(`HueAdjustment${n}`, int(v.hue));
      put(`SaturationAdjustment${n}`, int(v.sat));
      put(`LuminanceAdjustment${n}`, int(v.lum));
    }
  }

  // Colour Grading. Shadows and highlights live in the legacy SplitToning
  // fields; midtones and global in the ColorGrade ones.
  const g = adj.grading;
  const gradingActive =
    g.global.sat > 0 || g.shadows.sat > 0 || g.midtones.sat > 0 || g.highlights.sat > 0;
  if (gradingActive) {
    put('SplitToningShadowHue', uint(g.shadows.hue));
    put('SplitToningShadowSaturation', uint(g.shadows.sat));
    put('SplitToningHighlightHue', uint(g.highlights.hue));
    put('SplitToningHighlightSaturation', uint(g.highlights.sat));
    put('SplitToningBalance', int(g.balance));
    put('ColorGradeShadowLum', int(g.shadows.lum));
    put('ColorGradeHighlightLum', int(g.highlights.lum));
    put('ColorGradeMidtoneHue', uint(g.midtones.hue));
    put('ColorGradeMidtoneSat', uint(g.midtones.sat));
    put('ColorGradeMidtoneLum', int(g.midtones.lum));
    put('ColorGradeGlobalHue', uint(g.global.hue));
    put('ColorGradeGlobalSat', uint(g.global.sat));
    put('ColorGradeGlobalLum', int(g.global.lum));
    put('ColorGradeBlending', uint(g.blending));
  }

  // Grain: Size and Frequency only mean something alongside a non-zero Amount,
  // and their defaults are 25/50 — never write them on their own.
  if (adj.grainAmount > 0) {
    put('GrainAmount', uint(adj.grainAmount));
    put('GrainSize', uint(adj.grainSize));
    put('GrainFrequency', uint(adj.grainRoughness));
  }

  // Post-crop vignette: only when there is a measured, symmetric falloff.
  if (adj.vignette !== 0) {
    put('PostCropVignetteAmount', int(adj.vignette));
    put('PostCropVignetteMidpoint', '50');
    put('PostCropVignetteFeather', '50');
    put('PostCropVignetteRoundness', '0');
    put('PostCropVignetteStyle', '1');
  }

  // Sharpening and noise reduction: Lightroom's RAW defaults are non-zero
  // (Sharpness 40, ColorNoiseReduction 25). Omitting leaves them intact.
  if (adj.sharpenAmount > 0) {
    put('Sharpness', uint(adj.sharpenAmount));
    put('SharpenRadius', adj.sharpenRadius.toFixed(1));
    put('SharpenDetail', uint(adj.sharpenDetail));
  }
  if (adj.noiseReduction > 0) put('LuminanceSmoothing', uint(adj.noiseReduction));
  if (adj.colorNoiseReduction > 0) put('ColorNoiseReduction', uint(adj.colorNoiseReduction));

  const curve = curveIsIdentity
    ? ''
    : `
   <crs:ToneCurvePV2012>
    <rdf:Seq>
${adj.curve.map((p) => `     <rdf:li>${p.x}, ${p.y}</rdf:li>`).join('\n')}
    </rdf:Seq>
   </crs:ToneCurvePV2012>`;
  const masks = includeMasks ? maskBlock(adj.masks) : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Colour Archive">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="${CRS_NS}"
    crs:PresetType="Normal"
    crs:Cluster=""
    crs:UUID="${uuid}"
    crs:SupportsAmount="True"
    crs:SupportsColor="True"
    crs:SupportsMonochrome="False"
    crs:SupportsHighDynamicRange="True"
    crs:SupportsNormalDynamicRange="True"
    crs:SupportsSceneReferred="True"
    crs:SupportsOutputReferred="True"
    crs:CameraModelRestriction=""
    crs:Copyright=""
    crs:ContactInfo=""
    crs:Version="${CRS_VERSION}"
    crs:ProcessVersion="${PROCESS_VERSION}"
    crs:HasSettings="True"
    crs:ShowInPresets="True"
${a.join('\n')}>
   <crs:Name>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${name}</rdf:li>
    </rdf:Alt>
   </crs:Name>
   <crs:ShortName>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${name}</rdf:li>
    </rdf:Alt>
   </crs:ShortName>
   <crs:SortName>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${name.toLowerCase()}</rdf:li>
    </rdf:Alt>
   </crs:SortName>
   <crs:Group>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${group}</rdf:li>
    </rdf:Alt>
   </crs:Group>${curve}${masks}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;
}

export interface PresetFile {
  filename: string;
  contents: string;
  /** What this file is for, shown next to its download button. */
  description: string;
}

/**
 * Build the preset files for one match.
 *
 * Two files, deliberately. The mask block is the one part of this format that
 * could not be verified against a real Lightroom-written file — there are no
 * mask-bearing .xmp files in this machine's library to copy from — so if
 * Lightroom rejects it, it may reject the whole preset and the global grade
 * would be lost with it. The `-safe` file has no masks and uses only fields
 * confirmed against real presets, so there is always a version that imports.
 */
export function buildPresetFiles(adj: Adjustments, opts: PresetOptions): PresetFile[] {
  const base = opts.name.replace(/[^a-zA-Z0-9-_ ]+/g, '').replace(/\s+/g, '-');
  const usableMasks = adj.masks.filter((m) => MASK_SUBTYPE[m.kind] !== null);
  const files: PresetFile[] = [];

  if (usableMasks.length > 0) {
    files.push({
      filename: `${base}.xmp`,
      contents: toXmp(adj, { ...opts, includeMasks: true }),
      description: `Full preset — global grade plus ${usableMasks.length} automatic mask${usableMasks.length > 1 ? 's' : ''} (${usableMasks.map((m) => m.label).join(', ')}), which Lightroom regenerates against your photo on import.`,
    });
  }

  files.push({
    filename: `${base}${usableMasks.length > 0 ? '-safe' : ''}.xmp`,
    contents: toXmp(adj, { ...opts, includeMasks: false }),
    description:
      usableMasks.length > 0
        ? 'Same grade without the mask block — use this if the full preset fails to import.'
        : 'Global grade. No automatic masks applied for this pair.',
  });

  return files;
}
