/**
 * The recognition test for reading the floor (issue #147), before any UI:
 * "prove it on 20 printed frames". Without a printer and a floor to hand, it
 * builds the photograph: real work-print pages rendered as they would print,
 * cut into cards, laid out of order on a textured floor with each card
 * turned and resized a little, then the whole picture tilted (keystone), lit
 * by a glare in one corner, colour-cast and JPEG-compressed like a phone
 * shot. Then it reads the floor back and counts how many cards came back in
 * the right place.
 *
 *   npm run floor:test                 20 cards, candidates = the printed set
 *   npm run floor:test -- --all        candidates = every photo in the store
 *   npm run floor:test -- --save DIR   also write the synthetic photo there
 *
 * Exits non-zero below 15 of 16 per issue's bar, scaled to the card count.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readStore } from '../src/lib/manifest';
import { renderWorkPage, cells, type WorkPrint } from '../src/lib/floor/workprints';
import { readFloor } from '../src/lib/floor/read';
import { PHOTOS_DIR } from '../src/lib/paths';

const args = process.argv.slice(2);
const N = Number(args[args.indexOf('--n') + 1]) || 20;
const saveDir = args.includes('--save') ? args[args.indexOf('--save') + 1] : null;
let seed = Number(args[args.indexOf('--seed') + 1]) || 7;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 2 ** 32; return seed / 2 ** 32; };

async function main() {
  const store = (await readStore()).filter((p) => p.embedding);
  const present: typeof store = [];
  for (const p of store) { try { await fs.access(path.join(PHOTOS_DIR, p.filename)); present.push(p); } catch { /* not on this machine */ } }
  // An even spread through the archive, so neighbours in colour are in the test.
  const step = present.length / N;
  const chosen = Array.from({ length: N }, (_, i) => present[Math.floor(i * step)]);
  const prints: WorkPrint[] = chosen.map((p, i) => ({ id: p.id, filename: p.filename, code: String(i + 1).padStart(2, '0') }));

  // Render pages, cut out each card.
  const cards: Buffer[] = [];
  for (let i = 0; i < prints.length; i += 16) {
    const page = await renderWorkPage(prints.slice(i, i + 16));
    const grid = cells();
    for (let k = 0; k < Math.min(16, prints.length - i); k++) {
      const c = grid[k], s = page.w / 210;
      cards.push(await sharp(page.jpeg).extract({ left: Math.round(c.x * s) + 2, top: Math.round(c.y * s) + 2, width: Math.round(c.w * s) - 4, height: Math.round(c.h * s) - 4 }).png().toBuffer());
    }
  }

  // The order they are laid in: a shuffle of the printed order.
  const laid = prints.map((_, i) => i);
  for (let i = laid.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [laid[i], laid[j]] = [laid[j], laid[i]]; }

  const W = 3600, H = 3000, cols = 5, rows = Math.ceil(N / cols);
  const floorRaw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const grain = Math.sin(y * 0.05 + Math.sin(x * 0.004) * 6) * 12 + (rand() - 0.5) * 18;
    const o = (y * W + x) * 3;
    floorRaw[o] = 112 + grain; floorRaw[o + 1] = 84 + grain * 0.8; floorRaw[o + 2] = 58 + grain * 0.6;
  }
  const layers: sharp.OverlayOptions[] = [];
  const cellW = W / (cols + 0.6), cellH = H / (rows + 0.4);
  for (let k = 0; k < laid.length; k++) {
    const r = Math.floor(k / cols), c = k % cols;
    const targetW = Math.round(cellW * (0.56 + rand() * 0.08));
    const card = await sharp(cards[laid[k]]).resize(targetW).rotate((rand() - 0.5) * 20, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
    const cx = cellW * (c + 0.8) + (rand() - 0.5) * 40, cy = cellH * (r + 0.7) + (rand() - 0.5) * 40;
    layers.push({ input: card.data, left: Math.round(cx - card.info.width / 2), top: Math.round(cy - card.info.height / 2) });
  }
  const flat = await sharp(floorRaw, { raw: { width: W, height: H, channels: 3 } }).composite(layers).removeAlpha().raw().toBuffer();

  // Keystone: the top of the picture further away, so narrower.
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    const t = y / H, squeeze = 0.86 + 0.14 * t;
    const sy = Math.min(H - 1, Math.round(H * (t ** 1.08)));
    for (let x = 0; x < W; x++) {
      const sx = Math.round(W / 2 + (x - W / 2) / squeeze);
      const o = (y * W + x) * 3;
      if (sx < 0 || sx >= W) { out[o] = 90; out[o + 1] = 70; out[o + 2] = 50; continue; }
      const so = (sy * W + sx) * 3;
      out[o] = flat[so]; out[o + 1] = flat[so + 1]; out[o + 2] = flat[so + 2];
    }
  }
  // Glare in the top-right corner, a warm cast, and a phone's JPEG.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - W * 0.85, y - H * 0.1) / (W * 0.35);
    const g = Math.max(0, 1 - d) * 70;
    const o = (y * W + x) * 3;
    out[o] = Math.min(255, out[o] * 1.04 + g); out[o + 1] = Math.min(255, out[o + 1] + g); out[o + 2] = Math.min(255, out[o + 2] * 0.94 + g);
  }
  const shot = await sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 82 }).toBuffer();
  if (saveDir) { await fs.mkdir(saveDir, { recursive: true }); await fs.writeFile(path.join(saveDir, 'floor.jpg'), shot); }

  const candidates = (args.includes('--all') ? present : chosen).map((p) => ({ id: p.id, embedding: p.embedding! }));
  const t0 = Date.now();
  const reading = await readFloor(shot, candidates);
  const expected = laid.map((i) => prints[i].id);
  const got = reading.prints.map((p) => p.id);
  const right = expected.filter((id, k) => got[k] === id).length;
  console.log(`Found ${reading.prints.length} of ${N} prints in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${right} of ${N} read in the right place (candidates: ${candidates.length}).`);
  for (let k = 0; k < Math.max(expected.length, got.length); k++) {
    if (got[k] !== expected[k]) console.log(`  place ${k + 1}: expected ${prints.find((p) => p.id === expected[k])?.code ?? '-'}, read ${prints.find((p) => p.id === got[k])?.code ?? got[k] ?? 'nothing'} (score ${reading.prints[k]?.score ?? '-'})`);
  }
  const bar = Math.ceil((15 / 16) * N);
  if (right < bar) { console.log(`Below the bar of ${bar}.`); process.exitCode = 1; }
}

main().catch((err) => { console.error(err); process.exit(1); });
