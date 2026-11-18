import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { shortPlaceName } from './short-name.ts';

const en = ['en-GB', 'en'];

describe('shortPlaceName', () => {
  it('keeps the reader’s half of a bilingual name', () => {
    assert.equal(shortPlaceName('淺水灣 Repulse Bay', en), 'Repulse Bay');
    assert.equal(shortPlaceName('海灘道 Beach Road', en), 'Beach Road');
    assert.equal(shortPlaceName('ᐊᐃᕕᓕᐅᑉ ᑕᕆᐅᖓ Repulse Bay', en), 'Repulse Bay');
  });

  it('keeps the Chinese half for a Chinese reader', () => {
    assert.equal(shortPlaceName('淺水灣 Repulse Bay', ['zh-HK']), '淺水灣');
    assert.equal(shortPlaceName('東京タワー Tokyo Tower', ['ja']), '東京タワー');
  });

  it('falls back to Latin when the reader’s script isn’t there', () => {
    assert.equal(shortPlaceName('ᐊᐃᕕᓕᐅᑉ ᑕᕆᐅᖓ Repulse Bay', ['zh-CN']), 'Repulse Bay');
    assert.equal(shortPlaceName('淺水灣 Repulse Bay'), 'Repulse Bay');
  });

  it('leaves a name in one script alone', () => {
    assert.equal(shortPlaceName('Repulse Bay', en), 'Repulse Bay');
    assert.equal(shortPlaceName('東京', en), '東京');
    assert.equal(shortPlaceName("'s-Hertogenbosch", en), "'s-Hertogenbosch");
    assert.equal(shortPlaceName('22.2366°N 114.1967°E', en), '22.2366°N 114.1967°E');
    assert.equal(shortPlaceName('Naming that spot…', en), 'Naming that spot…');
  });

  it('keeps numbers with the words beside them', () => {
    assert.equal(shortPlaceName('39號碼頭 Pier 39', en), 'Pier 39');
  });

  it('drops brackets and anything after a comma', () => {
    assert.equal(shortPlaceName('淺水灣 (Repulse Bay)', en), 'Repulse Bay');
    assert.equal(shortPlaceName('Repulse Bay (淺水灣)', en), 'Repulse Bay');
    assert.equal(shortPlaceName('Washington, D.C.', en), 'Washington');
  });
});
