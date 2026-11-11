import { inflateRawSync } from 'node:zlib';

/**
 * Read chosen files out of a .zip — the reading half of zip.ts.
 *
 * For an Instagram data export: a few JSON files somewhere inside a zip that
 * can also hold every photo you ever posted. Only the entries `want` accepts
 * are inflated; the rest are skipped by their sizes in the central
 * directory, never decompressed. Stored and deflated entries, which is what
 * every zip tool writes; no zip64 (an export of just the JSON is small).
 */
export function unzip(buf: Buffer, want: (name: string) => boolean): { name: string; data: Buffer }[] {
  // End of central directory: the last 22 bytes, plus up to 64 KB of comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That is not a zip file.');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    throw new Error('That zip is too big to read here. Export only the JSON, without media.');
  }

  const out: { name: string; data: Buffer }[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('That zip is damaged.');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/') || !want(name)) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('That zip is damaged.');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compSize);
    if (method === 0) out.push({ name, data: Buffer.from(raw) });
    else if (method === 8) out.push({ name, data: inflateRawSync(raw) });
    // Anything else (bzip2, encrypted) is skipped rather than misread.
  }
  return out;
}
