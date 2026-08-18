import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { BaselineMode } from './types';

const run = promisify(execFile);

// Getting pixels out of a file sounds trivial and is the single easiest place
// to introduce a silent, systematic error into every number downstream.
//
// Two rules this module exists to enforce:
//
//  1. NEVER re-encode as JPEG on the way in. Grain and noise measurement reads
//     high-frequency energy; JPEG quantisation rewrites exactly that band. The
//     working file is always lossless (TIFF), even though it is larger.
//
//  2. ALWAYS land in sRGB. A Sony ARW decodes wide-gamut; a web JPEG is sRGB;
//     a scan might be AdobeRGB. Comparing chroma across two different gamuts
//     silently reports saturation differences that are really just tagging.

/** Extensions macOS Image I/O decodes as RAW (confirmed against `sips --formats`
 *  on this machine). Anything here needs a decode step before sharp can read it. */
const RAW_EXTS = new Set([
  'arw', 'srf', 'sr2', 'axr', // Sony
  'cr2', 'cr3', 'crw', // Canon
  'nef', 'nrw', 'nefx', // Nikon
  'raf', // Fuji
  'orf', // Olympus
  'rw2', // Panasonic
  'pef', // Pentax
  'dng', // Adobe
  'erf', 'dcr', 'mrw', 'mos', 'rwl', 'iiq', 'srw', '3fr', 'fff', 'dxo', 'raw',
]);

export const isRawFilename = (filename: string): boolean =>
  RAW_EXTS.has(path.extname(filename).replace('.', '').toLowerCase());

/** sRGB profile shipped with macOS. Absent on other platforms — we degrade to
 *  an untagged decode rather than failing, and flag it. */
const SRGB_PROFILE = '/System/Library/ColorSync/Profiles/sRGB Profile.icc';

let srgbProfileP: Promise<string | null> | null = null;
const findSrgbProfile = (): Promise<string | null> =>
  (srgbProfileP ??= fs
    .access(SRGB_PROFILE)
    .then(() => SRGB_PROFILE)
    .catch(() => null));

export interface WorkingImage {
  /** Path to a lossless, sRGB, full-resolution file that sharp can read. */
  path: string;
  width: number;
  height: number;
  baseline: BaselineMode;
  /** Present when the baseline is a compromise the user should know about. */
  note?: string;
  /** Always call. Removes temp files; safe to call more than once. */
  cleanup: () => Promise<void>;
}

const tmpBase = (): string => path.join(os.tmpdir(), 'colour-archive-match');

async function tmpDir(): Promise<string> {
  const dir = path.join(tmpBase(), createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 12));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Pull the largest embedded JPEG out of a RAW container.
 *
 * RAW files carry one or more JPEGs (thumbnail + full-size preview) as plain
 * byte runs between SOI (FFD8FF) and EOI (FFD9) markers. Scanning for them
 * needs no RAW library at all. We take the largest, which is the full-size
 * preview rather than the thumbnail.
 *
 * Caveat this exists to serve: that preview is the CAMERA's rendering — picture
 * profile, Creative Look, in-camera WB. It is not Lightroom's baseline, which
 * is why `preview` carries the lowest fidelity weight of any baseline.
 */
export function extractEmbeddedJpeg(buf: Buffer): Buffer | null {
  let best: Buffer | null = null;
  let i = 0;
  while (i < buf.length - 3) {
    // SOI must be followed by a marker byte (FFE0-FFEF app segments, or FFDB).
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      // Walk forward for EOI. Bounded so a false SOI can't scan the whole file
      // repeatedly on a 50MB RAW.
      const limit = Math.min(buf.length - 1, i + 80 * 1024 * 1024);
      for (let j = i + 2; j < limit; j++) {
        if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
          const candidate = buf.subarray(i, j + 2);
          if (!best || candidate.length > best.length) best = candidate;
          i = j + 2;
          break;
        }
        if (j === limit - 1) i = limit; // no EOI found; give up on this SOI
      }
    } else {
      i++;
    }
  }
  // A thumbnail is a few KB; a real preview is hundreds of KB or more. Reject
  // anything small enough to be a thumbnail — a 160px thumbnail would produce
  // confident, completely wrong numbers.
  if (best && best.length < 200 * 1024) return null;
  return best;
}

