import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { freshDoc, reviveDoc, setFit, applyCombination, swapPages, moveSpread, mergeSpread, splitSpread, photosInDoc, READING_ORDER, isEmpty, type PhotoRef } from './doc';
import { SPREADS, PANELS } from './imposition';

const photo = (id: string): PhotoRef => ({ kind: 'archive', id, thumb: `/${id}.avif`, full: `/${id}.avif`, w: 3, h: 2, panX: 0.4, panY: 0 });

describe('a fresh zine', () => {
  it('starts empty, with full-bleed covers', () => {
    const d = freshDoc();
    assert.ok(isEmpty(d));
    assert.equal(d.pages[5].fit, 'fill');
    assert.equal(d.pages[4].fit, 'fill');
    assert.equal(d.pages[6].fit, 'fit');
  });

  it('survives junk from storage', () => {
    assert.deepEqual(reviveDoc(null), freshDoc());
    assert.deepEqual(reviveDoc({ v: 2 }), freshDoc());
    const r = reviveDoc({ v: 1, paper: 'tabloid', cover: { title: 'Kept' } });
    assert.equal(r.paper, 'a4');
    assert.equal(r.cover.title, 'Kept');
    assert.equal(r.cover.align, 'center');
  });
});

describe('borders', () => {
  it('give fitted pages a margin and covers none', () => {
    const d = freshDoc();
    assert.equal(d.pages[6].border, 'm');
    assert.equal(d.pages[5].border, 'none');
    assert.equal(d.merged.p23.border, 'none');
  });

  it('keep the look of a zine saved before borders existed', () => {
    const r = reviveDoc({ v: 1, pages: [{ fit: 'fill' }, { fit: 'fit' }] });
    assert.equal(r.pages[0].border, 'none');
    assert.equal(r.pages[1].border, 'm');
    assert.equal(r.pages[0].plate, 'none');
  });

  it('follow fit and fill unless set by hand', () => {
    const d = freshDoc();
    const p = d.pages[6];
    setFit(p, 'fill');
    assert.equal(p.border, 'none');
    setFit(p, 'fit');
    assert.equal(p.border, 'm');
    p.border = 'wide';
    setFit(p, 'fill');
    assert.equal(p.border, 'wide');
  });
});

describe('colour', () => {
  it('keeps wheel colours and drops junk from storage', () => {
    const r = reviveDoc({ v: 1, palette: 999, cover: { ink: '#123abc' }, back: { ink: 'javascript:' }, pages: [{ tone: '#fff' }] });
    assert.equal(r.cover.ink, '#123abc');
    assert.equal(r.back.ink, 'white');
    assert.equal(r.pages[0].tone, 'white');
    assert.equal(r.palette, null);
  });

  it('drops the old wash over cover photos', () => {
    const r = reviveDoc({ v: 1, cover: { title: 'Kept', overlay: 0.35 } });
    assert.equal(r.cover.title, 'Kept');
    assert.equal('overlay' in r.cover, false);
  });

  it('colours the zine from a combination, leaving text on full-bleed photos alone', () => {
    const d = freshDoc();
    setFit(d.pages[7], 'fill');
    d.pages[7].ink = 'white';
    applyCombination(d, 1);
    assert.equal(d.palette, 1);
    assert.match(d.pages[6].ink, /^#/);
    assert.equal(d.pages[7].ink, 'white');
    assert.match(d.pages[6].tone, /^#/);
    assert.match(d.cover.ink, /^#/);
  });
});

describe('editing', () => {
  it('swaps the two pages of a spread', () => {
    const d = freshDoc();
    d.pages[6].photo = photo('a');
    swapPages(d, SPREADS[0]);
    assert.equal(d.pages[7].photo?.id, 'a');
    assert.equal(d.pages[6].photo, null);
  });

  it('moves a spread, merge and all, and shifts the others along', () => {
    const d = freshDoc();
    d.pages[SPREADS[0].left].caption = 'first';
    d.pages[SPREADS[2].left].caption = 'third';
    d.merged.p23.on = true;
    moveSpread(d, 0, 2);
    assert.equal(d.pages[SPREADS[2].left].caption, 'first');
    assert.equal(d.merged.p67.on, true);
    assert.equal(d.pages[SPREADS[1].left].caption, 'third');
    assert.equal(d.merged.p23.on, false);
  });

  it('merges with the first photo and both captions, and splits back to the pages untouched', () => {
    const d = freshDoc();
    d.pages[6].photo = photo('a');
    d.pages[6].caption = 'left';
    d.pages[7].caption = 'right';
    mergeSpread(d, SPREADS[0]);
    assert.equal(d.merged.p23.photo?.id, 'a');
    assert.equal(d.merged.p23.photo?.panX, 0);
    assert.equal(d.merged.p23.caption, 'left right');
    assert.deepEqual(photosInDoc(d).map((p) => p.id), ['a']);
    splitSpread(d, SPREADS[0]);
    assert.equal(d.pages[6].photo?.id, 'a');
    assert.equal(d.pages[6].photo?.panX, 0.4);
  });

  it('reads pages cover first, back cover last', () => {
    assert.deepEqual(READING_ORDER.map((i) => PANELS[i].page), [1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
