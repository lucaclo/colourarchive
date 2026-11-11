import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOrCreate, newItems, normaliseName, sameLink, type PhotographersFile } from './store';
import { nameFromCopyright } from './credit';
import { photoShare, quartiles, traits, reasonLine, type Metrics } from './style';

const empty = (): PhotographersFile => ({ version: 1, photographers: [], credits: {}, marks: {}, known: {}, dismissed: [] });

test('findOrCreate: a link is the stronger match, a name folds case and accents', () => {
  const f = empty();
  const a = findOrCreate(f, 'Renée Kohl');
  assert.equal(findOrCreate(f, 'renee kohl').id, a.id);
  const link = { kind: 'bluesky' as const, id: 'did:x', url: 'https://bsky.app/profile/x' };
  const b = findOrCreate(f, 'Someone', link);
  assert.equal(findOrCreate(f, 'A different display name', { ...link, url: 'https://bsky.app/profile/renamed' }).id, b.id);
  // A name match picks up the link it was missing.
  findOrCreate(f, 'Renée Kohl', { kind: 'arena-user', id: 'renee-kohl', url: 'https://www.are.na/renee-kohl' });
  assert.equal(a.links.length, 1);
  assert.equal(f.photographers.length, 2);
});

test('sameLink compares platform ids before addresses', () => {
  assert.ok(sameLink({ kind: 'flickr', id: '1@N0', url: 'a' }, { kind: 'flickr', id: '1@N0', url: 'b' }));
  assert.ok(!sameLink({ kind: 'flickr', id: '1@N0', url: 'a' }, { kind: 'bluesky', id: '1@N0', url: 'a' }));
  assert.ok(sameLink({ kind: 'page', url: 'https://x.y/' }, { kind: 'page', url: 'https://X.y' }));
});

test('newItems: not yet shown, not pinned, not passed', () => {
  const f = empty();
  f.known.p = ['a'];
  f.marks.p = { b: 'passed', c: 'pinned' };
  const items = ['a', 'b', 'c', 'd'].map((key) => ({ key, thumb: '', full: '', url: '' }));
  assert.deepEqual(newItems(f, 'p', items).map((i) => i.key), ['d']);
});

test('normaliseName', () => assert.equal(normaliseName('@Ólafur  Eliasson!'), 'olafur eliasson'));

test('nameFromCopyright strips the legal words and the year', () => {
  assert.equal(nameFromCopyright('© 2024 Jane Doe. All rights reserved.'), 'Jane Doe');
  assert.equal(nameFromCopyright('Copyright (c) Jo Smith'), 'Jo Smith');
});

test('photoShare: the softmax share of the first kind', () => {
  const kinds = [[1, 0], [0, 1]];
  assert.ok(photoShare([1, 0], kinds) > 0.99);
  assert.ok(photoShare([0, 1], kinds) < 0.01);
});

const m = (o: Partial<Metrics>): Metrics => ({ blacks: 0.05, key: 0.5, contrast: 0.2, sat: 0.06, warm: 0.01, tint: 0, split: 0, ...o });

test('traits: named only well outside the middle half; black and white silences colour words', () => {
  const pop = Array.from({ length: 40 }, (_, i) => m({ blacks: 0.02 + i * 0.002, sat: 0.03 + i * 0.002, warm: -0.01 + i * 0.001 }));
  const q = quartiles(pop);
  const lifted = traits([m({ blacks: 0.2, sat: 0.07, warm: 0.01 })], q).map((t) => t.word);
  assert.ok(lifted.includes('lifted blacks'));
  assert.ok(!lifted.includes('muted colour'));
  const mono = traits([m({ sat: 0.005, warm: 0.2 })], q).map((t) => t.word);
  assert.equal(mono[0], 'black and white');
  assert.ok(!mono.includes('warm'));
});

test('reasonLine says only what both share', () => {
  const t = (word: string) => ({ metric: 'blacks' as const, word, strength: 1 });
  assert.equal(reasonLine([t('lifted blacks'), t('cool')], { name: 'Oscar', traits: [t('lifted blacks')] }, { look: 1, content: 0.3, score: 1 }), 'Like Oscar: lifted blacks');
  assert.equal(reasonLine([], { name: 'Oscar', traits: [] }, { look: 1, content: 0.05, score: 1 }), 'Like Oscar, in what they photograph');
});
