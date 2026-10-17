import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARTNERS, turnOnWheel, hexToRgb, rgbHueToRyb, rgbToHsv, rybHueToRgb } from './ryb';

const partner = (hex: string, key: string) => turnOnWheel(hex, PARTNERS.find((p) => p.key === key)!.turn)!;

const rybOf = (hex: string) => rgbHueToRyb(rgbToHsv(hexToRgb(hex))[0]);
const gap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

test('the painter’s wheel puts orange opposite blue, not yellow', () => {
  const opp = partner('#1f4fd1', 'complementary');
  const [h] = rgbToHsv(hexToRgb(opp));
  assert.ok(h > 15 && h < 45, `orange hue, got ${h}`);
});

test('red’s complement is a green', () => {
  const [h] = rgbToHsv(hexToRgb(partner('#d11f27', 'complementary')));
  assert.ok(h > 90 && h < 150, `green hue, got ${h}`);
});

test('each partner is its turn on the wheel, at the same saturation and brightness', () => {
  const base = '#b0473a';
  const [, s, v] = rgbToHsv(hexToRgb(base));
  for (const p of PARTNERS) {
    const hex = turnOnWheel(base, p.turn)!;
    assert.ok(gap(rybOf(hex), rybOf(base) + p.turn) < 3, p.key);
    const [, s2, v2] = rgbToHsv(hexToRgb(hex));
    assert.ok(Math.abs(s2 - s) < 0.02 && Math.abs(v2 - v) < 0.02, p.key);
  }
});

test('the partners run round the wheel in order', () => {
  const turns = PARTNERS.map((p) => p.turn);
  assert.deepEqual(turns, [...turns].sort((a, b) => a - b));
  assert.equal(new Set(PARTNERS.map((p) => p.key)).size, PARTNERS.length);
});

test('a grey has no harmonies', () => {
  assert.equal(turnOnWheel('#808080', 120), null);
  assert.equal(turnOnWheel('#8a8580', 180), null);
});

test('the remap goes there and back', () => {
  for (let h = 0; h < 360; h += 7) assert.ok(gap(rybHueToRgb(rgbHueToRyb(h)), h) < 1e-9);
});
