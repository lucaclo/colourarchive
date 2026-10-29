import { pipeline, env } from '@xenova/transformers';
import { MODELS_DIR } from './paths';

// Voice notes (issue #149): a note said aloud, written down on this Mac by a
// local Whisper model — the same transformers runtime as search and genre,
// so nothing is sent anywhere. The base English model is about 75 MB,
// downloaded once on first use, and transcribes a short note in a second or
// two. The browser records and resamples (16 kHz mono float), so the server
// needs no audio decoder.
env.allowLocalModels = false;
if (MODELS_DIR) env.cacheDir = MODELS_DIR;

const MODEL_ID = process.env.COLOUR_ARCHIVE_WHISPER || 'Xenova/whisper-base.en';
export const SAMPLE_RATE = 16_000;
/** A note, not a lecture. Longer recordings are refused, not truncated. */
export const MAX_SECONDS = 90;

let asrP: Promise<any> | null = null;
const getAsr = () => (asrP ??= pipeline('automatic-speech-recognition', MODEL_ID));

/** Whisper's habits on silence and noise, which are not a note. */
const NOT_SPEECH = /^\s*[[(]?\s*(blank_audio|silence|music|inaudible|no speech)\s*[\])]?\s*$/i;

export function tidyTranscript(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return NOT_SPEECH.test(t) ? '' : t;
}

/** Loudness, as root mean square. Whisper writes "you" over silence. */
export function rms(samples: Float32Array): number {
  let s = 0;
  for (const x of samples) s += x * x;
  return Math.sqrt(s / Math.max(1, samples.length));
}
const QUIET = 0.004;

export async function transcribe(samples: Float32Array): Promise<string> {
  if (samples.length > MAX_SECONDS * SAMPLE_RATE) throw new Error(`Keep a voice note under ${MAX_SECONDS} seconds.`);
  if (samples.length < SAMPLE_RATE / 4 || rms(samples) < QUIET) return '';
  const asr = await getAsr();
  const out = await asr(samples, { chunk_length_s: 30, stride_length_s: 5 });
  return tidyTranscript(Array.isArray(out) ? out.map((o: { text: string }) => o.text).join(' ') : out.text);
}
