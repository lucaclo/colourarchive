/**
 * Cast building shadows, drawn as volumes rather than as flat polygons.
 *
 * The fill layer this replaces got two things wrong, both of them visible.
 *
 * **It pooled.** MapLibre blends every feature separately, so where two shadows
 * crossed, the ground was painted twice and came out darker than either. That
 * reads as information and is not: a point the sun cannot reach is equally unlit
 * whether one building blocks it or three. No paint property can fix it —
 * `fill-opacity` is applied per fragment, per feature, and there is no way to
 * ask for the maximum instead of the sum. It needs a different renderer.
 *
 * **It ignored what it landed on.** A shadow was drawn flat across whatever it
 * met, including the roof of a tower standing in full sun on the far side of the
 * street. A shadow is not a stain on the ground; it is the shaded part of a
 * volume, with a *ceiling* that starts at the building's own height and slopes
 * down to nothing at the tip. Whether a thing is in shadow depends on whether it
 * rises through that ceiling.
 *
 * Both fall out of one idea: **use a depth buffer as a height field.** Render
 * every footprint in view, depth-mapped from its height, into a private depth
 * attachment — that is a top-down record of how tall the world is at each pixel.
 * Then render each shadow with its ceiling depth-mapped the same way, tested
 * against that record with no depth writes. A fragment survives only where the
 * shadow's ceiling is above the thing standing there. Roofs below the ceiling
 * take the shadow; anything taller stays lit; and a building never paints its
 * own footprint, because there its ceiling *equals* its height and the test is
 * a strict one.
 *
 * The colour goes to a private texture with `MAX` blending, so overlapping
 * shadows take the darkest rather than the sum, and the whole mask is composited
 * over the map in one pass. That is the pooling gone, exactly, and for free.
 *
 * What it still does not do is climb *walls*. Those are drawn by MapLibre's own
 * fill-extrusion layer, out of reach from here, so a shadow crossing a low roof
 * is drawn on the roof but does not run up the side of the building it climbed.
 * Doing that properly means taking over the extrusion pass, which is a much
 * larger change than this one — reconsidered for issue #51 and left exactly
 * where it was: still out of reach, for the same reason.
 *
 * ## Issue #51: absolute elevation, both ways
 *
 * Two related gaps closed together, because they turned out to be the same
 * missing number seen twice. Every vertex here used to be projected at
 * mercator Z zero and packed with a height measured from its *own* base —
 * which is consistent for one building on flat ground and wrong twice over on
 * a slope: the ground position drifted from the terrain under it (worse the
 * more the map is pitched or elevated), and a building down-slope from a
 * mountain had no way to be shorter than it in absolute terms, because
 * nothing here spoke in absolute terms at all.
 *
 * The fix is one idea applied to both blockers and shadows: carry the DEM
 * elevation at every vertex, feed it to `scoutGround` (see `projection.ts`)
 * so the *position* sits on the real ground, and fold that same elevation
 * into the *height* every blocker and shadow ceiling already carries, so the
 * single height-field pass this file was built around now compares heights
 * that are all measured from the same sea level rather than each from its
 * own doorstep. A mountain is then just another blocker in that pass — see
 * `terrain.ts`'s `terrainFacets` — and it stops a building's shadow exactly
 * the way a taller building already did, for free, in the same test.
 */

import type maplibregl from 'maplibre-gl';
import { convexHull, type Ring } from '../shadows';
import type { TerrainFacet } from '../terrain';
import {
  GLSL_PROJECT_GROUND,
  NO_PRELUDE,
  PROJECTION_UNIFORMS,
  readProjection,
  setProjectionUniforms,
  type ShaderData,
} from './projection';

/**
 * Sets the depth buffer's scale. Used to be "taller than anything that has
 * been built" — 1000 m was plenty for a *relative* building height. Issue
 * #51 made every height here absolute (terrain elevation folded in), and
 * terrain alone clears 1000 m across a large fraction of the world's
 * mountains before a single building is added on top, so this now has to
 * clear the tallest ground on earth, not the tallest building: Everest is
 * 8,849 m, and 12,000 leaves headroom above it for whatever is standing on
 * top. The 16-bit depth buffer still resolves this to about 18 cm a step —
 * far finer than a shadow calculation needs.
 */
const MAX_HEIGHT_M = 12_000;

