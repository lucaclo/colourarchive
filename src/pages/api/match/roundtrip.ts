import type { APIRoute } from 'astro';
import { analysePhoto } from '../../../lib/match/analyze';
import { atGroupStrength } from '../../../lib/match/adjustments';
import { solveAndRefine } from '../../../lib/match/engine';
import { lrTables } from '../../../lib/match/lr-tables-node';
import { buildPresetFiles } from '../../../lib/match/xmp';
import {
  calibrationRows, compareEdit, fitCalibration, followUpAdjustments, handMoves, roundTripEligibility,
  type AppliedAs,
} from '../../../lib/match/roundtrip';
import {
  activeCalibration, appendRoundTrip, calibrationRowsSoFar, listDownloads, readDownload, readRoundTrips,
} from '../../../lib/match/roundtrip-store';

export const prerender = false;

// The round trip — see lib/match/roundtrip.ts for what each answer may and
// may not claim.
//
//   GET  ?match=<id>   the presets downloaded for this match, newest first,
//                      and any round trips already checked against them
//   POST (multipart)   download=<id>, appliedAs=unchanged|changed, photo=<export>

export const GET: APIRoute = async ({ url }) => {
  const matchId = url.searchParams.get('match') || '';
  const downloads = await listDownloads(matchId);
  const ids = new Set(downloads.map((d) => d.id));
  const history = (await readRoundTrips())
    .filter((r) => ids.has(r.downloadId))
    .map(({ rows: _rows, ...rest }) => rest)
    .reverse();
  return json({ ok: true, downloads, history });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const form = await request.formData();
    const downloadId = String(form.get('download') || '');
    const appliedAs: AppliedAs = form.get('appliedAs') === 'unchanged' ? 'unchanged' : 'changed';
    const file = form.get('photo');
    if (!(file instanceof File)) return json({ ok: false, error: 'No export received.' }, 400);
    const download = await readDownload(downloadId);
    if (!download) {
      return json({ ok: false, error: 'That preset download is not on record — download the preset again, apply it, and check that export.' }, 404);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0) return json({ ok: false, error: 'That file is empty.' }, 400);
    // A finished export is a rendered image by definition — its baseline is
    // never in question, the same as a reference's.
    const edited = await analysePhoto(buf, file.name, { baseline: 'native' });

    const comparison = compareEdit(download.mine, edited, download.reference);

    // What would close the rest, at the strengths that were downloaded: a
    // lower strength was a choice, and the follow-up respects it.
    const calibration = await activeCalibration();
    const correction = solveAndRefine(download.reference, edited, { calibration, tables: await lrTables().catch(() => null) });
    const corrective = atGroupStrength(correction.restrained, correction.faithful, download.strength);
    if (!download.hadMasks) corrective.masks = [];

    let followUp: { filename: string; contents: string } | null = null;
    let moves: ReturnType<typeof handMoves> | null = null;
    if (appliedAs === 'unchanged') {
      const combined = followUpAdjustments(download.applied, corrective);
      const clean = (s: string) => s.replace(/\.[^.]+$/, '').replace(/\.[0-9a-f]{8,}$/i, '');
      const files = buildPresetFiles(combined, {
        name: `${clean(download.myName)} as ${clean(download.referenceName)} · follow-up`.slice(0, 60),
        group: 'Colour Archive',
        seed: `${download.id}:${edited.id}:follow-up`,
      });
      const chosen = download.hadMasks ? files[0] : files[files.length - 1];
      followUp = { filename: chosen.filename, contents: chosen.contents };
    } else {
      moves = handMoves(corrective);
    }

    const eligibility = roundTripEligibility({
      appliedAs,
      baseline: download.mine.baseline,
      hadMasks: download.hadMasks,
      mine: download.mine,
      edited,
    });
    const rows = eligibility.eligible ? calibrationRows(download.mine, edited, download.applied) : [];
    const record = await appendRoundTrip({
      downloadId, at: new Date().toISOString(), appliedAs,
      eligible: eligibility.eligible, reasons: eligibility.reasons,
      overall: comparison.overall, rows,
    });

    const soFar = await calibrationRowsSoFar();
    return json({
      ok: true,
      roundTrip: { id: record.id, eligible: record.eligible, reasons: record.reasons, rowsAdded: rows.length },
      comparison,
      followUp,
      moves,
      calibration: {
        proposals: fitCalibration(soFar.rows, calibration),
        eligibleRoundTrips: soFar.eligible,
        totalRoundTrips: soFar.total,
      },
    });
  } catch (err) {
    console.error('[match/roundtrip] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
