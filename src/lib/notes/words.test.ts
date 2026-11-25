import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  askGemini,
  cacheKey,
  fromGrid,
  promptText,
  redact,
  requestBody,
  strippedJpeg,
  toGrid,
  validate,
  WordsError,
  type MeasuredFinding,
} from './words';

const KEY = 'AQ.test-key-1234567890abcdef';

async function photoWithMetadata(): Promise<Buffer> {
  return sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 120, g: 90, b: 60 } } })
    .withExif({
      IFD0: { Make: 'SONY', Model: 'ILCE-7CM2', Copyright: 'SERIAL-0099887766', ImageDescription: 'DSC01234.ARW' },
    })
    .withIccProfile('p3')
    .jpeg()
    .toBuffer();
}

test('the JPEG that leaves the Mac carries no EXIF, ICC, serial or file name, and is at most 1568 px', async () => {
  const src = await photoWithMetadata();
  assert.ok((await sharp(src).metadata()).exif, 'the fixture has EXIF to strip');
  const out = await strippedJpeg(src);
  const meta = await sharp(out).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.icc, undefined);
  assert.equal(meta.xmp, undefined);
  assert.equal(meta.iptc, undefined);
  assert.equal(Math.max(meta.width!, meta.height!), 1568);
  const text = out.toString('latin1');
  for (const s of ['SERIAL-0099887766', 'DSC01234', 'ILCE-7CM2', 'SONY', 'GPS']) assert.ok(!text.includes(s), s);
});

test('boxes: Gemini’s [ymin, xmin, ymax, xmax] 0..1000 become #179’s [x, y, w, h] fractions and back', () => {
  assert.deepEqual(fromGrid([100, 200, 600, 900]), [0.2, 0.1, 0.7, 0.5]);
  assert.deepEqual(toGrid([0.2, 0.1, 0.7, 0.5]), [100, 200, 600, 900]);
  assert.equal(fromGrid([0, 0, 0, 0]), null, 'empty');
  assert.equal(fromGrid([100, 200, 104, 900]), null, 'a line');
  assert.equal(fromGrid([100, 200, 1200, 900]), null, 'outside the frame');
  assert.equal(fromGrid([-5, 0, 500, 500]), null, 'outside the frame');
  assert.equal(fromGrid([1, 2, 3]), null);
  assert.equal(fromGrid(undefined), null);
});

const good = {
  seen: 'A doorway lit from inside, a figure passing on the left.',
  priority: {
    box: [300, 0, 900, 250],
    what: 'The bright shopfront on the left pulls the eye from the doorway.',
    why: 'The doorway is the subject, and this patch is brighter and larger.',
    edit: 'Linear gradient from the left edge, Exposure −0.7.',
    next_time: 'Step two paces right so the shopfront falls out of frame.',
  },
  works: { box: [200, 400, 800, 650], what: 'The doorway’s warm light against the blue street.' },
  others: [{ box: [850, 300, 1000, 700], what: 'The kerb line leads to the doorway.' }],
  nothing_stands_out: false,
};

test('validator keeps a note whose points have boxes and no unmeasured claims', () => {
  const { note, dropped } = validate(good, []);
  assert.deepEqual(dropped, []);
  assert.ok(note.priority);
  assert.deepEqual(note.priority.box, [0, 0.3, 0.25, 0.6]);
  assert.equal(note.priority.edit, good.priority.edit);
  assert.ok(note.works);
  assert.equal(note.others.length, 1);
  assert.equal(note.nothing_stands_out, false);
});

test('validator drops points with no box, an empty box, or a box outside the frame', () => {
  const raw = {
    ...good,
    priority: { ...good.priority, box: undefined },
    works: { ...good.works, box: [500, 500, 500, 500] },
    others: [{ box: [0, 0, 1100, 500], what: 'Outside.' }, good.others[0]],
  };
  const { note, dropped } = validate(raw, []);
  assert.equal(note.priority, null);
  assert.equal(note.works, null);
  assert.equal(note.others.length, 1);
  assert.deepEqual(
    dropped.map((d) => d.where),
    ['priority', 'works', 'others'],
  );
});

test('validator drops exposure, tilt and focus claims that no finding backs', () => {
  const claims = [
    'The sky is blown out above the roofline.',
    'Highlights are clipped in the window.',
    'The horizon is tilted to the right.',
    'The face is out of focus.',
    'The foreground is blurry.',
  ];
  for (const what of claims) {
    const { note, dropped } = validate({ ...good, priority: { ...good.priority, what } }, []);
    assert.equal(note.priority, null, what);
    assert.match(dropped[0].reason, /no (clip|tilt|soft) measurement/, what);
  }
});