/** x, y, elevMercZ, elevM, ceiling, dark — 6 floats a vertex. */
const SHADOW_STRIDE = 6;
/** x, y, elevMercZ, elevM, height — 5 floats a vertex. */
const BLOCKER_STRIDE = 5;

export interface ShadowLayer extends maplibregl.CustomLayerInterface {
  /**
   * True once the context proved it can do this — shaders compiled, a complete
   * framebuffer, and blending that can take a maximum. False means the caller
   * should keep drawing shadows the old way.
   */
  readonly ready: boolean;
  /** RGB the shadow is painted in, 0–1. */
  tint: [number, number, number];
  /**
   * A flat multiplier over the whole mask, 0–1 — how much hard light there is
   * to cast a shadow at all.
   *
   * A uniform rather than something carried on the vertices, because it moves
   * on the forecast's clock, not the sun's: cloud can change without a single
   * shadow moving, and rebuilding the geometry to say so would be absurd.
   * Scaling after the maximum is taken is safe, since a maximum survives being
   * multiplied by a positive constant.
   */
  opacity: number;
  /**
   * The shadows to draw, packed by `ShadowGeometry`. Changes whenever the sun
   * does.
   */
  setShadows(vertices: Float32Array): void;
  /**
   * What is standing in the way, packed by `ShadowGeometry`.
   *
   * Kept apart from the shadows because it changes on a different clock: the
   * buildings in view are a property of where you are looking, not of the time,
   * so a scrub through a whole day never touches this. Uploading it with every
   * recast would push a few hundred kilobytes at the GPU each frame for nothing.
   */
  setBlockers(vertices: Float32Array): void;
}

/**
 * Everything here stands on the ground, so it is projected by `scoutGround`.
 *
 * `a_height` is *absolute* now — see this file's issue #51 note — so
 * `gl_Position`'s Z still cannot come from the projection: it carries that
 * absolute height, which is the whole mechanism by which the tallest thing
 * at a pixel wins, whether that thing is a building or the mountain behind
 * it. That is also why the far side of the planet has to be discarded in the
 * fragment shader rather than clipped — the one number that would have done
 * it is spoken for.
 */
const BLOCKER_VERTEX = (prelude: string, define: string) => `
  ${prelude}
  ${define}
  ${GLSL_PROJECT_GROUND}
  attribute vec2 a_pos;
  attribute float a_elevMercZ;
  attribute float a_elevM;
  attribute float a_height;
  varying mediump float v_beyond;
  void main() {
    float beyond;
    vec4 p = scoutGround(a_pos, a_elevMercZ, a_elevM, beyond);
    v_beyond = beyond;
    // Height straight into normalised depth: tall is near, ground is far, so a
    // LESS test keeps the tallest thing standing at each pixel.
    float z = 1.0 - 2.0 * clamp(a_height / ${MAX_HEIGHT_M}.0, 0.0, 1.0);
    gl_Position = vec4(p.xy, z * p.w, p.w);
  }`;

const BLOCKER_FRAGMENT = `
  precision mediump float;
  varying mediump float v_beyond;
  void main() {
    // Round the back of the planet. Discarded rather than drawn black, so it
    // does not write depth either — a building on the far side must not shade
    // one on the near side.
    if (v_beyond > 1.0) discard;
    gl_FragColor = vec4(0.0);
  }`;

const SHADOW_VERTEX = (prelude: string, define: string) => `
  ${prelude}
  ${define}
  ${GLSL_PROJECT_GROUND}
  attribute vec2 a_pos;
  attribute float a_elevMercZ;
  attribute float a_elevM;
  attribute float a_ceiling;
  attribute float a_dark;
  varying mediump float v_dark;
  varying mediump float v_beyond;
  void main() {
    float beyond;
    vec4 p = scoutGround(a_pos, a_elevMercZ, a_elevM, beyond);
    v_beyond = beyond;
    // a_ceiling is absolute too (issue #51): the building's own base
    // elevation, folded in once by the caller rather than measured per
    // vertex, so a shadow's ceiling stays the flat-ground shape castShadow
    // computed and only its datum moves with the terrain.
    float z = 1.0 - 2.0 * clamp(a_ceiling / ${MAX_HEIGHT_M}.0, 0.0, 1.0);
    gl_Position = vec4(p.xy, z * p.w, p.w);
    v_dark = a_dark;
  }`;

