import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { clusterByProximity, metresBetween } from './cluster.ts';

/** Metres north/east of a base point, as degrees. Edinburgh-ish latitude. */
const BASE = { lat: 55.9533, lon: -3.1883 };
const at = (northM: number, eastM: number, tag = '') => ({
  lat: BASE.lat + northM / 111_320,
  lon: BASE.lon + eastM / (111_320 * Math.cos(BASE.lat * (Math.PI / 180))),
  tag,
});

describe('metresBetween', () => {
  it('measures what it says it measures', () => {
    assert.ok(Math.abs(metresBetween(BASE, at(100, 0)) - 100) < 0.5);
    assert.ok(Math.abs(metresBetween(BASE, at(0, 100)) - 100) < 0.5);
    assert.ok(Math.abs(metresBetween(BASE, at(30, 40)) - 50) < 0.5);
  });
});

describe('clusterByProximity', () => {
  it('turns a crowd around one bridge into one pin, not two hundred', () => {
    // The failure this exists to prevent.
    const crowd = Array.from({ length: 200 }, (_, i) =>
      at((i % 14) * 1.5, Math.floor(i / 14) * 1.5, `p${i}`),
    );
    const clusters = clusterByProximity(crowd);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].items.length, 200);
  });

  it('keeps genuinely separate places separate', () => {
    const spots = [at(0, 0), at(2, 2), at(0, 500), at(3, 502), at(1000, 0)];
    const clusters = clusterByProximity(spots, { epsilonM: 60 });
    assert.equal(clusters.length, 3);
    assert.deepEqual(clusters.map((c) => c.items.length), [2, 2, 1]);
  });

  it('ranks the busiest place first', () => {
    const spots = [at(0, 0), at(0, 600), at(2, 602), at(4, 604), at(0, 1200), at(2, 1202)];
    const clusters = clusterByProximity(spots);
    assert.deepEqual(clusters.map((c) => c.items.length), [3, 2, 1]);
  });

  it('puts the pin at the middle of what it contains', () => {
    const clusters = clusterByProximity([at(0, 0), at(20, 0), at(40, 0)]);
    assert.equal(clusters.length, 1);
    // Centroid is the middle one, so the pin sits on the group rather than on
    // whichever photograph happened to be first.
    assert.ok(Math.abs(metresBetween(clusters[0], at(20, 0))) < 0.5);
  });

  it('reports how far across it is, so a spot can say how vague it is', () => {
    const tight = clusterByProximity([at(0, 0), at(4, 0), at(0, 4)])[0];
    const loose = clusterByProximity([at(0, 0), at(0, 50), at(0, 100)])[0];
    assert.ok(tight.spanM < 5, `${tight.spanM}`);
    assert.ok(loose.spanM > 45 && loose.spanM < 55, `${loose.spanM}`);
  });

  it('will not let a chain run away down a towpath', () => {
    // Fifty photographs, each 50 m from the next: single-link with no leash
    // makes this one 2.5 km "spot", which is not a spot at all.
    const towpath = Array.from({ length: 50 }, (_, i) => at(0, i * 50, `t${i}`));
    const clusters = clusterByProximity(towpath, { epsilonM: 60, maxSpanM: 250 });
    assert.ok(clusters.length > 1, 'the chain was leashed into several places');
    for (const cluster of clusters) {
      assert.ok(cluster.spanM <= 250 + 1e-6, `a cluster ran to ${cluster.spanM} m`);
    }
    // Nothing is lost in the process.
    assert.equal(clusters.reduce((n, c) => n + c.items.length, 0), 50);
  });

  it('honours a tighter epsilon', () => {
    const spots = [at(0, 0), at(0, 40)];
    assert.equal(clusterByProximity(spots, { epsilonM: 60 }).length, 1);
    assert.equal(clusterByProximity(spots, { epsilonM: 20 }).length, 2);
  });

  it('copes with nothing, and with one', () => {
    assert.deepEqual(clusterByProximity([]), []);
    const one = clusterByProximity([at(0, 0)]);
    assert.equal(one.length, 1);
    assert.equal(one[0].spanM, 0);
  });

  it('never loses or duplicates a photograph', () => {
    const spots = Array.from({ length: 120 }, (_, i) =>
      at(((i * 37) % 100) * 6, ((i * 53) % 100) * 6, `s${i}`),
    );
    const clusters = clusterByProximity(spots);
    const tags = clusters.flatMap((c) => c.items.map((i) => i.tag));
    assert.equal(tags.length, 120);
    assert.equal(new Set(tags).size, 120);
  });
});
