/**
 * What a custom WebGL layer needs in order to agree with the map under it.
 *
 * The map draws a globe while the world is in view and mercator by the time a
 * city is, animating between the two. A custom layer that multiplies a position
 * by `mainMatrix` and stops there is drawing in whichever projection happened to
 * be up when its shader was written: under the other one the matrix projects a
 * *unit sphere* rather than the mercator square, so the geometry lands somewhere
 * else entirely, or off-screen, with no error and nothing in the console.
 *
 * MapLibre's answer is to hand over the GLSL — a prelude that changes with the
 * projection, plus the uniforms it reads. This module is the small amount of
 * plumbing both of Scout's layers need to use it, and the two projection
 * functions they need on top of it.
 *
 * ## The elevation trap
 *
 * MapLibre's own `projectTileWithElevation` takes one `elevation` and feeds it
 * to both halves of the globe-to-mercator blend. The two halves do not measure
 * elevation in the same unit: the sphere divides it by the earth's radius, so it
 * is **metres**, while the mercator fallback matrix multiplies it as a third
 * mercator coordinate, so it is **mercator units** — a factor of the earth's
 * circumference apart. At sea level the difference is nothing, which is why it
 * survives; a kilometre up, one of the two is wrong by a planet.
 *
 * So `GLSL_PROJECT_ELEVATED` below does the blend itself and gives each side the
 * number it actually wants. Geometry on the ground has no such problem and uses
 * `GLSL_PROJECT_GROUND`.
 */

/** The uniforms MapLibre's vertex prelude declares. */
export const PROJECTION_UNIFORMS = [
  'u_projection_matrix',
  'u_projection_tile_mercator_coords',
  'u_projection_clipping_plane',
  'u_projection_transition',
  'u_projection_fallback_matrix',
] as const;

/**
 * The subset of MapLibre's `ProjectionData` these layers read.
 *
 * Everything but the main matrix is optional because the mercator variant does
 * not supply it — and because a version that predates globe supplies none of it.
 */
export interface ProjectionData {
  mainMatrix: Iterable<number>;
  tileMercatorCoords?: [number, number, number, number];
  clippingPlane?: [number, number, number, number];
  projectionTransition?: number;
  fallbackMatrix?: Iterable<number>;
}

/** MapLibre's `shaderData`: the prelude, and a name that changes with it. */
export interface ShaderData {
  variantName: string;
  vertexShaderPrelude: string;
  define: string;
}

/**
 * What to compile against when MapLibre hands over no shader data at all.
 *
 * Only reached on a version that predates the projection prelude, where
 * mercator is not a guess but the only projection there was.
 */
export const NO_PRELUDE: ShaderData = {
  variantName: 'no-prelude',
  vertexShaderPrelude: 'uniform mat4 u_projection_matrix;',
  define: '',
};

/**
 * Read a custom layer's render argument, whatever shape it arrives in.
 *
 * MapLibre used to pass a bare matrix and now passes an object. Both are
 * accepted so this survives the next change, and so the layers do not each grow
 * their own version of the guess.
 */
export function readProjection(args: unknown): { projection: ProjectionData; shader: ShaderData } | null {
  if (Array.isArray(args)) {
    return { projection: { mainMatrix: args as number[] }, shader: NO_PRELUDE };
  }
  const input = args as { defaultProjectionData?: ProjectionData; shaderData?: ShaderData } | undefined;
  const projection = input?.defaultProjectionData;
  if (!projection?.mainMatrix) return null;
  return { projection, shader: input?.shaderData ?? NO_PRELUDE };
}

/** Locations, by uniform name. A null means the shader does not use it. */
type Uniforms = Record<string, WebGLUniformLocation | null>;

/**
 * Feed the prelude's uniforms.
 *
 * Silent about the ones it cannot find, because the mercator prelude genuinely
 * declares only the matrix and GL drops any uniform a shader never reads.
 */
export function setProjectionUniforms(
  gl: WebGLRenderingContext,
  uniforms: Uniforms,
  projection: ProjectionData,
): void {
  if (uniforms.u_projection_matrix) {
    gl.uniformMatrix4fv(uniforms.u_projection_matrix, false, projection.mainMatrix as Float32List);
  }
  if (uniforms.u_projection_tile_mercator_coords && projection.tileMercatorCoords) {
    gl.uniform4fv(uniforms.u_projection_tile_mercator_coords, projection.tileMercatorCoords);
  }
  if (uniforms.u_projection_clipping_plane && projection.clippingPlane) {
    gl.uniform4fv(uniforms.u_projection_clipping_plane, projection.clippingPlane);
  }
  if (uniforms.u_projection_transition) {
    gl.uniform1f(uniforms.u_projection_transition, projection.projectionTransition ?? 0);
  }
  if (uniforms.u_projection_fallback_matrix && projection.fallbackMatrix) {
    gl.uniformMatrix4fv(
      uniforms.u_projection_fallback_matrix,
      false,
      projection.fallbackMatrix as Float32List,
    );
  }
}

