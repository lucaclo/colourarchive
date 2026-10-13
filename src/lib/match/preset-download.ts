/**
 * One match's preset file at a given strength, and the round-trip record of
 * what it sets. Shared by /api/match/preset (one file) and
 * /api/match/presets.zip (a batch, one file per photo), so a preset from a
 * batch is exactly the file a single download would have been.
 */
import { atGroupStrength } from './adjustments';
import { buildPresetFiles } from './xmp';
import { recordDownload } from './roundtrip-store';
import type { getMatch } from './session';

type MatchRecord = NonNullable<ReturnType<typeof getMatch>>;
export interface GroupStrength { light: number; colour: number; effects: number }

export async function presetDownload(
  record: MatchRecord,
  groupStrength: GroupStrength,
  variant: 'full' | 'safe',
): Promise<{ filename: string; contents: string }> {
  const adj = atGroupStrength(record.solution.restrained, record.solution.faithful, groupStrength);
  // Extension first, THEN the archive's content-hash suffix — the hash is
  // never at the end of the string while ".jpg" is still attached, so doing
  // it the other way round leaves the hash in the name Lightroom displays.
  const clean = (s: string) => s.replace(/\.[^.]+$/, '').replace(/\.[0-9a-f]{8,}$/i, '');
  const name = `${clean(record.myName)} as ${clean(record.referenceName)}`.slice(0, 60);

  const files = buildPresetFiles(adj, {
    name,
    group: 'Colour Archive',
    seed: `${record.id}:${groupStrength.light.toFixed(2)}:${groupStrength.colour.toFixed(2)}:${groupStrength.effects.toFixed(2)}`,
  });

  // buildPresetFiles returns the masked preset first when masks exist, and
  // always ends with the mask-free one.
  const chosen = variant === 'safe' ? files[files.length - 1] : files[0];

  // What this file sets, recorded now — the only moment it is certain —
  // so a later round trip can be checked against it. See roundtrip-store.ts.
  const hadMasks = variant === 'full' && files.length > 1;
  await recordDownload({
    matchId: record.id,
    strength: groupStrength,
    variant,
    hadMasks,
    // Only the masks the file can carry — a 'manual' one is described, never written.
    applied: { ...adj, masks: hadMasks ? adj.masks.filter((m) => m.kind !== 'manual') : [] },
    mine: record.mine,
    reference: record.reference,
    myName: record.myName,
    referenceName: record.referenceName,
  }).catch((err) => console.error('[match/preset] could not record the download', err));

  return { filename: chosen.filename, contents: chosen.contents };
}

/** Strength from query parameters: the flat `strength`, or per-group `light`/`colour`/`effects`. */
export function strengthFromParams(params: URLSearchParams): GroupStrength {
  const clampUnit = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5);
  const strength = clampUnit(Number(params.get('strength') ?? '0.5'));
  const param = (key: string): number => {
    const raw = params.get(key);
    return raw === null ? strength : clampUnit(Number(raw));
  };
  return { light: param('light'), colour: param('colour'), effects: param('effects') };
}
