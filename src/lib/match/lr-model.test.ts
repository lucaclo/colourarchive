import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, describe, it } from 'node:test';
import { identityAdjustments, type Adjustments } from './adjustments';
import { lrTables } from './lr-tables-node';
import {
  linearToOklab,
  prepareLr,
  renderLinear,
  srgbDecode,
  srgbEncode,
  type LrTables,
} from './lr-model';
import { HSL_BANDS } from './types';

let T: LrTables;
before(async () => {
  T = await lrTables();
});

const adj = (over: Partial<Adjustments> = {}): Adjustments => ({ ...identityAdjustments(), ...over });
const render = (a: Adjustments, rgb: [number, number, number]) =>
  [...renderLinear(prepareLr(a, T), rgb[0], rgb[1], rgb[2])] as [number, number, number];
const hueOf = (rgb: number[]) => {
  const [, A, B] = linearToOklab(rgb[0], rgb[1], rgb[2]);
  return ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
};
const chromaOf = (rgb: number[]) => {
  const [, A, B] = linearToOklab(rgb[0], rgb[1], rgb[2]);
  return Math.hypot(A, B);
};

describe('lr-model: identity', () => {
  it('changes nothing at zero', () => {
    for (const c of [[0.2, 0.4, 0.6], [0.9, 0.1, 0.05], [0.01, 0.01, 0.01]] as const) {
      const out = render(adj(), [...c]);
      // 1e-5: the ProPhoto matrices are published to six digits, so a round
      // trip through them drifts by ~2e-6 — a tenth of a 16-bit step.
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(out[i] - c[i]) < 1e-5, `${c} → ${out}`);
    }
  });
});

describe('lr-model: point curve against Lightroom’s exports', () => {
  // Lightroom's own render of coloured ramps under the S curve (lr-data/README.md).
  const rows: number[][][] = JSON.parse(
    fs.readFileSync(new URL('./lr-data/lightroom-point-curves.json', import.meta.url), 'utf8'),
  );
  const S = [{ x: 0, y: 0 }, { x: 48, y: 24 }, { x: 128, y: 142 }, { x: 200, y: 224 }, { x: 255, y: 255 }];

  it('reproduces coloured ramps to under a level on average', () => {
    const a = adj({ curve: S });
    let sum = 0;
    let n = 0;
    for (const r of rows.slice(32)) {
      const base = r[0].map((v) => srgbDecode(v / 65535)) as [number, number, number];
      const out = render(a, base).map(srgbEncode);
      for (let c = 0; c < 3; c++) {
        sum += Math.abs(out[c] - r[1][c] / 65535) * 255;
        n++;
      }
    }
    assert.ok(sum / n < 1, `mean ${(sum / n).toFixed(2)} levels`);
  });

  it('an S curve adds colour, as Lightroom’s does', () => {
    const c: [number, number, number] = [0.3, 0.15, 0.08];
    assert.ok(chromaOf(render(adj({ curve: S }), c)) > chromaOf(c) * 1.05);
  });
});

