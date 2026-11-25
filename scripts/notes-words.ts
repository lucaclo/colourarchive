// Notes in words, trial (issue #180): one note on a photo, from Gemini, held to #180's rules.
//
//   npm run notes:words -- <photo> --intent "quiet, the lit doorway is the subject"
//       [--ref <image>]…        up to three references for the look (board images, your photos)
//       [--findings <json>]     #179's measured findings for the frame, when you have them
//       [--model <name>]        default gemini-3.5-flash (the free tier gives Pro no quota)
//       [--fresh]               ask again instead of using the cached note
//
// Reads GEMINI_API_KEY from .env. What leaves the Mac: the photo as a stripped ≤1568 px JPEG,
// the findings, the intent and the reference thumbnails. No file name, EXIF or GPS.
// Notes and a copy of the photo with the boxes drawn go to node_modules/.cache/notes-words/.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  askGemini,
  cacheKey,
  strippedJpeg,
  validate,
  WordsError,
  REF_EDGE,
  MAX_REFS,
  type Box,
  type MeasuredFinding,
  type WordsNote,
} from '../src/lib/notes/words';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const many = (name: string) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const valued = new Set(['intent', 'ref', 'findings', 'model']);
const photo = args.find((a, i) => !a.startsWith('--') && !valued.has((args[i - 1] ?? '').replace(/^--/, '')));

const intent = opt('intent') ?? '';
const model = opt('model') ?? 'gemini-3.5-flash';
if (!photo || !intent.trim()) {
  console.error('Usage: npm run notes:words -- <photo> --intent "what the frame is for" [--ref img]… [--findings f.json] [--model m] [--fresh]');
  console.error('No intent, no words (#180): the intent is what the note is measured against.');
  process.exit(2);
}

try {
  process.loadEnvFile('.env');
} catch {
  /* no .env: fall through to the check below */
}
const key = process.env.GEMINI_API_KEY ?? '';
if (!key) {
  console.error('No GEMINI_API_KEY in .env.');
  process.exit(2);
}

const findings: MeasuredFinding[] = opt('findings') ? JSON.parse(await fs.readFile(opt('findings')!, 'utf8')) : [];
const refPaths = many('ref');
if (refPaths.length > MAX_REFS) console.warn(`Only the first ${MAX_REFS} references are sent.`);

const frame = await strippedJpeg(photo);
const refs = await Promise.all(refPaths.slice(0, MAX_REFS).map((r) => strippedJpeg(r, REF_EDGE)));
const input = { model, frame, intent, findings, refs };

const outDir = path.resolve('node_modules/.cache/notes-words');
await fs.mkdir(outDir, { recursive: true });
const id = cacheKey(input);
const cached = path.join(outDir, `${id}.json`);

let raw: unknown;
let usage: { input: number; output: number; thinking: number } | null = null;
const hit = !flag('fresh') && (await fs.readFile(cached, 'utf8').then(JSON.parse).catch(() => null));
if (hit) {
  raw = hit.raw;
} else {
  const t0 = Date.now();
  try {
    ({ raw, usage } = await askGemini({ key, ...input }));
  } catch (err) {
    if (err instanceof WordsError) {
      console.error(`Notes not written · ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  console.log(`(${model}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  await fs.writeFile(cached, JSON.stringify({ model, intent, photo: path.basename(photo), raw, usage }, null, 2));
}

const { note, dropped } = validate(raw, findings);

// ─── Print ────────────────────────────────────────────────────────────────

const pct = ([x, y, w, h]: Box) => `x ${Math.round(x * 100)}–${Math.round((x + w) * 100)}%, y ${Math.round(y * 100)}–${Math.round((y + h) * 100)}%`;
const lines: string[] = [];
lines.push(`${path.basename(photo)}  ·  Intent: ${intent}`);
lines.push('');
lines.push(`Seen: ${note.seen}`);
lines.push('');
if (note.priority) {
  lines.push(`1  ${note.priority.what}   [${pct(note.priority.box)}]`);
  lines.push(`   ${note.priority.why}`);
  lines.push(`   Edit:      ${note.priority.edit}`);
  lines.push(`   Next time: ${note.priority.next_time}`);
} else if (note.nothing_stands_out) {
  lines.push('Nothing stands out.');
} else {
  lines.push('No priority survived the checks.');
}
if (note.works) lines.push(`2  Works: ${note.works.what}   [${pct(note.works.box)}]`);
note.others.forEach((o, i) => lines.push(`${i + 3}  ${o.what}   [${pct(o.box)}]`));
if (dropped.length) {
  lines.push('');
  lines.push('Dropped by the validator:');
  for (const d of dropped) lines.push(`   ${d.where}: "${d.what}" (${d.reason})`);
}
if (usage) {
  lines.push('');
  lines.push(`Tokens: ${usage.input} in, ${usage.output} out, ${usage.thinking} thinking`);
} else {
  lines.push('');
  lines.push('(cached; --fresh to ask again)');
}
console.log(lines.join('\n'));

// ─── The frame with its boxes ─────────────────────────────────────────────

async function drawBoxes(note: WordsNote): Promise<string> {
  const img = sharp(frame);
  const { width = 0, height = 0 } = await img.metadata();
  const boxes: Array<{ n: number; box: Box; colour: string }> = [];
  if (note.priority) boxes.push({ n: 1, box: note.priority.box, colour: '#ffd23f' });
  if (note.works) boxes.push({ n: 2, box: note.works.box, colour: '#7be0a5' });
  note.others.forEach((o, i) => boxes.push({ n: i + 3, box: o.box, colour: '#ffffff' }));
  const s = Math.max(width, height) / 1000;
  const rects = boxes
    .map(({ n, box: [x, y, w, h], colour }) => {
      const [X, Y, W, H] = [x * width, y * height, w * width, h * height];
      return `<rect x="${X}" y="${Y}" width="${W}" height="${H}" fill="none" stroke="${colour}" stroke-width="${3 * s}"/>
<rect x="${X}" y="${Y}" width="${26 * s}" height="${26 * s}" fill="${colour}"/>
<text x="${X + 13 * s}" y="${Y + 19 * s}" font-family="Helvetica" font-weight="bold" font-size="${18 * s}" text-anchor="middle" fill="#000">${n}</text>`;
    })
    .join('\n');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects}</svg>`);
  const out = path.join(outDir, `${path.parse(photo!).name}-${id.slice(0, 8)}.jpg`);
  await img.composite([{ input: svg }]).jpeg({ quality: 88 }).toFile(out);
  return out;
}

console.log(`\nBoxes: ${await drawBoxes(note)}`);
