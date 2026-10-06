import type { APIRoute } from 'astro';
import { DEFAULT_CALIBRATION, type Calibration } from '../../../lib/match/calibration';
import { fitCalibration, NOT_FROM_ROUND_TRIPS } from '../../../lib/match/roundtrip';
import { activeCalibration, calibrationRowsSoFar, readApproved, writeApproved } from '../../../lib/match/roundtrip-store';

export const prerender = false;

// The calibration fitted from round trips, and the person's decision about
// it. Nothing reaches the solver until it is applied here, one constant at a
// time — the same "look before you paste" rule CALIBRATION.md sets for the
// probe harness, with the paste made a button.
//
//   GET                         proposals, what is applied, what cannot be learned
//   POST { apply: [keys] }      apply those constants' current fits
//   POST { reset: [keys] }      return those constants to the estimate

export const GET: APIRoute = async () => json({ ok: true, ...(await state()) });

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const known = (keys: unknown): Array<keyof Calibration> =>
      Array.isArray(keys) ? keys.filter((k): k is keyof Calibration => typeof k === 'string' && k in DEFAULT_CALIBRATION) : [];
    const approved = await readApproved();

    if (body.apply) {
      const { rows } = await calibrationRowsSoFar();
      const proposals = fitCalibration(rows, await activeCalibration());
      const refused: string[] = [];
      for (const key of known(body.apply)) {
        const p = proposals.find((x) => x.key === key);
        // Only a clean fit is applied. The UI never offers anything else, so
        // a refusal here means the fit changed under the click.
        if (!p || p.status !== 'fitted' || p.value === undefined) { refused.push(key); continue; }
        approved.values[key] = p.value;
        approved.meta[key] = { at: new Date().toISOString(), points: p.points };
      }
      await writeApproved(approved);
      return json({ ok: true, refused, ...(await state()) });
    }
    if (body.reset) {
      for (const key of known(body.reset)) {
        delete approved.values[key];
        delete approved.meta[key];
      }
      await writeApproved(approved);
      return json({ ok: true, ...(await state()) });
    }
    return json({ ok: false, error: 'Need { apply: [keys] } or { reset: [keys] }.' }, 400);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

async function state() {
  const [{ rows, eligible, total }, approved, active] = await Promise.all([
    calibrationRowsSoFar(), readApproved(), activeCalibration(),
  ]);
  return {
    proposals: fitCalibration(rows, active),
    approved,
    applied: Object.keys(approved.values).length,
    eligibleRoundTrips: eligible,
    totalRoundTrips: total,
    notFromRoundTrips: NOT_FROM_ROUND_TRIPS,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