let librawAvailableP: Promise<boolean> | null = null;
/** Is LibRaw's `dcraw_emu` sample CLI on PATH? Checked once per process —
 *  running it with no arguments always exits non-zero (it prints usage), so
 *  the only thing distinguishing "not installed" is the exec itself failing
 *  with ENOENT rather than a normal non-zero exit. */
const librawAvailable = (): Promise<boolean> =>
  (librawAvailableP ??= run('dcraw_emu', [])
    .then(() => true)
    .catch((err: unknown) => (err as NodeJS.ErrnoException)?.code !== 'ENOENT'));

/**
 * Decode via LibRaw's `dcraw_emu` sample CLI.
 *
 * For most cameras LibRaw's `cam_xyz` matrix is the same as Adobe DNG
 * Converter's `ColorMatrix2` — `adobe_coeff()` was originally derived FROM
 * Adobe's own tables — so this lands materially closer to Lightroom's own
 * baseline than macOS Image I/O's Apple colour science does. `-o 1` requests
 * sRGB output (this module's rule #2, above); `-w` uses the as-shot white
 * balance, the same starting point Lightroom opens a RAW at; `-q 3` is AHD
 * interpolation — a solid demosaic, not a claim of matching Adobe's own
 * (undocumented) algorithm exactly. Real .dng files pull their matrix from
 * the file's own `ColorMatrix2` tag rather than `adobe_coeff`, so this closes
 * most but not all of the gap to Lightroom, camera-dependently.
 *
 * dcraw_emu writes its output next to the source file rather than accepting
 * an explicit destination path across every LibRaw version, so the produced
 * file is moved into place afterward.
 */
async function librawDecode(srcPath: string, outPath: string): Promise<void> {
  // 60MP RAWs are genuinely slow to decode; allow generous headroom.
  await run('dcraw_emu', ['-T', '-o', '1', '-w', '-q', '3', srcPath], {
    timeout: 180_000,
    maxBuffer: 1 << 24,
  });
  // Appends '.tiff' to the whole filename (`src.ARW` -> `src.ARW.tiff`) —
  // it does NOT replace the source extension, confirmed against the actual
  // binary rather than assumed from docs.
  const produced = `${srcPath}.tiff`;
  await fs.rename(produced, outPath);
}

/** Decode via macOS Image I/O. Handles every RAW format the OS knows, plus
 *  HEIC, with no third-party dependency. Output is lossless TIFF in sRGB.
 *  The fallback decoder — see `librawDecode` for why it isn't the default. */
async function sipsDecode(srcPath: string, outPath: string): Promise<void> {
  const profile = await findSrgbProfile();
  const args = ['-s', 'format', 'tiff'];
  if (profile) args.push('--matchTo', profile);
  args.push(srcPath, '--out', outPath);
  // 60MP RAWs are genuinely slow to decode; allow generous headroom.
  await run('sips', args, { timeout: 180_000, maxBuffer: 1 << 24 });
}

/**
 * Decode a RAW file to a lossless sRGB TIFF, preferring LibRaw over macOS
 * Image I/O — see `librawDecode`'s comment for why. Falls back to `sips`
 * (macOS only) when LibRaw isn't installed, or when it fails on a specific
 * file it can't handle: a lower-fidelity decode beats no decode at all, but
 * the caller is told so it can pass the note on rather than claiming the
 * closer-to-Lightroom baseline silently.
 */
