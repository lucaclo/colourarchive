import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GLSL_PROJECT_ELEVATED,
  GLSL_PROJECT_GROUND,
  NO_PRELUDE,
  PROJECTION_UNIFORMS,
  readProjection,
  setProjectionUniforms,
} from './projection.ts';

/**
 * A stand-in for the object MapLibre hands `render`.
 *
 * Only the fields these layers read, because the point of the reader is that it
 * copes with the shape changing around them.
 */
const args = (over: Record<string, unknown> = {}) => ({
  defaultProjectionData: {
    mainMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    tileMercatorCoords: [0, 0, 1, 1],
    clippingPlane: [0, 0, 1, -0.5],
    projectionTransition: 1,
    fallbackMatrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1],
  },
  shaderData: { variantName: 'globe', vertexShaderPrelude: '// globe', define: '#define GLOBE' },
  ...over,
});

describe('readProjection', () => {
  it('reads the object MapLibre passes now', () => {
    const read = readProjection(args())!;
    assert.equal(read.shader.variantName, 'globe');
    assert.equal(read.projection.projectionTransition, 1);
    assert.deepEqual(read.projection.tileMercatorCoords, [0, 0, 1, 1]);
  });

  it('still reads the bare matrix MapLibre used to pass', () => {
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const read = readProjection(matrix)!;
    assert.deepEqual(read.projection.mainMatrix, matrix);
    // No prelude came with it, so mercator is the only projection it can mean.
    assert.equal(read.shader, NO_PRELUDE);
  });

  it('falls back to the mercator prelude when no shader data arrives', () => {
    const read = readProjection(args({ shaderData: undefined }))!;
    assert.equal(read.shader, NO_PRELUDE);
    assert.equal(read.shader.define, '');
  });

  it('refuses an argument with no matrix rather than drawing somewhere wrong', () => {
    assert.equal(readProjection(undefined), null);
    assert.equal(readProjection({}), null);
    assert.equal(readProjection({ defaultProjectionData: {} }), null);
  });
});

describe('the projection shader snippets', () => {
  /**
   * Both halves must exist. A `#ifdef GLOBE` with the `#else` deleted compiles
   * perfectly under globe and fails to link under mercator — at which point the
   * layer silently draws nothing, at exactly the zooms it is most used.
   */
  for (const [name, source, fn] of [
    ['elevated', GLSL_PROJECT_ELEVATED, 'scoutProject'],
    ['ground', GLSL_PROJECT_GROUND, 'scoutGround'],
  ] as const) {
    it(`defines ${fn} for both projections`, () => {
      assert.ok(source.includes('#ifdef GLOBE'), `${name}: no globe branch`);
      assert.ok(source.includes('#else'), `${name}: no mercator branch`);
      assert.ok(source.includes('#endif'), `${name}: unterminated`);
      assert.equal(
        source.split(`vec4 ${fn}(`).length - 1,
        2,
        `${name}: ${fn} must be defined once per branch`,
      );
    });
  }

  it('gives the sphere metres and the flat fallback mercator units', () => {
    // The whole reason this file exists: MapLibre feeds one elevation to both
    // halves of the blend, and the two halves do not measure in the same unit.
    assert.ok(GLSL_PROJECT_ELEVATED.includes('metres / GLOBE_RADIUS'));
    assert.ok(GLSL_PROJECT_ELEVATED.includes('u_projection_fallback_matrix * vec4(merc, mercatorZ, 1.0)'));
  });

  it('issue #51: scoutGround takes a real elevation rather than nailing every vertex to sea level', () => {
    // Before this, the mercator branch was `vec4(merc, 0.0, 1.0)` — a shadow
    // was always projected as though the ground under it were flat and at sea
    // level, which is exactly the fault this asserts is gone.
    assert.ok(!GLSL_PROJECT_GROUND.includes('vec4(merc, 0.0, 1.0)'));
    assert.ok(GLSL_PROJECT_GROUND.includes('metres / GLOBE_RADIUS'));
    assert.ok(GLSL_PROJECT_GROUND.includes('u_projection_fallback_matrix * vec4(merc, mercatorZ, 1.0)'));
    assert.ok(GLSL_PROJECT_GROUND.includes('vec4 scoutGround(vec2 merc, float mercatorZ, float metres,'));
  });

  it('hides the far side of the planet, by clipping or by discarding', () => {
    // The elevated one can put it in Z, because nothing else needs Z.
    assert.ok(GLSL_PROJECT_ELEVATED.includes('globeComputeClippingZ'));
    // The ground one cannot — Z carries a blocker's height — so it reports it.
    assert.ok(GLSL_PROJECT_GROUND.includes('globeComputeClippingZ'));
    assert.ok(GLSL_PROJECT_GROUND.includes('out float beyondHorizon'));
  });

  it('reads no globe uniform outside the globe branch', () => {
    // The mercator prelude declares only the matrix, so anything else named in
    // that branch is a link error waiting for the next zoom out.
    for (const source of [GLSL_PROJECT_ELEVATED, GLSL_PROJECT_GROUND]) {
      const mercatorBranch = source.slice(source.indexOf('#else'), source.indexOf('#endif'));
      for (const name of PROJECTION_UNIFORMS) {
        if (name === 'u_projection_matrix') continue;
        assert.ok(!mercatorBranch.includes(name), `${name} is used where it is not declared`);
      }
    }
  });
});

describe('setProjectionUniforms', () => {
  /** Records what was set, and hands out a location only for named uniforms. */
  const fakeGl = () => {
    const calls: string[] = [];
    return {
      calls,
      gl: {
        uniformMatrix4fv: (loc: string) => calls.push(`mat:${loc}`),
        uniform4fv: (loc: string) => calls.push(`vec4:${loc}`),
        uniform1f: (loc: string) => calls.push(`float:${loc}`),
      } as unknown as WebGLRenderingContext,
    };
  };
  const locations = (names: readonly string[]) =>
    Object.fromEntries(names.map((n) => [n, n as unknown as WebGLUniformLocation]));

  it('feeds every uniform the globe prelude declares', () => {
    const { gl, calls } = fakeGl();
    setProjectionUniforms(gl, locations(PROJECTION_UNIFORMS), readProjection(args())!.projection);
    assert.deepEqual(calls, [
      'mat:u_projection_matrix',
      'vec4:u_projection_tile_mercator_coords',
      'vec4:u_projection_clipping_plane',
      'float:u_projection_transition',
      'mat:u_projection_fallback_matrix',
    ]);
  });

  it('sets only the matrix under mercator, where the rest do not exist', () => {
    const { gl, calls } = fakeGl();
    // GL drops any uniform a shader never reads, so the locations come back null.
    const mercator = { ...locations(PROJECTION_UNIFORMS) };
    for (const name of PROJECTION_UNIFORMS) {
      if (name !== 'u_projection_matrix') mercator[name] = null as unknown as WebGLUniformLocation;
    }
    setProjectionUniforms(gl, mercator, readProjection(args())!.projection);
    assert.deepEqual(calls, ['mat:u_projection_matrix']);
  });

  it('treats a missing transition as fully mercator rather than as fully globe', () => {
    const { gl, calls } = fakeGl();
    const projection = readProjection([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])!.projection;
    setProjectionUniforms(gl, locations(PROJECTION_UNIFORMS), projection);
    // No transition and no fallback: the one thing it must not do is claim 1.
    assert.ok(calls.includes('float:u_projection_transition'));
    assert.ok(!calls.includes('mat:u_projection_fallback_matrix'));
  });
});
