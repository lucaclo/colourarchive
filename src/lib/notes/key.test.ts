import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { notesKey } from './key';

const SLOT = Symbol.for('colour-archive.notes-key');
const g = globalThis as Record<symbol, unknown>;
const before = process.env.GEMINI_API_KEY;

afterEach(() => {
  delete g[SLOT];
  if (before === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = before;
});

test('the key the Mac app sends is read from the slot, never put in process.env', () => {
  delete process.env.GEMINI_API_KEY;
  g[SLOT] = 'slot-key-123';
  assert.equal(notesKey(), 'slot-key-123');
  assert.equal(process.env.GEMINI_API_KEY, undefined, 'child processes inherit process.env');
});

test('an emptied slot (key removed) gives no key outside development', () => {
  delete process.env.GEMINI_API_KEY;
  g[SLOT] = '';
  assert.equal(notesKey(), '');
});