test('validator lets a claim through when a finding backs it, and reads only claims, not moves', () => {
  const clip: MeasuredFinding = { kind: 'clip', box: [0, 0, 1, 0.3], value: 0.021, severity: 'mid' };
  const blown = { ...good, priority: { ...good.priority, what: 'The sky is clipped across the top third.' } };
  assert.ok(validate(blown, [clip]).note.priority);
  // A measured clip of 0 is no backing: "highlights clipped" contradicts it.
  assert.equal(validate(blown, [{ ...clip, value: 0 }]).note.priority, null);
  // "Highlights −40" and "focus on…" in the moves are not claims.
  const moves = {
    ...good,
    priority: { ...good.priority, edit: 'Highlights −40, Shadows +20.', next_time: 'Focus on the nearer figure.' },
  };
  assert.ok(validate(moves, []).note.priority);
  // "soft light" is about light, not focus.
  const soft = { ...good, works: { ...good.works, what: 'Soft light wraps the doorway.' } };
  assert.ok(validate(soft, []).note.works);
});

test('nothing stands out: kept only when there is no priority', () => {
  assert.equal(validate({ seen: 'x', priority: null, works: null, others: [], nothing_stands_out: true }, []).note.nothing_stands_out, true);
  assert.equal(validate({ ...good, nothing_stands_out: true }, []).note.nothing_stands_out, false);
});

test('the prompt carries the intent and the findings, and says to stay quiet when nothing was measured', () => {
  const none = promptText('the lit doorway', [], 0);
  assert.match(none, /Intent: the lit doorway/);
  assert.match(none, /Say nothing about exposure, tilt or focus/);
  const some = promptText('x', [{ kind: 'tilt', box: [0, 0.5, 1, 0.1], value: 1.8, severity: 'mid' }], 2);
  assert.match(some, /tilt at \[500, 0, 600, 1000\]: 1\.8°/);
  assert.match(some, /highlights clip, soft \(focus\): treat them as fine/);
  assert.match(some, /next 2 images are references/);
});

test('the request carries the key only in a header, and at most three references', async () => {
  const frame = await strippedJpeg(await photoWithMetadata());
  let seen: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(
      JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(good) }] } }],
        usageMetadata: { promptTokenCount: 1800, candidatesTokenCount: 200, thoughtsTokenCount: 900 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const res = await askGemini({ key: KEY, model: 'gemini-test', frame, intent: 'x', refs: [frame, frame, frame, frame], fetchImpl });
  assert.deepEqual(res.raw, good);
  assert.deepEqual(res.usage, { input: 1800, output: 200, thinking: 900 });
  assert.ok(seen);
  const { url, init } = seen as { url: string; init: RequestInit };
  assert.ok(!url.includes(KEY));
  assert.ok(!String(init.body).includes(KEY));
  assert.equal((init.headers as Record<string, string>)['x-goog-api-key'], KEY);
  const body = JSON.parse(String(init.body));
  assert.equal(body.contents[0].parts.filter((p: { inline_data?: unknown }) => p.inline_data).length, 4, 'the frame and three references');
});

test('errors map to #180’s reasons, and never carry the key', async () => {
  const frame = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const reply = (status: number, message: string) =>
    (async () => new Response(JSON.stringify({ error: { message } }), { status })) as unknown as typeof fetch;
  const cases: Array<[typeof fetch, string]> = [
    [reply(400, `API key not valid: ${KEY}`), 'key'],
    [reply(403, 'Permission denied'), 'key'],
    [reply(429, 'Quota exceeded'), 'limit'],
    [reply(503, 'Overloaded'), 'service'],
    [(async () => { throw new TypeError(`fetch failed for ${KEY}`); }) as unknown as typeof fetch, 'connection'],
    [
      (async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 })) as unknown as typeof fetch,
      'refused',
    ],
    [
      (async () =>
        new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Sure! Here is' }] } }] }), {
          status: 200,
        })) as unknown as typeof fetch,
      'bad-answer',
    ],
  ];
  for (const [fetchImpl, reason] of cases) {
    await assert.rejects(
      askGemini({ key: KEY, model: 'gemini-test', frame, intent: 'x', fetchImpl }),
      (err: unknown) => {
        assert.ok(err instanceof WordsError);
        assert.equal(err.reason, reason);
        assert.ok(!err.message.includes(KEY), `key in "${err.message}"`);
        return true;
      },
    );
  }
  assert.equal(redact(`a ${KEY} b ${KEY}`, KEY), 'a [key] b [key]');
});

test('one request per frame per intent: the cache key changes with what changes the answer', async () => {
  const frame = Buffer.from('frame');
  const base = { model: 'm', frame, intent: 'doorway' };
  assert.equal(cacheKey(base), cacheKey({ ...base, intent: '  doorway ' }));
  assert.notEqual(cacheKey(base), cacheKey({ ...base, intent: 'figure' }));
  assert.notEqual(cacheKey(base), cacheKey({ ...base, model: 'n' }));
  assert.notEqual(cacheKey(base), cacheKey({ ...base, refs: [Buffer.from('r')] }));
  assert.notEqual(cacheKey(base), cacheKey({ ...base, frame: Buffer.from('other') }));
  assert.ok(!JSON.stringify(requestBody(base)).includes('frame.jpg'));
});
