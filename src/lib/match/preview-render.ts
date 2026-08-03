import { DEFAULT_CALIBRATION, type Calibration } from './calibration';
import { HSL_BANDS } from './types';
import type { Adjustments } from './adjustments';

// Live preview: the same transform, in a fragment shader.
//
// ── Why the shader reads from Adjustments ──────────────────────────────────
// The renderer takes the *published slider values* and inverts the calibration
// to recover the parameters it needs, rather than being handed a parallel set
// of numbers from the solver. That is deliberate. If the preview were fed its
// own copy, the two could drift apart and the picture would stop being evidence
// for the values. Deriving from Adjustments means a wrong number produces a
// correspondingly wrong preview — always the same claim, shown two ways.
//
// The mapping is exact in both directions because every calibration constant is
// a simple linear gain (see calibration.ts).
//
// ── What this does NOT reproduce ────────────────────────────────────────────
// Grain, Texture and noise reduction are approximated: grain as hash noise,
// Texture as a four-tap unsharp. They are honest in direction and rough in
// magnitude. The numbers and the .xmp remain exact — only their preview is
// indicative, which is flagged in the UI.

/** Everything the shader needs, in the units it works in (OKLab / stops). */
export interface RenderSpec {
  exposure: number;
  /** 256-entry tone curve LUT, 0..255. */
  curveLut: Uint8Array;
  chromaScale: number;
  globalCast: [number, number];
  hslHueDeg: number[];
  hslChroma: number[];
  hslLum: number[];
  zoneShadow: [number, number];
  zoneMid: [number, number];
  zoneHigh: [number, number];
  maskExposure: [number, number, number, number];
  maskA: [number, number, number, number];
  maskB: [number, number, number, number];
  maskChroma: [number, number, number, number];
  grain: number;
  texture: number;
}

// --- Colour helpers (mirrors solve.ts / color.ts) ------------------------------

const srgbDecode = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const srgbEncode = (y: number): number => {
  const x = Math.max(0, Math.min(1, y));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
};

/** Lightroom Colour Grading hue (HSV convention) -> unit OKLab a/b direction.
 *  The forward direction lives in solve.ts; this is its exact counterpart. */
function lightroomHueToOklabDirection(hue: number): [number, number] {
  const h = (((hue % 360) + 360) % 360) / 60;
  const i = Math.floor(h) % 6;
  const f = h - Math.floor(h);
  const rgb: [number, number, number] =
    i === 0 ? [1, f, 0] :
    i === 1 ? [1 - f, 1, 0] :
    i === 2 ? [0, 1, f] :
    i === 3 ? [0, 1 - f, 1] :
    i === 4 ? [f, 0, 1] :
    [1, 0, 1 - f];
  const r = srgbDecode(rgb[0]);
  const g = srgbDecode(rgb[1]);
  const b = srgbDecode(rgb[2]);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const mag = Math.hypot(A, B) || 1;
  return [A / mag, B / mag];
}

function curveToLut(curve: Adjustments['curve']): Uint8Array {
  const lut = new Uint8Array(256);
  for (let x = 0; x < 256; x++) {
    let i = 0;
    while (i < curve.length - 2 && curve[i + 1].x < x) i++;
    const p0 = curve[i];
    const p1 = curve[i + 1] ?? curve[i];
    const t = p1.x === p0.x ? 0 : (x - p0.x) / (p1.x - p0.x);
    lut[x] = Math.max(0, Math.min(255, Math.round(p0.y + (p1.y - p0.y) * Math.max(0, Math.min(1, t)))));
  }
  return lut;
}

const pad4 = (xs: number[]): [number, number, number, number] => [
  xs[0] ?? 0, xs[1] ?? 0, xs[2] ?? 0, xs[3] ?? 0,
];

