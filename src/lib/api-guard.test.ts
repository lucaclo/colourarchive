import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeAllowed, claimedOrigin, isJsonish, badJson } from './api-guard';

const OWN = 'https://localhost:4321';
const h = (o: Record<string, string>) => new Headers(o);

test('a write from another site is refused', () => {
  assert.equal(writeAllowed(h({ origin: 'https://evil.example' }), OWN), false);
  assert.equal(writeAllowed(h({ origin: 'null' }), OWN), false);
  assert.equal(writeAllowed(h({ referer: 'https://evil.example/page' }), OWN), false);
});

test('a write from the app itself goes through', () => {
  assert.equal(writeAllowed(h({ origin: OWN }), OWN), true);
  assert.equal(writeAllowed(h({ referer: `${OWN}/book` }), OWN), true);
  assert.equal(writeAllowed(h({ origin: 'http://127.0.0.1:5123' }), 'http://127.0.0.1:5123'), true);
});

test('the same host on another port or scheme is another origin', () => {
  assert.equal(writeAllowed(h({ origin: 'https://localhost:9999' }), OWN), false);
  assert.equal(writeAllowed(h({ origin: 'http://localhost:4321' }), OWN), false);
});

test('Origin wins over Referer', () => {
  assert.equal(writeAllowed(h({ origin: 'https://evil.example', referer: `${OWN}/` }), OWN), false);
});

test('a request that names no origin is not from a web page (the share-sheet Shortcut)', () => {
  assert.equal(claimedOrigin(h({})), null);
  assert.equal(writeAllowed(h({}), OWN), true);
});

test('a broken Referer counts as another origin', () => {
  assert.equal(writeAllowed(h({ referer: 'not a url' }), OWN), false);
});

test('which bodies are read as JSON', () => {
  assert.equal(isJsonish('application/json'), true);
  assert.equal(isJsonish('text/plain;charset=UTF-8'), true);
  assert.equal(isJsonish('application/merge-patch+json'), true);
  assert.equal(isJsonish('multipart/form-data; boundary=x'), false);
  assert.equal(isJsonish('audio/webm'), false);
  assert.equal(isJsonish(null), false);
});

test('anything but a JSON object or array is bad JSON', () => {
  assert.equal(badJson('{"id":'), true);
  assert.equal(badJson('nope'), true);
  assert.equal(badJson(''), true);
  assert.equal(badJson('  \n'), true);
  assert.equal(badJson('null'), true);
  assert.equal(badJson('42'), true);
  assert.equal(badJson('"x"'), true);
  assert.equal(badJson('{"id":"x"}'), false);
  assert.equal(badJson('[]'), false);
});
