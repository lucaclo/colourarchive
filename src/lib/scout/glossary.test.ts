import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLOSSARY, GLOSSARY_GROUPS, glossaryEntry } from './glossary';
import { CORE_USABLE_ALTITUDE } from './galactic';
import { SUN_ALTITUDE } from './sun';

test('every entry has a unique id, a group and a sentence', () => {
  const ids = new Set<string>();
  for (const e of GLOSSARY) {
    assert.ok(!ids.has(e.id), `duplicate ${e.id}`);
    ids.add(e.id);
    assert.ok(GLOSSARY_GROUPS.includes(e.group));
    assert.match(e.text, /\.$/);
  }
});

test('the numbers it quotes are the ones Scout computes with', () => {
  assert.match(glossaryEntry('golden-hour')!.text, new RegExp(`${SUN_ALTITUDE.goldenUpper}° above.*${-SUN_ALTITUDE.goldenLower}° below`));
  assert.match(glossaryEntry('blue-hour')!.text, new RegExp(`${-SUN_ALTITUDE.blueUpper}° and ${-SUN_ALTITUDE.blueLower}°`));
  assert.match(glossaryEntry('core')!.text, new RegExp(`above ${CORE_USABLE_ALTITUDE}°`));
});

test('every data-term in the Scout page names a real entry', () => {
  const page = readFileSync(new URL('../../pages/scout.astro', import.meta.url), 'utf8');
  const terms = [...page.matchAll(/data-term="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(terms.length > 0);
  for (const t of terms) assert.ok(glossaryEntry(t), `no glossary entry for ${t}`);
});
