import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  colourScore, decodePalette, encodePalette, hexToOklch, MATCH_CEILING, matchPalette, oklchToHex,
  paletteTone, searchByColour, withinTone, type Swatch,
} from './colour-search';

const red: Swatch = { L: 0.628, C: 0.258, H: 29, share: 0 };
const teal: Swatch = { L: 0.6, C: 0.1, H: 190, share: 0 };
const grey: Swatch = { L: 0.5, C: 0.005, H: 0, share: 0 };

test('hex round-trips through OKLCH', () => {
  for (const hex of ['#ff0000', '#2a7f7a', '#808080', '#f6f6f4', '#0a0a0a']) {
    const o = hexToOklch(hex)!;
    assert.equal(oklchToHex(o), hex);
  }
  assert.equal(hexToOklch('nope'), null);
  assert.ok(hexToOklch('ff0000'), 'the # is optional');
});

test('pure red reads as OKLCH red', () => {
  const o = hexToOklch('#ff0000')!;
  assert.ok(Math.abs(o.L - 0.628) < 0.002);
  assert.ok(Math.abs(o.H - 29.2) < 0.5);
});

test('a swatch that covers more of the frame scores closer', () => {
  const q = { L: red.L, C: red.C, H: red.H };
  const wall = colourScore([{ ...red, share: 0.8 }, { ...grey, share: 0.2 }], q);
  const sign = colourScore([{ ...red, share: 0.05 }, { ...grey, share: 0.95 }], q);
  assert.ok(wall < sign);
  assert.ok(sign <= MATCH_CEILING, 'a small exact patch still matches');
});

test('a different hue does not match', () => {
  const q = { L: red.L, C: red.C, H: red.H };
  assert.ok(colourScore([{ ...teal, share: 1 }], q) > MATCH_CEILING);
});

test('a grey query matches greys by lightness, only when they cover the frame', () => {
  const q = hexToOklch('#777777')!;
  assert.ok(colourScore([{ ...grey, share: 1 }], q) <= MATCH_CEILING);
  assert.ok(colourScore([{ L: 0.15, C: 0.004, H: 0, share: 1 }], q) > MATCH_CEILING);
  assert.ok(colourScore([{ ...grey, share: 0.1 }, { ...red, share: 0.9 }], q) > MATCH_CEILING);
});

test('a vivid query finds the duller reds a photo holds', () => {
  const brick = { L: 0.5, C: 0.11, H: 33, share: 0.4 };
  assert.ok(colourScore([brick], hexToOklch('#ff0000')!) <= MATCH_CEILING);
});

test('a near-grey swatch does not match a strong hue', () => {
  assert.ok(colourScore([{ L: 0.6, C: 0.03, H: 29, share: 1 }], hexToOklch('#ff0000')!) > MATCH_CEILING);
});

test('an accent swatch matches but carries no area', () => {
  const pal = [{ ...grey, share: 1 }, { ...red, share: 0 }];
  assert.ok(colourScore(pal, red) <= MATCH_CEILING);
  assert.ok(paletteTone(pal)!.chroma < 0.05, 'the accent does not colour the tone');
});

test('no palette never matches and fails a narrowed tone range', () => {
  assert.equal(colourScore(undefined, red), Infinity);
  assert.equal(withinTone(undefined, {}), true, 'full ranges filter nothing');
  assert.equal(withinTone(undefined, { chroma: [0.5, 1] }), false);
});

test('tone is area-weighted', () => {
  const t = paletteTone([{ ...red, share: 0.5 }, { ...grey, share: 0.5 }])!;
  assert.ok(Math.abs(t.lightness - (0.628 + 0.5) / 2) < 1e-9);
  assert.equal(t.chroma, 1, 'half red is past the top of the archive tone range');
});

