/**
 * Windows on the buildings, drawn rather than modelled.
 *
 * OpenMapTiles knows a building's footprint, its base and its roof, and
 * nothing about its face. Atlas Photo's windows come from Mapbox Standard's
 * hand-made facades, which is licensed content; this is the version that
 * needs nothing but the footprint. Every wall gets a grid — storeys up, bays
 * along — cut in the fragment shader from two numbers carried on the vertex:
 * metres along the wall and metres above the ground. No texture, so a window
 * is the same size in metres at every zoom, and nothing to download.
 *
 * ## Why it brings its own walls
 *
 * MapLibre draws `fill-extrusion` into an offscreen target of its own and
 * composites it as a picture, so the depth of those walls never reaches a
 * custom layer. A window drawn straight onto the map would show through every
 * building in front of it. So this draws the whole set again — walls *and*
 * roofs — into a private target with a real depth buffer, where the nearest
 * surface at each pixel wins and only the window parts of it carry any colour,
 * then lays that over the map in one pass. A roof is drawn clear; it is there
 * to hide the walls behind it, which is what a roof does.
 *
 * The GL state traps in `shadow-layer.ts` apply here unchanged: MapLibre's
 * zero-width depth range, a clear masked like a draw, and a state cache that
 * never notices what was changed behind its back.
 *
 * ## What is guessed
 *
 * All of it, honestly: the storey height, the bay width and the window shape
 * are rules of thumb varied per building by a hash of its footprint, so
 * neighbours differ but a building never flickers between two looks. The
 * grid is faded out wherever a storey is under a few pixels tall — a sub-pixel
 * window grid is moiré, not detail.
 */

import earcut from 'earcut';
import type maplibregl from 'maplibre-gl';
import type { Ring } from '../shadows';
import { build } from './shadow-layer';
import { NO_PRELUDE, PROJECTION_UNIFORMS, readProjection, setProjectionUniforms, type ShaderData } from './projection';

/** x, y, mercZ, u (m along the wall), h (m above ground), wall length, seed, kind, roof height. */
export const WINDOW_STRIDE = 9;

/**
 * Below this zoom no storey anywhere on screen reaches `FADE_FROM_PX`, so the
 * layer skips the whole frame rather than drawing a target full of nothing.
 */
const MIN_ZOOM = 15;

/** A storey is under this many pixels tall: no grid at all. */
const FADE_FROM_PX = 6;
/** …and over this many: the full grid. */
const FADE_TO_PX = 14;

/**
 * Projected the plain mercator way under both preludes.
 *
 * The globe variant's own projection hands back the *clipping* depth, which
 * the blend sets to zero once the map is flat — a depth buffer of zeros. By
 * the zoom a window is worth drawing the globe has long since finished
 * flattening into mercator, so the fallback matrix is the projection actually
 * on screen, and it keeps a real Z.
 */
const WINDOW_VERTEX = (prelude: string, define: string) => `
  ${prelude}
  ${define}
  uniform vec2 u_viewport;
  uniform float u_merc_per_m;
  attribute vec2 a_pos;
  attribute float a_z;
  attribute float a_u;
  attribute float a_h;
  attribute float a_len;
  attribute float a_seed;
  attribute float a_kind;
  attribute float a_top;
  varying float v_u;
  varying float v_h;
  varying float v_len;
  varying float v_seed;
  varying float v_kind;
  varying float v_top;
  varying float v_px_per_m;
  vec4 flatProject(vec2 merc, float z) {
#ifdef GLOBE
    return u_projection_fallback_matrix * vec4(merc, z, 1.0);
#else
    return u_projection_matrix * vec4(merc, z, 1.0);
#endif
  }
  void main() {
    vec4 p = flatProject(a_pos, a_z);
    // A metre straight up, in pixels — the size every edge of the grid is
    // softened by, and what decides whether there is a grid at all.
    vec4 q = flatProject(a_pos, a_z + u_merc_per_m);
    vec2 d = (q.xy / max(q.w, 1e-6) - p.xy / max(p.w, 1e-6)) * 0.5 * u_viewport;
    v_px_per_m = p.w > 0.0 && q.w > 0.0 ? length(d) : 0.0;
    v_u = a_u;
    v_h = a_h;
    v_len = a_len;
    v_seed = a_seed;
    v_kind = a_kind;
    v_top = a_top;
    gl_Position = p;
  }`;

