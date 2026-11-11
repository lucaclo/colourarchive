import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { IMG_DIR } from './paths';
import { clipEmbedBuffer, clipEmbedText } from './clip';
import type { Photo } from './types';
import type { LightPhase, LightWish } from './light-plan';
import type { LightDirection } from './scout/lighting';
import { measureRef, metricsOf, populationQuartiles } from './photographers/style';

/**
 * What light a reference was taken in, read off the picture: the phase of
 * the day and, for direct sun, where it came from relative to the camera.
 * Feeds "shoot this light" (light-plan.ts).
 *
 * CLIP's zero-shot reading, with the prompts written the way photographers
 * talk about light. The two questions are asked separately — "when" and
 * "from where" — because a direction means nothing for an overcast or night
 * picture, and is only asked when the first answer is direct sun.
 *
 * CLIP alone mistakes bright, clean pictures for overcast ones, so its
 * answer is checked against what was measured (the same look signature
 * Style Match reads): hard contrast is direct sun whatever CLIP says, and a
 * warm, dark "overcast" is a sunset under cloud. Checked on the board's own
 * references, where CLIP alone got four of eleven wrong.
 */

const PHASES: [LightPhase, string][] = [
  ['golden', 'a photo at sunset or sunrise, the sun low on the horizon, warm orange light'],
  ['blue', 'a photo at dusk in blue twilight, the sky deep blue, city lights coming on'],
  ['overcast', 'a photo under a dull grey cloudy sky, diffuse light, no sun and no shadows'],
  ['midday', 'a photo on a sunny day with a clear blue sky and bright sunshine'],
  ['night', 'a photo at night in the dark, lit by street lights and neon'],
];
const DIRECTIONS: [LightDirection, string][] = [
  ['back', 'a backlit photo, the sun behind the subject, silhouettes and glowing edges'],
  ['side', 'a photo lit from the side, long raking shadows across the scene'],
  ['front', 'a front-lit photo, the sun behind the camera lighting the subject evenly'],
];

let prompts: Promise<{ phases: number[][]; directions: number[][] }> | null = null;
const getPrompts = () => (prompts ??= (async () => ({
  phases: await Promise.all(PHASES.map(([, t]) => clipEmbedText(t))),
  directions: await Promise.all(DIRECTIONS.map(([, t]) => clipEmbedText(t))),
}))());

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

/** Softmax at CLIP's usual ×100 temperature: the winner and its share. */
export function pick<T>(clip: number[], options: [T, string][], vectors: number[][]): { value: T; share: number } {
  const logits = vectors.map((v) => 100 * dot(clip, v));
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  let best = 0;
  for (let i = 1; i < exps.length; i++) if (exps[i] > exps[best]) best = i;
  return { value: options[best][0], share: exps[best] / sum };
}

export interface LightReading extends LightWish { share: number }

async function clipOf(photo: Photo): Promise<number[]> {
  if (photo.clipEmbedding?.length) return photo.clipEmbedding;
  const d = photo.derivatives[Math.min(1, photo.derivatives.length - 1)];
  const buf = await fs.readFile(path.join(IMG_DIR, d.avif.replace(/^\/img\//, '')));
  return clipEmbedBuffer(await sharp(buf).resize({ width: 336, height: 336, fit: 'inside' }).jpeg({ quality: 90 }).toBuffer());
}

export async function readLight(photo: Photo): Promise<LightReading> {
  const clip = await clipOf(photo);
  const p = await getPrompts();
  let phase = pick(clip, PHASES, p.phases);

  const measured = await measureRef(photo);
  const m = measured && metricsOf(measured.look);
  if (m) {
    const q = await populationQuartiles();
    const hard = m.contrast > q.contrast[2] + 0.02;
    if (hard && (phase.value === 'overcast' || phase.value === 'blue')) {
      // Shadows that hard need the sun: golden or high, CLIP decides which.
      const keep = [0, 3];
      const sub = pick(clip, keep.map((i) => PHASES[i]), keep.map((i) => p.phases[i]));
      phase = { value: sub.value, share: Math.min(phase.share, sub.share) };
    } else if (phase.value === 'overcast' && m.warm > q.warm[2] && m.key < 0.45) {
      phase = { value: 'golden', share: phase.share };
    }
  }

  const direct = phase.value === 'golden' || phase.value === 'midday';
  // A direction is only named when CLIP clearly prefers one.
  const dir = direct ? pick(clip, DIRECTIONS, p.directions) : null;
  return { phase: phase.value, direction: dir && dir.share >= 0.5 ? dir.value : null, share: phase.share };
}
