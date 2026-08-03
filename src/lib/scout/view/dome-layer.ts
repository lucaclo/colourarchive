/**
 * A custom WebGL layer for drawing lines and points *above* the ground.
 *
 * None of MapLibre's built-in layers can do it — they all drape onto the
 * terrain, which is exactly wrong for the sun's path. The whole information in
 * that arc is its height and its tilt: flat and high in midsummer, steep and
 * shallow in winter. Flattened onto the map it becomes a shape with no meaning.
 *
 * So the geometry is real 3D, placed in mercator space with a real altitude and
 * handed the map's own matrix. This file is only the plumbing; what to draw is
 * decided by the page, which knows where the sun and the moon are.
 *
 * ## How the arcs are made visible
 *
 * WebGL guarantees a line width of exactly one pixel and every desktop driver
 * ignores `lineWidth` beyond it, so the sun's path — the most important mark on
 * the page — used to be a one-pixel aliased hairline in a single flat colour
 * over a busy map. On a bright satellite basemap you genuinely could not find
 * it.
 *
 * Weight now comes from soft round sprites laid along the same path, with the
 * hairline underneath guaranteeing continuity. Colour is per-vertex, so the
 * day's arc is painted with the light along it and reads as a timeline: blue
 * before dawn, orange at the horizon, pale at noon. The sun's disc is a hot
 * core inside an additive halo tinted by the moment, so it looks luminous
 * rather than like a circle someone drew.
 *
 * **Precision must match across stages.** A uniform or varying declared at one
 * precision in the vertex shader and another in the fragment shader will not
 * link, and the only sign is a warning: the program is silently null and
 * everything it drew disappears. `u_halo` did exactly that, which cost the sun,
 * the moon, the hour beads and every sprite giving the arcs their weight.
 */

import type maplibregl from 'maplibre-gl';

export type RGBA = [number, number, number, number];

export interface DomePoint {
  lon: number;
  lat: number;
  altitudeM: number;
}

/** One continuous path. Drawn per run, so the end of one cannot join the next. */
interface LineRun {
  offset: number;
  count: number;
}

export interface DomeGeometryData {
  /** x,y,z, r,g,b,a — 7 floats a vertex. */
  lines: Float32Array;
  runs: LineRun[];
  /** x,y,z, r,g,b,a, size, glow — 9 floats a vertex. */
  points: Float32Array;
}

export interface DomeLayer extends maplibregl.CustomLayerInterface {
  setGeometry(data: DomeGeometryData): void;
}

const LINE_STRIDE = 7;
const POINT_STRIDE = 9;

/**
 * A plain line strip, with colour per vertex.
 *
 * **Do not reintroduce screen-space ribbon expansion here.** It was tried, to
 * get around WebGL's one-pixel line limit, and it froze the GPU: the expansion
 * divides by the projected `w` and by the viewport, and either of those going
 * to zero — geometry above the camera, a drawing buffer with no size — turns
 * every vertex into a NaN and every triangle into one that is rasterised across
 * the whole screen forever. Chrome's renderer stops answering, with no error in
 * the console and nothing in `getError`. Two sessions were lost to it.
 *
 * The thickness now comes from overlapping soft point sprites drawn along the
 * same path (see `DomeGeometry.push`), which cost the same, look better, and
 * cannot produce a degenerate triangle because a point has no neighbours.
 */
const LINE_VERTEX = `
  attribute vec3 a_pos;
  attribute vec4 a_colour;
  uniform mat4 u_matrix;
  varying mediump vec4 v_colour;
  void main() {
    gl_Position = u_matrix * vec4(a_pos, 1.0);
    v_colour = a_colour;
  }`;

const LINE_FRAGMENT = `
  precision mediump float;
  varying mediump vec4 v_colour;
  void main() {
    if (v_colour.a <= 0.0) discard;
    gl_FragColor = v_colour;
  }`;

const POINT_VERTEX = `
  attribute vec3 a_pos;
  attribute vec4 a_colour;
  attribute float a_size;
  attribute float a_glow;
  uniform mat4 u_matrix;
  uniform mediump float u_halo;
  varying mediump vec4 v_colour;
  void main() {
    vec4 c = u_matrix * vec4(a_pos, 1.0);
    // Same reasoning as the line shader: a point behind the camera is put
    // outside the clip volume rather than projected through infinity.
    if (c.w <= 0.0) {
      v_colour = vec4(0.0);
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    gl_Position = c;
    // On the halo pass a point with no glow gets no size, and rasterises to
    // nothing — cheaper than sorting the buffer into two. Clamped because a
    // sprite of a few hundred pixels is all overdraw and no information.
    float size = u_halo > 0.5 ? a_size * a_glow : a_size;
    gl_PointSize = clamp(size, 0.0, 96.0);
    v_colour = a_colour;
  }`;

