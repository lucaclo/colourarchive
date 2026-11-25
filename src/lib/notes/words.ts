/**
 * Notes in words (issue #180), trial: one note on a frame, written by a model
 * with Luca's own key, held to #180's rules.
 *
 * #180 is written for Claude. This trial runs on the Gemini API because that
 * is the key Luca has; only `askGemini` knows which provider it is. The rules,
 * the schema, the stripped JPEG and the validator are provider-free.
 *
 * What leaves the Mac per note, and nothing else: the frame as a ≤1568 px JPEG
 * with all metadata stripped, the measured findings as JSON, the intent, and
 * at most three reference thumbnails, stripped the same way.
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// ─── Shapes ───────────────────────────────────────────────────────────────

/** x, y, width, height as fractions of the frame: the same as #179's `Box`. */
export type Box = [number, number, number, number];

/** #179's `Finding`, by shape, so its findings can be passed straight in. */
export interface MeasuredFinding {
  kind: 'soft' | 'tilt' | 'clip' | 'wb' | 'edge' | 'empty' | 'chapter';
  box: Box;
  value: number;
  severity: 'low' | 'mid' | 'high';
}

export interface Point {
  box: Box;
  what: string;
}
export interface Priority extends Point {
  why: string;
  edit: string;
  next_time: string;
}
export interface WordsNote {
  /** What's in the frame, before any judgement (rule: describe before judging). */
  seen: string;
  priority: Priority | null;
  works: Point | null;
  others: Point[];
  nothing_stands_out: boolean;
}
export interface Dropped {
  where: 'priority' | 'works' | 'others';
  what: string;
  reason: string;
}

/** Bump when the rules or schema change, so a cached note isn't reused. */
export const RULES_VERSION = 1;
export const LONG_EDGE = 1568;
export const REF_EDGE = 512;
export const MAX_REFS = 3;

// ─── The rules ────────────────────────────────────────────────────────────

export const RULES = `You write one note on a single photograph for the photographer who took it, to help the next edit and the next time out.

Rules:
1. Describe before judging. Fill "seen" first: what is in the frame, plainly, with no judgement.
2. Every point names a box around the part of the frame it is about, and rests on a measurement you were given or on something plainly visible in that box.
3. One priority: the single change that would most serve the photographer's intent. Not a list.
4. Talk about the frame, never the person. No "you should have", no praise of the photographer.
5. No padding with praise. "works" is one thing that genuinely serves the intent, said plainly, or null.
6. If nothing stands out against the intent, set nothing_stands_out to true and priority to null. That is a good answer when it is true.
7. Exposure, tilt and focus come only from the measurements. Never judge them by eye. With no measurement for one of them, say nothing about it.
8. "edit" is one Lightroom move: a panel and slider, a mask or a crop, with a direction and a rough amount. "next_time" is where to stand or when to come back, in one sentence.
9. "others" holds at most two further points, each smaller than the priority. Leave it empty rather than fill it.
10. Short, plain sentences in British English. Words a working photographer uses, no art-school jargon.

Boxes are [ymin, xmin, ymax, xmax] on a 0 to 1000 grid over the frame (the first image).`;

const BOX_SCHEMA = {
  type: 'ARRAY',
  description: '[ymin, xmin, ymax, xmax], 0 to 1000, over the frame',
  items: { type: 'INTEGER' },
  minItems: 4,
  maxItems: 4,
};

/** Gemini's OpenAPI-subset schema for `WordsNote`, with boxes in its native 0..1000 order. */
export const NOTE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    seen: { type: 'STRING' },
    priority: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        box: BOX_SCHEMA,
        what: { type: 'STRING', description: 'the one thing, in a sentence' },
        why: { type: 'STRING', description: 'why it works against the intent, tied to the box' },
        edit: { type: 'STRING', description: 'one Lightroom move' },
        next_time: { type: 'STRING', description: 'where to stand or when to come back' },
      },
      required: ['box', 'what', 'why', 'edit', 'next_time'],
      propertyOrdering: ['box', 'what', 'why', 'edit', 'next_time'],
    },
    works: {
      type: 'OBJECT',
      nullable: true,
      properties: { box: BOX_SCHEMA, what: { type: 'STRING' } },
      required: ['box', 'what'],
      propertyOrdering: ['box', 'what'],
    },
    others: {
      type: 'ARRAY',
      maxItems: 2,
      items: {
        type: 'OBJECT',
        properties: { box: BOX_SCHEMA, what: { type: 'STRING' } },
        required: ['box', 'what'],
        propertyOrdering: ['box', 'what'],
      },
    },
    nothing_stands_out: { type: 'BOOLEAN' },
  },
  required: ['seen', 'priority', 'works', 'others', 'nothing_stands_out'],
  propertyOrdering: ['seen', 'priority', 'works', 'others', 'nothing_stands_out'],
};

