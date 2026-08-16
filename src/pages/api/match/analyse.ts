import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readInspStore } from '../../../lib/inspiration';
import { readStore } from '../../../lib/manifest';
import { INSPIRATION_DIR, PHOTOS_DIR } from '../../../lib/paths';
import { runMatch, MATCH_STAGE_LABEL } from '../../../lib/match/session';
import { canDecodeRaw, isRawFilename } from '../../../lib/match/decode';
import type { BaselineMode } from '../../../lib/match/types';

export const prerender = false;

// Analyse a reference against one of your photos and solve the grade.
//
// The reference is an item already on the inspiration board (or in the
// archive), identified by id; your photo is uploaded per request, since it is
// usually a file you are about to edit rather than something in the archive.

const BASELINES: BaselineMode[] = ['macos', 'export', 'preview', 'native'];

export const POST: APIRoute = async ({ request }) => {
  try {
    const form = await request.formData();
    const refId = String(form.get('ref') || '').trim();
    const file = form.get('photo');
    const baselineRaw = String(form.get('baseline') || 'macos');
    const baseline: BaselineMode = BASELINES.includes(baselineRaw as BaselineMode)
      ? (baselineRaw as BaselineMode)
      : 'macos';

    if (!refId) return json({ ok: false, error: 'Pick a reference first.' }, 400);
    if (!(file instanceof File)) return json({ ok: false, error: 'No photo received.' }, 400);

    // Find the reference in either collection, and locate its original file —
    // the derivatives are lossy, and measuring a re-encoded copy would fold the
    // encoder's artefacts into the reference's own measurements.
    const [insp, archive] = await Promise.all([readInspStore(), readStore()]);
    const inspItem = insp.find((p) => p.id === refId);
    const archiveItem = archive.find((p) => p.id === refId);
    const ref = inspItem ?? archiveItem;
    if (!ref) return json({ ok: false, error: 'That reference no longer exists.' }, 404);
    const refPath = path.join(inspItem ? INSPIRATION_DIR : PHOTOS_DIR, ref.filename);

    let referenceBuf: Buffer;
    try {
      referenceBuf = await fs.readFile(refPath);
    } catch {
      return json({ ok: false, error: 'The reference original is missing from disk.' }, 410);
    }

    const myBuf = Buffer.from(await file.arrayBuffer());
    if (myBuf.length === 0) return json({ ok: false, error: 'That file is empty.' }, 400);

    if (isRawFilename(file.name) && !(await canDecodeRaw())) {
      return json(
        {
          ok: false,
          error:
            'RAW decoding needs LibRaw or macOS (sips), and neither is available here. Export a JPEG from Lightroom with every slider reset and use that instead — it is the more accurate baseline anyway.',
        },
        400,
      );
    }

    const input = {
      referenceBuf,
      referenceName: ref.filename,
      referencePath: refPath,
      myBuf,
      myName: file.name,
      baseline,
    };
    const payload = (record: Awaited<ReturnType<typeof runMatch>>) => ({
      ok: true as const,
      id: record.id,
      reference: record.reference,
      mine: record.mine,
      solution: record.solution,
      preview: record.preview,
      referencePreview: record.referencePreview,
      maskChannels: record.maskChannels,
      referenceName: record.referenceName,
      myName: record.myName,
      kept: record.kept,
    });

    // Two decodes, six model passes and two full-resolution sweeps: twenty
    // seconds on a good day, considerably more on a 50MB RAW. Clients that ask
    // for it get the stages as they happen (newline-delimited JSON) instead of
    // one long silence. Everything else — the CLI probe, any older client —
    // still gets a single JSON object at the end.
    if (String(form.get('stream') || '') !== '1') {
      return json(payload(await runMatch(input)));
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) => {
          try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch { /* client went away */ }
        };
        try {
          const record = await runMatch(input, (stage) => send({ type: 'stage', stage, label: MATCH_STAGE_LABEL[stage] }));
          send({ type: 'result', ...payload(record) });
        } catch (err) {
          console.error('[match/analyse] failed', err);
          send({ type: 'result', ok: false, error: err instanceof Error ? err.message : String(err) });
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        // Stages are useless if something buffers them until the end.
        'x-accel-buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[match/analyse] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
