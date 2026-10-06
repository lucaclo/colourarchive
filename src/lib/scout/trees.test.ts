import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { distance } from './geo.ts';
import type { Ring } from './shadows.ts';
import {
  crownRing,
  DEFAULT_TREE_HEIGHT_M,
  overpassTreeQuery,
  parseOverpassTrees,
  pointInRing,
  scatterTrees,
  treeParts,
  type Tree,
} from './trees.ts';

/** A square about 200 m on a side in Central Park. */
const PARK: Ring = [
  [-73.972, 40.771],
  [-73.9696, 40.771],
  [-73.9696, 40.7728],
  [-73.972, 40.7728],
  [-73.972, 40.771],
];
const BOX = { west: -73.975, south: 40.769, east: -73.965, north: 40.775 };

describe('parseOverpassTrees', () => {
  it('reads nodes, tagged heights and crowns, and skips everything else', () => {
    const trees = parseOverpassTrees({
      elements: [
        { type: 'node', id: 1, lat: 40.771, lon: -73.97, tags: { natural: 'tree', height: '18 m', diameter_crown: '9' } },
        { type: 'node', id: 2, lat: 40.772, lon: -73.971, tags: { natural: 'tree' } },
        { type: 'node', id: 3, lat: 40.773, lon: -73.972, tags: { natural: 'tree', est_height: '6.5m' } },
        { type: 'way', id: 4, tags: { natural: 'tree_row' } },
        { type: 'node', id: 5, tags: { natural: 'tree' } },
      ],
    });
    assert.equal(trees.length, 3);
    assert.deepEqual([trees[0].heightM, trees[0].crownM, trees[0].heightKnown], [18, 9, true]);
    assert.equal(trees[1].heightM, DEFAULT_TREE_HEIGHT_M);
    assert.equal(trees[1].heightKnown, false);
    assert.equal(trees[2].heightM, 6.5);
    assert.ok(trees.every((t) => !t.estimated));
  });

  it('ignores nonsense heights rather than drawing a 900 m tree', () => {
    const [tree] = parseOverpassTrees({
      elements: [{ type: 'node', lat: 1, lon: 1, tags: { height: '900' } }],
    });
    assert.equal(tree.heightM, DEFAULT_TREE_HEIGHT_M);
    assert.equal(tree.heightKnown, false);
  });

  it('survives an answer that is not an answer', () => {
    assert.deepEqual(parseOverpassTrees(null), []);
    assert.deepEqual(parseOverpassTrees({ remark: 'runtime error' }), []);
  });
});

describe('overpassTreeQuery', () => {
  it('asks in south, west, north, east order, as Overpass wants', () => {
    assert.match(overpassTreeQuery(BOX), /node\["natural"="tree"\]\(40\.76900,-73\.97500,40\.77500,-73\.96500\)/);
  });
});

describe('scatterTrees', () => {
  it('only places trees inside the area', () => {
    const trees = scatterTrees([{ ring: PARK, kind: 'park' }], BOX, []);
    assert.ok(trees.length > 10, `expected a stand of trees, got ${trees.length}`);
    for (const t of trees) assert.ok(pointInRing(PARK, t.lon, t.lat));
    assert.ok(trees.every((t) => t.estimated && !t.heightKnown));
  });

  it('grows the same trees however the view is framed', () => {
    const a = scatterTrees([{ ring: PARK, kind: 'park' }], BOX, []);
    const b = scatterTrees([{ ring: PARK, kind: 'park' }], { ...BOX, west: -73.99, north: 40.78 }, []);
    assert.deepEqual(a, b);
  });

  it('plants woods densely and parks sparsely', () => {
    const park = scatterTrees([{ ring: PARK, kind: 'park' }], BOX, []);
    const wood = scatterTrees([{ ring: PARK, kind: 'wood' }], BOX, []);
    assert.ok(wood.length > park.length * 3);
  });

  it('leaves a surveyed park to its mapped trees', () => {
    const mapped: Tree[] = [];
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 8; j++) {
        mapped.push({
          lon: -73.9718 + i * 0.0002,
          lat: 40.7712 + j * 0.0002,
          heightM: 10,
          crownM: 6,
          estimated: false,
          heightKnown: false,
        });
      }
    }
    assert.equal(scatterTrees([{ ring: PARK, kind: 'park' }], BOX, mapped).length, 0);
  });

  it('keeps estimates off the crown of a mapped tree', () => {
    const lone: Tree = { lon: -73.9708, lat: 40.7719, heightM: 20, crownM: 30, estimated: false, heightKnown: true };
    for (const t of scatterTrees([{ ring: PARK, kind: 'park' }], BOX, [lone])) {
      assert.ok(distance(t, lone) >= (t.crownM + lone.crownM) / 2);
    }
  });

  it('plants nothing in water inside the park', () => {
    const lake: Ring = [
      [-73.9712, 40.7716],
      [-73.9704, 40.7716],
      [-73.9704, 40.7722],
      [-73.9712, 40.7722],
      [-73.9712, 40.7716],
    ];
    const trees = scatterTrees([{ ring: PARK, kind: 'wood' }], BOX, [], 2500, [lake]);
    assert.ok(trees.length > 0);
    assert.ok(trees.every((t) => !pointInRing(lake, t.lon, t.lat)));
  });

  it('thins evenly to the limit rather than filling one side', () => {
    const all = scatterTrees([{ ring: PARK, kind: 'wood' }], BOX, []);
    const some = scatterTrees([{ ring: PARK, kind: 'wood' }], BOX, [], 25);
    assert.equal(some.length, 25);
    // Stopping part-way through a west-to-east walk kept only the western
    // edge. Even thinning spreads the kept trees across the whole width.
    const lons = all.map((t) => t.lon);
    const mid = (Math.min(...lons) + Math.max(...lons)) / 2;
    const east = some.filter((t) => t.lon > mid).length;
    assert.ok(east > 5 && east < 20, `east half kept ${east} of 25`);
    // And the same 25 every time.
    assert.deepEqual(scatterTrees([{ ring: PARK, kind: 'wood' }], BOX, [], 25), some);
  });
});

describe('treeParts', () => {
  const tree: Tree = { lon: -73.97, lat: 40.772, heightM: 15, crownM: 8, estimated: false, heightKnown: true };

  it('stacks a trunk and two crown tiers up to the tree top', () => {
    const parts = treeParts(tree);
    assert.deepEqual(parts.map((p) => p.part), ['trunk', 'crown', 'crown']);
    assert.equal(parts[2].top, 15);
    assert.equal(parts[1].top, parts[2].base);
    assert.ok(parts[0].top > parts[1].base, 'trunk runs up into the crown, no gap');
  });

  it('draws a crown of the stated diameter', () => {
    const ring = crownRing(tree, 4);
    assert.equal(ring.length, 9);
    assert.deepEqual(ring[0], ring[8]);
    for (const [lon, lat] of ring) assert.ok(Math.abs(distance(tree, { lon, lat }) - 4) < 0.05);
  });
});
