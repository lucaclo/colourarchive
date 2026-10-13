import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHex, queryCommands, rankCommands, scoreCommand, type Command } from './command-palette.ts';

const C: Command[] = [
  { id: 'archive', title: 'Archive', group: 'Go to', href: '/' },
  { id: 'inspiration', title: 'Inspiration', group: 'Go to', href: '/inspiration', keywords: ['reference', 'board'] },
  { id: 'scout', title: 'Scout', group: 'Go to', href: '/scout' },
  { id: 'upload', title: 'Add & remove', group: 'Go to', href: '/upload', keywords: ['upload', 'import'] },
  { id: 'ch-red', title: 'Red', group: 'Chapters', href: '/#chapter=Red', swatch: '#c33' },
  { id: 'ch-ash', title: 'Ash', group: 'Chapters', href: '/#chapter=Ash' },
  { id: 'p1', title: 'Hong Kong', group: 'Places', href: '/scout?at=1,2' },
  { id: 'p2', title: 'Rome', group: 'Places', href: '/scout?at=3,4' },
];

test('an empty query lists the pages, then the first places', () => {
  assert.deepEqual(rankCommands(C, '').map((c) => c.id), ['archive', 'inspiration', 'scout', 'upload', 'p1', 'p2']);
});

test('a prefix beats a substring beats a subsequence', () => {
  assert.ok(scoreCommand(C[2], 'sc') > scoreCommand(C[2], 'cou'));
  assert.ok(scoreCommand(C[2], 'cou') > scoreCommand(C[2], 'sct'));
  assert.equal(scoreCommand(C[2], 'xyz'), 0);
  assert.equal(scoreCommand(C[0], 're'), 0, 'two letters are not a subsequence match');
});

test('keywords find a page by another name', () => {
  assert.equal(rankCommands(C, 'upload')[0].id, 'upload');
  assert.equal(rankCommands(C, 'board')[0].id, 'inspiration');
});

test('a word inside a title counts as a prefix', () => {
  assert.equal(rankCommands(C, 'remove')[0].id, 'upload');
});

test('ties keep the group order and then the list order', () => {
  assert.deepEqual(rankCommands(C, 'r').map((c) => c.id).slice(0, 2), ['ch-red', 'p2']);
});

test('parseHex accepts the usual spellings', () => {
  assert.equal(parseHex('#3F6F8F'), '#3f6f8f');
  assert.equal(parseHex('3f6f8f'), '#3f6f8f');
  assert.equal(parseHex('#36f'), '#3366ff');
  assert.equal(parseHex('teal'), null);
});

test('queryCommands offers a colour search for a hex and a text search for words', () => {
  assert.deepEqual(queryCommands('#3f6f8f').map((c) => c.href), ['/?colour=3f6f8f']);
  assert.deepEqual(queryCommands('sea at dusk').map((c) => c.href), ['/?q=sea%20at%20dusk']);
  assert.deepEqual(queryCommands('a'), []);
});

test('results come grouped, groups in the order of their best match', () => {
  const ids = rankCommands(C, 'r').map((c) => c.group);
  const firstSeen = ids.filter((g, i) => ids.indexOf(g) === i);
  for (const g of firstSeen) {
    const at = ids.map((x, i) => (x === g ? i : -1)).filter((i) => i >= 0);
    assert.equal(at[at.length - 1] - at[0], at.length - 1, `${g} is contiguous`);
  }
});

test('without a text search only a hex gives a row', () => {
  assert.deepEqual(queryCommands('sea', { textSearch: false }), []);
  assert.equal(queryCommands('#fff', { textSearch: false }).length, 1);
});
