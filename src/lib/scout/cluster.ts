/**
 * Photographs into places.
 *
 * Two hundred pictures of one bridge are not two hundred spots. Dropped on a
 * map unclustered they are an unreadable smear that hides the very thing they
 * are evidence of — that this bridge is worth photographing — and this is
 * precisely where the existing spot-discovery maps fall down.
 *
 * So photographs are grouped into *hotspots*: a cluster is somewhere people
 * repeatedly point a camera, and its weight is how many of them did.
 *
 * ## Connected components, with a leash
 *
 * The grouping is single-link — two photographs closer than `epsilonM` belong
 * together, and that relation is followed transitively. This is DBSCAN with a
 * minimum of one, and it is the right shape because a hotspot has no
 * characteristic size: a doorway is ten metres across and a viaduct is three
 * hundred, and a fixed grid would cut the viaduct in half at a cell boundary
 * for no reason a photographer would recognise.
 *
 * The price of single-link is chaining: a line of photographs each just inside
 * `epsilonM` of the next will run away along a whole riverbank and come back
 * as one "spot" that is really a mile of towpath. So the growth is leashed —
 * a photograph is refused if taking it would stretch the cluster past
 * `maxSpanM`. That converts a runaway chain into several honest neighbours,
 * and it is why `spanM` is reported: a cluster that is 300 m across is a
 * different claim from one that is 12 m across, and the caller should be able
 * to say so.
 *
 * Pure, and deterministic for a given input order.
 */

export interface Located {
  lat: number;
  lon: number;
}

export interface Cluster<T> {
  /** Mean position of the members — where the pin goes. */
  lat: number;
  lon: number;
  items: T[];
  /** Greatest distance between any member and the centroid, metres. */
  spanM: number;
}

export interface ClusterOptions {
  /** How close two photographs must be to be the same place. */
  epsilonM?: number;
  /** How far a single cluster may ever stretch, which is the anti-chaining leash. */
  maxSpanM?: number;
}

const EARTH_R = 6_371_000;
const RAD = Math.PI / 180;

/**
 * Flat-earth distance in metres.
 *
 * Right for the scale this operates at — tens to hundreds of metres — where
 * the error against a proper geodesic is millimetres, and wrong only for
 * distances this function is never asked about.
 */
export function metresBetween(a: Located, b: Located): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD * Math.cos(((a.lat + b.lat) / 2) * RAD);
  return Math.hypot(dLat, dLon) * EARTH_R;
}

function centroid<T extends Located>(items: T[]): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  for (const item of items) {
    lat += item.lat;
    lon += item.lon;
  }
  return { lat: lat / items.length, lon: lon / items.length };
}

function spanOf<T extends Located>(items: T[], at: Located): number {
  let span = 0;
  for (const item of items) span = Math.max(span, metresBetween(item, at));
  return span;
}

/**
 * Group by proximity. Returns clusters biggest first, which is the order a
 * ranked list of hotspots wants them in.
 */
export function clusterByProximity<T extends Located>(
  items: T[],
  { epsilonM = 60, maxSpanM = 250 }: ClusterOptions = {},
): Array<Cluster<T>> {
  const unassigned = items.map((item, index) => ({ item, index }));
  const taken = new Set<number>();
  const clusters: Array<Cluster<T>> = [];

  for (const seed of unassigned) {
    if (taken.has(seed.index)) continue;
    taken.add(seed.index);

    const members: T[] = [seed.item];
    // Breadth-first over the epsilon graph. `frontier` holds the members whose
    // neighbours have not been looked at yet.
    let frontier: T[] = [seed.item];

    while (frontier.length) {
      const next: T[] = [];
      for (const from of frontier) {
        for (const candidate of unassigned) {
          if (taken.has(candidate.index)) continue;
          if (metresBetween(from, candidate.item) > epsilonM) continue;

          // The leash: refuse anything that would stretch this cluster past
          // what one place can plausibly be. It stays unassigned and will seed
          // or join a neighbouring cluster instead.
          const trial = [...members, candidate.item];
          if (spanOf(trial, centroid(trial)) > maxSpanM) continue;

          taken.add(candidate.index);
          members.push(candidate.item);
          next.push(candidate.item);
        }
      }
      frontier = next;
    }

    const at = centroid(members);
    clusters.push({ ...at, items: members, spanM: spanOf(members, at) });
  }

  return clusters.sort((a, b) => b.items.length - a.items.length);
}