const SHADOW_FRAGMENT = `
  precision mediump float;
  varying mediump float v_dark;
  varying mediump float v_beyond;
  void main() {
    if (v_beyond > 1.0) discard;
    gl_FragColor = vec4(v_dark);
  }`;

const COMPOSITE_VERTEX = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const COMPOSITE_FRAGMENT = `
  precision mediump float;
  uniform sampler2D u_mask;
  uniform vec3 u_tint;
  uniform float u_opacity;
  varying vec2 v_uv;
  void main() {
    float a = texture2D(u_mask, v_uv).a * u_opacity;
    if (a <= 0.0) discard;
    gl_FragColor = vec4(u_tint, a);
  }`;

interface Program {
  program: WebGLProgram;
  attributes: Record<string, number>;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

function build(
  gl: WebGLRenderingContext,
  vertex: string,
  fragment: string,
  attributes: string[],
  uniforms: string[],
): Program | null {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('[scout] shadow shader failed', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vs = compile(gl.VERTEX_SHADER, vertex);
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  const program = vs && fs ? gl.createProgram() : null;
  if (!vs || !fs || !program) return null;

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[scout] shadow program failed', gl.getProgramInfoLog(program));
    return null;
  }

  return {
    program,
    attributes: Object.fromEntries(attributes.map((n) => [n, gl.getAttribLocation(program, n)])),
    uniforms: Object.fromEntries(uniforms.map((n) => [n, gl.getUniformLocation(program, n)])),
  };
}

/**
 * The `MAX` blend equation, wherever this context keeps it.
 *
 * Core in WebGL2; in WebGL1 it is `EXT_blend_minmax`, which is near-universal
 * but not guaranteed. Without it there is no way to take the darkest of two
 * overlapping shadows in one pass, and the layer stands down rather than draw
 * the pooled picture it exists to replace.
 */
function maxEquation(gl: WebGLRenderingContext): number | null {
  const gl2 = gl as WebGLRenderingContext & { MAX?: number };
  if (typeof gl2.MAX === 'number') return gl2.MAX;
  const ext = gl.getExtension('EXT_blend_minmax');
  return ext ? ext.MAX_EXT : null;
}

export function createShadowLayer(id: string, onReady?: (ready: boolean) => void): ShadowLayer {
  let blockerProgram: Program | null = null;
  let shadowProgram: Program | null = null;
  let compositeProgram: Program | null = null;

  let shadowBuffer: WebGLBuffer | null = null;
  let blockerBuffer: WebGLBuffer | null = null;
  let quadBuffer: WebGLBuffer | null = null;

  let framebuffer: WebGLFramebuffer | null = null;
  let texture: WebGLTexture | null = null;
  let depth: WebGLRenderbuffer | null = null;
  let targetWidth = 0;
  let targetHeight = 0;

  let maxBlend: number | null = null;
  let ready = false;
  let shadowsDirty = false;
  let blockersDirty = false;
  /**
   * Which projection the blocker and shadow programs were compiled for.
   *
   * MapLibre swaps the prelude under the layer as the map crosses between globe
   * and mercator, so a program compiled once would project against a projection
   * the map has since left — and shadows drawn in the wrong place look like
   * shadows, which is why this cannot be left to be noticed.
   */
  let variant: string | null = null;

  /** (Re)build the two projected programs for `shader`'s projection. */
  function compileFor(gl: WebGLRenderingContext, shader: ShaderData): boolean {
    for (const p of [blockerProgram, shadowProgram]) if (p) gl.deleteProgram(p.program);
    blockerProgram = build(
      gl,
      BLOCKER_VERTEX(shader.vertexShaderPrelude, shader.define),
      BLOCKER_FRAGMENT,
      ['a_pos', 'a_elevMercZ', 'a_elevM', 'a_height'],
      [...PROJECTION_UNIFORMS],
    );
    shadowProgram = build(
      gl,
      SHADOW_VERTEX(shader.vertexShaderPrelude, shader.define),
      SHADOW_FRAGMENT,
      ['a_pos', 'a_elevMercZ', 'a_elevM', 'a_ceiling', 'a_dark'],
      [...PROJECTION_UNIFORMS],
    );
    variant = shader.variantName;
    return Boolean(blockerProgram && shadowProgram);
  }

  let shadows: Float32Array = new Float32Array(0);
  let blockers: Float32Array = new Float32Array(0);
  /** Vertices, not floats. */
  let shadowCount = 0;
  let blockerCount = 0;

  /**
   * A colour texture and a depth attachment the size of the drawing buffer.
   *
   * Private on purpose: the depth attachment holds heights in metres, not
   * distances from the camera, and must not touch the buffer MapLibre uses to
   * sort the map's own geometry.
   */
  function ensureTarget(gl: WebGLRenderingContext, width: number, height: number): boolean {
    if (framebuffer && width === targetWidth && height === targetHeight) return true;

    if (texture) gl.deleteTexture(texture);
    if (depth) gl.deleteRenderbuffer(depth);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);

    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // NEAREST and clamped: the mask is sampled one texel to one pixel, so there
    // is nothing to interpolate and edge wrapping could only smear it.
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
      console.warn('[scout] shadow framebuffer incomplete');
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
    tint: [0.08, 0.1, 0.17] as [number, number, number],
    opacity: 1,

    get ready() {
      return ready;
    },

    setShadows(vertices: Float32Array) {
      shadows = vertices;
      shadowCount = vertices.length / SHADOW_STRIDE;
      shadowsDirty = true;
    },

    setBlockers(vertices: Float32Array) {
      blockers = vertices;
      blockerCount = vertices.length / BLOCKER_STRIDE;
      blockersDirty = true;
    },

    onAdd(_map: maplibregl.Map, gl: WebGLRenderingContext) {
      maxBlend = maxEquation(gl);
      // Compiled against the plain mercator prelude, which is enough to prove
      // the shaders themselves are sound — `ready` has to be answered now, and
      // which projection is up is not known until a frame is drawn. The first
      // frame recompiles against whatever MapLibre is really using, because
      // `variant` is left saying otherwise.
      const compiled = compileFor(gl, NO_PRELUDE);
      compositeProgram = build(
        gl,
        COMPOSITE_VERTEX,
        COMPOSITE_FRAGMENT,
        ['a_pos'],
        ['u_mask', 'u_tint', 'u_opacity'],
      );

      shadowBuffer = gl.createBuffer();
      blockerBuffer = gl.createBuffer();
      quadBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // A style change tears the layer down and builds it again against fresh
      // buffers, so whatever geometry is already in hand has to be re-uploaded
      // even though nothing about it changed.
      shadowsDirty = true;
      blockersDirty = true;

      ready = Boolean(maxBlend && compiled && compositeProgram);
      // Said now rather than at first paint, so the caller can put the old fill
      // layer away before a frame is drawn with both of them showing.
      onReady?.(ready);
    },

    onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext) {
      for (const p of [blockerProgram, shadowProgram, compositeProgram]) {
        if (p) gl.deleteProgram(p.program);
      }
      for (const b of [shadowBuffer, blockerBuffer, quadBuffer]) if (b) gl.deleteBuffer(b);
      if (texture) gl.deleteTexture(texture);
      if (depth) gl.deleteRenderbuffer(depth);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      blockerProgram = shadowProgram = compositeProgram = null;
      variant = null;
      shadowBuffer = blockerBuffer = quadBuffer = framebuffer = texture = depth = null;
      targetWidth = targetHeight = 0;
      ready = false;
    },

