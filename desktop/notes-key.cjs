// The Gemini key for notes in words (#180), kept by the Mac app.
//
// Encrypted with Electron's safeStorage, whose own key is in the macOS
// Keychain, and written to userData/notes-key.bin readable by this user only.
// main.cjs hands the plain key to the server process by message, never in its
// environment, settings.json, the log or the archive folder. Electron is
// injected so the tests run under plain Node.

const nodeFs = require('node:fs');
const path = require('node:path');

/**
 * @param {{ file: string, safeStorage: { isEncryptionAvailable(): boolean, encryptString(s: string): Buffer, decryptString(b: Buffer): string }, fs?: typeof import('node:fs') }} deps
 */
function createNotesKey({ file, safeStorage, fs = nodeFs }) {
  return {
    has() {
      return fs.existsSync(file);
    },

    /** The key, or null when none is saved or the Keychain won't open it. */
    read() {
      try {
        return safeStorage.decryptString(fs.readFileSync(file)) || null;
      } catch {
        return null;
      }
    },

    /** Null when saved, or why it wasn't. */
    save(key) {
      const plain = String(key ?? '').trim();
      if (!plain) return 'Key needed';
      if (!safeStorage.isEncryptionAvailable()) return 'Keychain unavailable';
      let bytes;
      try {
        bytes = safeStorage.encryptString(plain);
      } catch {
        return 'Keychain unavailable';
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, bytes, { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, file);
      return null;
    },

    remove() {
      fs.rmSync(file, { force: true });
    },
  };
}

module.exports = { createNotesKey };