const WINDOW_FRAGMENT = `
  precision highp float;
  uniform vec3 u_glass;
  uniform float u_glass_alpha;
  uniform vec3 u_lit;
  uniform float u_night;
  varying float v_u;
  varying float v_h;
  varying float v_len;
  varying float v_seed;
  varying float v_kind;
  varying float v_top;
  varying float v_px_per_m;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // 1 inside [a, b], 0 outside, softened over one pixel either side.
  float band(float x, float a, float b, float px) {
    return smoothstep(a - px, a + px, x) * (1.0 - smoothstep(b - px, b + px, x));
  }

  void main() {
    // Roofs and anything too small to carry a grid still write depth — that is
    // what they are here for — and leave the map under them untouched.
    if (v_kind < 0.5 || v_len < 2.5 || v_top < 3.0) { gl_FragColor = vec4(0.0); return; }

    float tower = step(60.0, v_top);
    float storey = 3.0 + 0.7 * fract(v_seed * 7.13);
    float ground = storey + 1.0;
    float fade = clamp((v_px_per_m * storey - ${FADE_FROM_PX}.0) / ${FADE_TO_PX - FADE_FROM_PX}.0, 0.0, 1.0);
    // Below the ground floor's top, a shopfront; under the parapet, nothing.
    if (fade <= 0.0 || v_h > v_top - 1.2) { gl_FragColor = vec4(0.0); return; }

    float px = 0.5 / max(v_px_per_m, 1e-3);
    float shop = 1.0 - step(ground, v_h);
    float floorIndex = shop > 0.5 ? -1.0 : floor((v_h - ground) / storey);
    float y = shop > 0.5 ? v_h : v_h - ground - floorIndex * storey;
    float sill = shop > 0.5 ? 0.5 : mix(0.9, 0.35, tower);
    float head = shop > 0.5 ? ground - 0.6 : mix(2.4, storey - 0.35, tower);

    float bayWidth = shop > 0.5 ? 4.5 : mix(3.0 + 1.2 * fract(v_seed * 3.71), 2.2, tower);
    float bays = max(1.0, floor(v_len / bayWidth + 0.5));
    float bay = v_len / bays;
    float bayIndex = floor(v_u / bay);
    float x = v_u - bayIndex * bay;
    float share = shop > 0.5 ? 0.8 : mix(0.34 + 0.22 * fract(v_seed * 5.17), 0.62, tower);
    float margin = bay * (1.0 - share) * 0.5;

    float w = band(x, margin, bay - margin, px) * band(y, sill, head, px) * fade;
    if (w <= 0.0) { gl_FragColor = vec4(0.0); return; }

    // At night a share of them are lit — a different share per building, so
    // a block is not one pattern.
    float on = step(hash(vec2(v_seed * 91.7 + floorIndex * 13.1, bayIndex)), 0.1 + 0.2 * fract(v_seed * 2.3));
    vec3 colour = mix(u_glass, u_lit, on * u_night);
    float alpha = mix(u_glass_alpha, 0.9, on * u_night) * w;
    gl_FragColor = vec4(colour * alpha, alpha);
  }`;

const COMPOSITE_VERTEX = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

/** Premultiplied, so a soft window edge composites without a dark fringe. */
const COMPOSITE_FRAGMENT = `
  precision mediump float;
  uniform sampler2D u_windows;
  varying vec2 v_uv;
  void main() {
    vec4 c = texture2D(u_windows, v_uv);
    if (c.a <= 0.0) discard;
    gl_FragColor = c;
  }`;

/** How the glass looks, set from the sun and the basemap. */
export interface WindowStyle {
  /** Glass by day, RGB 0–1. */
  glass: [number, number, number];
  glassAlpha: number;
  /** A lit window, RGB 0–1. */
  lit: [number, number, number];
  /** 0 by day, 1 once it is dark enough for lights to be on. */
  night: number;
}

export interface WindowLayer extends maplibregl.CustomLayerInterface {
  style: WindowStyle;
  /** Mercator units per metre at the view's latitude, for the grid's pixel size. */
  mercPerMetre: number;
  setGeometry(vertices: Float32Array): void;
}

const ATTRIBUTES = ['a_pos', 'a_z', 'a_u', 'a_h', 'a_len', 'a_seed', 'a_kind', 'a_top'] as const;