    render(gl: WebGLRenderingContext, args: unknown) {
      if (!ready || !shadowCount || !compositeProgram) return;

      const read = readProjection(args);
      if (!read) return;
      const { projection, shader } = read;

      // Recompiled on the way between globe and mercator, and stood down for
      // good if the new projection's prelude will not compile — better the flat
      // fill layer, which is honest about being worse, than shadows silently
      // stopping.
      if (shader.variantName !== variant && !compileFor(gl, shader)) {
        ready = false;
        queueMicrotask(() => onReady?.(false));
        return;
      }
      if (!blockerProgram || !shadowProgram) return;

      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      // A canvas with no size at all is a minimised window or a tab that has
      // never been shown, not a context that cannot do this. Standing down here
      // would be permanent, so wait instead — there is nothing to draw anyway.
      if (!width || !height) return;
      if (!ensureTarget(gl, width, height)) {
        ready = false;
        // Out of the render pass before telling anyone: the listener puts the
        // fallback layer back up, and restyling the map from inside its own
        // draw is not something to find out about the hard way.
        queueMicrotask(() => onReady?.(false));
        return;
      }

      // Everything below is put back before returning, including the clear
      // values and the depth function. MapLibre caches the GL state it believes
      // the context is in and skips redundant calls, so anything changed behind
      // its back is not corrected on the next frame — it is simply wrong, and
      // silently, which is the worst way for this to fail.
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
      // Both masks open *before* the clear. A clear is masked exactly like a
      // draw, so clearing depth while `depthMask` is false silently does
      // nothing — and since this pass leaves it false on the way out, the
      // height buffer would be cleared on the first frame and never again,
      // accumulating every building the view had ever held. Caught by reading
      // the mask back: a five-metre shed was blocking a thirty-metre shadow,
      // because the shed was not the shed, it was a tower from two frames ago.
      gl.depthMask(true);
      gl.colorMask(true, true, true, true);
      // The whole depth range, which MapLibre does not leave lying around.
      //
      // It hands each 2D layer a *single depth plane* — measured here as
      // [0.98419, 0.98419], a slice of zero width — so that layers stack in
      // draw order and never fight. Every fragment written under that setting
      // lands on the same depth whatever its vertex said, which quietly turns
      // the height comparison below into a comparison of a number with itself:
      // no error, no warning, and a shadow blocked by a garden shed. Inside a
      // private framebuffer the full range is ours to take, and it is restored
      // before the map draws anything else.
      gl.depthRange(0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      if (shadowsDirty) {
        gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, shadows, gl.DYNAMIC_DRAW);
        shadowsDirty = false;
      }
      if (blockersDirty) {
        gl.bindBuffer(gl.ARRAY_BUFFER, blockerBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, blockers, gl.STATIC_DRAW);
        blockersDirty = false;
      }

      // Pass 1 — the height field. Colour is masked off; all this pass leaves
      // behind is a depth buffer saying how tall the world is at each pixel.
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.colorMask(false, false, false, false);

      if (blockerCount) {
        gl.useProgram(blockerProgram.program);
        setProjectionUniforms(gl, blockerProgram.uniforms, projection);
        gl.bindBuffer(gl.ARRAY_BUFFER, blockerBuffer);
        const blockerStride = BLOCKER_STRIDE * 4;
        gl.enableVertexAttribArray(blockerProgram.attributes.a_pos);
        gl.vertexAttribPointer(blockerProgram.attributes.a_pos, 2, gl.FLOAT, false, blockerStride, 0);
        gl.enableVertexAttribArray(blockerProgram.attributes.a_elevMercZ);
        gl.vertexAttribPointer(blockerProgram.attributes.a_elevMercZ, 1, gl.FLOAT, false, blockerStride, 8);
        gl.enableVertexAttribArray(blockerProgram.attributes.a_elevM);
        gl.vertexAttribPointer(blockerProgram.attributes.a_elevM, 1, gl.FLOAT, false, blockerStride, 12);
        gl.enableVertexAttribArray(blockerProgram.attributes.a_height);
        gl.vertexAttribPointer(blockerProgram.attributes.a_height, 1, gl.FLOAT, false, blockerStride, 16);
        gl.drawArrays(gl.TRIANGLES, 0, blockerCount);
        gl.disableVertexAttribArray(blockerProgram.attributes.a_pos);
        gl.disableVertexAttribArray(blockerProgram.attributes.a_elevMercZ);
        gl.disableVertexAttribArray(blockerProgram.attributes.a_elevM);
        gl.disableVertexAttribArray(blockerProgram.attributes.a_height);
      }

      // Pass 2 — the mask. Depth reads, never writes, so the shadows test
      // against the height field without disturbing it, and MAX blending keeps
      // the darkest of any that overlap instead of adding them up.
      gl.colorMask(true, true, true, true);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendEquation(maxBlend!);
      gl.blendFunc(gl.ONE, gl.ONE);

      gl.useProgram(shadowProgram.program);
      setProjectionUniforms(gl, shadowProgram.uniforms, projection);
      gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuffer);
      const shadowStride = SHADOW_STRIDE * 4;
      gl.enableVertexAttribArray(shadowProgram.attributes.a_pos);
      gl.vertexAttribPointer(shadowProgram.attributes.a_pos, 2, gl.FLOAT, false, shadowStride, 0);
      gl.enableVertexAttribArray(shadowProgram.attributes.a_elevMercZ);
      gl.vertexAttribPointer(shadowProgram.attributes.a_elevMercZ, 1, gl.FLOAT, false, shadowStride, 8);
      gl.enableVertexAttribArray(shadowProgram.attributes.a_elevM);
      gl.vertexAttribPointer(shadowProgram.attributes.a_elevM, 1, gl.FLOAT, false, shadowStride, 12);
      gl.enableVertexAttribArray(shadowProgram.attributes.a_ceiling);
      gl.vertexAttribPointer(shadowProgram.attributes.a_ceiling, 1, gl.FLOAT, false, shadowStride, 16);
      gl.enableVertexAttribArray(shadowProgram.attributes.a_dark);
      gl.vertexAttribPointer(shadowProgram.attributes.a_dark, 1, gl.FLOAT, false, shadowStride, 20);
      gl.drawArrays(gl.TRIANGLES, 0, shadowCount);
      gl.disableVertexAttribArray(shadowProgram.attributes.a_pos);
      gl.disableVertexAttribArray(shadowProgram.attributes.a_elevMercZ);
      gl.disableVertexAttribArray(shadowProgram.attributes.a_elevM);
      gl.disableVertexAttribArray(shadowProgram.attributes.a_ceiling);
      gl.disableVertexAttribArray(shadowProgram.attributes.a_dark);