test('search ranks closest first and keeps order without a colour', () => {
  const items = [
    { id: 'a', palette: [{ ...teal, share: 1 }] },
    { id: 'b', palette: [{ ...red, share: 0.1 }, { ...grey, share: 0.9 }] },
    { id: 'c', palette: [{ ...red, share: 0.9 }, { ...grey, share: 0.1 }] },
  ];
  assert.deepEqual(searchByColour(items, red).map((r) => r.id), ['c', 'b']);
  assert.deepEqual(searchByColour(items, null).map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual(searchByColour(items, null, { chroma: [0.9, 1] }).map((r) => r.id), ['c']);
});

test('palette encodes compactly and decodes back', () => {
  const p = [{ L: 0.6281, C: 0.2577, H: 29.2, share: 0.4 }, { ...grey, share: 0.6 }];
  const back = decodePalette(encodePalette(p));
  assert.equal(back.length, 2);
  assert.equal(back[0].L, 0.628);
  assert.equal(back[0].H, 29);
  assert.deepEqual(decodePalette(''), []);
  assert.deepEqual(decodePalette('garbage;1,2'), []);
});

const plain = (s: Swatch) => ({ L: s.L, C: s.C, H: s.H });

test('one colour as a list scores exactly as the single-colour path', () => {
  const pals = [
    [{ ...red, share: 0.8 }, { ...grey, share: 0.2 }],
    [{ L: 0.5, C: 0.11, H: 33, share: 0.4 }, { ...teal, share: 0.6 }],
    [{ ...grey, share: 1 }, { ...red, share: 0 }],
  ];
  for (const p of pals) assert.equal(matchPalette(p, [plain(red)])!.score, colourScore(p, red));
});

test('several colours must all be present', () => {
  const teaAndOrange = [{ ...teal, share: 0.5 }, { L: 0.7, C: 0.15, H: 55, share: 0.3 }, { ...grey, share: 0.2 }];
  const orange = hexToOklch('#d9822b')!;
  assert.ok(matchPalette(teaAndOrange, [plain(teal), orange]));
  assert.equal(matchPalette([{ ...teal, share: 1 }], [plain(teal), orange]), null);
});

test('reasons name the matched swatches and the frame they cover', () => {
  const pal = [{ ...red, share: 0.3 }, { L: 0.6, C: 0.24, H: 31, share: 0.2 }, { ...teal, share: 0.5 }];
  const m = matchPalette(pal, [plain(red)])!;
  assert.deepEqual(m.parts[0].swatches, [0, 1]);
  assert.ok(Math.abs(m.parts[0].covered - 0.5) < 1e-9);
});

test('an accent satisfies a colour but covers none of the frame', () => {
  const m = matchPalette([{ ...grey, share: 1 }, { ...red, share: 0 }], [plain(red)])!;
  assert.equal(m.parts[0].covered, 0);
});

test('a requested share prefers photos that come close to it', () => {
  const lots = [{ ...red, share: 0.5 }, { ...grey, share: 0.5 }];
  const little = [{ ...red, share: 0.1 }, { ...grey, share: 0.9 }];
  const half = { ...plain(red), share: 0.5 };
  assert.ok(matchPalette(lots, [half])!.score < matchPalette(little, [half])!.score);
  // An accent alone can't meet "half the frame".
  assert.equal(matchPalette([{ ...grey, share: 1 }, { ...red, share: 0 }], [half]), null);
});

test('search takes a list, caps it at three, and returns reasons', () => {
  const items = [{ id: 'a', palette: [{ ...red, share: 0.6 }, { ...teal, share: 0.4 }] }, { id: 'b', palette: [{ ...red, share: 1 }] }];
  const hits = searchByColour(items, [plain(red), plain(teal)]);
  assert.deepEqual(hits.map((h) => h.id), ['a']);
  assert.equal(hits[0].parts.length, 2);
  assert.deepEqual(searchByColour(items, [plain(red), plain(teal), plain(red), plain(teal)]).map((h) => h.id), ['a'], 'a fourth colour is ignored');
});
