import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hexToRgb, rgbToHex, rgbToLab, readCover, rgbHueToRyb, rybHueToRgb, hsvToRgb, rgbToHsv, nearestWada, combination, combinationsWith, dominantColours, rankCombinations, roles, contrast } from './colour';
import { WADA_COLOURS, WADA_COMBINATIONS } from './wada';

describe('the dictionary', () => {
  it('has the book’s 159 colours and 348 combinations of two to four', () => {
    assert.equal(WADA_COLOURS.length, 159);
    assert.equal(WADA_COMBINATIONS.length, 348);
    assert.ok(WADA_COMBINATIONS.every((c) => c.length >= 2 && c.length <= 4));
  });

  it('finds a colour’s own entry, and the combinations that use it', () => {
    const [name, hex] = WADA_COLOURS[40];
    const near = nearestWada(hex);
    assert.equal(near.name, name);
    assert.ok(near.distance < 0.01);
    for (const n of combinationsWith(40)) assert.ok(combination(n).includes(hex));
  });
});

describe('the wheel', () => {
  it('round-trips hex through HSV', () => {
    for (const hex of ['#c8321e', '#1f4a9c', '#f3c42f', '#808080', '#000000', '#ffffff']) {
      assert.equal(rgbToHex(hsvToRgb(...rgbToHsv(hexToRgb(hex)))), hex);
    }
  });
});

describe('suggesting from photos', () => {
  const pixels = (colours: [number, number, number][], each = 100) => {
    const out = new Uint8ClampedArray(colours.length * each * 4);
    colours.forEach((c, j) => { for (let i = 0; i < each; i++) out.set([...c, 255], (j * each + i) * 4); });
    return out;
  };

  it('pulls out a picture’s main colours, the larger first', () => {
    const sw = dominantColours(pixels([[200, 40, 30], [200, 40, 30], [20, 60, 140]]), 2);
    assert.equal(sw.length, 2);
    assert.equal(sw[0].hex, '#c8281e');
    assert.ok(Math.abs(sw[0].weight - 2 / 3) < 1e-9);
  });

  it('ranks highest the combinations whose colours are in the photos', () => {
    const n = 100;
    const cols = combination(n).map((h) => hexToRgb(h));
    const top = rankCombinations(dominantColours(pixels(cols), cols.length), 5).map((r) => r.n);
    assert.ok(top.includes(n), `expected ${n} in ${top}`);
  });
});

describe('roles', () => {
  it('takes the lightest as paper and the most legible as text', () => {
    const r = roles(['#f2ead8', '#1f4a9c', '#f3c42f']);
    assert.equal(r.paper, '#f2ead8');
    assert.equal(r.ink, '#1f4a9c');
    assert.equal(r.accent, '#f3c42f');
    assert.ok(contrast(r.ink, r.paper) > 4.5);
  });
});

describe('reading a cover with colour theory', () => {
  const sw = (rgb: [number, number, number], weight: number) => ({ lab: rgbToLab(rgb), hex: rgbToHex(rgb), weight });

  it('uses the painter’s wheel: blue faces orange, red faces green', () => {
    assert.ok(Math.abs(((rgbHueToRyb(rgbToHsv([30, 70, 200])[0]) + 180) % 360) - rgbHueToRyb(30)) < 25);
    assert.equal(rgbHueToRyb(0), 0);
    assert.equal(rgbHueToRyb(120), 180);
    assert.equal(rybHueToRgb(rgbHueToRyb(200)), 200);
  });

  it('takes the key colour by strength as well as area', () => {
    const r = readCover([sw([150, 150, 150], 0.7), sw([190, 40, 30], 0.3)], '#202020')!;
    assert.ok(rgbToHsv(hexToRgb(r.key.hex))[0] < 20, r.key.name);
  });

  it('gives six different book colours, one per rule, that read on the title band', () => {
    const photo = [sw([30, 60, 140], 0.5), sw([40, 40, 45], 0.3), sw([210, 190, 160], 0.2)];
    const r = readCover(photo, '#1d2433')!;
    assert.deepEqual(r.picks.map((p) => p.rule), ['complementary', 'split-a', 'split-b', 'triadic', 'analogous', 'echo']);
    assert.equal(new Set(r.picks.map((p) => p.hex)).size, 6);
    const book = new Set(WADA_COLOURS.map(([, h]) => h));
    for (const p of r.picks) {
      assert.ok(book.has(p.hex));
      assert.ok(p.contrast >= 3, `${p.name} on the title band`);
    }
    // Blue photo: its complement is warm (orange family).
    const h = rgbHueToRyb(rgbToHsv(hexToRgb(r.picks[0].hex))[0]);
    assert.ok(h > 20 && h < 110, `${r.picks[0].name} at ${h}`);
  });
});