      // Pass 3 — one flat coat over the map, at the mask's own opacity. This is
      // the only time anything is blended onto the map, which is what makes
      // crossing shadows impossible to pool.
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      gl.viewport(previousViewport[0], previousViewport[1], previousViewport[2], previousViewport[3]);
      gl.disable(gl.DEPTH_TEST);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      gl.useProgram(compositeProgram.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(compositeProgram.uniforms.u_mask, 0);
      gl.uniform3fv(compositeProgram.uniforms.u_tint, this.tint);
      gl.uniform1f(compositeProgram.uniforms.u_opacity, Math.max(0, Math.min(1, this.opacity)));
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.enableVertexAttribArray(compositeProgram.attributes.a_pos);
      gl.vertexAttribPointer(compositeProgram.attributes.a_pos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(compositeProgram.attributes.a_pos);

      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.clearColor(
        previousClearColour[0],
        previousClearColour[1],
        previousClearColour[2],
        previousClearColour[3],
      );
      gl.clearDepth(previousClearDepth);
      gl.depthFunc(previousDepthFunc);
      gl.depthRange(previousDepthRange[0], previousDepthRange[1]);
      gl.depthMask(false);
    },
  };
}

/**
 * Builds the two vertex arrays the layer draws.
 *
 * Both are triangle lists, fanned from convex rings — which is all `castShadow`
 * and the footprints it works from ever produce, so no triangulation library is
 * needed. Concave footprints come out as their hull, over-covering the notch,
 * which is exactly the trade `shadows.ts` already documents for the shadow
 * itself; making the two agree matters more here than being right in one and
 * not the other, because a footprint that did not match its own shadow would
 * punch a hole in it.
 *
 * Positions are in whatever space `project` returns — mercator, to match the
 * matrix MapLibre hands the layer. `project` now also takes the elevation to
 * put a vertex at (issue #51): it hands back the mercator-Z that elevation
 * corresponds to, alongside x and y, which is what lets a footprint sit on
 * sloped ground rather than on the flat sea-level plane every vertex here
 * used to be nailed to.
 *
 * Every height this class is handed is now **absolute** — metres above sea
 * level, not above whatever the building's own doorstep happens to be — so
 * that the single height-field pass `shadow-layer.ts` runs can compare a
 * blocker against a mountain on the same footing it already compares one
 * blocker against another. Combining a relative height with the ground it
 * stands on is the caller's job (see `page.ts`), because only the caller
 * knows which elevation a given relative height was measured from.
 */
