import { DEFAULT_CALIBRATION, type Calibration } from './calibration';
import type { Adjustments } from './adjustments';
import { splineOf } from './curve';
import { gradeGains, mixerModel, type LrTables } from './lr-model';

// Live preview: the Lightroom model (lr-model.ts), in a fragment shader.
//
// ── Why the shader reads from Adjustments ──────────────────────────────────
// The renderer takes the *published slider values* and resolves them through
// the same model the solver checked its answer with, rather than being handed
// a parallel set of numbers. If the preview were fed its own copy, the two
// could drift apart and the picture would stop being evidence for the values.
// A wrong number produces a correspondingly wrong preview — always the same
// claim, shown two ways.
//
// The stages match lr-model.ts one for one: exposure in linear light, the
// point curve as hue-preserving RGB tone in Melissa RGB, the measured Colour
// Mixer / Saturation / Vibrance grid over ProPhoto HSV, the measured Colour
// Grading gain curves, then masks. The CPU model is the reference; this is its
// port. Two simplifications, both small:
//   • Saturation below −50 fades to the colour's own luminance before the
//     other mixer sliders, where Lightroom uses the luminance after them.
//   • Without float textures the tables travel as bytes (about 1.5% steps).
//
// ── What this does NOT reproduce ────────────────────────────────────────────
// Grain, Texture and noise reduction are approximated: grain as hash noise,
// Texture as a four-tap unsharp. They are honest in direction and rough in
// magnitude. The numbers and the .xmp remain exact — only their preview is
// indicative, which is flagged in the UI.

/** Everything the shader needs. */
export interface RenderSpec {
  /** Linear-light gain, 2^Exposure. */
  gain: number;
  /** 256-entry tone curve LUT over Melissa-encoded input, 0..255; null = identity. */
  curveLut: Uint8Array | null;
  /** Mixer grid, 3 × 1296 channel-major (see lr-model); null = nothing to do. */
  mixer: Float32Array | null;
  /** How far colours fade to gray (Saturation below −50). */
  gray: number;
  /** Grading gains, 64 × 3 sample-major; null = no grading. */
  grade: Float32Array | null;
  maskGain: [number, number, number, number];
  maskA: [number, number, number, number];
  maskB: [number, number, number, number];
  maskChroma: [number, number, number, number];
  grain: number;
  texture: number;
}

function curveToLut(curve: Adjustments['curve']): Uint8Array | null {
  if (curve.every((p) => p.x === p.y)) return null;
  const f = splineOf(curve);
  const lut = new Uint8Array(256);
  for (let x = 0; x < 256; x++) lut[x] = Math.max(0, Math.min(255, Math.round(f(x))));
  return lut;
}

const pad4 = (xs: number[]): [number, number, number, number] => [
  xs[0] ?? 0, xs[1] ?? 0, xs[2] ?? 0, xs[3] ?? 0,
];

/** Resolve slider values into shader parameters. Without `tables` (they
 *  couldn't be fetched) the mixer and grading stages are left out, and the
 *  caller says the preview shows tone only. */
