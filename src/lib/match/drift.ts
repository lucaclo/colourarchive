/**
 * Your own look (issue #144): which photographs drift from their chapter's
 * grade, and which ones carry it.
 *
 * Every photo is set against its chapter's DNA measured *without it*
 * (chapter-dna.ts, leave-one-out, so a strong outlier can't drag the middle
 * towards itself), with the same `compareLooks` the rest of Style Match uses.
 * Past CLOSE_ENOUGH it is named, with the part that differs most and which
 * way ("Warmer shadows than the rest of Red"). A hint, not a verdict: the
 * archive is ordered by colour, and a chapter can hold more than one look.
 * The closest few are the chapter's look at its plainest, which is what
 * "Match this chapter's look" hands Style Match as references.
 */
import { chapterDna, MIN_CHAPTER_PHOTOS } from './chapter-dna';
import { compareLooks, CLOSE_ENOUGH, splitVector, type LookPart, type LookSignature } from './resemble';

export interface Drifter { id: string; distance: number; part: LookPart; reason: string }
export interface ChapterDrift { key: string; name: string; drifters: Drifter[]; typical: string[] }

const SHOWN = 3;

/**
 * The part to name. Usually the furthest one; but how bright a frame is
 * follows its subject as much as its grade, so when a colour part (cast,
 * split, saturation) is also a full regrade apart, that's the more telling
 * thing to say.
 */
export function namedPart(parts: Partial<Record<LookPart, number>>): LookPart {
  const all = (Object.entries(parts) as [LookPart, number][]).sort((a, b) => b[1] - a[1]);
  const colour = all.find(([p, v]) => (p === 'cast' || p === 'split' || p === 'saturation') && v >= 1);
  return (all[0][0] === 'tone' || all[0][0] === 'contrast') && colour ? colour[0] : all[0][0];
}
const TYPICAL = 3;

/** Which way a photo differs from the DNA on one part, in words. */
export function driftReason(sig: LookSignature, dna: LookSignature, part: LookPart, chapter: string): string {
  const g = sig.regions.global, d = dna.regions.global;
  const rest = `than the rest of ${chapter}`;
  if (!g || !d) return `A different grade ${rest}`;
  switch (part) {
    case 'tone': {
      const mid = (r: typeof g) => r.percentiles[10] ?? r.L.mean;
      return `${mid(g) > mid(d) ? 'Brighter' : 'Darker'} ${rest}`;
    }
    case 'cast': {
      const da = g.ab.a - d.ab.a, db = g.ab.b - d.ab.b;
      const word = Math.abs(db) >= Math.abs(da) ? (db > 0 ? 'Warmer' : 'Cooler') : da > 0 ? 'More magenta' : 'Greener';
      return `${word} ${rest}`;
    }
    case 'saturation':
      return `${g.C.mean > d.C.mean ? 'More saturated' : 'More muted'} ${rest}`;
    case 'contrast':
      return `${g.L.sd > d.L.sd ? 'More contrast' : 'Flatter'} ${rest}`;
    case 'split': {
      const s = sig.regions['zone.shadow'], ds = dna.regions['zone.shadow'];
      const h = sig.regions['zone.highlight'], dh = dna.regions['zone.highlight'];
      const sb = s && ds ? s.ab.b - ds.ab.b : 0, hb = h && dh ? h.ab.b - dh.ab.b : 0;
      if (!splitVector(sig) || Math.abs(sb) + Math.abs(hb) === 0) return `Split differently ${rest}`;
      return Math.abs(sb) >= Math.abs(hb)
        ? `${sb > 0 ? 'Warmer' : 'Cooler'} shadows ${rest}`
        : `${hb > 0 ? 'Warmer' : 'Cooler'} highlights ${rest}`;
    }
  }
}

/** Drift for every chapter with enough measured photos to have a look. */
export function chapterDrift(chapters: { key: string; name: string; ids: string[] }[], signatures: Map<string, LookSignature>): ChapterDrift[] {
  const out: ChapterDrift[] = [];
  for (const ch of chapters) {
    const sigs = ch.ids.map((id) => signatures.get(id)).filter((s): s is LookSignature => Boolean(s));
    if (sigs.length < MIN_CHAPTER_PHOTOS + 1) continue;
    const scored = sigs.map((sig) => {
      const dna = chapterDna(sigs.filter((o) => o !== sig))!;
      const res = compareLooks(dna, sig);
      return { sig, dna, res };
    }).filter((x) => Number.isFinite(x.res.distance));
    const drifters = scored
      .filter((x) => x.res.distance > CLOSE_ENOUGH)
      .sort((a, b) => b.res.distance - a.res.distance)
      .slice(0, SHOWN)
      .map((x) => {
        const part = namedPart(x.res.parts);
        return { id: x.sig.id, distance: Math.round(x.res.distance * 100) / 100, part, reason: driftReason(x.sig, x.dna, part, ch.name) };
      });
    const typical = [...scored].sort((a, b) => a.res.distance - b.res.distance).slice(0, TYPICAL).map((x) => x.sig.id);
    out.push({ key: ch.key, name: ch.name, drifters, typical });
  }
  return out;
}