async function decodeRaw(srcPath: string, outPath: string): Promise<{ note?: string }> {
  if (await librawAvailable()) {
    try {
      await librawDecode(srcPath, outPath);
      return {};
    } catch {
      // A file this LibRaw build can't handle, or a broken install — sips is
      // still worth trying rather than failing the whole request.
    }
  }
  await sipsDecode(srcPath, outPath);
  return {
    note:
      'Decoded with macOS Image I/O rather than LibRaw, which renders closer to Lightroom. ' +
      'Install LibRaw (e.g. `brew install libraw`) for a more accurate baseline.',
  };
}

/**
 * Turn uploaded bytes into a working image, honouring the requested baseline.
 *
 * `requested` is what the user picked in the UI. We fall back rather than fail:
 * if the embedded preview is missing we decode properly and say so, because a
 * slightly-different baseline with a note beats an error dialog.
 */
export async function toWorkingImage(
  buf: Buffer,
  filename: string,
  requested: BaselineMode = 'macos',
): Promise<WorkingImage> {
  const dir = await tmpDir();
  const cleanup = async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    const raw = isRawFilename(filename);
    let workPath: string;
    let baseline: BaselineMode;
    let note: string | undefined;

    if (!raw) {
      // Already a rendered image. Normalise to sRGB TIFF so downstream code has
      // exactly one format to handle, and so an AdobeRGB-tagged JPEG can't
      // masquerade as extra saturation.
      workPath = path.join(dir, 'work.tiff');
      await sharp(buf, { failOn: 'none' })
        .toColorspace('srgb')
        .tiff({ compression: 'lzw' })
        .toFile(workPath);
      baseline = requested === 'export' ? 'export' : 'native';
      if (requested === 'macos' || requested === 'preview') {
        note = 'File is already a rendered image, so no RAW decode was needed.';
      }
    } else if (requested === 'preview') {
      const jpeg = extractEmbeddedJpeg(buf);
      if (jpeg) {
        workPath = path.join(dir, 'work.tiff');
        await sharp(jpeg, { failOn: 'none' })
          .toColorspace('srgb')
          .tiff({ compression: 'lzw' })
          .toFile(workPath);
        baseline = 'preview';
        note =
          "Using the camera's embedded preview. It carries your picture profile, " +
          'not Lightroom’s baseline, so treat the magnitude of each move as approximate.';
      } else {
        const srcPath = path.join(dir, `src${path.extname(filename) || '.raw'}`);
        await fs.writeFile(srcPath, buf);
        workPath = path.join(dir, 'work.tiff');
        const decoded = await decodeRaw(srcPath, workPath);
        baseline = 'macos';
        note = ['No usable preview was embedded in this RAW, so it was decoded on this Mac instead.', decoded.note]
          .filter(Boolean)
          .join(' ');
      }
    } else {
      // 'macos' or an 'export' claim on a RAW (which is a contradiction — an
      // export is by definition already a JPEG — so treat it as a plain decode).
      const srcPath = path.join(dir, `src${path.extname(filename) || '.raw'}`);
      await fs.writeFile(srcPath, buf);
      workPath = path.join(dir, 'work.tiff');
      const decoded = await decodeRaw(srcPath, workPath);
      baseline = 'macos';
      const exportNote =
        requested === 'export'
          ? 'This is a RAW file, so it was decoded here rather than treated as a ' +
            'Lightroom export. For exact numbers, export a JPEG from Lightroom with every slider reset.'
          : undefined;
      note = [exportNote, decoded.note].filter(Boolean).join(' ') || undefined;
    }

    const meta = await sharp(workPath).metadata();
    return {
      path: workPath,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      baseline,
      note,
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/** Is a RAW decoder usable here — LibRaw or, failing that, macOS `sips`?
 *  Lets the API report a clear reason rather than throwing an exec error at
 *  the user. LibRaw being cross-platform is what actually drops the
 *  macOS-only constraint this function used to embed. */
export async function canDecodeRaw(): Promise<boolean> {
  if (await librawAvailable()) return true;
  try {
    await run('sips', ['--formats'], { timeout: 10_000, maxBuffer: 1 << 22 });
    return true;
  } catch {
    return false;
  }
}