export function createWindowLayer(id: string): WindowLayer {
  type Program = NonNullable<ReturnType<typeof build>>;
  const built = new Map<string, Program | null>();
  let program: Program | null = null;
  let variant: string | null = null;
  let composite: Program | null = null;

  let buffer: WebGLBuffer | null = null;
  let quad: WebGLBuffer | null = null;
  let framebuffer: WebGLFramebuffer | null = null;
  let texture: WebGLTexture | null = null;
  let depth: WebGLRenderbuffer | null = null;
  let targetWidth = 0;
  let targetHeight = 0;

  let map: maplibregl.Map | null = null;
  let vertices: Float32Array = new Float32Array(0);
  let count = 0;
  let dirty = false;

  function compileFor(gl: WebGLRenderingContext, shader: ShaderData): boolean {
    if (!built.has(shader.variantName)) {
      built.set(
        shader.variantName,
        build(
          gl,
          WINDOW_VERTEX(shader.vertexShaderPrelude, shader.define),
          WINDOW_FRAGMENT,
          [...ATTRIBUTES],
          [...PROJECTION_UNIFORMS, 'u_viewport', 'u_merc_per_m', 'u_glass', 'u_glass_alpha', 'u_lit', 'u_night'],
        ),
      );
    }
    program = built.get(shader.variantName) ?? null;
    variant = shader.variantName;
    return program != null;
  }

  function ensureTarget(gl: WebGLRenderingContext, width: number, height: number): boolean {
    if (framebuffer && width === targetWidth && height === targetHeight) return true;
    if (texture) gl.deleteTexture(texture);
    if (depth) gl.deleteRenderbuffer(depth);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);

    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // Same size as the drawing buffer, so NEAREST is a 1:1 copy.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);

    framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    if (!complete) {
      console.warn('[scout] window framebuffer incomplete');
      framebuffer = null;
      return false;
    }
    targetWidth = width;
    targetHeight = height;
    return true;
  }

  return {
    id,
    type: 'custom' as const,
    renderingMode: '2d' as const,
    style: { glass: [0.6, 0.66, 0.73], glassAlpha: 0.7, lit: [1, 0.8, 0.52], night: 0 },
    mercPerMetre: 0,

    setGeometry(next: Float32Array) {
      vertices = next;
      count = next.length / WINDOW_STRIDE;
      dirty = true;
    },

    onAdd(instance: maplibregl.Map, gl: WebGLRenderingContext) {
      map = instance;
      compileFor(gl, NO_PRELUDE);
      composite = build(gl, COMPOSITE_VERTEX, COMPOSITE_FRAGMENT, ['a_pos'], ['u_windows']);
      buffer = gl.createBuffer();
      quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      dirty = true;
    },

    onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext) {
      for (const p of built.values()) if (p) gl.deleteProgram(p.program);
      built.clear();
      if (composite) gl.deleteProgram(composite.program);
      for (const b of [buffer, quad]) if (b) gl.deleteBuffer(b);
      if (texture) gl.deleteTexture(texture);
      if (depth) gl.deleteRenderbuffer(depth);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      program = composite = null;
      variant = null;
      map = null;
      buffer = quad = framebuffer = texture = depth = null;
      targetWidth = targetHeight = 0;
    },

    render(gl: WebGLRenderingContext, args: unknown) {
      if (!count || !composite || !(this.mercPerMetre > 0)) return;
      if (map && map.getZoom() < MIN_ZOOM) return;
      const read = readProjection(args);
      if (!read) return;
      const { projection, shader } = read;
      if (shader.variantName !== variant && !compileFor(gl, shader)) return;
      if (!program) return;

      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      if (!width || !height || !ensureTarget(gl, width, height)) return;

      // Put back on the way out, all of it — see the state cache trap above.
      const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
      const previousClearColour = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
      const previousClearDepth = gl.getParameter(gl.DEPTH_CLEAR_VALUE) as number;
      const previousDepthFunc = gl.getParameter(gl.DEPTH_FUNC) as number;
      const previousDepthRange = gl.getParameter(gl.DEPTH_RANGE) as Float32Array;

      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.depthMask(true);
      gl.colorMask(true, true, true, true);
      gl.depthRange(0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      if (dirty) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        dirty = false;
      }

      // The nearest wall or roof at each pixel wins outright — no blending in
      // here, so a blank stretch of a near wall hides a window behind it.
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.disable(gl.BLEND);
      gl.useProgram(program.program);
      setProjectionUniforms(gl, program.uniforms, projection);
      const s = this.style;
      gl.uniform2f(program.uniforms.u_viewport, width, height);
      gl.uniform1f(program.uniforms.u_merc_per_m, this.mercPerMetre);
      gl.uniform3fv(program.uniforms.u_glass, s.glass);
      gl.uniform1f(program.uniforms.u_glass_alpha, s.glassAlpha);
      gl.uniform3fv(program.uniforms.u_lit, s.lit);
      gl.uniform1f(program.uniforms.u_night, s.night);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const stride = WINDOW_STRIDE * 4;
      const sizes = [2, 1, 1, 1, 1, 1, 1, 1];
      let offset = 0;
      ATTRIBUTES.forEach((name, i) => {
        const loc = program!.attributes[name];
        if (loc >= 0) {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, sizes[i], gl.FLOAT, false, stride, offset);
        }
        offset += sizes[i] * 4;
      });
      gl.drawArrays(gl.TRIANGLES, 0, count);
      for (const name of ATTRIBUTES) {
        const loc = program.attributes[name];
        if (loc >= 0) gl.disableVertexAttribArray(loc);
      }

      // Onto the map, once.
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      gl.viewport(previousViewport[0], previousViewport[1], previousViewport[2], previousViewport[3]);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(composite.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(composite.uniforms.u_windows, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(composite.attributes.a_pos);
      gl.vertexAttribPointer(composite.attributes.a_pos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(composite.attributes.a_pos);

      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(previousClearColour[0], previousClearColour[1], previousClearColour[2], previousClearColour[3]);
      gl.clearDepth(previousClearDepth);
      gl.depthFunc(previousDepthFunc);
      gl.depthRange(previousDepthRange[0], previousDepthRange[1]);
      gl.depthMask(false);
    },
  };
}

