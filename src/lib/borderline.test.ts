import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { borderlineOf, chapterChoices, isChapterBase, CHROMA_MARGIN, HUE_MARGIN } from './borderline';
import { ACHROMATIC_CHROMA, ACHROMATIC_KEY, ANCHORS, classify } from './color';

const red = ANCHORS.find((a) => a.slug === 'red')!;
const orange = ANCHORS.find((a) => a.slug === 'orange')!;
const redOrangeEdge = (red.H + orange.H) / 2;

describe('borderlineOf', () => {
  it('flags the issue #106 pair from both sides of the chroma cut-off', () => {
    const grey = borderlineOf({ L: 0.6, C: 0.034, H: orange.H });
    const coloured = borderlineOf({ L: 0.6, C: 0.036, H: orange.H });
    assert.deepEqual(grey && { alt: grey.alternative, edge: grey.edge }, { alt: 'orange', edge: 'chroma' });
    assert.deepEqual(coloured && { alt: coloured.alternative, edge: coloured.edge }, { alt: ACHROMATIC_KEY, edge: 'chroma' });
  });

  it('names the chapter on the other side, which is never the one classify chose', () => {
    for (let H = 0; H < 360; H += 1.5) {
      for (const C of [ACHROMATIC_CHROMA - 0.003, ACHROMATIC_CHROMA + 0.003, 0.12]) {
        const b = borderlineOf({ L: 0.6, C, H });
        if (b) assert.notEqual(b.alternative, classify({ L: 0.6, C, H }).chapter, `H=${H} C=${C}`);
      }
    }
  });

  it('flags a hue just either side of the midpoint between two anchors', () => {
    const below = borderlineOf({ L: 0.6, C: 0.12, H: redOrangeEdge - 1 });
    const above = borderlineOf({ L: 0.6, C: 0.12, H: redOrangeEdge + 1 });
    assert.equal(below?.alternative, 'orange');
    assert.equal(above?.alternative, 'red');
    assert.equal(below?.edge, 'hue');
  });

  it('leaves a photo alone once it is past the margin', () => {
    assert.equal(borderlineOf({ L: 0.6, C: 0.12, H: redOrangeEdge - HUE_MARGIN - 0.5 }), null);
    assert.equal(borderlineOf({ L: 0.6, C: 0.12, H: orange.H }), null);
    assert.equal(borderlineOf({ L: 0.6, C: ACHROMATIC_CHROMA - CHROMA_MARGIN - 0.001, H: 40 }), null);
  });

  it('handles the wrap between magenta and red', () => {
    const magenta = ANCHORS.find((a) => a.slug === 'magenta')!;
    const edge = ((magenta.H + red.H + 360) / 2) % 360; // 9°
    assert.equal(borderlineOf({ L: 0.6, C: 0.12, H: edge + 1 })?.alternative, 'magenta');
    assert.equal(borderlineOf({ L: 0.6, C: 0.12, H: (edge - 1 + 360) % 360 })?.alternative, 'red');
  });
});

describe('chapterChoices', () => {
  it('offers grey plus every anchor, in wheel order, honouring renames', () => {
    const choices = chapterChoices({ orange: 'Camel' });
    assert.deepEqual(choices.map((c) => c.key), [ACHROMATIC_KEY, ...ANCHORS.map((a) => a.slug)]);
    assert.equal(choices.find((c) => c.key === 'orange')?.name, 'Camel');
    assert.ok(choices.every((c) => isChapterBase(c.key)));
  });

  it('refuses keys a photo cannot be filed under', () => {
    assert.equal(isChapterBase('orange-deep'), false);
    assert.equal(isChapterBase('hue-210'), false);
    assert.equal(isChapterBase(''), false);
  });
});
