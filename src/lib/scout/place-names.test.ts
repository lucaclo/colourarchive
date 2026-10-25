import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { destination } from './geo.ts';
import { placeNameFor, type NamedPlace } from './place-names.ts';

const spot = { lat: 40.7308, lon: -73.9973 };
const off = (metres: number, bearing = 90) => destination(spot, bearing, metres);
const poi = (name: string, metres: number, cls: string, subclass?: string): NamedPlace => ({
  kind: 'poi',
  name,
  at: off(metres),
  class: cls,
  subclass,
});
const square = (half: number): [number, number][] => {
  const d = half / 111_320;
  const e = half / (111_320 * Math.cos((spot.lat * Math.PI) / 180));
  return [
    [spot.lon - e, spot.lat - d],
    [spot.lon + e, spot.lat - d],
    [spot.lon + e, spot.lat + d],
    [spot.lon - e, spot.lat + d],
    [spot.lon - e, spot.lat - d],
  ];
};

describe('placeNameFor', () => {
  it('names a spot after the nearest landmark', () => {
    const places = [poi('Washington Square Arch', 40, 'monument'), poi('Judson Memorial Church', 70, 'place_of_worship')];
    assert.equal(placeNameFor(spot, places), 'Washington Square Arch');
  });

  it('never names a spot after a shop, however close', () => {
    assert.equal(placeNameFor(spot, [poi('Blue Bottle Coffee', 5, 'cafe')]), null);
  });

  it('takes a landmark subclass filed under an ordinary class', () => {
    assert.equal(placeNameFor(spot, [poi('Fountain', 12, 'amenity', 'fountain')]), 'Fountain');
  });

  it('ignores landmarks too far away to be what the spot is at', () => {
    assert.equal(placeNameFor(spot, [poi('Far Monument', 300, 'monument')]), null);
  });

  it('falls back to the park the spot stands in, with a nearby landmark winning', () => {
    const park: NamedPlace = { kind: 'park', name: 'Washington Square Park', rings: [square(150)] };
    assert.equal(placeNameFor(spot, [park]), 'Washington Square Park');
    assert.equal(placeNameFor(spot, [park, poi('Arch', 30, 'monument')]), 'Arch');
  });

  it('does not put a spot in a park when it is in one of its holes', () => {
    const park: NamedPlace = { kind: 'park', name: 'Park', rings: [square(150), square(20)] };
    assert.equal(placeNameFor(spot, [park]), null);
  });
});