// ─── Boxes ────────────────────────────────────────────────────────────────

/** Gemini's [ymin, xmin, ymax, xmax] on 0..1000 to [x, y, w, h] fractions. Null when it isn't
 *  four numbers, falls outside the frame, or has no area. */
export function fromGrid(raw: unknown): Box | null {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  const [ymin, xmin, ymax, xmax] = raw as number[];
  if ([ymin, xmin, ymax, xmax].some((n) => n < 0 || n > 1000)) return null;
  const w = (xmax - xmin) / 1000;
  const h = (ymax - ymin) / 1000;
  // Less than 1% of a side is a line or a dot, not a place in the frame.
  if (w < 0.01 || h < 0.01) return null;
  return [xmin / 1000, ymin / 1000, w, h];
}

/** [x, y, w, h] fractions to Gemini's grid, for findings in the prompt. */
export function toGrid([x, y, w, h]: Box): [number, number, number, number] {
  const r = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000);
  return [r(y), r(x), r(y + h), r(x + w)];
}

// ─── The frame ────────────────────────────────────────────────────────────

/** The frame as it leaves the Mac: upright, at most `edge` px on its long side, sRGB JPEG with
 *  no EXIF, GPS, XMP, IPTC or ICC (sharp keeps none unless asked). */
export async function strippedJpeg(input: string | Buffer, edge = LONG_EDGE): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .jpeg({ quality: 85 })
    .toBuffer();
}

// ─── The prompt ───────────────────────────────────────────────────────────

const UNIT: Record<MeasuredFinding['kind'], (v: number) => string> = {
  soft: (v) => `detail ${(v * 100).toFixed(0)}% of the sharpest area`,
  tilt: (v) => `${v.toFixed(1)}° (counter-clockwise positive)`,
  clip: (v) => `${(v * 100).toFixed(2)}% of the frame clipped`,
  wb: (v) => `${v.toFixed(2)} stops of cast against the as-shot balance`,
  edge: (v) => `${(v * 100).toFixed(0)}% of that side touched`,
  empty: (v) => `${(v * 100).toFixed(0)}% of the frame`,
  chapter: (v) => `distance ${v.toFixed(2)} from the chapter's look`,
};

const KIND_WORDS: Record<MeasuredFinding['kind'], string> = {
  soft: 'soft (focus)',
  tilt: 'tilt',
  clip: 'highlights clip',
  wb: 'colour cast',
  edge: 'subject touches the edge',
  empty: 'empty area',
  chapter: 'off the chapter’s look',
};

export function promptText(intent: string, findings: MeasuredFinding[], refs: number): string {
  const measured = findings.length
    ? findings
        .map((f) => `- ${KIND_WORDS[f.kind]} at [${toGrid(f.box).join(', ')}]: ${UNIT[f.kind](f.value)}, ${f.severity}`)
        .join('\n')
    : '- None for this frame. Say nothing about exposure, tilt or focus.';
  const kinds = new Set(findings.map((f) => f.kind));
  const unmeasured = (['clip', 'tilt', 'soft'] as const).filter((k) => !kinds.has(k));
  const quiet =
    findings.length && unmeasured.length
      ? `\nNothing was found for ${unmeasured.map((k) => KIND_WORDS[k]).join(', ')}: treat ${unmeasured.length > 1 ? 'them' : 'it'} as fine.`
      : '';
  return [
    `Intent: ${intent.trim()}`,
    '',
    'Measured by code (trust these over your eye):',
    measured + quiet,
    '',
    refs
      ? `The first image is the frame. The ${refs === 1 ? 'next image is a reference' : `next ${refs} images are references`} for the look the photographer is after; they are not to be critiqued.`
      : 'The image is the frame.',
  ].join('\n');
}

