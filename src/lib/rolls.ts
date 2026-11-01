/**
 * Film rolls, inferred from the scans (issue #146).
 *
 * A lab scans a roll as one batch, so its frames share a scanner and its
 * software, and their file numbers run on with small gaps (frames not kept).
 * That's enough to put every film scan in a roll, number the rolls in file
 * order, and label each frame from its file number — "Frame 8, Roll 1" — so
 * film captions stop repeating the same generated sentence.
 *
 * Signals, in order: the scanner model (an EZ Controller scan is never on the
 * same roll as a QSS one); the scanner software's version when both frames
 * carry one (different labs, different versions); and a jump in file number
 * past MAX_GAP. Software that isn't the scanner's (a lab's Photoshop pass)
 * says nothing either way. The import day was considered and left out: the
 * archive's own scans were added over two days in mixed order.
 *
 * Pure. The archive's captions, the lightbox's "Same roll" and the Mac's
 * roll titles (api/rolls.ts) all call it.
 */

export interface RollInput {
  id: string;
  filename: string;
  camera?: string;
  software?: string;
  capturedAt?: string;
}

export interface Roll {
  /** Stable while the scans are: scanner and first file number. */
  key: string;
  /** 1-based, in file-number order. */
  number: number;
  ids: string[];
  /** id → "8", or "8b" for a second scan of the same frame. */
  frames: Record<string, string>;
  /** The dated frames' first and last day, if any. */
  dates: [string, string] | null;
}

export const MAX_GAP = 40;

/** "IMG_2686-2.41cf….jpeg" → { n: 2686, variant: 1 }. */
export function fileNumber(filename: string): { n: number; variant: number } | null {
  const base = filename.split('.')[0];
  const m = base.match(/(\d{3,})(?:[-_ ](\d))?$/) ?? base.match(/(\d{3,})/);
  if (!m) return null;
  return { n: Number(m[1]), variant: m[2] ? Math.max(0, Number(m[2]) - 1) : 0 };
}

const model = (camera?: string) => (camera ?? '').replace(/^NORITSU KOKI\s*/i, '').trim().toLowerCase() || 'unknown';
/** The scanner software's version, or null when it's some other program's. */
function scannerVersion(software?: string, camera?: string): string | null {
  if (!software) return null;
  const m = software.match(/^(EZ Controller|QSS[-\w]*|Frontier[\w ]*|SilverFast|VueScan)\s+([\d.]+)/i);
  if (!m) return camera && software.toLowerCase().includes(model(camera)) ? software : null;
  return `${m[1].toLowerCase()} ${m[2].split('.').slice(0, 2).join('.')}`;
}

export function inferRolls(photos: readonly RollInput[]): Roll[] {
  const items = photos
    .map((p) => ({ p, num: fileNumber(p.filename), model: model(p.camera), version: scannerVersion(p.software, p.camera) }))
    .sort((a, b) => a.model.localeCompare(b.model) || (a.num?.n ?? Infinity) - (b.num?.n ?? Infinity) || (a.num?.variant ?? 0) - (b.num?.variant ?? 0) || a.p.filename.localeCompare(b.p.filename));

  const groups: (typeof items)[] = [];
  for (const item of items) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    const version = group?.find((g) => g.version)?.version ?? null;
    const sameRoll = last && last.model === item.model
      && (last.num && item.num ? item.num.n - last.num.n <= MAX_GAP : !last.num && !item.num)
      && !(version && item.version && version !== item.version);
    if (sameRoll) group!.push(item);
    else groups.push([item]);
  }

  // Numbered by where the roll starts in file order, scanners interleaved.
  groups.sort((a, b) => (a[0].num?.n ?? Infinity) - (b[0].num?.n ?? Infinity) || a[0].model.localeCompare(b[0].model));
  return groups.map((g, i) => {
    const first = g[0].num?.n;
    const frames: Record<string, string> = {};
    g.forEach((item, k) => {
      frames[item.p.id] = item.num && first != null
        ? `${item.num.n - first + 1}${item.num.variant ? String.fromCharCode(97 + item.num.variant) : ''}`
        : String(k + 1);
    });
    const dated = g.map((x) => x.p.capturedAt).filter((d): d is string => Boolean(d)).sort();
    return {
      key: `${g[0].model.replace(/[^a-z0-9]+/g, '-')}-${first ?? i}`,
      number: i + 1,
      ids: g.map((x) => x.p.id),
      frames,
      dates: dated.length ? [dated[0].slice(0, 10), dated.at(-1)!.slice(0, 10)] : null,
    };
  });
}

/** "Frame 8, Roll 1". */
export const frameCaption = (roll: Roll, id: string): string => `Frame ${roll.frames[id]}, Roll ${roll.number}`;

const month = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "Roll 4 · Kyoto · Mar 2025", or a name given by hand. */
export function rollTitle(roll: Roll, place?: string | null, custom?: string | null): string {
  if (custom?.trim()) return custom.trim();
  const when = roll.dates ? (month(roll.dates[0]) === month(roll.dates[1]) ? month(roll.dates[0]) : `${month(roll.dates[0])} – ${month(roll.dates[1])}`) : '';
  return [`Roll ${roll.number}`, place, when].filter(Boolean).join(' · ');
}