/** Recover shader parameters from the published slider values. */
export function deriveRenderSpec(
  adj: Adjustments,
  maskChannels: string[],
  cal: Calibration = DEFAULT_CALIBRATION,
): RenderSpec {
  const castOf = (hue: number, sat: number): [number, number] => {
    if (sat <= 0) return [0, 0];
    const [ux, uy] = lightroomHueToOklabDirection(hue);
    const mag = (sat / 100) * cal.colorGradeUnit;
    return [ux * mag, uy * mag];
  };

  const chromaScale =
    1 + adj.saturation / (100 * cal.saturationGain) + adj.vibrance / (100 * cal.vibranceGain);

  const g = adj.grading;
  const byRegion = new Map(adj.masks.map((m) => [m.region as string, m]));
  const chans = maskChannels.slice(0, 4);

  return {
    exposure: adj.exposure,
    curveLut: curveToLut(adj.curve),
    chromaScale: Math.max(0, chromaScale),
    globalCast: castOf(g.global.hue, g.global.sat),
    hslHueDeg: HSL_BANDS.map((b) => (adj.hsl[b.key].hue / 100) * cal.hslHueDegreesAt100),
    hslChroma: HSL_BANDS.map((b) =>
      Math.max(0, 1 + adj.hsl[b.key].sat / (100 * cal.hslSaturationGain)),
    ),
    hslLum: HSL_BANDS.map((b) => adj.hsl[b.key].lum / cal.hslLuminanceGain),
    zoneShadow: castOf(g.shadows.hue, g.shadows.sat),
    zoneMid: castOf(g.midtones.hue, g.midtones.sat),
    zoneHigh: castOf(g.highlights.hue, g.highlights.sat),
    maskExposure: pad4(chans.map((r) => byRegion.get(r)?.exposure ?? 0)),
    maskA: pad4(chans.map((r) => ((byRegion.get(r)?.tint ?? 0) / 100) * cal.localTintUnit)),
    maskB: pad4(chans.map((r) => ((byRegion.get(r)?.temp ?? 0) / 100) * cal.localTempUnit)),
    maskChroma: pad4(
      chans.map((r) =>
        Math.max(0, 1 + (byRegion.get(r)?.saturation ?? 0) / (100 * cal.localSaturationGain)),
      ),
    ),
    grain: (adj.grainAmount / 100) * cal.grainUnit,
    texture: adj.texture / 100,
  };
}

// --- Shaders -------------------------------------------------------------------

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 v_uv;

uniform sampler2D u_photo;
uniform sampler2D u_masks;
uniform sampler2D u_curve;
uniform bool  u_hasMasks;
uniform vec2  u_texel;

uniform float u_exposure;
uniform float u_chromaScale;
uniform vec2  u_globalCast;
uniform float u_hslHue[8];
uniform float u_hslChroma[8];
uniform float u_hslLum[8];
uniform vec2  u_zoneShadow;
uniform vec2  u_zoneMid;
uniform vec2  u_zoneHigh;
uniform vec4  u_maskExpo;
uniform vec4  u_maskA;
uniform vec4  u_maskB;
uniform vec4  u_maskChroma;
uniform float u_grain;
uniform float u_texture;
uniform float u_split;      // wipe position; < 0 disables

const float PI = 3.14159265359;

// Band centres in OKLCH hue degrees — the same anchors the measurement uses.
const float B0 = 28.0;  const float B1 = 62.0;  const float B2 = 100.0; const float B3 = 145.0;
const float B4 = 195.0; const float B5 = 255.0; const float B6 = 305.0; const float B7 = 350.0;

float srgbDecode(float v) {
  return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4);
}
float srgbEncode(float y) {
  float x = clamp(y, 0.0, 1.0);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}
vec3 toOklab(vec3 srgb) {
  vec3 c = vec3(srgbDecode(srgb.r), srgbDecode(srgb.g), srgbDecode(srgb.b));
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  float l_ = pow(max(l, 0.0), 1.0 / 3.0);
  float m_ = pow(max(m, 0.0), 1.0 / 3.0);
  float s_ = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_);
}
vec3 fromOklab(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  vec3 lin = vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  return vec3(srgbEncode(lin.r), srgbEncode(lin.g), srgbEncode(lin.b));
}

float hueDist(float a, float b) {
  float d = abs(mod(a - b + 540.0, 360.0) - 180.0);
  return d;
}
float bandCentre(int i) {
  if (i == 0) return B0; if (i == 1) return B1; if (i == 2) return B2; if (i == 3) return B3;
  if (i == 4) return B4; if (i == 5) return B5; if (i == 6) return B6; return B7;
}