/** A stable 0–1 number per footprint, so a building keeps its look. */
export function footprintSeed(ring: Ring): number {
  const [lon, lat] = ring[0];
  const x = Math.sin(lon * 12.9898 + lat * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const METRES_PER_DEGREE_LAT = 110_540;
const METRES_PER_DEGREE_LON_AT_EQUATOR = 111_320;

/**
 * The walls and roofs the layer draws, as one triangle list.
 *
 * `project` is the same mercator projection the shadow geometry uses, and
 * heights are relative to the building's own ground: the windows are drawn on
 * the flat plane MapLibre extrudes on without terrain, and in 3D with terrain
 * a building that MapLibre lifts onto a hillside is lifted here by the same
 * `groundM` the shadows use.
 */
export class WindowGeometry {
  private readonly out: number[] = [];

  constructor(
    private readonly project: (lon: number, lat: number, elevationM: number) => [number, number, number],
  ) {}

  /**
   * One building, or one `building:part`. `baseM` and `topM` are above its
   * ground (OpenMapTiles' `render_min_height` and `render_height`), and the
   * storeys are counted from the ground, not from the part's base, so a
   * setback's windows line up with the floors under it.
   */
  addBuilding(ring: Ring, groundM: number, baseM: number, topM: number, seed: number): void {
    if (!(topM > baseM) || ring.length < 4) return;
    const n = ring.length - 1; // closed ring
    const lat0 = ring[0][1];
    const lonScale = METRES_PER_DEGREE_LON_AT_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
    const out = this.out;
    const push = (p: [number, number, number], u: number, h: number, len: number, kind: number) =>
      out.push(p[0], p[1], p[2], u, h, len, seed, kind, topM);

    for (let i = 0; i < n; i++) {
      const [lon1, lat1] = ring[i];
      const [lon2, lat2] = ring[i + 1];
      const len = Math.hypot((lon2 - lon1) * lonScale, (lat2 - lat1) * METRES_PER_DEGREE_LAT);
      if (len < 0.2) continue;
      const b1 = this.project(lon1, lat1, groundM + baseM);
      const t1 = this.project(lon1, lat1, groundM + topM);
      const b2 = this.project(lon2, lat2, groundM + baseM);
      const t2 = this.project(lon2, lat2, groundM + topM);
      push(b1, 0, baseM, len, 1);
      push(b2, len, baseM, len, 1);
      push(t1, 0, topM, len, 1);
      push(b2, len, baseM, len, 1);
      push(t2, len, topM, len, 1);
      push(t1, 0, topM, len, 1);
    }

    const flat: number[] = [];
    for (let i = 0; i < n; i++) flat.push(ring[i][0], ring[i][1]);
    const triangles = earcut(flat);
    const roof = Array.from({ length: n }, (_, i) => this.project(ring[i][0], ring[i][1], groundM + topM));
    for (const index of triangles) push(roof[index], 0, topM, 0, 0);
  }

  vertices(): Float32Array {
    return new Float32Array(this.out);
  }
}