// ─── The validator ────────────────────────────────────────────────────────

/** Claims the model may only make when code measured them (#180 rule: exposure, tilt and focus
 *  come only from the findings). Read on "what" and "why", the claims, never on "edit" and
 *  "next_time", the moves: "Highlights −30" is a move, "highlights are blown" is a claim. */
const MEASURED_ONLY: Array<{ kind: MeasuredFinding['kind']; words: RegExp; label: string }> = [
  {
    kind: 'clip',
    label: 'exposure',
    words: /\bclip(s|ped|ping)?\b|\bblown\b|over-?expos|under-?expos|burn(ed|t) out|crushed|\b(too|over(ly)?) (bright|dark)\b|lost (highlight|shadow) detail/i,
  },
  {
    kind: 'tilt',
    label: 'tilt',
    words: /\btilt(s|ed|ing)?\b|crooked|\bwonky\b|\bskew(ed)?\b|not level|off[- ]level|isn['’]t level|out of level|straighten|horizon (leans|slopes|dips|rises)/i,
  },
  {
    kind: 'soft',
    label: 'focus',
    words: /out of focus|(missed|front|back)[- ]focus|focus (is|falls|sits|landed|lands|missed)|\bblurr?(y|ed)?\b|motion blur|camera shake|not sharp|unsharp|\bis soft\b|soft (focus|subject|foreground|face|eyes)/i,
  },
];

function contradiction(text: string, findings: MeasuredFinding[]): string | null {
  for (const rule of MEASURED_ONLY) {
    if (!rule.words.test(text)) continue;
    const hit = findings.find((f) => f.kind === rule.kind && f.value !== 0);
    if (!hit) return `${rule.label} claim with no ${rule.kind} measurement`;
  }
  return null;
}

/** The model's raw JSON, checked: points with a box that's missing, empty or outside the frame
 *  are dropped, and so are points that claim exposure, tilt or focus without a finding. */
export function validate(raw: unknown, findings: MeasuredFinding[]): { note: WordsNote; dropped: Dropped[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const dropped: Dropped[] = [];
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  const point = (v: unknown, where: Dropped['where']): Point | null => {
    if (!v || typeof v !== 'object') return null;
    const p = v as Record<string, unknown>;
    const what = str(p.what);
    const box = fromGrid(p.box);
    if (!what) {
      dropped.push({ where, what: '(no words)', reason: 'empty' });
      return null;
    }
    if (!box) {
      dropped.push({ where, what, reason: 'box missing, empty or outside the frame' });
      return null;
    }
    const clash = contradiction(`${what} ${str(p.why)}`, findings);
    if (clash) {
      dropped.push({ where, what, reason: clash });
      return null;
    }
    return { box, what };
  };

  let priority: Priority | null = null;
  const pRaw = r.priority as Record<string, unknown> | null | undefined;
  const p = point(pRaw, 'priority');
  if (p && pRaw) {
    const [why, edit, next_time] = [str(pRaw.why), str(pRaw.edit), str(pRaw.next_time)];
    if (why && edit && next_time) priority = { ...p, why, edit, next_time };
    else dropped.push({ where: 'priority', what: p.what, reason: 'missing why, edit or next time' });
  }

  const works = point(r.works, 'works');
  const others = (Array.isArray(r.others) ? r.others : [])
    .slice(0, 2)
    .map((o) => point(o, 'others'))
    .filter((o): o is Point => o !== null);

  return {
    note: {
      seen: str(r.seen),
      priority,
      works,
      others,
      nothing_stands_out: r.nothing_stands_out === true && !priority,
    },
    dropped,
  };
}

// ─── Gemini ───────────────────────────────────────────────────────────────

export type WordsReason = 'key' | 'limit' | 'connection' | 'refused' | 'service' | 'bad-answer';

/** #180's corner-note reasons, plus two the trial needs. */
export const REASON_COPY: Record<WordsReason, string> = {
  key: 'Key refused',
  // A 429 is the service's quota or rate limit; the app's own monthly cap comes with the UI.
  limit: 'Limit reached',
  connection: 'No connection',
  refused: 'The model declined this frame',
  service: 'The service failed',
  'bad-answer': 'The answer wasn’t a note',
};

export class WordsError extends Error {
  constructor(
    readonly reason: WordsReason,
    detail: string,
  ) {
    super(`${REASON_COPY[reason]}: ${detail}`);
    this.name = 'WordsError';
  }
}

/** The key never appears in a message: not in the URL (it goes in a header), and scrubbed from
 *  anything the service echoes back. */
export function redact(text: string, key: string): string {
  return key ? text.split(key).join('[key]') : text;
}

export interface AskInput {
  key: string;
  model: string;
  frame: Buffer;
  intent: string;
  findings?: MeasuredFinding[];
  refs?: Buffer[];
  fetchImpl?: typeof fetch;
}

export interface AskResult {
  raw: unknown;
  usage: { input: number; output: number; thinking: number };
}

interface GeminiReply {
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const BLOCKED = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY', 'LANGUAGE']);

export function requestBody(input: Omit<AskInput, 'key' | 'fetchImpl'>) {
  const refs = (input.refs ?? []).slice(0, MAX_REFS);
  const image = (b: Buffer) => ({ inline_data: { mime_type: 'image/jpeg', data: b.toString('base64') } });
  return {
    system_instruction: { parts: [{ text: RULES }] },
    contents: [
      {
        role: 'user',
        parts: [{ text: promptText(input.intent, input.findings ?? [], refs.length) }, image(input.frame), ...refs.map(image)],
      },
    ],
    generationConfig: { responseMimeType: 'application/json', responseSchema: NOTE_SCHEMA },
  };
}

export async function askGemini(input: AskInput): Promise<AskResult> {
  const { key, model } = input;
  if (!key) throw new WordsError('key', 'no key');
  if (!/^[a-z0-9.-]+$/i.test(model)) throw new WordsError('bad-answer', `not a model name: ${model}`);
  const doFetch = input.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(requestBody(input)),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err) {
    throw new WordsError('connection', redact(String((err as Error)?.message ?? err), key));
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      msg = JSON.parse(text)?.error?.message ?? msg;
    } catch {
      /* not JSON */
    }
    msg = redact(String(msg), key);
    if (res.status === 429) throw new WordsError('limit', msg);
    if (res.status === 401 || res.status === 403 || /API key|API_KEY/i.test(msg)) throw new WordsError('key', msg);
    if (res.status >= 500) throw new WordsError('service', `${res.status} ${msg}`);
    throw new WordsError('bad-answer', `${res.status} ${msg}`);
  }
  let body: GeminiReply;
  try {
    body = JSON.parse(text);
  } catch {
    throw new WordsError('bad-answer', 'not JSON');
  }
  if (body?.promptFeedback?.blockReason) throw new WordsError('refused', String(body.promptFeedback.blockReason));
  const cand = body?.candidates?.[0];
  const finish = String(cand?.finishReason ?? '');
  if (BLOCKED.has(finish)) throw new WordsError('refused', finish);
  if (finish === 'MAX_TOKENS') throw new WordsError('bad-answer', 'ran out of room');
  const out = (cand?.content?.parts ?? [])
    .filter((p) => typeof p?.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  let raw: unknown;
  try {
    raw = JSON.parse(out);
  } catch {
    throw new WordsError('bad-answer', `not a note${finish ? ` (${finish})` : ''}`);
  }
  const u = body?.usageMetadata ?? {};
  return {
    raw,
    usage: { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thinking: u.thoughtsTokenCount ?? 0 },
  };
}

/** One request per frame per intent: the cache key covers everything that changes the answer. */
export function cacheKey(input: Omit<AskInput, 'key' | 'fetchImpl'>): string {
  const h = createHash('sha256');
  h.update(`v${RULES_VERSION}\0${input.model}\0${input.intent.trim()}\0${JSON.stringify(input.findings ?? [])}\0`);
  h.update(input.frame);
  for (const r of (input.refs ?? []).slice(0, MAX_REFS)) h.update(r);
  return h.digest('hex').slice(0, 24);
}