// Cheap hash for grain.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Apply the whole transform to one sampled colour.
vec3 grade(vec3 srgb, vec2 uv) {
  vec3 lab = toOklab(srgb);
  float L = lab.x;
  float a = lab.y;
  float b = lab.z;

  // 1. Exposure — Y = L^3, so a stop scales L by 2^(1/3).
  L = min(1.0, L * pow(2.0, u_exposure / 3.0));

  // 2. Tone curve, in Lightroom's own 0..255 encoded space.
  float x = srgbEncode(L * L * L);
  float y = texture2D(u_curve, vec2(clamp(x, 0.0, 1.0), 0.5)).r;
  L = pow(max(srgbDecode(y), 0.0), 1.0 / 3.0);

  // 3. Global chroma.
  a *= u_chromaScale;
  b *= u_chromaScale;

  // 4. Global cast.
  a += u_globalCast.x;
  b += u_globalCast.y;

  // 5. Colour Mixer. Bands overlap smoothly rather than switching at a
  //    boundary, which would show as a visible edge through a gradient.
  float C = sqrt(a * a + b * b);
  if (C > 0.004) {
    float hue = degrees(atan(b, a));
    if (hue < 0.0) hue += 360.0;
    float wsum = 0.0;
    float rot = 0.0;
    float chroma = 0.0;
    float lum = 0.0;
    for (int i = 0; i < 8; i++) {
      float d = hueDist(hue, bandCentre(i));
      float w = max(0.0, 1.0 - d / 55.0);
      w = w * w;
      wsum += w;
      rot += w * u_hslHue[i];
      chroma += w * u_hslChroma[i];
      lum += w * u_hslLum[i];
    }
    if (wsum > 0.0001) {
      rot /= wsum; chroma /= wsum; lum /= wsum;
      float nh = radians(hue + rot);
      float nc = C * chroma;
      a = nc * cos(nh);
      b = nc * sin(nh);
      L = clamp(L + lum, 0.0, 1.0);
    }
  }

  // 6. Colour Grading by luminance zone, weighted so the three overlap.
  float wS = max(0.0, 1.0 - L / 0.5);
  float wH = max(0.0, (L - 0.5) / 0.5);
  float wM = max(0.0, 1.0 - abs(L - 0.5) / 0.5);
  float zt = max(wS + wM + wH, 0.0001);
  a += (u_zoneShadow.x * wS + u_zoneMid.x * wM + u_zoneHigh.x * wH) / zt;
  b += (u_zoneShadow.y * wS + u_zoneMid.y * wM + u_zoneHigh.y * wH) / zt;

  // 7. Masks — four regions packed into RGBA.
  if (u_hasMasks) {
    vec4 m = texture2D(u_masks, uv);
    for (int c = 0; c < 4; c++) {
      float w = c == 0 ? m.r : c == 1 ? m.g : c == 2 ? m.b : m.a;
      if (w <= 0.002) continue;
      float e = c == 0 ? u_maskExpo.x : c == 1 ? u_maskExpo.y : c == 2 ? u_maskExpo.z : u_maskExpo.w;
      float ma = c == 0 ? u_maskA.x : c == 1 ? u_maskA.y : c == 2 ? u_maskA.z : u_maskA.w;
      float mb = c == 0 ? u_maskB.x : c == 1 ? u_maskB.y : c == 2 ? u_maskB.z : u_maskB.w;
      float mc = c == 0 ? u_maskChroma.x : c == 1 ? u_maskChroma.y : c == 2 ? u_maskChroma.z : u_maskChroma.w;
      L = clamp(mix(L, min(1.0, L * pow(2.0, e / 3.0)), w), 0.0, 1.0);
      a = mix(a, a * mc + ma, w);
      b = mix(b, b * mc + mb, w);
    }
  }

  return fromOklab(vec3(clamp(L, 0.0, 1.0), a, b));
}