/**
 * Where the two projections stop disagreeing about Z.
 *
 * Below this much globe there is barely a horizon to hide anything behind, and
 * clipping against one that early snaps geometry away while the map still looks
 * flat. MapLibre uses the same threshold for its own layers, and matching it
 * matters more than choosing it well — the arc has to disappear over the horizon
 * on the same frame the ground under it does.
 */
const Z_THRESHOLD = '0.2';

/**
 * A point at a stated height, projected the way the ground beneath it is.
 *
 * Takes the altitude twice, in metres and in mercator units, for the reason set
 * out at the top of this file.
 *
 * The Z it returns is the clipping-plane depth rather than a distance: it is
 * what makes geometry on the far side of the planet disappear behind it instead
 * of being drawn over the near side. Layers that need Z for their own purposes
 * cannot use this — see `GLSL_PROJECT_GROUND`.
 */
export const GLSL_PROJECT_ELEVATED = `
#ifdef GLOBE
  vec4 scoutProject(vec2 merc, float mercatorZ, float metres) {
    vec3 sphere = projectToSphere(merc);
    vec3 elevated = sphere * (1.0 + metres / GLOBE_RADIUS);
    vec4 globePos = u_projection_matrix * vec4(elevated, 1.0);
    globePos.z = globeComputeClippingZ(elevated) * globePos.w;

    if (u_projection_transition > 0.999) return globePos;

    vec4 flatPos = u_projection_fallback_matrix * vec4(merc, mercatorZ, 1.0);
    vec4 result = globePos;
    result.z = mix(
      0.0,
      globePos.z,
      clamp((u_projection_transition - ${Z_THRESHOLD}) / (1.0 - ${Z_THRESHOLD}), 0.0, 1.0)
    );
    result.xyw = mix(flatPos.xyw, globePos.xyw, u_projection_transition);
    return result;
  }
#else
  vec4 scoutProject(vec2 merc, float mercatorZ, float metres) {
    return u_projection_matrix * vec4(merc, mercatorZ, 1.0);
  }
#endif`;

/**
 * A point at a stated elevation above sea level, for a layer that needs Z for
 * something else.
 *
 * The shadow mask encodes a blocker's own height in Z so the tallest thing
 * standing at each pixel wins, which means it cannot also carry the clipping
 * depth. So how far past the horizon a vertex is comes back as a number to be
 * handed to the fragment shader and discarded on, which costs a varying and
 * hides the far side of the planet just the same.
 *
 * Above 1.0 is past the horizon; MapLibre's clipping plane is scaled that way.
 *
 * `mercatorZ` and `metres` are the same elevation in the two units the two
 * projections each want — see the elevation trap above — and issue #51 is
 * why this takes them at all: every vertex here used to be nailed to
 * `merc, 0.0`, so a building's own shadow was projected as though the ground
 * under it were flat and at sea level. On a slope, in 3D, that put the shadow
 * visibly beside the terrain it was supposed to be falling across, by an
 * amount that grew with elevation and pitch. Passing the real elevation
 * through is the same fix `GLSL_PROJECT_ELEVATED` already makes for the dome;
 * this is that fix for the layer that only ever needed the ground.
 */
export const GLSL_PROJECT_GROUND = `
#ifdef GLOBE
  vec4 scoutGround(vec2 merc, float mercatorZ, float metres, out float beyondHorizon) {
    vec3 sphere = projectToSphere(merc);
    vec3 elevated = sphere * (1.0 + metres / GLOBE_RADIUS);
    vec4 globePos = u_projection_matrix * vec4(elevated, 1.0);
    beyondHorizon = globeComputeClippingZ(elevated);

    if (u_projection_transition > 0.999) return globePos;

    vec4 flatPos = u_projection_fallback_matrix * vec4(merc, mercatorZ, 1.0);
    vec4 result = globePos;
    result.xyw = mix(flatPos.xyw, globePos.xyw, u_projection_transition);
    beyondHorizon = mix(
      0.0,
      beyondHorizon,
      clamp((u_projection_transition - ${Z_THRESHOLD}) / (1.0 - ${Z_THRESHOLD}), 0.0, 1.0)
    );
    return result;
  }
#else
  vec4 scoutGround(vec2 merc, float mercatorZ, float metres, out float beyondHorizon) {
    beyondHorizon = 0.0;
    return u_projection_matrix * vec4(merc, mercatorZ, 1.0);
  }
#endif`;