export function deriveRenderSpec(
  adj: Adjustments,
  maskChannels: string[],
  cal: Calibration = DEFAULT_CALIBRATION,
  tables: LrTables | null = null,
): RenderSpec {
  const byRegion = new Map(adj.masks.map((m) => [m.region as string, m]));
  const chans = maskChannels.slice(0, 4);
  const mixer = tables ? mixerModel(tables, adj) : null;
  return {
    gain: Math.pow(2, adj.exposure),
    curveLut: curveToLut(adj.curve),
    mixer: mixer?.delta ?? null,
    gray: mixer?.gray ?? 0,
    grade: tables ? gradeGains(tables, adj.grading) : null,
    maskGain: pad4(chans.map((r) => Math.pow(2, byRegion.get(r)?.exposure ?? 0))),
    maskA: pad4(chans.map((r) => ((byRegion.get(r)?.tint ?? 0) / 100) * cal.localTintUnit)),
    maskB: pad4(chans.map((r) => ((byRegion.get(r)?.temp ?? 0) / 100) * cal.localTempUnit)),
    maskChroma: pad4(
      chans.map((r) => Math.max(0, 1 + (byRegion.get(r)?.saturation ?? 0) / (100 * cal.localSaturationGain))),
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
uniform sampler2D u_mixer;   // 216 x 6: x = hue * 6 + sat, y = value
uniform sampler2D u_grade;   // 64 x 1
uniform bool  u_hasMasks;
uniform bool  u_hasCurve;
uniform bool  u_hasMixer;
uniform bool  u_hasGrade;
uniform vec3  u_mixMul;      // value = texel * mul + add, per channel
uniform vec3  u_mixAdd;      // (float textures: 1 and 0)
uniform vec3  u_gradeMul;
uniform vec3  u_gradeAdd;
uniform vec2  u_texel;

uniform float u_gain;
uniform float u_gray;
uniform vec4  u_maskGain;
uniform vec4  u_maskA;
uniform vec4  u_maskB;
uniform vec4  u_maskChroma;
uniform float u_grain;
uniform float u_texture;
uniform float u_split;      // wipe position; < 0 disables

const mat3 RGB_TO_PRO = mat3(
  0.529345, 0.098374, 0.016883,
  0.330072, 0.873462, 0.117673,
  0.140583, 0.028164, 0.865444);
const mat3 PRO_TO_RGB = mat3(
  2.034075, -0.228813, -0.00857,
  -0.727334, 1.231731, -0.153286,
  -0.306742, -0.002918, 1.161856);

float srgbDecode(float v) {
  return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4);
}
float srgbEncode(float y) {
  float x = clamp(y, 0.0, 1.0);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}
vec3 decode3(vec3 c) { return vec3(srgbDecode(c.r), srgbDecode(c.g), srgbDecode(c.b)); }
vec3 encode3(vec3 c) { return vec3(srgbEncode(c.r), srgbEncode(c.g), srgbEncode(c.b)); }

vec3 toOklab(vec3 c) {
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
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

float curveAt(float x) {
  return texture2D(u_curve, vec2(clamp(x, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).r;
}

vec3 gridAt(float hi, float si, float vi) {
  vec3 t = texture2D(u_mixer, vec2((hi * 6.0 + si + 0.5) / 216.0, (vi + 0.5) / 6.0)).rgb;
  return t * u_mixMul + u_mixAdd;
}

// The measured mixer: ProPhoto HSV through a trilinear grid lookup.
vec3 mixer(vec3 p) {
  vec3 q = max(p, 0.0);
  float mx = max(max(q.r, q.g), q.b);
  if (mx <= 1e-6) return p;
  float mn = min(min(q.r, q.g), q.b);
  float d = mx - mn;
  float h = 0.0;
  if (d >= 1e-9) {
    if (mx == q.r) h = mod((q.g - q.b) / d, 6.0) / 6.0;
    else if (mx == q.g) h = ((q.b - q.r) / d + 2.0) / 6.0;
    else h = ((q.r - q.g) / d + 4.0) / 6.0;
  }
  float s = d / mx;

  float fh = fract(h) * 36.0 - 0.5;
  float fs = clamp(sqrt(clamp(s, 0.0, 1.0)) * 6.0 - 0.5, 0.0, 5.0);
  float fv = clamp(pow(clamp(mx, 0.0, 1.0), 0.45) * 6.0 - 0.5, 0.0, 5.0);
  float h0 = floor(fh); float th = fh - h0;
  float s0 = floor(fs); float ts = fs - s0;
  float v0 = floor(fv); float tv = fv - v0;
  float h1 = mod(h0 + 1.0, 36.0); h0 = mod(h0 + 36.0, 36.0);
  float s1 = min(s0 + 1.0, 5.0);
  float v1 = min(v0 + 1.0, 5.0);
  vec3 dlt =
    mix(mix(mix(gridAt(h0, s0, v0), gridAt(h0, s0, v1), tv), mix(gridAt(h0, s1, v0), gridAt(h0, s1, v1), tv), ts),
        mix(mix(gridAt(h1, s0, v0), gridAt(h1, s0, v1), tv), mix(gridAt(h1, s1, v0), gridAt(h1, s1, v1), tv), ts), th);

  float hh = fract(h + dlt.x) * 6.0;
  float ss = clamp(s * exp2(dlt.y), 0.0, 1.0);
  float vv = mx * exp2(dlt.z);
  float c = vv * ss;
  float x = c * (1.0 - abs(mod(hh, 2.0) - 1.0));
  vec3 rgb =
    hh < 1.0 ? vec3(c, x, 0.0) : hh < 2.0 ? vec3(x, c, 0.0) : hh < 3.0 ? vec3(0.0, c, x) :
    hh < 4.0 ? vec3(0.0, x, c) : hh < 5.0 ? vec3(x, 0.0, c) : vec3(c, 0.0, x);
  return rgb + (vv - c);
}

vec3 gainAt(float k) {
  vec3 t = texture2D(u_grade, vec2((k + 0.5) / 64.0, 0.5)).rgb;
  return t * u_gradeMul + u_gradeAdd;
}
float gradeChannel(float v, int c) {
  float at = pow(clamp(v, 0.0, 1.0), 1.0 / 2.2) * 63.0;
  float i = min(62.0, floor(at));
  float f = at - i;
  vec3 a = gainAt(i);
  vec3 b = gainAt(i + 1.0);
  float ga = c == 0 ? a.r : c == 1 ? a.g : a.b;
  float gb = c == 0 ? b.r : c == 1 ? b.g : b.b;
  return v * mix(ga, gb, f);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// The Lightroom model, one pixel: sRGB in, linear sRGB out.
vec3 grade(vec3 srgb, vec2 uv) {
  vec3 lin = decode3(srgb) * u_gain;
  vec3 p = RGB_TO_PRO * lin;

  if (u_hasCurve) {
    vec3 e = encode3(p);
    float hiV = max(max(e.r, e.g), e.b);
    float loV = min(min(e.r, e.g), e.b);
    float fH = curveAt(hiV);
    float fL = curveAt(loV);
    // Hue-preserving: max and min go through the curve, the middle keeps its place.
    e = hiV - loV < 1e-6 ? vec3(fH) : fL + (fH - fL) * (e - loV) / (hiV - loV);
    p = decode3(e);
  }

  if (u_hasMixer) {
    vec3 before = p;
    p = mixer(p);
    if (u_gray > 0.0) {
      float y = dot(PRO_TO_RGB * before, vec3(0.2126, 0.7152, 0.0722));
      p += u_gray * (vec3(y) - p);
    }
  }

  if (u_hasGrade) p = vec3(gradeChannel(p.r, 0), gradeChannel(p.g, 1), gradeChannel(p.b, 2));

  lin = PRO_TO_RGB * p;

  if (u_hasMasks) {
    vec4 m = texture2D(u_masks, uv);
    for (int c = 0; c < 4; c++) {
      float w = c == 0 ? m.r : c == 1 ? m.g : c == 2 ? m.b : m.a;
      if (w <= 0.002) continue;
      float g = c == 0 ? u_maskGain.x : c == 1 ? u_maskGain.y : c == 2 ? u_maskGain.z : u_maskGain.w;
      float ma = c == 0 ? u_maskA.x : c == 1 ? u_maskA.y : c == 2 ? u_maskA.z : u_maskA.w;
      float mb = c == 0 ? u_maskB.x : c == 1 ? u_maskB.y : c == 2 ? u_maskB.z : u_maskB.w;
      float mc = c == 0 ? u_maskChroma.x : c == 1 ? u_maskChroma.y : c == 2 ? u_maskChroma.z : u_maskChroma.w;
      lin *= 1.0 + (g - 1.0) * w;
      vec3 lab = toOklab(max(lin, 0.0));
      lab.y = mix(lab.y, lab.y * mc + ma, w);
      lab.z = mix(lab.z, lab.z * mc + mb, w);
      lin = fromOklab(lab);
    }
  }
  return lin;
}

void main() {
  vec3 src = texture2D(u_photo, v_uv).rgb;

  // Before/after wipe: left of the split shows the original untouched.
  if (u_split >= 0.0 && v_uv.x < u_split) {
    gl_FragColor = vec4(src, 1.0);
    return;
  }

  // Deband: the photo arrives in 8 bits, and wherever the grade steepens the
  // curve each step of the source becomes a visible stripe. One level of noise
  // before grading turns those steps into grain finer than the eye resolves,
  // as Lightroom's 16-bit pipeline would.
  vec3 dithered = clamp(src + (hash(gl_FragCoord.xy + vec2(19.0, 47.0)) - 0.5) / 255.0, 0.0, 1.0);
  vec3 outC = encode3(grade(dithered, v_uv));

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

function newTexture(gl: WebGLRenderingContext, filter: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  return tex;
}

function loadTexture(gl: WebGLRenderingContext, img: TexImageSource): WebGLTexture {
  const tex = newTexture(gl, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  return tex;
}

/** Byte encodings when float textures are unavailable: value = byte/255 × mul
 *  + add, per channel. Mixer hue shifts stay within ±¼ turn (0.7° steps); the
 *  log2 saturation and value factors within ±4 (2% steps). Grading gains 0..4. */
const MIX_BYTES = { mul: [0.5, 8, 8], add: [-0.25, -4, -4] };
const GRADE_BYTES = { mul: [4, 4, 4], add: [0, 0, 0] };

export class MatchPreview {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private photoTex: WebGLTexture | null = null;
  private maskTex: WebGLTexture | null = null;
  private curveTex: WebGLTexture;
  private mixerTex: WebGLTexture;
  private gradeTex: WebGLTexture;
  private float: boolean;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private size: [number, number] = [1, 1];
  private last = { mixer: null as Float32Array | null, grade: null as Float32Array | null, curve: null as Uint8Array | null };

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is unavailable in this browser.');
    this.gl = gl;
    this.float = Boolean(gl.getExtension('OES_texture_float'));

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

    this.curveTex = newTexture(gl, gl.LINEAR);
    // Tables are read texel by texel and interpolated in the shader: float
    // textures can't be filtered on iPad, and exact texel reads are what the
    // CPU model does anyway.
    this.mixerTex = newTexture(gl, gl.NEAREST);
    this.gradeTex = newTexture(gl, gl.NEAREST);
  }

  /** Whether the tables can travel at full precision on this device. */
  get floatTables(): boolean {
    return this.float;
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

  /** Upload an RGB table as RGBA, float or scaled bytes. */
  private upload(tex: WebGLTexture, w: number, h: number, rgb: (i: number, c: number) => number, bytes: { mul: number[]; add: number[] }) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.float) {
      const data = new Float32Array(w * h * 4);
      for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) data[i * 4 + c] = rgb(i, c);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.FLOAT, data);
    } else {
      const data = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(((rgb(i, c) - bytes.add[c]) / bytes.mul[c]) * 255)));
        data[i * 4 + 3] = 255;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
  }

  /** Draw one frame. Cheap enough to call on every slider input event; the
   *  tables are only re-uploaded when they change. */
  render(spec: RenderSpec, split = -1): void {
    const gl = this.gl;
    if (!this.photoTex) return;
    gl.useProgram(this.program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    if (spec.curveLut && spec.curveLut !== this.last.curve) {
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
      const rgba = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        rgba[i * 4] = spec.curveLut[i];
        rgba[i * 4 + 3] = 255;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      this.last.curve = spec.curveLut;
    }
    if (spec.mixer && spec.mixer !== this.last.mixer) {
      const m = spec.mixer;
      const CELLS = 1296;
      // Texel (x = hue*6 + sat, y = value) holds cell (hue*6 + sat)*6 + value.
      this.upload(this.mixerTex, 216, 6, (i, c) => {
        const x = i % 216;
        const y = Math.floor(i / 216);
        return m[c * CELLS + x * 6 + y];
      }, MIX_BYTES);
      this.last.mixer = m;
    }
    if (spec.grade && spec.grade !== this.last.grade) {
      const g = spec.grade;
      this.upload(this.gradeTex, 64, 1, (i, c) => g[i * 3 + c], GRADE_BYTES);
      this.last.grade = g;
    }

    const bind = (unit: number, tex: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.u(name), unit);
    };
    bind(0, this.photoTex, 'u_photo');
    bind(1, this.maskTex ?? this.photoTex, 'u_masks');
    bind(2, this.curveTex, 'u_curve');
    bind(3, this.mixerTex, 'u_mixer');
    bind(4, this.gradeTex, 'u_grade');
    gl.uniform1i(this.u('u_hasMasks'), this.maskTex ? 1 : 0);
    gl.uniform1i(this.u('u_hasCurve'), spec.curveLut ? 1 : 0);
    gl.uniform1i(this.u('u_hasMixer'), spec.mixer ? 1 : 0);
    gl.uniform1i(this.u('u_hasGrade'), spec.grade ? 1 : 0);
    gl.uniform3fv(this.u('u_mixMul'), this.float ? [1, 1, 1] : MIX_BYTES.mul);
    gl.uniform3fv(this.u('u_mixAdd'), this.float ? [0, 0, 0] : MIX_BYTES.add);
    gl.uniform3fv(this.u('u_gradeMul'), this.float ? [1, 1, 1] : GRADE_BYTES.mul);
    gl.uniform3fv(this.u('u_gradeAdd'), this.float ? [0, 0, 0] : GRADE_BYTES.add);

    gl.uniform2f(this.u('u_texel'), 1 / this.size[0], 1 / this.size[1]);
    gl.uniform1f(this.u('u_gain'), spec.gain);
    gl.uniform1f(this.u('u_gray'), spec.gray);
    gl.uniform4fv(this.u('u_maskGain'), new Float32Array(spec.maskGain));
    gl.uniform4fv(this.u('u_maskA'), new Float32Array(spec.maskA));
    gl.uniform4fv(this.u('u_maskB'), new Float32Array(spec.maskB));
    gl.uniform4fv(this.u('u_maskChroma'), new Float32Array(spec.maskChroma));
    gl.uniform1f(this.u('u_grain'), spec.grain);
    gl.uniform1f(this.u('u_texture'), spec.texture);
    gl.uniform1f(this.u('u_split'), split);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