describe('lr-model: measured Colour Mixer', () => {
  const band = (key: string, field: 'hue' | 'sat' | 'lum', v: number) => {
    const a = adj();
    a.hsl = { ...a.hsl, [key]: { ...a.hsl[key as 'red'], [field]: v } };
    return a;
  };

  it('leaves grays alone whatever the bands do', () => {
    for (const b of HSL_BANDS) {
      for (const f of ['hue', 'sat', 'lum'] as const) {
        const out = render(band(b.key, f, 100), [0.3, 0.3, 0.3]);
        assert.ok(Math.abs(out[0] - out[2]) < 2e-3 && Math.abs(out[0] - out[1]) < 2e-3, `${b.key} ${f}: ${out}`);
      }
    }
  });

  it('Orange luminance darkens skin and leaves blue alone (band order is right)', () => {
    const skin: [number, number, number] = [0.55, 0.32, 0.22];
    const blue: [number, number, number] = [0.05, 0.15, 0.5];
    const a = band('orange', 'lum', -100);
    const Y = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    assert.ok(Y(render(a, skin)) < Y(skin) * 0.85, 'skin darkens');
    assert.ok(Math.abs(Y(render(a, blue)) - Y(blue)) < Y(blue) * 0.03, 'blue stays');
  });

  it('Blue saturation acts on blue and not on red', () => {
    const red: [number, number, number] = [0.6, 0.05, 0.04];
    const blue: [number, number, number] = [0.05, 0.12, 0.6];
    const a = band('blue', 'sat', -100);
    assert.ok(chromaOf(render(a, blue)) < chromaOf(blue) * 0.6);
    assert.ok(Math.abs(chromaOf(render(a, red)) - chromaOf(red)) < chromaOf(red) * 0.05);
  });

  it('band hues rotate the right way round the wheel', () => {
    const green: [number, number, number] = [0.1, 0.4, 0.08];
    const towardsAqua = hueOf(render(band('green', 'hue', 100), green)) - hueOf(green);
    assert.ok(towardsAqua > 3, `moved ${towardsAqua.toFixed(1)}°`);
  });

  it('Saturation −100 turns colour to its own luminance', () => {
    const c: [number, number, number] = [0.5, 0.2, 0.1];
    const out = render(adj({ saturation: -100 }), c);
    const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    for (const v of out) assert.ok(Math.abs(v - Y) < 0.01, `${out} vs ${Y}`);
  });

  it('Vibrance lifts a muted colour more than a vivid one', () => {
    const muted: [number, number, number] = [0.3, 0.26, 0.22];
    const vivid: [number, number, number] = [0.7, 0.1, 0.05];
    const a = adj({ vibrance: 60 });
    const gain = (c: [number, number, number]) => chromaOf(render(a, c)) / chromaOf(c);
    assert.ok(gain(muted) > gain(vivid), `${gain(muted)} vs ${gain(vivid)}`);
  });
});

describe('lr-model: measured Colour Grading', () => {
  const grade = (wheel: 'shadows' | 'midtones' | 'highlights' | 'global', hue: number, sat: number, extra = {}) => {
    const a = adj();
    a.grading = { ...a.grading, [wheel]: { hue, sat, lum: 0 }, ...extra };
    return a;
  };
  const cool = (c: number[]) => c[2] / Math.max(1e-6, c[0]);

  it('a blue Shadows wheel cools darks more than lights', () => {
    const a = grade('shadows', 240, 50);
    const dark = render(a, [0.02, 0.02, 0.02]);
    const light = render(a, [0.8, 0.8, 0.8]);
    assert.ok(cool(dark) > 1.05, `${dark}`);
    assert.ok(cool(dark) > cool(light));
  });

  it('Balance moves the Shadows wheel up the range', () => {
    const at = (balance: number) => cool(render(grade('shadows', 210, 50, { balance }), [0.1, 0.1, 0.1]));
    assert.ok(at(-100) > at(0) + 0.05);
    assert.ok(at(100) < at(0) - 0.05);
  });

  it('a warm Global wheel warms every tone', () => {
    const a = grade('global', 35, 40);
    for (const v of [0.05, 0.3, 0.7]) {
      const out = render(a, [v, v, v]);
      assert.ok(out[0] > out[2] * 1.02, `${v}: ${out}`);
    }
  });

  it('wheel hue follows Lightroom’s convention (0 red, 120 green, 240 blue)', () => {
    const mid = (hue: number) => render(grade('midtones', hue, 80), [0.2, 0.2, 0.2]);
    const r = mid(0), g = mid(120), b = mid(240);
    assert.ok(r[0] > r[1] && r[0] > r[2]);
    assert.ok(g[1] > g[0] && g[1] > g[2]);
    assert.ok(b[2] > b[0] && b[2] > b[1]);
  });
});