export class ShadowGeometry {
  private readonly shadows: number[] = [];
  private readonly blockers: number[] = [];

  constructor(
    private readonly project: (
      lon: number,
      lat: number,
      elevationM: number,
    ) => [x: number, y: number, mercatorZ: number],
  ) {}

  /**
   * One cast shadow: a closed ring, each vertex carrying its own ground
   * elevation (where the shadow actually falls) and its own absolute ceiling
   * (how high above sea level the shaded volume still reaches there).
   *
   * The two are not the same number and must not be confused: `groundM[i]`
   * moves the *point* onto the slope beneath it, while `ceilingsM[i]` is the
   * shadow's own geometry — flat-ground-relative, per `castShadow` — already
   * re-based onto sea level by the caller. A shadow's ceiling does not bend
   * to follow the ground it crosses; only its datum does.
   */
  addShadow(ring: Ring, ceilingsM: number[], groundM: number[], darkness: number): void {
    // The ring is closed, so the last vertex repeats the first and is dropped.
    const n = ring.length - 1;
    if (n < 3 || darkness <= 0) return;
    // `mercZ` is the same elevation `groundM[i]` is, in the projection's own
    // units — `scoutGround` wants both, one for each side of the globe blend
    // it does (see projection.ts), so both are packed rather than one derived
    // from the other in a shader that has no access to `project`'s formula.
    const point = (i: number) => {
      const [lon, lat] = ring[i];
      const [x, y, mercZ] = this.project(lon, lat, groundM[i]);
      return [x, y, mercZ, groundM[i], ceilingsM[i]] as const;
    };
    const a = point(0);
    for (let i = 1; i < n - 1; i++) {
      const b = point(i);
      const c = point(i + 1);
      this.shadows.push(a[0], a[1], a[2], a[3], a[4], darkness);
      this.shadows.push(b[0], b[1], b[2], b[3], b[4], darkness);
      this.shadows.push(c[0], c[1], c[2], c[3], c[4], darkness);
    }
  }

