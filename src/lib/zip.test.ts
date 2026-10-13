import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32, zipFiles } from './zip';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

// Read back with Python's zipfile, which honours the UTF-8 name flag; the
// Info-ZIP unzip that ships with macOS does not, and garbles "Café".
test('a standard reader reads it back, and duplicate names get a number', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
  try {
    const file = path.join(dir, 'presets.zip');
    fs.writeFileSync(file, zipFiles([
      { name: 'A as B.xmp', data: '<x:xmpmeta>a</x:xmpmeta>' },
      { name: 'A as B.xmp', data: '<x:xmpmeta>b</x:xmpmeta>' },
      { name: 'Café.xmp', data: 'é' },
    ]));
    const read = (code: string) => execFileSync('python3', ['-c', `import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1])\n${code}`, file], { encoding: 'utf8' }).trim();
    assert.equal(read('print(z.testzip())'), 'None', 'every CRC checks');
    assert.deepEqual(JSON.parse(read('print(json.dumps(sorted(z.namelist())))')), ['A as B 2.xmp', 'A as B.xmp', 'Café.xmp']);
    assert.equal(read("print(z.read('A as B 2.xmp').decode())"), '<x:xmpmeta>b</x:xmpmeta>');
    assert.equal(read("print(z.read('Café.xmp').decode())"), 'é');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