const POINT_FRAGMENT = `
  precision mediump float;
  uniform mediump float u_halo;
  varying mediump vec4 v_colour;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (d > 1.0) discard;
    float a;
    if (u_halo > 0.5) {
      // Bright in the middle and gone well before the edge, so it reads as
      // light coming off the thing rather than as a bigger circle behind it.
      a = pow(1.0 - d, 2.5) * 0.5;
    } else {
      a = 1.0 - smoothstep(0.7, 1.0, d);
    }
    gl_FragColor = vec4(v_colour.rgb, v_colour.a * a);
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
      console.warn('[scout] dome shader failed', gl.getShaderInfoLog(shader));
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
    console.warn('[scout] dome program failed', gl.getProgramInfoLog(program));
    return null;
  }
  return {
    program,
    attributes: Object.fromEntries(attributes.map((n) => [n, gl.getAttribLocation(program, n)])),
    uniforms: Object.fromEntries(uniforms.map((n) => [n, gl.getUniformLocation(program, n)])),
  };
}

export function createDomeLayer(id: string): DomeLayer {
  let lineProgram: Program | null = null;
  let pointProgram: Program | null = null;
  let lineBuffer: WebGLBuffer | null = null;
  let pointBuffer: WebGLBuffer | null = null;

  let data: DomeGeometryData = { lines: new Float32Array(0), runs: [], points: new Float32Array(0) };
  let dirty = false;

  return {
    id,
    type: 'custom' as const,
    renderingMode: '3d' as const,

    setGeometry(next: DomeGeometryData) {
      data = next;
      dirty = true;
    },

    onAdd(_map: maplibregl.Map, gl: WebGLRenderingContext) {
      lineProgram = build(gl, LINE_VERTEX, LINE_FRAGMENT, ['a_pos', 'a_colour'], ['u_matrix']);
      pointProgram = build(
        gl,
        POINT_VERTEX,
        POINT_FRAGMENT,
        ['a_pos', 'a_colour', 'a_size', 'a_glow'],
        ['u_matrix', 'u_halo'],
      );
      lineBuffer = gl.createBuffer();
      pointBuffer = gl.createBuffer();
      dirty = true;
    },

    onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext) {
      for (const p of [lineProgram, pointProgram]) if (p) gl.deleteProgram(p.program);
      for (const b of [lineBuffer, pointBuffer]) if (b) gl.deleteBuffer(b);
      lineProgram = pointProgram = null;
      lineBuffer = pointBuffer = null;
    },

    render(gl: WebGLRenderingContext, args: unknown) {
      if (!lineProgram || !pointProgram) return;
      // MapLibre used to hand custom layers a bare matrix and now hands them a
      // projection-data object. Accept either, so this survives the next change.
      const matrix = Array.isArray(args)
        ? args
        : ((args as { defaultProjectionData?: { mainMatrix?: number[] } })?.defaultProjectionData
            ?.mainMatrix ?? null);
      if (!matrix) return;
      // A canvas with no size has nothing to draw into, and the ribbon shader
      // divides by half of it. Belt as well as the shader's braces.
      if (!gl.drawingBufferWidth || !gl.drawingBufferHeight) return;

      if (dirty) {
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data.lines, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data.points, gl.DYNAMIC_DRAW);
        dirty = false;
      }

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      // Drawn over the buildings rather than through them: the path is a piece
      // of notation about the sky, not an object standing in the street.
      gl.disable(gl.DEPTH_TEST);

      if (data.runs.length) {
        const p = lineProgram;
        gl.useProgram(p.program);
        gl.uniformMatrix4fv(p.uniforms.u_matrix, false, matrix as Float32List);
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
        const stride = LINE_STRIDE * 4;
        const set = (name: string, size: number, offset: number) => {
          const loc = p.attributes[name];
          if (loc < 0) return;
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
        };
        set('a_pos', 3, 0);
        set('a_colour', 4, 3);
        // One strip per run, or the end of each path would be joined to the
        // start of the next by a stray line across the map.
        for (const run of data.runs) gl.drawArrays(gl.LINE_STRIP, run.offset, run.count);
        for (const name of ['a_pos', 'a_colour']) {
          if (p.attributes[name] >= 0) gl.disableVertexAttribArray(p.attributes[name]);
        }
      }

      if (data.points.length) {
        const p = pointProgram;
        gl.useProgram(p.program);
        gl.uniformMatrix4fv(p.uniforms.u_matrix, false, matrix as Float32List);
        gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
        const stride = POINT_STRIDE * 4;
        const set = (name: string, size: number, offset: number) => {
          const loc = p.attributes[name];
          if (loc < 0) return;
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
        };
        set('a_pos', 3, 0);
        set('a_colour', 4, 3);
        set('a_size', 1, 7);
        set('a_glow', 1, 8);

        const count = data.points.length / POINT_STRIDE;
        // Halo first and additively, so the core sits *in* its own light rather
        // than under a wash of it.
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.uniform1f(p.uniforms.u_halo, 1);
        gl.drawArrays(gl.POINTS, 0, count);

        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1f(p.uniforms.u_halo, 0);
        gl.drawArrays(gl.POINTS, 0, count);

        for (const name of ['a_pos', 'a_colour', 'a_size', 'a_glow']) {
          if (p.attributes[name] >= 0) gl.disableVertexAttribArray(p.attributes[name]);
        }
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },
  };
}

/**
 * Builder for what the dome layer draws.
 *
 * Collects everything into one line buffer and one point buffer, so a whole
 * day's geometry is two uploads rather than one per feature.
 */
export class DomeGeometry {
  private readonly lines: number[] = [];
  private readonly points: number[] = [];
  readonly runs: LineRun[] = [];

  constructor(
    private readonly project: (lon: number, lat: number, altitudeM: number) => [number, number, number],
  ) {}

  /**
   * Add a run of points.
   *
   * `colour` may be a function of the index, which is how the day's arc is
   * painted with the light along it rather than with one flat tone.
   */
  push(
    points: DomePoint[],
    mode: 'strip' | 'lines' | 'points',
    colour: RGBA | ((index: number) => RGBA),
    size = 1,
    glow = 0,
  ): void {
    if (!points.length) return;
    const at = typeof colour === 'function' ? colour : () => colour;

    if (mode === 'points') {
      for (let i = 0; i < points.length; i++) {
        const [x, y, z] = this.project(points[i].lon, points[i].lat, points[i].altitudeM);
        const c = at(i);
        this.points.push(x, y, z, c[0], c[1], c[2], c[3], size, glow);
      }
      return;
    }

    // `lines` is disconnected pairs; `strip` is one continuous run.
    if (mode === 'lines') {
      for (let i = 0; i + 1 < points.length; i += 2) {
        this.path([points[i], points[i + 1]], (k) => at(i + k), size);
      }
      return;
    }
    this.path(points, at, size);
  }

  /**
   * One polyline: a hairline for continuity, sprites along it for weight.
   *
   * WebGL will only ever draw a line one pixel wide, so a path drawn as a line
   * alone is the faint thing this layer used to be. Expanding it into ribbons
   * in the shader is the usual answer and it is not available here — it froze
   * the GPU, twice, for the reasons set out above `LINE_VERTEX`.
   *
   * So the weight comes from soft round sprites laid along the same path,
   * spaced closely enough to merge into a continuous band, with the hairline
   * underneath guaranteeing the path is unbroken even when the sprites are too
   * far apart to touch — which is what happens when you zoom far enough in that
   * the arc runs off the screen. Worst case it degrades to what it was before.
   * It cannot degrade to a hung tab.
   */
  private path(points: DomePoint[], at: (index: number) => RGBA, width: number): void {
    if (points.length < 2) return;
    const projected = points.map((p) => this.project(p.lon, p.lat, p.altitudeM));
    const offset = this.lines.length / LINE_STRIDE;

    for (let i = 0; i < projected.length; i++) {
      const [x, y, z] = projected[i];
      const c = at(i);
      this.lines.push(x, y, z, c[0], c[1], c[2], c[3]);
      // Below about two pixels a sprite adds nothing a hairline has not
      // already said, and the horizon ring and plumb line are meant to be
      // quiet.
      if (width >= 2) this.points.push(x, y, z, c[0], c[1], c[2], c[3], width, 0);
    }

    this.runs.push({ offset, count: projected.length });
  }

  data(): DomeGeometryData {
    return {
      lines: new Float32Array(this.lines),
      runs: this.runs,
      points: new Float32Array(this.points),
    };
  }
}

/**
 * Join what belongs to the day onto what belongs to the minute.
 *
 * The day's half is six hundred projected points and is built once; only the
 * sun's disc, its ray and the moon's marker move. Keeping the stride knowledge
 * here means the caller never has to know how a vertex is laid out in order to
 * shift a run's offset.
 */
export function mergeDomeGeometry(day: DomeGeometryData, minute: DomeGeometryData): DomeGeometryData {
  const lines = new Float32Array(day.lines.length + minute.lines.length);
  lines.set(day.lines);
  lines.set(minute.lines, day.lines.length);

  const base = day.lines.length / LINE_STRIDE;
  const runs = [
    ...day.runs,
    ...minute.runs.map((run) => ({ offset: run.offset + base, count: run.count })),
  ];

  const points = new Float32Array(day.points.length + minute.points.length);
  points.set(day.points);
  points.set(minute.points, day.points.length);

  return { lines, runs, points };
}
