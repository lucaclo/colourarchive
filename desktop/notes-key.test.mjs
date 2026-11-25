import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import notesKeyModule from './notes-key.cjs';

const { createNotesKey } = notesKeyModule;

const KEY = 'AQ.test-key-desktop-1234567890abcdef';

/** Stands in for Electron's safeStorage: reversible, and never the plain text on disk. */
function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`.split('').reverse().join('')),
    decryptString: (b) => {
      const s = b.toString().split('').reverse().join('');
      if (!s.startsWith('enc:')) throw new Error('not ours');
      return Buffer.from(s.slice(4), 'base64').toString();
    },
  };
}

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notes-key-')), 'profile', 'notes-key.bin');

test('save, read, has and remove; the key is trimmed and never on disk in plain text', () => {
  const file = tempFile();
  const store = createNotesKey({ file, safeStorage: fakeSafeStorage(), fs });
  assert.equal(store.has(), false);
  assert.equal(store.read(), null);

  assert.equal(store.save(`  ${KEY}\n`), null);
  assert.equal(store.has(), true);
  assert.equal(store.read(), KEY);
  assert.ok(!fs.readFileSync(file).toString().includes(KEY));
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['notes-key.bin'], 'no temp file left behind');

  store.remove();
  assert.equal(store.has(), false);
  assert.equal(store.read(), null);
  store.remove(); // removing nothing is fine
});

test('the file is readable by this user only, also when it replaces a looser one', () => {
  const file = tempFile();
  const store = createNotesKey({ file, safeStorage: fakeSafeStorage(), fs });
  assert.equal(store.save(KEY), null);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.chmodSync(file, 0o644);
  assert.equal(store.save('another-key'), null);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(store.read(), 'another-key');
});

test('refuses to save when encryption isn’t available, or the key is empty', () => {
  const file = tempFile();
  const locked = createNotesKey({ file, safeStorage: fakeSafeStorage(false), fs });
  assert.equal(typeof locked.save(KEY), 'string');
  assert.equal(fs.existsSync(file), false);

  const store = createNotesKey({ file, safeStorage: fakeSafeStorage(), fs });
  assert.equal(typeof store.save('   '), 'string');
  assert.equal(typeof store.save(undefined), 'string');
  assert.equal(fs.existsSync(file), false);
});

test('a file the Keychain can’t open reads as no key', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'garbage');
  const store = createNotesKey({ file, safeStorage: fakeSafeStorage(), fs });
  assert.equal(store.has(), true);
  assert.equal(store.read(), null);
});
