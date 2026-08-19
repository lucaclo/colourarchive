/**
 * Vendor a bright-star catalogue into public/data.
 *
 * Issue #56: the astrophotography mode points a camera at the sky and now
 * turns the map to face it, but until this there was nothing to actually
 * look *at* — no stars, no constellations, nothing to check the framing
 * against beyond an arc for the core alone. Star positions do not need a
 * live source any more than the light-pollution atlas does: a star's motion
 * across a human lifetime is unmeasurable without a telescope, so the whole
 * catalogue can be fetched once and precessed at runtime from J2000, the
 * same way `galactic.ts` already precesses the core.
 *
 * The source is the HYG Database (github.com/astronexus/HYG-Database,
 * mirrored at codeberg.org/astronexus/hyg going forward), a free compilation
 * of the Hipparcos, Yale Bright Star, and Gliese catalogues, released under
 * CC BY-SA 4.0. Filtered here to naked-eye stars (magnitude ≤ 4) — the ones
 * that actually form a recognisable sky rather than a photographic deep
 * field, and small enough to bundle as JSON rather than a binary asset.
 *
 * Constellation *lines* are deliberately not vendored from anywhere: the
 * handful of freely-available stick-figure datasets found while building
 * this turned out to carry a GPL header on the actual file despite a more
 * permissive licence being claimed in prose beside it, and mixing that into
 * a bundled asset here was not worth the ambiguity. `stars.ts` draws its own
 * stick figures instead — a minimum spanning tree over each constellation's
 * stars by angular separation — which is a real computation over this
 * file's CC BY-SA data rather than a borrowed drawing.
 *
 * Run this only if the catalogue needs revisiting (bumping the magnitude
 * limit, say) — it is not going stale on its own:
 *
 *   npm run bright-stars
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from '../src/lib/paths';

const CSV_URL = 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/v3/hyg_v38.csv.gz';
const OUT_PATH = path.join(ROOT, 'public', 'data', 'bright-stars.json');

/** Naked-eye limit under good conditions is usually quoted as mag 6; 4 keeps
 *  the catalogue to the stars that read as a sky rather than a smear, and
 *  keeps every named star and every constellation's principal stars in. */
const MAG_LIMIT = 4.0;

export interface RawStar {
  id: number;
  name: string | null;
  bayer: string | null;
  flam: string | null;
  con: string | null;
  raDeg: number;
  decDeg: number;
  mag: number;
  /** B−V colour index, or null when the catalogue has none. Used to tint a
   *  star's point roughly the colour it actually is — blue-white for a hot
   *  giant, orange for a cool one — rather than drawing every star identically. */
  ci: number | null;
}

/** A tiny RFC 4180 reader: good enough for a catalogue with no embedded
 *  newlines, and this repo has no CSV dependency to reach for instead. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function main() {
  console.log(`Fetching ${CSV_URL} …`);
  const response = await fetch(CSV_URL);
  if (!response.ok) throw new Error(`HYG fetch failed: ${response.status}`);
  const gz = Buffer.from(await response.arrayBuffer());
  const csv = zlib.gunzipSync(gz).toString('utf8');

  const lines = csv.split('\n').filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const col = Object.fromEntries(header.map((h, i) => [h, i]));

  const stars: RawStar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const id = Number(cols[col.id]);
    if (id === 0) continue; // row 0 is the Sun, which is not a point in the night sky
    const mag = parseFloat(cols[col.mag]);
    if (!Number.isFinite(mag) || mag > MAG_LIMIT) continue;
    const raHours = parseFloat(cols[col.ra]);
    const dec = parseFloat(cols[col.dec]);
    if (!Number.isFinite(raHours) || !Number.isFinite(dec)) continue;
    const ci = parseFloat(cols[col.ci]);
    stars.push({
      id,
      name: cols[col.proper] || null,
      bayer: cols[col.bayer] || null,
      flam: cols[col.flam] || null,
      con: cols[col.con] || null,
      raDeg: Math.round(raHours * 15 * 1e5) / 1e5,
      decDeg: Math.round(dec * 1e5) / 1e5,
      mag: Math.round(mag * 100) / 100,
      ci: Number.isFinite(ci) ? Math.round(ci * 100) / 100 : null,
    });
  }
  stars.sort((a, b) => a.mag - b.mag);

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(stars));
  console.log(`Wrote ${stars.length} stars (mag ≤ ${MAG_LIMIT}) to ${path.relative(ROOT, OUT_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