  /**
   * One thing standing on the ground that a shadow can land on, or miss.
   *
   * `absoluteHeightM` is the top of the thing in metres above sea level —
   * ground elevation plus whatever stands on it — and `groundM` is that same
   * ground elevation on its own, used only to place the footprint. A single
   * sample for the whole footprint rather than one per vertex: a building is
   * small next to the DEM grid it sits on, so every corner reads the same
   * cell in practice, and one lookup a building keeps this affordable at a
   * few thousand of them.
   *
   * Hulled before fanning. A fan drawn straight off a concave ring is not that
   * ring — it spills outside some corners and misses others — so the hull is
   * both the honest shape and the one that matches how the shadow itself was
   * built.
   *
   * `hull` is that same hull, when the caller already holds it. This runs for
   * every building on every frame the depth map is rebuilt, and hulling here
   * was undoing half of what precomputing them bought: the shadow pass stopped
   * re-hulling, and the blocker pass carried straight on.
   */
  addBlocker(ring: Ring, absoluteHeightM: number, groundM: number, hull?: Ring): void {
    if (!(absoluteHeightM > 0) || ring.length < 3) return;
    const outline = hull ?? convexHull(ring);
    if (outline.length < 3) return;
    const point = (i: number) => this.project(outline[i][0], outline[i][1], groundM);
    const [ax, ay, az] = point(0);
    for (let i = 1; i < outline.length - 1; i++) {
      const [bx, by, bz] = point(i);
      const [cx, cy, cz] = point(i + 1);
      this.blockers.push(ax, ay, az, groundM, absoluteHeightM);
      this.blockers.push(bx, by, bz, groundM, absoluteHeightM);
      this.blockers.push(cx, cy, cz, groundM, absoluteHeightM);
    }
  }

  /**
   * One triangle of bare terrain — issue #51's other half. A mountain enters
   * the same height-field pass a building's blocker already competes in, at
   * its own absolute elevation, which is what lets it win that competition
   * and stop a shadow that would otherwise be drawn straight through it.
   *
   * Ground elevation and blocking height are the same number here, because
   * there is nothing built on this triangle to add to it — bare terrain is
   * exactly as tall as it is tall.
   */
  addTerrainFacet(facet: TerrainFacet): void {
    for (const [lon, lat, heightM] of [facet.a, facet.b, facet.c]) {
      const [x, y, z] = this.project(lon, lat, heightM);
      this.blockers.push(x, y, z, heightM, heightM);
    }
  }

  shadowVertices(): Float32Array {
    return new Float32Array(this.shadows);
  }

  blockerVertices(): Float32Array {
    return new Float32Array(this.blockers);
  }
}