void main() {
  vec3 src = texture2D(u_photo, v_uv).rgb;

  // Before/after wipe: left of the split shows the original untouched.
  if (u_split >= 0.0 && v_uv.x < u_split) {
    gl_FragColor = vec4(src, 1.0);
    return;
  }

  vec3 outC = grade(src, v_uv);

  // Texture — four-tap unsharp. An approximation of Lightroom's mid-frequency
  // detail control, good for direction, rough on magnitude.
  if (abs(u_texture) > 0.001) {
    vec3 blur = (
      texture2D(u_photo, v_uv + vec2(u_texel.x, 0.0)).rgb +
      texture2D(u_photo, v_uv - vec2(u_texel.x, 0.0)).rgb +
      texture2D(u_photo, v_uv + vec2(0.0, u_texel.y)).rgb +
      texture2D(u_photo, v_uv - vec2(0.0, u_texel.y)).rgb) * 0.25;
    outC += (src - blur) * u_texture * 1.5;
  }

  // Grain.
  if (u_grain > 0.0001) {
    float n = hash(gl_FragCoord.xy) - 0.5;
    outC += n * u_grain * 2.0;
  }

  gl_FragColor = vec4(clamp(outC, 0.0, 1.0), 1.0);
}`;

// --- Renderer ------------------------------------------------------------------

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return sh;
}

function loadTexture(gl: WebGLRenderingContext, img: TexImageSource): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  return tex;
}

export class MatchPreview {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private photoTex: WebGLTexture | null = null;
  private maskTex: WebGLTexture | null = null;
  private curveTex: WebGLTexture;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private size: [number, number] = [1, 1];

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is unavailable in this browser.');
    this.gl = gl;

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.curveTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  private u(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.uniforms.get(name) ?? null;
  }

  async setImages(photoUrl: string, maskUrl: string | null): Promise<void> {
    const load = (src: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Could not load ${src}`));
        img.src = src;
      });

    const photo = await load(photoUrl);
    this.size = [photo.naturalWidth, photo.naturalHeight];
    this.canvas.width = photo.naturalWidth;
    this.canvas.height = photo.naturalHeight;
    this.photoTex = loadTexture(this.gl, photo);

    if (maskUrl) {
      const masks = await load(maskUrl);
      this.maskTex = loadTexture(this.gl, masks);
    } else {
      this.maskTex = null;
    }
  }

  /** Draw one frame. Cheap enough to call on every slider input event. */
  render(spec: RenderSpec, split = -1): void {
    const gl = this.gl;
    if (!this.photoTex) return;
    gl.useProgram(this.program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    // A 256x1 LUT stored in RGBA because WebGL1 guarantees that format.
    const rgba = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      rgba[i * 4] = spec.curveLut[i];
      rgba[i * 4 + 3] = 255;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.photoTex);
    gl.uniform1i(this.u('u_photo'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex ?? this.photoTex);
    gl.uniform1i(this.u('u_masks'), 1);
    gl.uniform1i(this.u('u_hasMasks'), this.maskTex ? 1 : 0);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    gl.uniform1i(this.u('u_curve'), 2);

    gl.uniform2f(this.u('u_texel'), 1 / this.size[0], 1 / this.size[1]);
    gl.uniform1f(this.u('u_exposure'), spec.exposure);
    gl.uniform1f(this.u('u_chromaScale'), spec.chromaScale);
    gl.uniform2f(this.u('u_globalCast'), spec.globalCast[0], spec.globalCast[1]);
    gl.uniform1fv(this.u('u_hslHue'), new Float32Array(spec.hslHueDeg));
    gl.uniform1fv(this.u('u_hslChroma'), new Float32Array(spec.hslChroma));
    gl.uniform1fv(this.u('u_hslLum'), new Float32Array(spec.hslLum));
    gl.uniform2f(this.u('u_zoneShadow'), spec.zoneShadow[0], spec.zoneShadow[1]);
    gl.uniform2f(this.u('u_zoneMid'), spec.zoneMid[0], spec.zoneMid[1]);
    gl.uniform2f(this.u('u_zoneHigh'), spec.zoneHigh[0], spec.zoneHigh[1]);
    gl.uniform4fv(this.u('u_maskExpo'), new Float32Array(spec.maskExposure));
    gl.uniform4fv(this.u('u_maskA'), new Float32Array(spec.maskA));
    gl.uniform4fv(this.u('u_maskB'), new Float32Array(spec.maskB));
    gl.uniform4fv(this.u('u_maskChroma'), new Float32Array(spec.maskChroma));
    gl.uniform1f(this.u('u_grain'), spec.grain);
    gl.uniform1f(this.u('u_texture'), spec.texture);
    gl.uniform1f(this.u('u_split'), split);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
